import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isCanonical, parse, serialize } from "@kimo/core-schema"
import { createEmptyDocument, YjsDocStore } from "@kimo/editor-state"
import {
  atomicWrite,
  FileProvider,
  type FileSystem,
  nodeFileSystem,
  SaveRefusedError,
  SaveVerifyError,
  sha256,
} from "../src/file"
import {
  countingFs,
  emptyStore,
  FORWARD_FIXTURES,
  fixtureText,
  rect,
  sleep,
  tempDir,
  VALID_FIXTURES,
  validFixtures,
} from "./helpers"

const EXAMPLE = fixtureText(VALID_FIXTURES, "example-10-5.kimo")

function setup(
  text = EXAMPLE,
  options: Partial<ConstructorParameters<typeof FileProvider>[0]> = {},
) {
  const dir = tempDir()
  const path = join(dir, "design.kimo")
  if (text !== "") writeFileSync(path, text)
  const fs = countingFs()
  const provider = new FileProvider({
    path,
    autosaveMs: 40,
    recoveryDir: join(dir, "recovery"),
    fs,
    ...options,
  })
  const store = new YjsDocStore()
  return { dir, path, fs, provider, store }
}

const insert = (store: YjsDocStore, id: string) => {
  const r = store.apply({ op: "insert", id, node: rect(id) }, { origin: "user" })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
}

describe("FileProvider: load", () => {
  test("loads and validates into the store", async () => {
    const { provider, store } = setup()
    await provider.attach(store)
    expect(provider.status).toBe("synced")
    expect(provider.canSave).toBe(true)
    expect(store.getNode("B2title001")?.content).toBe("Design next to your code")
    expect(store.readOnly).toBeNull()
  })

  test("refuse-save-after-failed-load: unparsable file is never written", async () => {
    const { path, provider, store, fs } = setup('{"format": "1.0.0", oops')
    await provider.attach(store)
    expect(provider.status).toBe("read-only")
    expect(provider.loadError?.code).toBe("LOAD_FAILED")
    expect(store.readOnly).not.toBeNull()
    expect(store.apply({ op: "insert", node: rect("x") }, { origin: "user" }).ok).toBe(false)
    expect(await provider.writePending()).toBeNull()
    await expect(provider.saveFile({ force: true })).rejects.toBeInstanceOf(SaveRefusedError)
    await expect(provider.upgradeAndSave()).rejects.toBeInstanceOf(SaveRefusedError)
    await provider.detach()
    expect(fs.writes).toEqual([])
    expect(readFileSync(path, "utf8")).toBe('{"format": "1.0.0", oops')
  })

  test("newer format / unknown feature / invalid: read-only, content viewable, never saved", async () => {
    const cases: [string, string][] = [
      ["newer-minor", fixtureText(FORWARD_FIXTURES, "newer-minor.kimo")],
      ["unknown-feature", fixtureText(FORWARD_FIXTURES, "unknown-feature.kimo")],
      [
        "invalid",
        fixtureText(join(VALID_FIXTURES, "../invalid"), "PARENT_MISSING--dangling-parent.kimo"),
      ],
    ]
    for (const [name, text] of cases) {
      const { path, provider, store, fs } = setup(text)
      await provider.attach(store)
      expect({ name, status: provider.status }).toEqual({ name, status: "read-only" })
      expect(provider.loadError?.code).toBe("READ_ONLY")
      expect(store.size).toBeGreaterThan(0)
      store.setReadOnly(null) // even if someone forces the store writable…
      insert(store, "Sneaky0001")
      await sleep(60)
      expect(await provider.writePending()).toBeNull()
      await provider.detach()
      expect(fs.writes).toEqual([]) // …the provider never writes
      expect(readFileSync(path, "utf8")).toBe(text)
    }
  })

  test("missing file: failed load by default, or created on request", async () => {
    const a = setup("")
    await a.provider.attach(a.store)
    expect(a.provider.loadError?.code).toBe("LOAD_FAILED")
    expect(existsSync(a.path)).toBe(false)

    const b = setup("", { createIfMissing: "New doc" })
    await b.provider.attach(b.store)
    expect(b.provider.dirty).toBe(true)
    const r = await b.provider.writePending()
    expect(r?.target).toBe("file")
    expect(parse(readFileSync(b.path, "utf8")).meta?.name).toBe("New doc")
    await b.provider.detach()
  })
})

