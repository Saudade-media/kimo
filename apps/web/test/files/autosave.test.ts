/**
 * Saving a .kimo through `FileDocumentProvider` on the memory platform: the atomic write with
 * read-back, failures that keep the user's edits in a recovery file, and settings applied live.
 */
import { describe, expect, test } from "bun:test"
import { type Banner, pickBanner } from "../../src/platform/contract"
import { docText, edit, FILE, nodeNames, ROOT, setup, sleep, waitFor } from "../session-helpers"
import { fastSetup, gitState, settled } from "./helpers"

describe("autosave", () => {
  test("an edit is written atomically after the idle interval", async () => {
    const { platform, manager } = await fastSetup()
    const s = await manager.open(FILE)
    expect(s.state().phase).toBe("ready")
    expect(s.state().saveStatus.kind).toBe("saved")
    edit(s.store, "Edit000001")
    expect(s.state().saveStatus).toMatchObject({ kind: "unsaved", target: "file" })
    expect(s.state().unsavedEdits).toBe(1)
    await waitFor(() => settled(s), 2000, "autosave")
    expect(nodeNames(platform.control.readFile(FILE))).toContain("Edit000001")
    expect(s.state().saveStatus.kind).toBe("saved")
    await s.close()
  })

  test("recovery snapshots are written while dirty, even with autosave off", async () => {
    const { platform, manager } = await fastSetup(undefined, {
      settings: { "files.autosave": false },
      snapshotMs: 30,
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

  test("the autosave interval and pause-during-git apply live", async () => {
    const { platform, manager } = await setup(undefined, {
      settings: { "files.autosaveIntervalMs": 5000 },
    })
    const s = await manager.open(FILE)
    await platform.settings.set("files.autosaveIntervalMs", 250)
    edit(s.store, "Live000001")
    await waitFor(() => settled(s), 2000, "autosave at the new interval")
    await platform.settings.set("files.pauseAutosaveDuringGit", false)
    platform.control.setGit(ROOT, gitState("rebase"), {
      kind: "operation-started",
      operation: "rebase",
    })
    expect(s.provider?.pauses.has("git")).toBe(false)
    await s.close()
  })
})

describe("failed saves", () => {
  test("a write that dies leaves the file untouched, keeps the edits in recovery and is retried", async () => {
    const { platform, manager } = await fastSetup(undefined, { retryMs: 150 })
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
    await waitFor(() => s.failure === null, 2000, "retry")
    expect(nodeNames(platform.control.readFile(FILE))).toContain("Crash00001")
    expect(await platform.recovery.list()).toEqual([])
    await s.close()
  })

  test("disk full is a save failure that Retry clears", async () => {
    const { platform, manager } = await fastSetup(undefined, { retryMs: 60_000 })
    const s = await manager.open(FILE)
    platform.control.failNextWrite("DISK_FULL", "ENOSPC", FILE)
    edit(s.store, "Full000001")
    await waitFor(() => s.failure !== null)
    expect(s.failure?.code).toBe("DISK_FULL")
    expect(s.state().saveStatus.kind).toBe("failed")
    expect(s.state().banner?.kind).toBe("save-failed")
    await s.runAction("retry-save")
    expect(s.failure).toBeNull()
    await s.close()
  })

  test("a read-only file is classified as permission denied", async () => {
    const { platform, manager } = await fastSetup(undefined, { retryMs: 60_000 })
    const s = await manager.open(FILE)
    platform.control.setReadOnly(FILE, true)
    edit(s.store, "Perm000001")
    await waitFor(() => s.failure !== null)
    expect(s.failure).toMatchObject({ code: "PERMISSION", errno: "EACCES" })
    await s.dispose()
  })

  test("a read-back mismatch keeps a recovery copy, and the corrupted bytes are not an external edit", async () => {
    const { platform, manager } = await fastSetup(undefined, { retryMs: 60_000 })
    const s = await manager.open(FILE)
    platform.control.corruptNextReadBack(FILE)
    edit(s.store, "Mismatch01")
    await waitFor(() => s.failure !== null)
    expect(s.failure?.code).toBe("READ_BACK_MISMATCH")
    expect((await platform.recovery.list())[0]?.reason).toBe("read-back-mismatch")
    await sleep(300) // the watcher saw our (corrupted) write
    expect(s.state().toasts).toEqual([])
    await s.dispose()
  })

  test("flushAll reports the files that could not be saved, and a failed flush blocks closing", async () => {
    const other = `${ROOT}/onboarding.kimo`
    const { platform, manager } = await fastSetup(
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
})

describe("banner priority", () => {
  const saveFailed: Banner = {
    kind: "save-failed",
    severity: "danger",
    fileName: "a",
    failure: { code: "DISK_FULL", path: FILE, message: "x", at: 0 },
  }
  const gitRebase: Banner = {
    kind: "git-operation",
    severity: "warning",
    operation: "rebase",
    unsavedEdits: 1,
  }
  const gitMerge: Banner = {
    kind: "git-operation",
    severity: "warning",
    operation: "merge",
    unsavedEdits: 0,
  }
  const mergeConflicts: Banner = {
    kind: "merge-conflicts",
    severity: "warning",
    info: null,
    open: 2,
    resolved: 3,
    total: 5,
  }
  const locked: Banner = {
    kind: "locked",
    severity: "warning",
    fileName: "a",
    holder: {
      pid: 1,
      app: "kimo-cli",
      appLabel: "kimo",
      host: "h",
      sinceIso: "",
      lockPath: "",
    } as never,
  }

  test("a failed save outranks a git operation, stored conflicts hide the generic merge banner, a lock outranks both", () => {
    expect(
      pickBanner([{ kind: "merge-ready", severity: "info", fileName: "a" }, gitRebase, saveFailed])
        ?.kind,
    ).toBe("save-failed")
    expect(pickBanner([gitMerge, mergeConflicts])?.kind).toBe("merge-conflicts")
    expect(pickBanner([locked, gitMerge])?.kind).toBe("locked")
  })
})
