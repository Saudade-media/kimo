/**
 * A file that changes on disk while it is open: three-way merge with the user's edits, the
 * "ask first" setting, undoing a reload, and the pause around git operations.
 */
import { describe, expect, test } from "bun:test"
import {
  addNode,
  edit,
  FILE,
  fixture,
  nodeNames,
  ROOT,
  rename,
  renameNode,
  setup,
  sleep,
  waitFor,
} from "../session-helpers"
import { fastSetup, gitState, settled } from "./helpers"

// Tests that make a local edit and then write the file from outside keep a long autosave interval
// so the edit is still unsaved when the change on disk is seen (the watcher debounces 150 ms),
// then shorten it once the interesting part is over.
const slowAutosave = { "files.autosaveIntervalMs": 1000 }

describe("external changes", () => {
  test("local edits and a clean change on disk are merged, then autosave resumes", async () => {
    const { platform, manager } = await setup(undefined, { settings: slowAutosave })
    const s = await manager.open(FILE)
    edit(s.store, "Local00001")
    platform.control.writeExternal(
      FILE,
      addNode(platform.control.readFile(FILE) as string, "Disk000001"),
    )
    await waitFor(() => s.state().toasts.length > 0, 2000, "merge toast")
    expect(s.state().toasts[0]?.kind).toBe("external-merged")
    expect(s.store.hasNode("Local00001")).toBe(true)
    expect(s.store.hasNode("Disk000001")).toBe(true)
    s.provider?.setAutosaveMs(30)
    await waitFor(() => settled(s), 3000, "autosave after merge")
    expect(nodeNames(platform.control.readFile(FILE))).toEqual(
      expect.arrayContaining(["Local00001", "Disk000001"]),
    )
    await s.close()
  })

  test("a conflicting change pauses autosave until the conflicts are resolved", async () => {
    const { platform, manager } = await setup(undefined, { settings: slowAutosave })
    const s = await manager.open(FILE)
    rename(s.store, "Rect000001", "Mine")
    platform.control.writeExternal(
      FILE,
      renameNode(platform.control.readFile(FILE) as string, "Rect000001", "Theirs"),
    )
    await waitFor(() => s.state().toasts.length > 0, 2000, "conflict toast")
    const st = s.state()
    expect(st.toasts[0]?.kind).toBe("external-conflicts")
    expect(st.saveStatus).toEqual({ kind: "paused", reason: "conflicts", open: 1 })
    expect(st.banner?.kind).toBe("merge-conflicts")
    expect(st.conflicts).toEqual({ open: 1, total: 1 })
    expect(s.provider?.pauses.has("conflicts")).toBe(true)
    await s.dispose()
  })

  test("a file removed on disk stays open and unsaved", async () => {
    const { platform, manager } = await fastSetup()
    const s = await manager.open(FILE)
    platform.control.removeExternal(FILE)
    await waitFor(() => s.provider?.dirty === true, 2000, "removed")
    expect(s.state().saveStatus.kind).toBe("unsaved")
    expect(s.store.hasNode("Rect000001")).toBe(true)
    await s.dispose()
  })

  test("undoing a reload restores memory only and never rewrites the file", async () => {
    const { platform, manager } = await fastSetup()
    const s = await manager.open(FILE)
    const external = renameNode(platform.control.readFile(FILE) as string, "Rect000001", "Ext")
    platform.control.writeExternal(FILE, external)
    await waitFor(() => s.state().toasts.length > 0, 2000, "reload toast")
    const toast = s.state().toasts[0]
    expect(toast?.kind).toBe("external-reloaded")
    expect(s.store.getNode("Rect000001")?.name).toBe("Ext")
    await s.undoExternal((toast as unknown as { undo: never }).undo)
    expect(s.store.getNode("Rect000001")?.name).toBe("Rect000001")
    expect(s.state().saveStatus.kind).toBe("unsaved")
    await sleep(250) // eight autosave intervals
    expect(platform.control.readFile(FILE)).toBe(external)
    await s.dispose()
  })
})