describe("FileProvider: autosave", () => {
  test("debounced: many changes inside the window produce one write", async () => {
    const { path, provider, store, fs } = setup()
    await provider.attach(store)
    insert(store, "Debounce01")
    insert(store, "Debounce02")
    insert(store, "Debounce03")
    expect(provider.status).toBe("dirty")
    expect(fs.writes.length).toBe(0)
    await sleep(120)
    expect(fs.writes.length).toBe(1)
    expect(provider.status).toBe("synced")
    expect(provider.dirty).toBe(false)
    const onDisk = parse(readFileSync(path, "utf8"))
    expect(Object.keys(onDisk.nodes)).toContain("Debounce03")
    expect(provider.lastSave?.hash).toBe(sha256(readFileSync(path, "utf8")))
    await provider.detach()
  })

  test("flush writes immediately and cancels the pending autosave", async () => {
    const { provider, store, fs } = setup(EXAMPLE, { autosaveMs: 10_000 })
    await provider.attach(store)
    insert(store, "Flushed001")
    const r = await provider.writePending()
    expect(r?.target).toBe("file")
    expect(r?.revision).toEqual(store.revision)
    expect(fs.writes.length).toBe(1)
    expect(await provider.writePending()).toBeNull()
    await provider.detach()
    expect(fs.writes.length).toBe(1)
  })

  test("detach flushes pending changes", async () => {
    const { path, provider, store } = setup(EXAMPLE, { autosaveMs: 10_000 })
    await provider.attach(store)
    insert(store, "OnDetach01")
    await provider.detach()
    expect(Object.keys(parse(readFileSync(path, "utf8")).nodes)).toContain("OnDetach01")
  })

  test("an edit that is undone writes nothing", async () => {
    const { provider, store, fs } = setup()
    await provider.attach(store)
    insert(store, "Undone0001")
    store.undo("user")
    expect(await provider.writePending()).toBeNull()
    expect(fs.writes.length).toBe(0)
    await provider.detach()
  })

  test("changes during a save are written by the next save", async () => {
    const slow: FileSystem = {
      ...nodeFileSystem,
      async writeFileDurable(p, d) {
        await sleep(30)
        await nodeFileSystem.writeFileDurable(p, d)
      },
    }
    const { path, provider, store } = setup(EXAMPLE, { fs: slow, autosaveMs: 10_000 })
    await provider.attach(store)
    insert(store, "First00001")
    const first = provider.writePending()
    await sleep(10) // the write is in flight
    expect(provider.status).toBe("saving")
    insert(store, "Second0001")
    await first
    expect(provider.dirty).toBe(true)
    await provider.writePending()
    expect(Object.keys(parse(readFileSync(path, "utf8")).nodes)).toContain("Second0001")
    await provider.detach()
  })
})

describe("FileProvider: atomic writes", () => {
  test("simulated crash before rename: temp file left, original intact", async () => {
    const crashed: FileSystem = {
      ...nodeFileSystem,
      rename: async () => {
        throw new Error("simulated crash")
      },
      // The process is dead: no cleanup happens.
      unlink: async () => {
        throw new Error("simulated crash")
      },
    }
    const { dir, path, provider, store } = setup(EXAMPLE, { fs: crashed })
    await provider.attach(store)
    insert(store, "Crash00001")
    await expect(provider.writePending()).rejects.toThrow("simulated crash")
    expect(readFileSync(path, "utf8")).toBe(EXAMPLE)
    const temps = readdirSync(dir).filter((f) => f.endsWith(".tmp"))
    expect(temps.length).toBe(1)
    // The leftover temp holds the complete new content (recoverable).
    expect(Object.keys(parse(readFileSync(join(dir, temps[0] as string), "utf8")).nodes)).toContain(
      "Crash00001",
    )
    expect(provider.status).toBe("error")
    expect(provider.dirty).toBe(true)
    await provider.detach({ flush: false })
  })

  test("failed write cleans up its temp file and keeps changes pending", async () => {
    let fail = true
    const flaky: FileSystem = {
      ...nodeFileSystem,
      async rename(from, to) {
        if (fail) throw new Error("EIO")
        await nodeFileSystem.rename(from, to)
      },
    }
    const { dir, path, provider, store } = setup(EXAMPLE, { fs: flaky })
    await provider.attach(store)
    insert(store, "Retry00001")
    await expect(provider.writePending()).rejects.toThrow("EIO")
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([])
    expect(readFileSync(path, "utf8")).toBe(EXAMPLE)
    fail = false
    const r = await provider.writePending()
    expect(r?.target).toBe("file")
    expect(Object.keys(parse(readFileSync(path, "utf8")).nodes)).toContain("Retry00001")
    await provider.detach()
  })

  test("read-back verification catches a corrupted write", async () => {
    const dir = tempDir()
    const target = join(dir, "x.kimo")
    const lying: FileSystem = { ...nodeFileSystem, readFile: async () => "corrupted" }
    await expect(atomicWrite(lying, target, "hello")).rejects.toBeInstanceOf(SaveVerifyError)
    const r = await atomicWrite(nodeFileSystem, target, "héllo")
    expect(r).toEqual({ bytes: 6, hash: sha256("héllo") })
  })
})

