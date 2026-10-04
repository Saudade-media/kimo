/**
 * M4 files: `FileDocumentProvider` + `FileDocumentSession` / `FileSessionManager` on the memory
 * platform, one test per board 17 path (save, failures, consent, external changes, git, leases,
 * newer format, failed load, launch recovery) and the session rules (400 ms, banner priority).
 */
import { describe, expect, test } from "bun:test"
import { parse } from "@kimo/core-schema"
import type { RecoveryEntry } from "@kimo/platform"
import { FileDocumentProvider } from "@kimo/sync"
import {
  BANNER_PRIORITY,
  bannerCopy,
  displayedSaveStatus,
  pickBanner,
  type SaveStatus,
  saveStatusLabel,
  toastCopy,
} from "../src/platform/contract"
import { bannerFormatters } from "../src/platform/format"
import {
  approxChangedLines,
  type failedLoadDetail,
  recoveryCandidate,
} from "../src/platform/session"
import {
  addNode,
  docText,
  edit,
  FILE,
  fixture,
  migrations,
  nodeNames,
  OLD_FORMAT,
  ROOT,
  rename,
  renameNode,
  setup,
  sleep,
  waitFor,
} from "./m4-helpers"

const fmt = bannerFormatters("macos")
/** Nothing pending and no write in flight (`dirty` drops when a write starts). */
const settled = (s: { provider: { dirty: boolean; writingSince: number | null } | null }) =>
  !!s.provider && !s.provider.dirty && s.provider.writingSince === null
const git = (operation: "rebase" | "merge" | null, indexLocked = false) => ({
  branch: "feat/onboarding",
  head: "abc",
  operation,
  indexLocked,
  fileStatus: "modified" as const,
  changedCount: 3,
})