describe("external changes with Ask first", () => {
  const ask = { "files.onExternalChange": "ask", ...slowAutosave }

  test("local edits are not merged until asked, and the file on disk is kept", async () => {
    const { platform, manager } = await setup(undefined, { settings: ask })
    const s = await manager.open(FILE)
    edit(s.store, "Local00001")
    const disk = addNode(platform.control.readFile(FILE) as string, "Disk000001")
    platform.control.writeExternal(FILE, disk)
    await waitFor(() => s.state().banner?.kind === "external-change", 2000, "ask banner")
    expect(s.store.getNode("Disk000001")).toBeUndefined()
    // Autosave stays paused while the question is open.
    s.provider?.setAutosaveMs(30)
    await sleep(150)
    expect(platform.control.readFile(FILE)).toBe(disk)
    // Merge: the change from disk joins the edits; autosave resumes.
    await s.runAction("external-merge")
    expect(s.state().banner?.kind).not.toBe("external-change")
    expect(s.store.getNode("Disk000001")).toBeDefined()
    expect(s.store.getNode("Local00001")).toBeDefined()
    await waitFor(
      () => nodeNames(platform.control.readFile(FILE)).includes("Local00001"),
      2000,
      "autosave after merge",
    )
    await s.dispose()
  })

  test("Keep mine saves the local version over the file", async () => {
    const { platform, manager } = await setup(undefined, { settings: ask })
    const s = await manager.open(FILE)
    edit(s.store, "Local00001")
    platform.control.writeExternal(
      FILE,
      addNode(platform.control.readFile(FILE) as string, "Disk000001"),
    )
    await waitFor(() => s.state().banner?.kind === "external-change", 2000, "ask banner")
    s.provider?.setAutosaveMs(30)
    await s.runAction("external-keep")
    expect(s.state().banner?.kind).not.toBe("external-change")
    await waitFor(
      () => nodeNames(platform.control.readFile(FILE)).includes("Local00001"),
      2000,
      "local version saved",
    )
    expect(nodeNames(platform.control.readFile(FILE))).not.toContain("Disk000001")
    await s.dispose()
  })
})

describe("git operations", () => {
  test("a rebase pauses autosave and the change git makes is merged once it finishes", async () => {
    const { platform, manager } = await fastSetup(undefined, { autosaveMs: 60 })
    platform.control.setGit(ROOT, gitState(null), { kind: "status-changed" })
    const s = await manager.open(FILE)
    platform.control.setGit(ROOT, gitState("rebase"), {
      kind: "operation-started",
      operation: "rebase",
    })
    edit(s.store, "Rebase0001")
    const st = s.state()
    expect(st.saveStatus).toEqual({ kind: "paused", reason: "git", operation: "rebase" })
    expect(st.banner?.kind).toBe("git-operation")
    // git rewrites the file meanwhile: not merged until the operation finishes.
    const rebased = addNode(platform.control.readFile(FILE) as string, "Upstream01")
    platform.control.writeExternal(FILE, rebased)
    await sleep(250)
    expect(s.store.hasNode("Upstream01")).toBe(false)
    expect(platform.control.readFile(FILE)).toBe(rebased)
    await s.respondToGit("keep")
    expect(s.state().banner).toBeNull()
    platform.control.setGit(ROOT, gitState(null), {
      kind: "operation-finished",
      operation: "rebase",
    })
    await waitFor(() => s.store.hasNode("Upstream01"), 2000, "merge after rebase")
    expect(s.state().toasts[0]?.kind).toBe("external-merged")
    await waitFor(() => settled(s), 2000, "autosave after rebase")
    expect(nodeNames(platform.control.readFile(FILE))).toEqual(
      expect.arrayContaining(["Rebase0001", "Upstream01"]),
    )
    await s.close()
  })

  test("Discard reloads what git left (undoable); Stash writes a recovery entry", async () => {
    const { platform, manager } = await fastSetup()
    const s = await manager.open(FILE)
    platform.control.setGit(ROOT, gitState("merge"), {
      kind: "operation-started",
      operation: "merge",
    })
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
    platform.control.setGit(ROOT, gitState(null), {
      kind: "operation-finished",
      operation: "merge",
    })
    edit(s.store, "After00001")
    await s.save()
    expect((await platform.recovery.list()).map((e) => e.reason)).toEqual(["git-stash"])
    await s.close()
  })

  test("⌘S while git-paused asks for a choice instead of writing", async () => {
    const { platform, manager } = await fastSetup()
    const s = await manager.open(FILE)
    platform.control.setGit(ROOT, gitState("rebase"), {
      kind: "operation-started",
      operation: "rebase",
    })
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

  test("stored conflicts win over the git merge banner, and ⌘S saves them as they are", async () => {
    const { platform, manager } = await fastSetup({
      [FILE]: fixture("lint/CONFLICT_OPEN--board-18.kimo"),
    })
    const s = await manager.open(FILE)
    platform.control.setGit(
      ROOT,
      {
        branch: "main",
        head: "abc",
        operation: "merge",
        indexLocked: false,
        fileStatus: "conflict",
        changedCount: 1,
      },
      { kind: "operation-started", operation: "merge" },
    )
    await waitFor(() => s.provider?.pauses.has("git") === true, 2000, "git pause")
    expect(s.state().banner?.kind).toBe("merge-conflicts")
    expect(s.state().saveStatus).toMatchObject({ kind: "paused", reason: "conflicts", open: 2 })
    s.store.apply({ op: "update", id: "Hero000001", set: { name: "Hero 2" } }, { origin: "user" })
    await s.save()
    expect(platform.control.readFile(FILE)).toContain('"Hero 2"')
    await s.dispose()
  })
})
