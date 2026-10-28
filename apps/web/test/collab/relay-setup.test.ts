/** Relay setup: the command builders, the relay test and the process runners over a scripted host. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { DEFAULT_LIMITS, MultiplayerError, PROTOCOL, type RelayInfo } from "@kimo/sync/mp"
import {
  autoOrigins,
  flyDeploySteps,
  flyToml,
  originsValue,
} from "../../src/multiplayer/relay-setup/commands"
import { createFakeRelayHost } from "../../src/multiplayer/relay-setup/host"
import { cloudflared, parseQuickTunnelUrl } from "../../src/multiplayer/relay-setup/local"
import {
  RELAY_SETUP_TEST_MS,
  type RelayTestDeps,
  testRelaySetup,
} from "../../src/multiplayer/relay-setup/relay-test"
import { type Clock, LocalRelay, runFlySteps } from "../../src/multiplayer/relay-setup/runner"
import {
  createRelaySetupStore,
  EMPTY_SETUP,
  parseSetup,
  serializeSetup,
} from "../../src/multiplayer/relay-setup/store"

/** A manual clock: timers fire only on `advance`. */
function fakeClock(start = 1_000_000) {
  let now = start
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const clock: Clock & { advance(ms: number): void; pending(): number } = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout(h) {
      timers.delete(h as number)
    },
    advance(ms) {
      const until = now + ms
      for (let guard = 0; guard < 10_000; guard++) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = until
    },
    pending: () => timers.size,
  }
  return clock
}

const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// --- Commands ----------------------------------------------------------------------------------------

describe("commands", () => {
  const ownerKey = "3eO8zsfzpmoRFfRdcg9NwTXDrnxOItyjj9se_WpJX_g"
  test("allowed origins: the page's origin on web, none on desktop, extra deduplicated", () => {
    expect(autoOrigins("web", "https://design.maya.studio/editor?x=1")).toEqual([
      "https://design.maya.studio",
    ])
    expect(autoOrigins("desktop", "tauri://localhost")).toEqual([])
    expect(originsValue([])).toBeNull()
    expect(
      originsValue(["https://a.example/", "https://a.example", "nonsense", "http://b.local:3000"]),
    ).toBe("https://a.example,http://b.local:3000")
  })

  test("flyctl deploy steps: the key goes through stdin, never an argument", () => {
    const steps = flyDeploySteps({
      app: "kimo-relay-maya",
      region: "ams",
      config: "/x/fly.toml",
      ownerKey,
      origins: [],
    })
    expect(steps.find((s) => s.stdin)?.stdin).toBe(`KIMO_OWNER_KEY=${ownerKey}\n`)
    expect(steps.flatMap((s) => s.args ?? []).join(" ")).not.toContain(ownerKey)
  })

  test("the one-click fly.toml is apps/server/deploy/fly.toml with this app and region", () => {
    const repo = readFileSync(join(import.meta.dir, "../../../server/deploy/fly.toml"), "utf8")
    const body = (text: string) =>
      text
        .split("\n")
        .filter((l) => !l.startsWith("#"))
        .join("\n")
        .trim()
    const ours = flyToml({ app: "my-kimo-relay", region: "iad" })
    expect(body(ours)).toBe(body(repo))
  })
})

// --- This computer pieces ------------------------------------------------------------------------------

describe("local relay pieces", () => {
  test("quick tunnel address from cloudflared's output", () => {
    const line =
      "2025-10-20T10:00:00Z INF |  https://quiet-otter-lime.trycloudflare.com                  |"
    expect(parseQuickTunnelUrl(line)).toBe("wss://quiet-otter-lime.trycloudflare.com")
    expect(parseQuickTunnelUrl("Requesting new quick Tunnel on trycloudflare.com...")).toBeNull()
    expect(parseQuickTunnelUrl("https://api.trycloudflare.com/tunnel")).toBeNull()
  })
})

// --- Test and save -------------------------------------------------------------------------------------