describe("FileDocumentProvider on platform.files", () => {
  test("atomic save with read-back, 2 s-style idle autosave", async () => {
    const { platform, manager } = await setup()
    const s = await manager.open(FILE)
    expect(s.state().phase).toBe("ready")
    expect(s.state().saveStatus.kind).toBe("saved")
    edit(s.store, "Edit000001")
    expect(s.state().saveStatus).toMatchObject({ kind: "unsaved", target: "file" })
    expect(s.state().unsavedEdits).toBe(1)
    await waitFor(() => settled(s), 2000, "autosave")
    expect(nodeNames(platform.control.readFile(FILE))).toContain("Edit000001")
    expect(s.state().saveStatus.kind).toBe("saved")
    expect(saveStatusLabel(s.state().saveStatus)).toBe("Saved to disk")
    await s.close()
  })

  test("kill mid-write: the file is untouched, edits go to recovery, retry succeeds", async () => {
    const { platform, manager } = await setup()
    const before = platform.control.readFile(FILE)
    const s = await manager.open(FILE)
    platform.control.failNextWrite("IO", "EIO", FILE)
    edit(s.store, "Crash00001")
    await waitFor(() => s.failure !== null, 2000, "failure")
    expect(platform.control.readFile(FILE)).toBe(before)
    expect(s.failure?.code).toBe("IO")
    const entries = await platform.recovery.list()
    expect(entries.map((e) => e.reason)).toEqual(["save-failed"])
    expect(s.failure?.recoveryPath).toContain(entries[0]?.id as string)
    expect(s.state().saveStatus.kind).toBe("failed")
    // Retried after saveRetryMs (30 s in the app).
    await waitFor(() => s.failure === null, 2000, "retry")
    expect(nodeNames(platform.control.readFile(FILE))).toContain("Crash00001")
    expect(await platform.recovery.list()).toEqual([])
    await s.close()
  })

  test("disk full: Save failed + danger banner with the design's copy", async () => {
    const { platform, manager } = await setup(undefined, { retryMs: 60_000 })
    const s = await manager.open(FILE)
    platform.control.failNextWrite("DISK_FULL", "ENOSPC", FILE)
    edit(s.store, "Full000001")
    await waitFor(() => s.failure !== null)
    const st = s.state()
    expect(st.saveStatus.kind).toBe("failed")
    expect(saveStatusLabel(st.saveStatus)).toBe("Save failed")
    expect(st.banner?.kind).toBe("save-failed")
    const copy = bannerCopy(st.banner as never, fmt)
    expect(copy.title).toBe("Couldn't save marketing.kimo")
    expect(copy.body).toBe(
      "The disk is full (ENOSPC). Your edits are safe in a recovery file; retrying every 30 s.",
    )
    expect(copy.actions.map((a) => a.label)).toEqual(["Save as…", "Retry"])
    await s.runAction("retry-save")
    expect(s.failure).toBeNull()
    await s.close()
  })

  test("permission denied: classified PERMISSION / EACCES", async () => {
    const { platform, manager } = await setup(undefined, { retryMs: 60_000 })
    const s = await manager.open(FILE)
    platform.control.setReadOnly(FILE, true)
    edit(s.store, "Perm000001")
    await waitFor(() => s.failure !== null)
    expect(s.failure).toMatchObject({ code: "PERMISSION", errno: "EACCES" })
    const copy = bannerCopy(s.state().banner as never, fmt)
    expect(copy.title).toBe("Couldn't save — permission denied")
    expect(copy.body).toBe(
      "~/Projects/loom is read-only for your user (EACCES). Save a copy somewhere else.",
    )
    await s.dispose()
  })

  test("read-back mismatch: recovery copy, and the corrupted bytes are not an external edit", async () => {
    const { platform, manager } = await setup(undefined, { retryMs: 60_000 })
    const s = await manager.open(FILE)
    platform.control.corruptNextReadBack(FILE)
    edit(s.store, "Mismatch01")
    await waitFor(() => s.failure !== null)
    expect(s.failure?.code).toBe("READ_BACK_MISMATCH")
    expect((await platform.recovery.list())[0]?.reason).toBe("read-back-mismatch")
    await sleep(300) // the watcher saw our (corrupted) write
    expect(s.state().toasts).toEqual([])
    expect(bannerCopy(s.state().banner as never, fmt).title).toBe(
      "Saved, but the read-back didn't match",
    )
    await s.dispose()
  })

  test("recovery snapshots every recoverySnapshotMs while dirty, even with autosave off", async () => {
    const { platform, manager } = await setup(undefined, {
      settings: { "files.autosave": false },
    })
    const s = await manager.open(FILE)
    edit(s.store, "Snap000001")
    expect(s.state().saveStatus).toMatchObject({ kind: "unsaved", autosaveAt: null })
    await waitFor(() => (s.provider?.hasRecoveryCopy ?? false) === true, 2000, "snapshot")
    const [entry] = await platform.recovery.list()
    expect(entry?.reason).toBe("snapshot")
    expect(entry?.edits).toBe(1)
    expect(nodeNames(platform.control.readFile(FILE))).not.toContain("Snap000001")
    // ⌘S writes the file and drops the snapshot.
    await s.save()
    expect(await platform.recovery.list()).toEqual([])
    await s.close()
  })

  test("undo of a reload restores memory only and never rewrites the file", async () => {
    const { platform, manager } = await setup()
    const s = await manager.open(FILE)
    const external = renameNode(platform.control.readFile(FILE) as string, "Rect000001", "Ext")
    platform.control.writeExternal(FILE, external)
    await waitFor(() => s.state().toasts.length > 0, 2000, "reload toast")
    const toast = s.state().toasts[0]
    expect(toast?.kind).toBe("external-reloaded")
    expect(toastCopy(toast as never).text).toBe("marketing.kimo changed on disk — reloaded")
    expect(s.store.getNode("Rect000001")?.name).toBe("Ext")
    await s.undoExternal((toast as unknown as { undo: never }).undo)
    expect(s.store.getNode("Rect000001")?.name).toBe("Rect000001")
    expect(s.state().saveStatus.kind).toBe("unsaved")
    await sleep(400)
    expect(platform.control.readFile(FILE)).toBe(external)
    await s.dispose()
  })
})

