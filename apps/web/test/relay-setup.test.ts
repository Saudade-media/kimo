/** Board 42 relay setup: the pure parts and the process runners over a scripted host. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { DEFAULT_LIMITS, MultiplayerError, PROTOCOL, type RelayInfo } from "@kimo/sync/mp"
import {
  autoOrigins,
  dockerRunCommand,
  flyDeploySteps,
  flyManualCommands,
  flyToml,
  localRelayEnv,
  originsValue,
  ownerKeyText,
  parseFlyWhoami,
  parseVersion,
  RAILWAY_TEMPLATE_URL,
  railwayDeployUrl,
  shellWord,
  suggestFlyApp,
  validFlyApp,
} from "../src/multiplayer/relay-setup/commands"
import { createFakeRelayHost } from "../src/multiplayer/relay-setup/host"
import {
  advanceInstall,
  bunInstallLines,
  cloudflared,
  elapsed,
  finishInstall,
  isQuickTunnelUrl,
  parseQuickTunnelUrl,
  pickPort,
  tunnelName,
  uptime,
  validHostname,
} from "../src/multiplayer/relay-setup/local"
import {
  RELAY_SETUP_TEST_MS,
  type RelayTestDeps,
  testRelaySetup,
} from "../src/multiplayer/relay-setup/relay-test"
import {
  type Clock,
  LocalRelay,
  runFlySteps,
  stepTime,
} from "../src/multiplayer/relay-setup/runner"
import {
  createRelaySetupStore,
  EMPTY_SETUP,
  parseSetup,
  serializeSetup,
} from "../src/multiplayer/relay-setup/store"

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

  test("the owner key shows shortened on screen and whole on the clipboard", () => {
    expect(ownerKeyText(ownerKey, true)).toBe("ed25519:3eO8zsfzpmoRF…")
    expect(ownerKeyText(ownerKey, false)).toBe(ownerKey)
  })

  test("docker run: this device's key, shortened on screen, whole on the clipboard; no secret", () => {
    const web = { ownerKey, origins: ["https://design.maya.studio"] }
    expect(dockerRunCommand(web, { masked: true })).toBe(
      [
        "docker run -d --name kimo-relay --restart unless-stopped \\",
        "  -p 8787:8787 -v kimo-relay:/data \\",
        "  -e KIMO_OWNER_KEY=ed25519:3eO8zsfzpmoRF… \\",
        "  -e KIMO_ALLOWED_ORIGINS=https://design.maya.studio \\",
        "  ghcr.io/saudade-media/kimo-relay",
      ].join("\n"),
    )
    const desktop = dockerRunCommand({ ownerKey, origins: [] }, { masked: false })
    expect(desktop).toContain(`KIMO_OWNER_KEY=${ownerKey} \\`)
    expect(desktop).not.toContain("KIMO_ALLOWED_ORIGINS")
    expect(desktop).not.toContain("SECRET")
    expect(shellWord("a b")).toBe("'a b'")
  })

  test("Fly.io copy-paste carries the key; Railway needs no variables", () => {
    const fly = flyManualCommands({ ownerKey, origins: ["https://x.example"] }, { masked: true })
    expect(fly.launch).toBe("fly launch --copy-config -c apps/server/deploy/fly.toml --no-deploy")
    expect(fly.secrets).toBe(
      "fly secrets set KIMO_OWNER_KEY=ed25519:3eO8zsfzpmoRF… KIMO_ALLOWED_ORIGINS=https://x.example",
    )
    expect(fly.deploy).toBe("fly deploy -c apps/server/deploy/fly.toml")
    expect(flyManualCommands({ ownerKey, origins: [] }, { masked: false }).secrets).toBe(
      `fly secrets set KIMO_OWNER_KEY=${ownerKey}`,
    )
    // Prefill stays off until Railway's template links are known to honour it (ADR 0017).
    expect(railwayDeployUrl(ownerKey)).toBe(RAILWAY_TEMPLATE_URL)
    expect(railwayDeployUrl(ownerKey, true)).toBe(
      `${RAILWAY_TEMPLATE_URL}?KIMO_OWNER_KEY=${ownerKey}`,
    )
    expect(railwayDeployUrl(null, true)).toBe(RAILWAY_TEMPLATE_URL)
  })

  test("the local relay's environment carries KIMO_OWNER_KEY and no secret", () => {
    expect(localRelayEnv({ port: 8788, ownerKey, origins: [] })).toEqual({
      PORT: "8788",
      HOST: "0.0.0.0",
      KIMO_OWNER_KEY: ownerKey,
    })
    expect(localRelayEnv({ port: 8787, ownerKey: null, origins: ["https://a.b"] })).toEqual({
      PORT: "8787",
      HOST: "0.0.0.0",
      KIMO_ALLOWED_ORIGINS: "https://a.b",
    })
  })

  test("flyctl deploy steps: the key goes through stdin with the origins", () => {
    const steps = flyDeploySteps({
      app: "kimo-relay-maya",
      region: "ams",
      config: "/x/fly.toml",
      ownerKey,
      origins: [],
    })
    expect(steps.map((s) => s.label)).toEqual([
      "fly apps create kimo-relay-maya",
      "fly secrets set KIMO_OWNER_KEY",
      "fly volumes create kimo_data --size 1",
      "fly deploy -c apps/server/deploy/fly.toml",
      "Wait for health check",
    ])
    expect(steps[1]?.stdin).toBe(`KIMO_OWNER_KEY=${ownerKey}\n`)
    expect(steps[2]?.args).toContain("ams")
    expect(steps[3]?.args).toEqual([
      "deploy",
      "--config",
      "/x/fly.toml",
      "--app",
      "kimo-relay-maya",
      "--ha=false",
      "--yes",
    ])
  })

  test("the one-click fly.toml is apps/server/deploy/fly.toml with this app and region", () => {
    const repo = readFileSync(join(import.meta.dir, "../../server/deploy/fly.toml"), "utf8")
    const body = (text: string) =>
      text
        .split("\n")
        .filter((l) => !l.startsWith("#"))
        .join("\n")
        .trim()
    const ours = flyToml({ app: "my-kimo-relay", region: "iad" })
    expect(body(ours)).toBe(body(repo))
  })

  test("app names, whoami and versions", () => {
    expect(validFlyApp("kimo-relay-maya")).toBe(true)
    expect(validFlyApp("Kimo")).toBe(false)
    expect(validFlyApp("a--b")).toBe(false)
    expect(suggestFlyApp("Maya Ö")).toBe("kimo-relay-maya-o")
    expect(suggestFlyApp("", () => 0.5)).toMatch(/^kimo-relay-[a-z0-9]{4,}$/)
    expect(parseFlyWhoami("maya@studio.example\n")).toBe("maya@studio.example")
    expect(parseVersion("flyctl v0.3.172 darwin/arm64")).toBe("0.3.172")
    expect(parseVersion("1.2.19")).toBe("1.2.19")
    expect(parseVersion("cloudflared version 2025.9.1 (built …)")).toBe("2025.9.1")
  })
})

// --- This computer pieces ------------------------------------------------------------------------------

describe("local relay pieces", () => {
  test("port 8787, else the next free one, else null", async () => {
    expect(await pickPort(async () => true)).toBe(8787)
    expect(await pickPort(async (p) => p >= 8790)).toBe(8790)
    expect(await pickPort(async () => false)).toBeNull()
  })

  test("quick tunnel address from cloudflared's output", () => {
    const line =
      "2025-10-20T10:00:00Z INF |  https://quiet-otter-lime.trycloudflare.com                  |"
    expect(parseQuickTunnelUrl(line)).toBe("wss://quiet-otter-lime.trycloudflare.com")
    expect(parseQuickTunnelUrl("Requesting new quick Tunnel on trycloudflare.com...")).toBeNull()
    expect(parseQuickTunnelUrl("https://api.trycloudflare.com/tunnel")).toBeNull()
    expect(isQuickTunnelUrl("wss://quiet-otter-lime.trycloudflare.com")).toBe(true)
    expect(isQuickTunnelUrl("https://relay.maya.studio")).toBe(false)
    expect(isQuickTunnelUrl(null)).toBe(false)
  })

  test("named tunnel hostname and arguments", () => {
    expect(validHostname("kimo.maya.studio")).toBe(true)
    expect(validHostname("localhost")).toBe(false)
    expect(validHostname("x.trycloudflare.com")).toBe(false)
    expect(tunnelName("Kimo.Maya.studio")).toBe("kimo-relay-kimo-maya-studio")
    expect(cloudflared.quick(8788)).toEqual([
      "tunnel",
      "--no-autoupdate",
      "--url",
      "http://localhost:8788",
    ])
    expect(cloudflared.run("kimo.maya.studio", 8787).at(-1)).toBe("kimo-relay-kimo-maya-studio")
  })

  test("Install Bun lines follow the installer's output", () => {
    let lines = bunInstallLines("macos", "aarch64")
    expect(lines[0]?.label).toBe("Downloading bun-darwin-aarch64.zip")
    expect(lines.map((l) => l.status)).toEqual(["running", "pending", "pending", "pending"])
    lines = advanceInstall(lines, "######################################################## 100.0%")
    expect(lines[0]?.status).toBe("running")
    lines = advanceInstall(lines, "bun was installed successfully to ~/.bun/bin/bun")
    expect(lines.map((l) => l.status)).toEqual(["done", "done", "running", "pending"])
    lines = advanceInstall(lines, 'Added "~/.bun/bin" to $PATH in "~/.zshrc"')
    expect(lines.map((l) => l.status)).toEqual(["done", "done", "done", "running"])
    expect(finishInstall(lines, false).map((l) => l.status)).toEqual([
      "done",
      "done",
      "done",
      "failed",
    ])
    expect(finishInstall(lines, true).every((l) => l.status === "done")).toBe(true)
  })

  test("times", () => {
    expect(elapsed(18_400)).toBe("0:18")
    expect(elapsed(72_000)).toBe("1:12")
    expect(uptime((2 * 60 + 14) * 60_000)).toBe("Up 2 h 14 min")
    expect(uptime(5 * 60_000)).toBe("Up 5 min")
    expect(stepTime(2000)).toBe("2 s")
    expect(stepTime(65_000)).toBe("1:05")
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
  test("ok: each line ticks; an unclaimed relay is claimed on the Ownership line", async () => {
    const clock = fakeClock()
    const seen: string[] = []
    const claimed: string[] = []
    const result = await testRelaySetup(
      "wss://relay.maya.studio",
      testDeps(
        clock,
        async () => {
          clock.advance(84)
          return info("unclaimed")
        },
        {
          claim: async (url) => {
            claimed.push(url)
          },
        },
      ),
      (s) => seen.push(s.checks.map((c) => c.status[0]).join("")),
    )
    expect(result.outcome).toBe("ok")
    expect(result.owned).toBe("claimed")
    expect(result.url).toBe("https://relay.maya.studio")
    expect(result.ms).toBe(84)
    expect(claimed).toEqual(["https://relay.maya.studio"])
    expect(result.checks.map((c) => [c.id, c.status, c.meta])).toEqual([
      ["reach", "ok", "84 ms"],
      ["handshake", "ok", "ok"],
      ["protocol", "ok", "kimo-mp/1"],
      ["ownership", "ok", "claimed by you"],
    ])
    expect(seen).toEqual(["rppp", "ooor", "oooo"])
    expect(clock.pending()).toBe(0)
  })

  test("already yours (KIMO_OWNER_KEY): nothing is claimed", async () => {
    const clock = fakeClock()
    let claims = 0
    const r = await testRelaySetup(
      "https://relay.maya.studio",
      testDeps(clock, async () => info("claimed"), {
        claim: async () => {
          claims++
        },
      }),
    )
    expect(r.outcome).toBe("ok")
    expect(r.owned).toBe("already")
    expect(r.checks[3]).toEqual({ id: "ownership", status: "ok", meta: "yours" })
    expect(claims).toBe(0)
  })

  test("belongs to another Kimo, also when another claim won the race", async () => {
    const clock = fakeClock()
    const other = await testRelaySetup(
      "https://relay.maya.studio",
      testDeps(clock, async () => info("claimed"), { ownership: async () => "other" }),
    )
    expect(other.outcome).toBe("not-yours")
    expect(other.checks[3]).toEqual({ id: "ownership", status: "warning", meta: "not yours" })
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

  test("unreachable within 5 s, not a relay, too old, invalid", async () => {
    const clock = fakeClock()
    const pending = testRelaySetup(
      "https://relay.maya.studio",
      testDeps(clock, () => new Promise<RelayInfo>(() => {})),
    )
    await flush()
    clock.advance(RELAY_SETUP_TEST_MS)
    const down = await pending
    expect(down.outcome).toBe("unreachable")
    expect(down.checks[0]).toEqual({ id: "reach", status: "failed", meta: "no answer · 5 s" })

    const notRelay = await testRelaySetup(
      "https://example.com",
      testDeps(clock, async () => {
        throw new MultiplayerError(
          "NOT_A_RELAY",
          "https://example.com is not a Kimo relay (relay answered 404)",
        )
      }),
    )
    expect(notRelay.outcome).toBe("not-a-relay")
    expect(notRelay.checks[1]).toEqual({ id: "handshake", status: "failed", meta: "404" })

    const old = await testRelaySetup(
      "https://old.example",
      testDeps(clock, async () => {
        throw new MultiplayerError(
          "NOT_A_RELAY",
          "https://old.example is not a Kimo relay (protocol kimo-mp/0)",
        )
      }),
    )
    expect(old.outcome).toBe("too-old")
    expect(old.checks[2]).toEqual({
      id: "protocol",
      status: "warning",
      meta: "kimo-mp/0 · needs kimo-mp/1",
    })

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

  test("Install Bun: lines tick, then Bun is found", async () => {
    const host = createFakeRelayHost({
      scripts: {
        "bun-install": {
          lines: [
            "bun was installed successfully to ~/.bun/bin/bun",
            'Added "~/.bun/bin" to $PATH',
          ],
          exit: 0,
        },
      },
    })
    const relay = new LocalRelay(host, { os: "macos", arch: "aarch64" })
    expect((await relay.checks()).bun).toBeNull()
    const spawnedInstall = relay.installBun()
    await flush()
    host.setTool("bun", { path: "/Users/maya/.bun/bin/bun", version: "1.2.19" })
    expect(await spawnedInstall).toEqual({ path: "/Users/maya/.bun/bin/bun", version: "1.2.19" })
    expect(relay.getState().install?.lines.every((l) => l.status === "done")).toBe(true)
    expect(host.spawned[0]).toMatchObject({ kind: "bun-install" })
  })

  test("Fly.io: each step ticks with its time; a failure stops with flyctl's last lines", async () => {
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
    const updates: string[] = []
    const run = await runFlySteps(
      host,
      steps,
      "kimo-relay-maya",
      async () => true,
      (r) => updates.push(r.lines.map((l) => l.status[0]).join("")),
    )
    expect(run.lines.map((l) => l.status)).toEqual(["done", "done", "failed", "pending", "pending"])
    expect(run.error).toBe("Error: region ams is out of capacity")
    expect(run.tail).toEqual(["Error: region ams is out of capacity"])
    expect(host.spawned.find((s) => s.args?.[0] === "secrets")?.stdin).toBe("KIMO_OWNER_KEY=k\n")
    expect(updates[0]).toBe("rpppp")
  })

  test("Fly.io: the health check polls until the relay answers", async () => {
    const host = createFakeRelayHost()
    let answers = 0
    const run = await runFlySteps(
      host,
      [{ id: "health", label: "Wait for health check", args: null }],
      "kimo-relay-maya",
      async (url) => {
        expect(url).toBe("wss://kimo-relay-maya.fly.dev")
        return ++answers >= 2
      },
      () => {},
      { now: () => 0, setTimeout: (fn) => setTimeout(fn, 1), clearTimeout: () => {} },
    )
    expect(run.done).toBe(true)
    expect(run.error).toBeNull()
    expect(answers).toBe(2)
  })
})
