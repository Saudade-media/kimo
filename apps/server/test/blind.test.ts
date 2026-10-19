import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { sealBlob, sealSnapshot, sealUpdate } from "@kimo/sync/mp"
import {
  bearer,
  type Harness,
  joinAs,
  putSnapshotRaw,
  registered,
  startRelay,
  token,
} from "./helpers"

const serverSrc = resolve(import.meta.dir, "../src")
const syncMp = resolve(import.meta.dir, "../../../packages/sync/src/mp")

/** Bare module specifiers reachable from `entry` through relative imports. */
function bareImports(entry: string, seen = new Set<string>()): Set<string> {
  const found = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const text = readFileSync(file, "utf8")
    for (const match of text.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)) {
      const spec = match[1] as string
      if (spec.startsWith(".")) {
        const base = resolve(dirname(file), spec)
        const target = [`${base}.ts`, join(base, "index.ts"), base].find(
          (p) => existsSync(p) && statSync(p).isFile(),
        )
        if (target) visit(target)
      } else if (spec === "@kimo/sync/mp") {
        visit(join(syncMp, "index.ts"))
      } else {
        found.add(spec)
      }
    }
  }
  visit(entry)
  return found
}

describe("the relay is blind", () => {
  test("its module graph never imports Yjs or editor-state", () => {
    const specs = [...bareImports(join(serverSrc, "index.ts"))]
    expect(specs.filter((s) => /yjs|y-protocols|editor-state|core-schema/.test(s))).toEqual([])
    expect(specs).toContain("bun:sqlite")
    // Every file of the server and the protocol core stays free of CRDT code, not just the graph.
    for (const dir of [serverSrc, syncMp])
      for (const name of readdirSync(dir))
        if (name.endsWith(".ts"))
          expect(readFileSync(join(dir, name), "utf8")).not.toMatch(
            /from\s+["'](yjs|@kimo\/editor-state)/,
          )
  })

  test("stored log, snapshot and blob bytes never contain the plaintext", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kimo-blind-"))
    const marker = "PLAINTEXT-MARKER-4f2a9c"
    const h: Harness = startRelay({ dataDir: dir })
    try {
      const owner = await registered(h)
      const edit = await token(owner, "edit")
      const { client } = await joinAs(h, owner, "edit")
      const text = new TextEncoder().encode(`{"doc":"${marker}"}`)
      client.send({ type: "append", cid: 1, env: await sealUpdate(owner.keys, text) })
      await client.next("ack")
      client.close()
      await putSnapshotRaw(h, owner, edit, 1, {
        body: await sealSnapshot(owner.keys, 1, text),
      })
      const blob = await sealBlob(owner.keys, text)
      await fetch(`${h.base}/blob/${owner.room.id}/${blob.id}`, {
        method: "PUT",
        headers: bearer(edit),
        body: blob.envelope as Uint8Array<ArrayBuffer>,
      })

      const needle = Buffer.from(marker)
      const rows = h.relay.db.sqlite
        .query<{ env: Uint8Array }, []>("SELECT env FROM log UNION ALL SELECT env FROM snapshots")
        .all()
      expect(rows).toHaveLength(2)
      for (const row of rows) expect(Buffer.from(row.env).includes(needle)).toBe(false)
      const stored = readFileSync(join(dir, "blobs", owner.room.id, blob.id.slice(0, 2), blob.id))
      expect(stored.includes(needle)).toBe(false)
      // Control: the check would notice plaintext.
      expect(Buffer.from(text).includes(needle)).toBe(true)
      // Sockets and files: nothing on disk under the data dir carries it either.
      h.relay.db.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)")
      for (const name of readdirSync(dir))
        if (name.startsWith("relay.sqlite"))
          expect(readFileSync(join(dir, name)).includes(needle)).toBe(false)
    } finally {
      await h.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