describe("external changes", () => {
  test("local edits + clean change: three-way merge, toast with counts, autosave resumes", async () => {
    const { platform, manager } = await setup(undefined, {
      settings: { "files.autosaveIntervalMs": 1000 },
    })
    const s = await manager.open(FILE)
    edit(s.store, "Local00001")
    platform.control.writeExternal(
      FILE,
      addNode(platform.control.readFile(FILE) as string, "Disk000001"),
    )
    await waitFor(() => s.state().toasts.length > 0, 2000, "merge toast")
    const t = s.state().toasts[0]
    expect(t?.kind).toBe("external-merged")
    expect(toastCopy(t as never).text).toBe("Merged 1 change from disk with your 1 edit")
    expect(s.store.hasNode("Local00001")).toBe(true)
    expect(s.store.hasNode("Disk000001")).toBe(true)
    await waitFor(() => settled(s), 3000, "autosave after merge")
    expect(nodeNames(platform.control.readFile(FILE))).toEqual(
      expect.arrayContaining(["Local00001", "Disk000001"]),
    )
    await s.close()
  })

  test("local edits + conflicting change: conflicts toast, autosave paused", async () => {
    const { platform, manager } = await setup(undefined, {
      settings: { "files.autosaveIntervalMs": 1000 },
    })
    const s = await manager.open(FILE)
    rename(s.store, "Rect000001", "Mine")
    platform.control.writeExternal(
      FILE,
      renameNode(platform.control.readFile(FILE) as string, "Rect000001", "Theirs"),
    )
    await waitFor(() => s.state().toasts.length > 0, 2000, "conflict toast")
    const st = s.state()
    expect(st.toasts[0]?.kind).toBe("external-conflicts")
    expect(toastCopy(st.toasts[0] as never)).toMatchObject({
      text: "Changed on disk while you were editing — 1 conflict",
      action: "Review",
      component: "Toast/Warning",
    })
    expect(st.saveStatus).toEqual({ kind: "paused", reason: "conflicts", open: 1 })
    expect(saveStatusLabel(st.saveStatus)).toBe("1 conflict · autosave paused")
    expect(st.banner?.kind).toBe("merge-conflicts")
    expect(st.conflicts).toEqual({ open: 1, total: 1 })
    expect(s.provider?.pauses.has("conflicts")).toBe(true)
    await s.dispose()
  })

  test("removed on disk: the document stays and is unsaved", async () => {
    const { platform, manager } = await setup()
    const s = await manager.open(FILE)
    platform.control.removeExternal(FILE)
    await waitFor(() => s.provider?.dirty === true, 2000, "removed")
    expect(s.state().saveStatus.kind).toBe("unsaved")
    expect(s.store.hasNode("Rect000001")).toBe(true)
    await s.dispose()
  })
})

