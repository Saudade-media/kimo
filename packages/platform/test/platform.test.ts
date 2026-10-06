import { describe, expect, test } from "bun:test"
import {
  createSettingsStore,
  formatDeepLink,
  isOpenableUrl,
  isPlatformError,
  normalizeSettings,
  parseDeepLink,
  resolveAgainstFile,
  SETTINGS_DEFAULTS,
  sha256Hex,
} from "../src/index"
import { createMemoryPlatform } from "../src/memory"
import { TAURI_COMMANDS, type TauriCommand } from "../src/tauri"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("openable links (G1)", () => {
  test("web, mail and phone links open; other schemes never do", () => {
    for (const ok of [
      "https://kimo.dev/docs",
      "http://localhost:3000/",
      "mailto:hi@kimo.dev",
      "tel:+15551234567",
    ])
      expect(isOpenableUrl(ok)).toBe(true)
    for (const bad of [
      "mailto:",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "kimo://open?path=/a.kimo",
      "ftp://example.com/x",
      "not a url",
    ])
      expect(isOpenableUrl(bad)).toBe(false)
  })
})

describe("deep links", () => {
  test("parses kimo://open with path and node", () => {
    expect(
      parseDeepLink("kimo://open?path=%2FUsers%2Fme%2Floom%2Fmarketing.kimo&node=Hero000001"),
    ).toEqual({
      action: "open",
      path: "/Users/me/loom/marketing.kimo",
      node: "Hero000001",
    })
    expect(parseDeepLink("kimo://open?path=C%3A%5Cdesign%5Ca.kimoz")?.path).toBe(
      "C:\\design\\a.kimoz",
    )
  })
  test("rejects anything else", () => {
    for (const bad of [
      "https://open?path=/a.kimo",
      "kimo://delete?path=/a.kimo",
      "kimo://open?path=a.kimo",
      "kimo://open?path=/etc/passwd",
      "kimo://open?path=/a/../b.kimo",
      "kimo://open?path=/a.kimo&node=bad/id",
      "kimo://open?path=/a.kimo&page=bad/id",
      "kimo://open",
      "not a url",
    ])
      expect(parseDeepLink(bad)).toBeNull()
  })
  test("round-trips", () => {
    const link = { action: "open" as const, path: "/Users/me/my file.kimo", node: "Abc123xyz9" }
    expect(parseDeepLink(formatDeepLink(link))).toEqual(link)
    const onPage = { action: "open" as const, path: "/a.kimo", page: "Page000002" }
    expect(parseDeepLink(formatDeepLink(onPage))).toEqual(onPage)
  })
})

describe("URI resolver", () => {
  test("resolves against the file's directory", () => {
    expect(resolveAgainstFile("/a/b/doc.kimo", "./assets/0123456789abcdef.png")).toBe(
      "/a/b/assets/0123456789abcdef.png",
    )
    expect(resolveAgainstFile("/a/b/doc.kimo", "../lib/ui.lib.kimo")).toBe("/a/lib/ui.lib.kimo")
    expect(resolveAgainstFile("C:\\w\\d\\doc.kimo", "./assets/x.png")).toBe(
      "C:\\w\\d\\assets\\x.png",
    )
    expect(resolveAgainstFile("fsa:abc-1/design/doc.kimo", "./assets/x.png")).toBe(
      "fsa:abc-1/design/assets/x.png",
    )
  })
  test("rejects non-relative references and escapes above the root", () => {
    expect(() => resolveAgainstFile("/a/doc.kimo", "/etc/passwd")).toThrow()
    expect(() => resolveAgainstFile("/a/doc.kimo", "https://x/y.png")).toThrow()
    expect(() => resolveAgainstFile("/a/doc.kimo", "./a\\b")).toThrow()
    expect(() => resolveAgainstFile("/a/doc.kimo", "../../x.kimo")).toThrow()
  })
})