describe("FileProvider: byte stability", () => {
  for (const [name, text] of validFixtures()) {
    test(`load → save is byte-identical: ${name}`, async () => {
      expect(isCanonical(text)).toBe(true)
      const { path, provider, store } = setup(text)
      await provider.attach(store)
      const r = await provider.saveFile({ force: true })
      expect(readFileSync(path, "utf8")).toBe(text)
      expect(r?.hash).toBe(sha256(text))
      await provider.detach()
    })
  }

  test("an edit changes only the edited node's line", async () => {
    const { path, provider, store } = setup()
    await provider.attach(store)
    const r = store.apply(
      { op: "update", id: "B2title001", set: { content: "Edited" } },
      { origin: "user" },
    )
    expect(r.ok).toBe(true)
    await provider.writePending()
    const before = EXAMPLE.split("\n")
    const after = readFileSync(path, "utf8").split("\n")
    expect(after.length).toBe(before.length)
    const changed = after.filter((l, i) => l !== before[i])
    expect(changed.length).toBe(1)
    expect(changed[0]).toContain('"B2title001"')
    expect(serialize(parse(after.join("\n")))).toBe(after.join("\n"))
    await provider.detach()
  })
})

describe("FileProvider: recovery (format not current)", () => {
  /** The example as a format 0.1 file: the real 0.1 → 1.0 migration applies. */
  const OLD = EXAMPLE.replace('"format": "1.0.0"', '"format": "0.1.0"').replace(
    "kimo-1.0.json",
    "kimo-0.1.json",
  )
  /** A format no migration reaches. */
  const ANCIENT = EXAMPLE.replace('"format": "1.0.0"', '"format": "0.0.3"').replace(
    "kimo-1.0.json",
    "kimo-0.0.json",
  )

  test("autosave goes to the recovery file until the upgrade is accepted", async () => {
    expect(OLD).toContain('"format": "0.1.0"')
    const { dir, path, provider, store, fs } = setup(OLD)
    await provider.attach(store)
    expect(provider.needsUpgradeConsent).toBe(true)
    expect(provider.recoveryPath.startsWith(join(dir, "recovery"))).toBe(true)
    insert(store, "Recover001")
    const r = await provider.writePending()
    expect(r?.target).toBe("recovery")
    expect(readFileSync(path, "utf8")).toBe(OLD) // working file untouched
    const recovered = parse(readFileSync(provider.recoveryPath, "utf8"))
    expect(recovered.format).toBe("1.0.0")
    expect(Object.keys(recovered.nodes)).toContain("Recover001")
    expect(fs.writes.every((w) => !w.startsWith(join(dir, ".design.kimo")))).toBe(true)

    const up = await provider.upgradeAndSave()
    expect(up.target).toBe("file")
    expect(provider.needsUpgradeConsent).toBe(false)
    const text = readFileSync(path, "utf8")
    expect(parse(text).format).toBe("1.0.0")
    expect(isCanonical(text)).toBe(true)
    expect(existsSync(provider.recoveryPath)).toBe(false)
    await provider.detach()
  })

  test("an explicit save counts as consent", async () => {
    const { path, provider, store } = setup(OLD)
    await provider.attach(store)
    await provider.saveFile()
    expect(parse(readFileSync(path, "utf8")).format).toBe("1.0.0")
    expect(provider.needsUpgradeConsent).toBe(false)
    await provider.detach()
  })

  test("older format without a migration path is read-only", async () => {
    const { provider, store, fs } = setup(ANCIENT)
    await provider.attach(store)
    expect(provider.status).toBe("read-only")
    expect(provider.loadError?.reasons[0]?.code).toBe("NO_MIGRATION_PATH")
    expect(fs.writes).toEqual([])
  })
})