describe("git operations", () => {
  test("rebase start pauses autosave, finish resumes and reconciles", async () => {
    const { platform, manager } = await setup()
    platform.control.setGit(ROOT, git(null), { kind: "status-changed" })
    const s = await manager.open(FILE)
    expect(s.state().branchLabel).toBe("feat/onboarding")
    platform.control.setGit(ROOT, git("rebase"), { kind: "operation-started", operation: "rebase" })
    edit(s.store, "Rebase0001")
    let st = s.state()
    expect(st.saveStatus).toEqual({ kind: "paused", reason: "git", operation: "rebase" })
    expect(saveStatusLabel(st.saveStatus)).toBe("Autosave paused · rebase")
    expect(st.banner?.kind).toBe("git-operation")
    const copy = bannerCopy(st.banner as never, fmt)
    expect(copy.title).toBe("Rebase in progress — autosave paused")
    expect(copy.body).toBe("Your 1 unsaved edit is kept in memory.")
    expect(copy.actions.map((a) => a.label)).toEqual([
      "Discard",
      "Stash as recovery file",
      "Keep my edits",
    ])
    // git rewrites the file meanwhile: not merged until the operation finishes.
    const rebased = addNode(platform.control.readFile(FILE) as string, "Upstream01")
    platform.control.writeExternal(FILE, rebased)
    await sleep(400)
    expect(s.store.hasNode("Upstream01")).toBe(false)
    expect(platform.control.readFile(FILE)).toBe(rebased)
    await s.respondToGit("keep")
    expect(s.state().banner).toBeNull()
    platform.control.setGit(ROOT, git(null), { kind: "operation-finished", operation: "rebase" })
    await waitFor(() => s.store.hasNode("Upstream01"), 2000, "merge after rebase")
    st = s.state()
    expect(st.toasts[0]?.kind).toBe("external-merged")
    await waitFor(() => settled(s), 2000, "autosave after rebase")
    expect(nodeNames(platform.control.readFile(FILE))).toEqual(
      expect.arrayContaining(["Rebase0001", "Upstream01"]),
    )
    await s.close()
  })

  test("Discard reloads what git left (undoable); Stash writes a recovery entry", async () => {
    const { platform, manager } = await setup()
    const s = await manager.open(FILE)
    platform.control.setGit(ROOT, git("merge"), { kind: "operation-started", operation: "merge" })
    edit(s.store, "Dropped001")
    await s.respondToGit("discard")
    expect(s.store.hasNode("Dropped001")).toBe(false)
    const undo = s.state().toasts[0]
    expect(undo?.kind).toBe("external-reloaded")
    await s.undoExternal((undo as unknown as { undo: never }).undo)
    expect(s.store.hasNode("Dropped001")).toBe(true)
    await s.respondToGit("stash")
    expect(s.store.hasNode("Dropped001")).toBe(false)
    const [entry] = await platform.recovery.list()
    expect(entry?.reason).toBe("git-stash")
    // A later save keeps the stash for the launch dialog.
    platform.control.setGit(ROOT, git(null), { kind: "operation-finished", operation: "merge" })
    edit(s.store, "After00001")
    await s.save()
    expect((await platform.recovery.list()).map((e) => e.reason)).toEqual(["git-stash"])
    await s.close()
  })

  test("⌘S while git-paused asks for a choice instead of writing", async () => {
    const { platform, manager } = await setup()
    const s = await manager.open(FILE)
    platform.control.setGit(ROOT, git("rebase"), { kind: "operation-started", operation: "rebase" })
    edit(s.store, "Ask0000001")
    await s.respondToGit("keep")
    await s.respondToGit("later")
    const before = platform.control.readFile(FILE)
    await s.save()
    expect(s.state().banner?.kind).toBe("git-operation")
    await s.flush() // update restart / close: goes to recovery, not into the rebase
    expect(platform.control.readFile(FILE)).toBe(before)
    expect((await platform.recovery.list())[0]?.reason).toBe("snapshot")
    await s.dispose()
  })
})

describe("leases", () => {
  test("held by a live process: locked, Open read-only, Retry once freed", async () => {
    const { platform, manager } = await setup()
    platform.control.setForeignLease(FILE, { pid: 48213 })
    const s = await manager.open(FILE)
    let st = s.state()
    expect(st.phase).toBe("read-only")
    expect(st.saveStatus.kind).toBe("locked")
    expect(saveStatusLabel(st.saveStatus)).toBe("Locked by another app")
    const copy = bannerCopy(st.banner as never, fmt)
    expect(copy.title).toBe("Locked by another process")
    expect(copy.body).toMatch(
      /^kimo mcp \(pid 48213\) has had marketing\.kimo open for writing since \d\d:\d\d\.$/,
    )
    expect(s.store.readOnly).not.toBeNull()
    expect(s.store.hasNode("Rect000001")).toBe(true)
    await s.runAction("open-read-only")
    st = s.state()
    expect(st.banner).toBeNull()
    expect(st.saveStatus).toEqual({ kind: "read-only", cause: "user-choice" })
    platform.control.clearForeignLease(FILE)
    await s.runAction("retry-lease")
    st = s.state()
    expect(st.phase).toBe("ready")
    expect(st.saveStatus.kind).toBe("saved")
    expect(s.store.readOnly).toBeNull()
    await s.close()
  })

  test("stale lease (dead pid) is reclaimed on open", async () => {
    const { platform, manager } = await setup()
    platform.control.setForeignLease(FILE, { pid: 777 })
    platform.control.killPid(777)
    const s = await manager.open(FILE)
    expect(s.state().phase).toBe("ready")
    expect((await platform.leases.inspect(FILE))?.self).toBe(true)
    await s.close()
    expect(await platform.leases.inspect(FILE)).toBeNull()
  })

  test("one writer per file: open twice returns the same session", async () => {
    const { manager } = await setup()
    const [a, b] = await Promise.all([manager.open(FILE), manager.open(FILE)])
    expect(a).toBe(b)
    expect(manager.sessions().length).toBe(1)
    await a.close()
    expect(manager.sessions().length).toBe(0)
  })
})