describe("settings", () => {
  test("normalize drops unknown keys and invalid values", () => {
    const s = normalizeSettings({
      "files.autosaveIntervalMs": 5000,
      "files.autosave": "yes",
      "updates.channel": "nightly",
      bogus: 1,
    })
    expect(s["files.autosaveIntervalMs"]).toBe(5000)
    expect(s["files.autosave"]).toBe(true)
    expect(s["updates.channel"]).toBe("stable")
    expect("bogus" in s).toBe(false)
  })
  test("defaults match board 19", () => {
    expect(SETTINGS_DEFAULTS["files.autosaveIntervalMs"]).toBe(2000)
    expect(SETTINGS_DEFAULTS["files.recoverySnapshotMs"]).toBe(30_000)
    expect(SETTINGS_DEFAULTS["files.onExternalChange"]).toBe("merge-and-tell")
    expect(SETTINGS_DEFAULTS["general.onLaunch"]).toBe("last-files")
  })
  test("set validates and notifies", async () => {
    const p = createMemoryPlatform()
    await p.settings.ready
    const seen: string[] = []
    p.settings.onChange((k, v) => seen.push(`${k}=${v}`))
    await p.settings.set("updates.channel", "beta")
    expect(p.settings.get("updates.channel")).toBe("beta")
    expect(seen).toEqual(["updates.channel=beta"])
    await expect(p.settings.set("updates.channel", "nightly" as never)).rejects.toThrow()
  })
  test("a set() before ready survives the initial load and keeps the other persisted keys", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    let persisted: Record<string, unknown> = {
      "updates.channel": "beta",
      "files.autosaveIntervalMs": 5000,
    }
    const writes: Record<string, unknown>[] = []
    const store = createSettingsStore({
      load: async () => {
        await gate
        return persisted
      },
      // A whole-map backend (browser localStorage, memory): `all` must include loaded values.
      persist: async (_k, _v, all) => {
        persisted = { ...all }
        writes.push(persisted)
      },
    })
    const pending = store.set("updates.channel", "stable")
    expect(store.get("updates.channel")).toBe("stable")
    expect(writes).toHaveLength(0)
    release()
    await store.ready
    await pending
    expect(store.get("updates.channel")).toBe("stable")
    expect(store.get("files.autosaveIntervalMs")).toBe(5000)
    expect(persisted["updates.channel"]).toBe("stable")
    expect(persisted["files.autosaveIntervalMs"]).toBe(5000)
    expect(writes).toHaveLength(1)
  })
})

describe("memory platform", () => {
  test("atomic write hashes and reads back", async () => {
    const p = createMemoryPlatform({ files: { "/w/a.kimo": "{}\n" } })
    const r = await p.files.writeTextAtomic("/w/a.kimo", "hello")
    expect(r).toEqual({ bytes: 5, hash: await sha256Hex("hello") })
    expect((await p.files.readText("/w/a.kimo")).text).toBe("hello")
  })
  test("injected failures surface with codes the sync classifier understands", async () => {
    const p = createMemoryPlatform({ files: { "/w/a.kimo": "{}\n" } })
    p.control.failNextWrite("DISK_FULL", "ENOSPC")
    const e1 = await p.files.writeTextAtomic("/w/a.kimo", "x").catch((e) => e)
    expect(isPlatformError(e1, "DISK_FULL")).toBe(true)
    expect(e1.errno).toBe("ENOSPC")
    expect(p.control.readFile("/w/a.kimo")).toBe("{}\n")
    p.control.corruptNextReadBack()
    const e2 = await p.files.writeTextAtomic("/w/a.kimo", "y").catch((e) => e)
    expect(isPlatformError(e2, "READ_BACK_MISMATCH")).toBe(true)
    p.control.setReadOnly("/w/a.kimo", true)
    const e3 = await p.files.writeTextAtomic("/w/a.kimo", "z").catch((e) => e)
    expect(isPlatformError(e3, "PERMISSION")).toBe(true)
  })
  test("watch coalesces events into one batch", async () => {
    const p = createMemoryPlatform({ files: { "/w/a.kimo": "1" } })
    const batches: number[] = []
    const off = p.files.watch(["/w/a.kimo"], { debounceMs: 20 }, (b) => batches.push(b.length))
    p.control.writeExternal("/w/a.kimo", "2")
    p.control.writeExternal("/w/a.kimo", "3")
    await sleep(40)
    expect(batches).toEqual([2])
    off()
  })
  test("leases: foreign holder blocks, dead pid is reclaimed, self re-acquire is idempotent", async () => {
    const p = createMemoryPlatform({ files: { "/w/a.kimo": "{}" } })
    p.control.setForeignLease("/w/a.kimo", { pid: 48213 })
    const blocked = await p.leases.acquire("/w/a.kimo")
    expect(blocked.ok).toBe(false)
    if (!blocked.ok)
      expect(blocked.holder).toMatchObject({ pid: 48213, app: "kimo-mcp", alive: true })
    p.control.killPid(48213)
    const got = await p.leases.acquire("/w/a.kimo")
    expect(got.ok && got.reclaimed?.pid).toBe(48213)
    const again = await p.leases.acquire("/w/a.kimo")
    expect(again.ok).toBe(true)
    if (got.ok) await p.leases.release(got.lease)
    expect(await p.leases.inspect("/w/a.kimo")).toBeNull()
  })
  test("git: only the repo containing the file notifies", async () => {
    const p = createMemoryPlatform()
    const seen: string[] = []
    p.git.watch("/repo/design/a.kimo", (s, c) => seen.push(`${c.kind}:${s?.operation ?? "-"}`))
    const base = {
      branch: "main",
      head: "abc",
      indexLocked: false,
      fileStatus: "clean" as const,
      changedCount: 0,
    }
    p.control.setGit(
      "/other",
      { ...base, operation: "rebase" },
      { kind: "operation-started", operation: "rebase" },
    )
    p.control.setGit(
      "/repo",
      { ...base, operation: "rebase" },
      { kind: "operation-started", operation: "rebase" },
    )
    expect(seen).toEqual(["operation-started:rebase"])
    expect((await p.git.state("/repo/design/a.kimo"))?.operation).toBe("rebase")
    expect(await p.git.state("/nowhere/a.kimo")).toBeNull()
  })
  test("recovery: orphaned entries are those whose owner died", async () => {
    const p = createMemoryPlatform({ pid: 77 })
    await p.recovery.write({
      id: "abc",
      sourceRef: "/w/a.kimo",
      name: "a.kimo",
      reason: "snapshot",
      text: "{}",
      edits: 3,
    })
    expect((await p.recovery.list())[0]?.ownerAlive).toBe(true)
    p.control.killPid(77)
    const [e] = await p.recovery.list()
    expect(e?.ownerAlive).toBe(false)
    expect(e?.ownerExitedAt).not.toBeNull()
    expect((await p.recovery.restore("abc")).text).toBe("{}")
    await p.recovery.discard("abc")
    expect(await p.recovery.list()).toEqual([])
  })
  test("fonts: remote fetch obeys No third-party fetch and the allowlist", async () => {
    const p = createMemoryPlatform()
    await p.settings.ready
    await expect(p.fonts.fetchRemote("https://evil.example/x.woff2")).rejects.toThrow()
    await p.settings.set("privacy.noThirdPartyFetch", true)
    const e = await p.fonts.fetchRemote("https://fonts.gstatic.com/s/x.woff2").catch((x) => x)
    expect(isPlatformError(e, "BLOCKED")).toBe(true)
  })
  test("window chrome numbers", () => {
    const mac = createMemoryPlatform({ os: "macos" })
    expect(mac.window.trafficLightPosition()).toEqual({ x: 16, y: 18 })
    expect(mac.window.trafficLightInset()).toBe(68)
    mac.control.setFullscreen(true)
    expect(mac.window.trafficLightInset()).toBe(4)
    const win = createMemoryPlatform({ os: "windows" })
    expect(win.window.trafficLightPosition()).toBeNull()
    expect(win.window.trafficLightInset()).toBe(0)
  })
  test("launch: requests before a listener are queued for takeInitialRequests", async () => {
    const p = createMemoryPlatform()
    p.control.open({ source: "file-association", refs: ["/w/a.kimo"] })
    expect(await p.launch.takeInitialRequests()).toEqual([
      { source: "file-association", refs: ["/w/a.kimo"] },
    ])
    expect(await p.launch.takeInitialRequests()).toEqual([])
  })
})