const info = (owner: RelayInfo["owner"] = "unclaimed"): RelayInfo => ({
  relayUrl: "https://relay.maya.studio",
  name: "@kimo/server",
  version: "1.0.0",
  protocol: PROTOCOL,
  limits: DEFAULT_LIMITS,
  relayId: new Uint8Array(16),
  owner,
})

function testDeps(
  clock: ReturnType<typeof fakeClock>,
  probe: RelayTestDeps["probe"],
  ownership: Partial<Pick<RelayTestDeps, "ownership" | "claim">> = {},
): RelayTestDeps {
  return {
    probe,
    ownership: ownership.ownership ?? (async () => "yours"),
    claim: ownership.claim ?? (async () => {}),
    ...clock,
  }
}

describe("relay test", () => {
  test("an unclaimed relay is claimed by the test", async () => {
    const clock = fakeClock()
    const claimed: string[] = []
    const result = await testRelaySetup(
      "wss://relay.maya.studio",
      testDeps(clock, async () => info("unclaimed"), {
        claim: async (url) => {
          claimed.push(url)
        },
      }),
    )
    expect(result.outcome).toBe("ok")
    expect(result.owned).toBe("claimed")
    expect(result.url).toBe("https://relay.maya.studio")
    expect(claimed).toEqual(["https://relay.maya.studio"])
    expect(clock.pending()).toBe(0)
  })

  test("external owner policy (Kimo Cloud): ok with nothing claimed or listed", async () => {
    const clock = fakeClock()
    let asked = 0
    const r = await testRelaySetup(
      "https://relay.maya.studio",
      testDeps(clock, async () => info("external"), {
        claim: async () => {
          asked++
        },
        ownership: async () => {
          asked++
          return "other"
        },
      }),
    )
    expect(r.outcome).toBe("ok")
    expect(r.owned).toBe("external")
    expect(asked).toBe(0)
    expect(clock.pending()).toBe(0)
  })

  test("belongs to another Kimo, also when another claim won the race", async () => {
    const clock = fakeClock()
    const other = await testRelaySetup(
      "https://relay.maya.studio",
      testDeps(clock, async () => info("claimed"), { ownership: async () => "other" }),
    )
    expect(other.outcome).toBe("not-yours")
    const raced = await testRelaySetup(
      "https://relay.maya.studio",
      testDeps(clock, async () => info("unclaimed"), {
        claim: async () => {
          throw new MultiplayerError("RELAY_CLAIMED", "this relay already has an owner")
        },
        ownership: async () => "other",
      }),
    )
    expect(raced.outcome).toBe("not-yours")
  })

  test("a relay that never answers is unreachable after 5 s; a non-http URL is invalid", async () => {
    const clock = fakeClock()
    const pending = testRelaySetup(
      "https://relay.maya.studio",
      testDeps(clock, () => new Promise<RelayInfo>(() => {})),
    )
    await flush()
    clock.advance(RELAY_SETUP_TEST_MS)
    expect((await pending).outcome).toBe("unreachable")
    const bad = await testRelaySetup(
      "ftp://x",
      testDeps(clock, async () => info()),
    )
    expect(bad.outcome).toBe("invalid")
  })
})

// --- Settings persistence ---------------------------------------------------------------------------------

describe("relay setup store", () => {
  test("parse is lenient and serialize round-trips", () => {
    expect(parseSetup(null)).toEqual(EMPTY_SETUP)
    const parsed = parseSetup({
      path: "local",
      extraOrigins: ["https://a.b", "" as string],
      local: { port: 8788, reach: "quick", hostname: null },
      fly: { app: "kimo-relay-maya", region: "ams", byKimo: true },
    })
    expect(parsed).toEqual({
      path: "local",
      extraOrigins: ["https://a.b"],
      local: { port: 8788, reach: "quick", hostname: null },
      fly: { app: "kimo-relay-maya", region: "ams", byKimo: true },
    })
    expect(parseSetup(serializeSetup(parsed))).toEqual(parsed)
    expect(
      parseSetup({ path: "moon" as "local", local: { port: -1, reach: "x" as "lan" } }),
    ).toEqual({
      ...EMPTY_SETUP,
      local: { port: 8787, reach: "lan", hostname: null },
    })
  })

  test("settings hold the choices, and nothing else", async () => {
    const platform = createMemoryPlatform({ os: "macos" })
    const store = createRelaySetupStore({ settings: platform.settings })
    let changes = 0
    store.subscribe(() => changes++)
    await store.save({ patch: { path: "docker", extraOrigins: ["https://x.example"] } })
    const saved = platform.settings.get("multiplayer.relaySetup")
    expect(saved).toEqual({
      path: "docker",
      extraOrigins: ["https://x.example"],
      local: null,
      fly: null,
    })
    expect(store.getState().extraOrigins).toEqual(["https://x.example"])
    expect(changes).toBeGreaterThan(0)
  })
})