describe("formats and failed loads", () => {
  test("newer format: read-only + info banner, nothing is written", async () => {
    const text = fixture("forward/unknown-feature.kimo")
    const { platform, manager } = await setup({ [FILE]: text })
    const s = await manager.open(FILE)
    const st = s.state()
    expect(st.phase).toBe("read-only")
    expect(st.saveStatus).toEqual({ kind: "read-only", cause: "newer-format" })
    expect(st.banner).toMatchObject({ kind: "newer-format", features: ["layout/grid"] })
    expect(bannerCopy(st.banner as never, fmt).title).toBe("Read-only — made with a newer Kimo")
    await s.save()
    expect(platform.control.readFile(FILE)).toBe(text)
    await s.close()
  })

  test("older format: consent dialog; autosave goes to recovery until Upgrade and save", async () => {
    const { platform, manager } = await setup(
      { [FILE]: OLD_FORMAT },
      { openOptions: { migrations } },
    )
    const s = await manager.open(FILE)
    let st = s.state()
    expect(st.phase).toBe("needs-consent")
    expect(st.consent).toMatchObject({
      fileName: "marketing.kimo",
      fromFormat: "0.1",
      toFormat: "1.0",
    })
    expect(st.consent?.approxChangedLines).toBeGreaterThan(0)
    edit(s.store, "Pending001")
    await waitFor(() => (s.provider?.hasRecoveryCopy ?? false) === true, 2000, "recovery autosave")
    expect(platform.control.readFile(FILE)).toBe(OLD_FORMAT)
    expect((await platform.recovery.list())[0]?.reason).toBe("upgrade-pending")
    expect(s.state().saveStatus).toMatchObject({ kind: "unsaved", target: "recovery" })
    await s.respondToConsent("upgrade")
    st = s.state()
    expect(st.phase).toBe("ready")
    expect(parse(platform.control.readFile(FILE) as string).format).toBe("1.0.0")
    expect(await platform.recovery.list()).toEqual([])
    await s.close()
  })

  test("older format, Open read-only: the file is never written", async () => {
    const { platform, manager } = await setup(
      { [FILE]: OLD_FORMAT },
      { openOptions: { migrations } },
    )
    const s = await manager.open(FILE)
    await s.respondToConsent("read-only")
    expect(s.state().saveStatus).toEqual({ kind: "read-only", cause: "user-choice" })
    expect(s.store.readOnly).not.toBeNull()
    await s.save()
    expect(platform.control.readFile(FILE)).toBe(OLD_FORMAT)
    await s.close()
  })

  test("failed load (git markers) is terminal: no save, no autosave, no recovery writes", async () => {
    const good = docText().split("\n")
    const broken = [...good.slice(0, 3), "<<<<<<< HEAD", ...good.slice(3)].join("\n")
    const { platform, manager } = await setup({ [FILE]: broken })
    const s = await manager.open(FILE)
    const st = s.state()
    expect(st.phase).toBe("failed-load")
    expect(saveStatusLabel(st.saveStatus)).toBe("Read-only · couldn't load")
    expect(st.banner?.kind).toBe("failed-load")
    const detail = (st.banner as { detail: ReturnType<typeof failedLoadDetail> }).detail
    expect(detail.headline).toBe("This file can't be parsed")
    expect(detail.gitConflictMarkers).toBe(true)
    expect(detail.error).toMatch(/^SyntaxError · line 4/)
    expect(detail.excerpt.map((l) => l.line)).toEqual([3, 4, 5])
    expect(detail.excerpt[1]?.text).toBe("<<<<<<< HEAD")
    expect(bannerCopy(st.banner as never, fmt).title).toBe("Couldn't open marketing.kimo")
    expect(() => edit(s.store, "Never00001")).toThrow()
    await s.save()
    await s.flush()
    platform.control.writeExternal(FILE, docText())
    await sleep(300)
    expect(s.state().phase).toBe("failed-load")
    expect(await platform.recovery.list()).toEqual([])
    await s.runAction("reveal")
    await s.runAction("open-as-text")
    expect(platform.control.calls).toEqual(
      expect.arrayContaining([`reveal ${FILE}`, `openWithDefaultApp ${FILE}`]),
    )
    await s.close()
  })
})