describe("memory platform: board 37 trash, rename, copy", () => {
  test("Move to Trash, restore (EXISTS when taken, as a copy), remove, empty", async () => {
    const p = createMemoryPlatform({ files: { "/w/home.kimo": "{}", "/w/b.kimo": "{}" } })
    await p.recents.noteOpened("/w/home.kimo")
    const t = await p.trash.move("/w/home.kimo")
    expect(t).toMatchObject({ originalRef: "/w/home.kimo", name: "home.kimo" })
    expect(await p.files.stat("/w/home.kimo")).toBeNull()
    expect((await p.recents.listFiles()).some((f) => f.ref === "/w/home.kimo")).toBe(false)
    p.control.writeExternal("/w/home.kimo", "{}")
    await expect(p.trash.restore(t.id)).rejects.toMatchObject({ code: "EXISTS" })
    expect(await p.trash.restore(t.id, "/w/home copy.kimo")).toBe("/w/home copy.kimo")
    expect(await p.trash.list()).toEqual([])
    await expect(p.trash.restore(t.id)).rejects.toMatchObject({ code: "NOT_FOUND" })
    await p.trash.move("/w/b.kimo")
    expect(await p.trash.empty()).toBe(1)
    expect(await p.trash.list()).toEqual([])
  })
  test("rename and copy never overwrite", async () => {
    const p = createMemoryPlatform({ files: { "/w/a.kimo": "A", "/w/b.kimo": "B" } })
    await expect(p.files.rename("/w/a.kimo", "/w/b.kimo")).rejects.toMatchObject({
      code: "EXISTS",
    })
    await expect(p.files.copy("/w/a.kimo", "/w/b.kimo")).rejects.toMatchObject({ code: "EXISTS" })
    await p.files.copy("/w/a.kimo", "/w/a copy.kimo")
    await p.files.rename("/w/a.kimo", "/w/c.kimo")
    expect(p.control.readFile("/w/c.kimo")).toBe("A")
    expect(p.control.readFile("/w/a copy.kimo")).toBe("A")
    expect(p.control.readFile("/w/a.kimo")).toBeNull()
  })
})

describe("tauri surface", () => {
  test("TAURI_COMMANDS lists every command exactly once", () => {
    type Missing = Exclude<TauriCommand, (typeof TAURI_COMMANDS)[number]>
    const complete: [Missing] extends [never] ? true : false = true
    expect(complete).toBe(true)
    expect(new Set(TAURI_COMMANDS).size).toBe(TAURI_COMMANDS.length)
    for (const c of TAURI_COMMANDS) expect(c).toMatch(/^kimo_[a-z_]+$/)
  })
})