// --- Runners over a scripted host ---------------------------------------------------------------------------

describe("runners", () => {
  test("This computer: start, quick tunnel address, stop", async () => {
    const host = createFakeRelayHost({
      scripts: {
        relay: { lines: ["@kimo/server listening on http://0.0.0.0:8788/ (data: x)"] },
        cloudflared: {
          lines: [
            "INF Requesting new quick Tunnel on trycloudflare.com...",
            "INF |  https://quiet-otter-lime.trycloudflare.com  |",
          ],
        },
      },
    })
    const relay = new LocalRelay(host, { os: "macos", arch: "aarch64" })
    const state = await relay.start({
      port: 8788,
      ownerKey: "3eO8zsfzpmoRFfRdcg9NwTXDrnxOItyjj9se_WpJX_g",
      origins: [],
      reach: "quick",
      hostname: null,
    })
    expect(state.status).toBe("running")
    expect(state.lanUrl).toBe("ws://192.168.1.24:8788")
    expect(state.publicUrl).toBe("wss://quiet-otter-lime.trycloudflare.com")
    expect(host.spawned[0]).toMatchObject({
      kind: "relay",
      env: {
        PORT: "8788",
        HOST: "0.0.0.0",
        KIMO_OWNER_KEY: "3eO8zsfzpmoRFfRdcg9NwTXDrnxOItyjj9se_WpJX_g",
      },
    })
    expect(host.spawned[1]?.args).toEqual(cloudflared.quick(8788))
    expect((await host.running()).length).toBe(2)
    await relay.stop()
    expect(relay.getState().status).toBe("stopped")
    expect((await host.running()).length).toBe(0)
  })

  test("This computer: a relay that exits before listening fails with its last line", async () => {
    const host = createFakeRelayHost({
      scripts: { relay: { lines: ['Invalid PORT: "x"'], exit: 1 } },
    })
    const relay = new LocalRelay(host, { os: "macos", arch: "aarch64" })
    const state = await relay.start({
      port: 8787,
      ownerKey: null,
      origins: [],
      reach: "lan",
      hostname: null,
    })
    expect(state.status).toBe("failed")
    expect(state.error).toContain('Invalid PORT: "x"')
  })

  test("Fly.io: a failing step stops the run with flyctl's last lines", async () => {
    const host = createFakeRelayHost({
      scripts: {
        "flyctl:apps": { exit: 0 },
        "flyctl:secrets": { exit: 0 },
        "flyctl:volumes": { lines: ["Error: region ams is out of capacity"], exit: 1 },
      },
    })
    const steps = flyDeploySteps({
      app: "kimo-relay-maya",
      region: "ams",
      config: "/c",
      ownerKey: "k",
      origins: [],
    })
    const run = await runFlySteps(
      host,
      steps,
      "kimo-relay-maya",
      async () => true,
      () => {},
    )
    expect(run.lines.map((l) => l.status)).toEqual(["done", "done", "failed", "pending", "pending"])
    expect(run.error).toBe("Error: region ams is out of capacity")
    expect(run.tail).toEqual(["Error: region ams is out of capacity"])
    expect(host.spawned.find((s) => s.args?.[0] === "secrets")?.stdin).toBe("KIMO_OWNER_KEY=k\n")
  })
})