describe("session rules", () => {
  test("displayedSaveStatus: Saving… only after 400 ms", async () => {
    const saved: SaveStatus = { kind: "saved", savedAt: 0, ref: FILE }
    const saving: SaveStatus = { kind: "saving", since: 1000 }
    expect(displayedSaveStatus(saving, saved, 1399)).toBe(saved)
    expect(displayedSaveStatus(saving, saved, 1400)).toBe(saving)
    const { platform, manager } = await setup(undefined, {
      platform: (p) => {
        const write = p.files.writeTextAtomic
        p.files.writeTextAtomic = async (ref, text, o) => {
          await sleep(700)
          return write(ref, text, o)
        }
        return p
      },
    })
    void platform
    const s = await manager.open(FILE)
    const shown: string[] = []
    s.subscribe((st) => shown.push(st.saveStatus.kind))
    edit(s.store, "Slow000001")
    const save = s.save()
    await sleep(150)
    expect(s.state().saveStatus.kind).toBe("unsaved")
    await sleep(400)
    expect(s.state().saveStatus.kind).toBe("saving")
    await save
    expect(s.state().saveStatus.kind).toBe("saved")
    expect(shown).toContain("saving")
    await s.close()
  })

  test("pickBanner: highest severity wins", () => {
    expect(BANNER_PRIORITY[0]).toBe("failed-load")
    const b = pickBanner([
      { kind: "merge-ready", severity: "info", fileName: "a" },
      { kind: "git-operation", severity: "warning", operation: "rebase", unsavedEdits: 1 },
      {
        kind: "save-failed",
        severity: "danger",
        fileName: "a",
        failure: { code: "DISK_FULL", path: FILE, message: "x", at: 0 },
      },
    ])
    expect(b?.kind).toBe("save-failed")
  })

  test("save failure during a rebase: the danger banner wins", async () => {
    const { platform, manager } = await setup(undefined, { retryMs: 60_000 })
    const s = await manager.open(FILE)
    platform.control.failNextWrite("DISK_FULL", "ENOSPC", FILE)
    edit(s.store, "Both000001")
    await waitFor(() => s.failure !== null)
    platform.control.setGit(ROOT, git("rebase"), { kind: "operation-started", operation: "rebase" })
    expect(s.state().banner?.kind).toBe("save-failed")
    expect(s.state().saveStatus.kind).toBe("failed")
    await s.dispose()
  })

  test("flushAll reports files that could not be saved", async () => {
    const other = `${ROOT}/onboarding.kimo`
    const { platform, manager } = await setup(
      { [FILE]: docText(), [other]: docText("Onboarding") },
      { retryMs: 60_000, settings: { "files.autosave": false } },
    )
    const a = await manager.open(FILE)
    const b = await manager.open(other)
    edit(a.store, "Flush00001")
    edit(b.store, "Flush00002")
    platform.control.failNextWrite("DISK_FULL", "ENOSPC", other)
    const r = await manager.flushAll()
    expect(r).toEqual({ ok: false, failed: [other] })
    expect(nodeNames(platform.control.readFile(FILE))).toContain("Flush00001")
    expect(await platform.control.requestClose()).toBe(true) // no close handler installed
    manager.install()
    platform.control.failNextWrite("DISK_FULL", "ENOSPC", other)
    expect(await platform.control.requestClose()).toBe(false)
    await manager.dispose()
  })

  test("settings: autosave interval and pause-during-git apply live", async () => {
    const { platform, manager } = await setup(undefined, {
      settings: { "files.autosaveIntervalMs": 5000 },
    })
    const s = await manager.open(FILE)
    await platform.settings.set("files.autosaveIntervalMs", 250)
    edit(s.store, "Live000001")
    await waitFor(() => settled(s), 2000, "autosave at the new interval")
    await platform.settings.set("files.pauseAutosaveDuringGit", false)
    platform.control.setGit(ROOT, git("rebase"), { kind: "operation-started", operation: "rebase" })
    expect(s.provider?.pauses.has("git")).toBe(false)
    await s.close()
  })

  test("approxChangedLines counts added + removed lines", () => {
    expect(approxChangedLines("a\nb\nc", "a\nB\nc\nd")).toBe(3)
  })
})

