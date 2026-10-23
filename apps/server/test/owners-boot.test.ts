import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exportPublicKey, generateSigningKeyPair, toBase64Url } from "@kimo/sync/mp"
import { loadConfig } from "../src/config"
import type { RelayConfig } from "../src/index"
import { Relay } from "../src/index"
import { ENV_DEVICE_NAME } from "../src/owners"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kimo-owners-boot-"))
  dirs.push(dir)
  return dir
}

/** Boots a relay on `dir` with `env`, returns what boot left behind, and closes it. */
function boot(dir: string, env: Record<string, string> = {}, at = 1_792_000_000_000) {
  const lines: string[] = []
  const config: RelayConfig = { ...loadConfig(env), dataDir: dir }
  const relay = new Relay(
    config,
    () => at,
    (line) => lines.push(line),
  )
  const result = {
    relayId: toBase64Url(relay.relayId),
    owners: relay.db.owners().map((o) => ({ pub: toBase64Url(o.pub), name: o.name, via: o.via })),
    pairings: relay.db.sqlite
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM pairings_used")
      .get()?.n,
    lines,
    relay,
  }
  relay.dispose()
  return result
}

async function key(): Promise<{ pub: Uint8Array; text: string }> {
  const pair = await generateSigningKeyPair()
  const pub = await exportPublicKey(pair.publicKey)
  return { pub, text: toBase64Url(pub) }
}

describe("ownership at boot (section 14.11)", () => {
  test("relay_id is made once and stable across restarts", () => {
    const dir = dataDir()
    const first = boot(dir)
    expect(first.relayId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(boot(dir).relayId).toBe(first.relayId)
    expect(first.lines).toEqual(["owner: unclaimed, claim it from Kimo"])
  })

  test("KIMO_OWNER_KEY seeds an empty set and is ignored once claimed", async () => {
    const dir = dataDir()
    const [a, b] = [await key(), await key()]
    const seeded = boot(dir, { KIMO_OWNER_KEY: a.text })
    expect(seeded.owners).toEqual([{ pub: a.text, name: ENV_DEVICE_NAME, via: "env" }])
    expect(seeded.lines).toEqual(["owner: claimed (1 device)"])
    const later = boot(dir, { KIMO_OWNER_KEY: `${a.text},${b.text}` })
    expect(later.owners.map((o) => o.pub)).toEqual([a.text])
  })

  test("KIMO_RESET_OWNER clears owners and used pairings once per distinct value; rooms survive", async () => {
    const dir = dataDir()
    const a = await key()
    const first = boot(dir, { KIMO_OWNER_KEY: a.text })
    expect(first.owners.length).toBe(1)
    // A room and a used pairing to see what the reset touches.
    {
      const relay = new Relay({ ...loadConfig({}), dataDir: dir }, () => 1_792_000_000_000)
      relay.db.insertRoom({
        id: "a".repeat(32),
        rootPub: new Uint8Array(32),
        kid: 1,
        linkPub: new Uint8Array(32),
        cert: new Uint8Array(84),
        at: 1,
      })
      relay.db.usePairing(new Uint8Array(16).fill(1), 1_900_000_000)
      relay.dispose()
    }

    const reset = boot(dir, { KIMO_RESET_OWNER: "2026-10-21" })
    expect(reset.owners).toEqual([])
    expect(reset.pairings).toBe(0)
    expect(reset.lines[0]).toBe(
      "warn: KIMO_RESET_OWNER cleared the owner list. Claim the relay from Kimo, then remove the variable.",
    )
    expect(reset.lines[1]).toBe("owner: unclaimed, claim it from Kimo")
    {
      const relay = new Relay({ ...loadConfig({}), dataDir: dir }, () => 1_792_000_000_000)
      expect(relay.db.getRoom("a".repeat(32))).not.toBeNull()
      relay.db.insertOwner({
        pub: a.pub,
        name: "Mac",
        added_at: 2,
        added_by: null,
        via: "claim",
      })
      relay.dispose()
    }

    // The same value on a later boot does nothing.
    const same = boot(dir, { KIMO_RESET_OWNER: "2026-10-21" })
    expect(same.owners.length).toBe(1)
    expect(same.lines).toEqual(["owner: claimed (1 device)"])
    // A new value clears again, and KIMO_OWNER_KEY then seeds the emptied set.
    const b = await key()
    const again = boot(dir, { KIMO_RESET_OWNER: "2026-10-22", KIMO_OWNER_KEY: b.text })
    expect(again.owners.map((o) => o.pub)).toEqual([b.text])
    expect(again.relayId).toBe(first.relayId)
  })

  test("the owners tables join an existing version 1 database", () => {
    const dir = dataDir()
    {
      const relay = new Relay({ ...loadConfig({}), dataDir: dir }, () => 1)
      relay.db.sqlite.run("DROP TABLE owners")
      relay.db.sqlite.run("DROP TABLE pairings_used")
      relay.db.sqlite.run("DROP TABLE relay_meta")
      relay.dispose()
    }
    expect(boot(dir).owners).toEqual([])
  })
})