describe("FileProvider: reload", () => {
  test("hot-reloads external changes when there are no local edits", async () => {
    const { path, provider, store } = setup()
    await provider.attach(store)
    const doc = parse(EXAMPLE)
    ;(doc.nodes.B2title001 as { content: string }).content = "From git"
    writeFileSync(path, serialize(doc))
    expect(await provider.reload()).toBe(true)
    expect(store.getNode("B2title001")?.content).toBe("From git")
    expect(provider.dirty).toBe(false)
    insert(store, "LocalEdit1")
    expect(await provider.reload()).toBe(false)
    await provider.detach({ flush: false })
  })

  test("a failed load's read-only state does not outlive the provider", async () => {
    const bad = setup('{"format": "1.0.0", oops')
    await bad.provider.attach(bad.store)
    expect(bad.store.readOnly).not.toBeNull()
    await bad.provider.detach()
    expect(bad.store.readOnly).toBeNull()
    expect(bad.provider.loadError).toBeNull()
    const good = setup()
    await good.provider.attach(bad.store)
    expect(good.provider.status).toBe("synced")
    expect(good.provider.canSave).toBe(true)
    expect(bad.store.readOnly).toBeNull()
    insert(bad.store, "AfterSwap1")
    await good.provider.detach({ flush: false })
  })

  test("reload after a failed initial load is refused and never reports synced", async () => {
    const { path, provider, store } = setup('{"format": "1.0.0", oops')
    await provider.attach(store)
    writeFileSync(path, EXAMPLE)
    await expect(provider.reload()).rejects.toBeInstanceOf(SaveRefusedError)
    expect(provider.status).toBe("read-only")
    expect(provider.canSave).toBe(false)
    expect(store.readOnly).not.toBeNull()
    await provider.detach()
  })

  test("a half-written external file does not end a healthy session", async () => {
    const { path, provider, store } = setup()
    await provider.attach(store)
    writeFileSync(path, EXAMPLE.slice(0, 200))
    expect(await provider.reload()).toBe(false)
    expect(provider.status).toBe("error")
    expect(provider.canSave).toBe(true)
    expect(store.readOnly).toBeNull()
    expect(store.getNode("B2title001")?.content).toBe("Design next to your code")
    const doc = parse(EXAMPLE)
    ;(doc.nodes.B2title001 as { content: string }).content = "Finished writing"
    writeFileSync(path, serialize(doc))
    expect(await provider.reload()).toBe(true)
    expect(provider.status).toBe("synced")
    expect(store.getNode("B2title001")?.content).toBe("Finished writing")
    await provider.detach({ flush: false })
  })

  test("hot reload of a newer file is read-only until a valid file is reloaded", async () => {
    const { path, provider, store } = setup()
    await provider.attach(store)
    writeFileSync(path, fixtureText(FORWARD_FIXTURES, "newer-minor.kimo"))
    expect(await provider.reload()).toBe(true)
    expect(provider.status).toBe("read-only")
    expect(store.readOnly).not.toBeNull()
    writeFileSync(path, EXAMPLE)
    expect(await provider.reload()).toBe(true)
    expect(provider.status).toBe("synced")
    expect(provider.canSave).toBe(true)
    expect(store.readOnly).toBeNull()
    await provider.detach({ flush: false })
  })

  test("store from emptyStore can be persisted to a new path", async () => {
    const dir = tempDir()
    const store = emptyStore()
    const provider = new FileProvider({
      path: join(dir, "n.kimo"),
      createIfMissing: true,
      recoveryDir: dir,
    })
    // attach replaces the store's content with the (new, empty) file document
    await provider.attach(store)
    await provider.writePending()
    expect(parse(readFileSync(join(dir, "n.kimo"), "utf8"))).toEqual(createEmptyDocument())
    await provider.detach()
  })
})