describe("launch recovery", () => {
  test("candidates of crashed owners, newest first, with the board's copy", async () => {
    const onboarding = `${ROOT}/onboarding.kimo`
    const { platform, manager } = await setup({ [FILE]: docText(), [onboarding]: docText("O") })
    await platform.recovery.write({
      id: "aaaaaaaaaaaaaaaa",
      sourceRef: FILE,
      name: "marketing.kimo",
      reason: "snapshot",
      text: addNode(docText(), "Recovered1"),
      edits: 14,
      lastAutosaveAt: platform.control.now() - 60_000,
    })
    platform.control.tick(1000)
    await platform.recovery.write({
      id: "untitled-x",
      sourceRef: null,
      name: "Untitled 2",
      reason: "untitled",
      text: docText("Untitled 2"),
      edits: 3,
      layers: 22,
    })
    expect(await manager.recoveryCandidates()).toEqual([]) // owner still alive
    platform.control.killPid(1000)
    const c = await manager.recoveryCandidates()
    expect(c.map((x) => x.entry.name)).toEqual(["Untitled 2", "marketing.kimo"])
    expect(c[0]).toMatchObject({ badge: "never saved", location: "not on disk yet" })
    expect(c[0]?.detail).toMatch(/^Created \d\d:\d\d · 22 layers$/)
    expect(c[0]?.choices).toEqual(["discard", "save-as"])
    expect(c[1]).toMatchObject({ badge: "14 edits", location: "~/Projects/loom/marketing.kimo" })
    expect(c[1]?.detail).toMatch(/^Last autosave \d\d:\d\d · quit unexpectedly \d\d:\d\d$/)
    expect(
      recoveryCandidate({ ...(c[1]?.entry as RecoveryEntry), sourceChangedSince: false }).detail,
    ).toMatch(/file unchanged on disk since$/)

    // Restore: the recovered document is loaded unsaved, and the entry goes once saved.
    const s = await manager.resolveRecovery("aaaaaaaaaaaaaaaa", "restore")
    expect(s?.store.hasNode("Recovered1")).toBe(true)
    expect(s?.state().saveStatus.kind).toBe("unsaved")
    await s?.save()
    expect(nodeNames(platform.control.readFile(FILE))).toContain("Recovered1")

    // Untitled: Save as… writes the new file and drops the entry.
    platform.dialogs.saveFile = async () => `${ROOT}/untitled-2.kimo`
    const u = await manager.resolveRecovery("untitled-x", "save-as")
    expect(u?.ref).toBe(`${ROOT}/untitled-2.kimo`)
    expect((await platform.recovery.list()).map((e) => e.id)).not.toContain("untitled-x")
    await manager.dispose()
  })

  test("Discard all / Decide later", async () => {
    const { platform, manager } = await setup()
    for (const id of ["r1", "r2"])
      await platform.recovery.write({
        id,
        sourceRef: `${ROOT}/${id}.kimo`,
        name: `${id}.kimo`,
        reason: "snapshot",
        text: docText(),
        edits: 1,
      })
    platform.control.killPid(1000)
    await manager.resolveRecoveryDialog("decide-later")
    expect((await manager.recoveryCandidates()).length).toBe(2)
    await manager.resolveRecoveryDialog("discard-all")
    expect(await platform.recovery.list()).toEqual([])
  })
})

describe("FileDocumentProvider contract", () => {
  test("is a FileSessionProvider over platform.files / platform.recovery", async () => {
    const { platform } = await setup()
    const p = new FileDocumentProvider({
      path: FILE,
      files: platform.files,
      recovery: platform.recovery,
      autosaveMs: 50,
    })
    expect(p.recoveryPath).toBe(`/home/test/.kimo/recovery/${p.recoveryId}.kimo`)
    expect(p.recoveryId).toMatch(/^[0-9a-f]{16}$/)
    expect(p.pauses.size).toBe(0)
  })
})
