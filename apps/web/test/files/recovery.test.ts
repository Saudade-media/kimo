/**
 * Work that was never saved: recovery entries of a crashed session offered at launch, and a new
 * untitled file that autosaves to recovery until its first save.
 */
import { describe, expect, test } from "bun:test"
import { untitledRecoveryId } from "../../src/platform/contract"
import { addNode, docText, FILE, nodeNames, ROOT, setup, sleep } from "../session-helpers"
import { fastSetup } from "./helpers"

describe("launch recovery", () => {
  test("candidates come from crashed owners only, newest first; Restore loads the copy unsaved", async () => {
    const { platform, manager } = await setup()
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
    expect(c[0]?.choices).toEqual(["discard", "save-as"])

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

  test("Discard all drops every entry; Decide later keeps them", async () => {
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

  test("Restore all returns every session it opened, not sessions()[0] (C3)", async () => {
    const other = `${ROOT}/other.kimo`
    const { platform, manager } = await setup({ [FILE]: docText(), [other]: docText("O") })
    // A session open before the restore must not be mistaken for a restored one.
    const before = await manager.open(other)
    await platform.recovery.write({
      id: "aaaaaaaaaaaaaaaa",
      sourceRef: FILE,
      name: "marketing.kimo",
      reason: "snapshot",
      text: addNode(docText(), "Saved1"),
      edits: 1,
    })
    for (const [id, node] of [
      ["untitled-one", "Untitled1"],
      ["untitled-two", "Untitled2"],
    ] as const) {
      platform.control.tick(1000)
      await platform.recovery.write({
        id,
        sourceRef: null,
        name: "Untitled",
        reason: "untitled",
        text: addNode(docText(), node),
        edits: 1,
      })
    }
    platform.control.killPid(1000)
    expect((await manager.recoveryCandidates()).length).toBe(3)
    const opened = await manager.resolveRecoveryDialog("restore-all")
    expect(opened).toHaveLength(3)
    expect(opened).not.toContain(before)
    expect(opened.filter((s) => s.untitled)).toHaveLength(2)
    expect(opened.some((s) => s.ref === FILE && s.store.hasNode("Saved1"))).toBe(true)
    for (const node of ["Untitled1", "Untitled2"])
      expect(opened.some((s) => s.untitled && s.store.hasNode(node))).toBe(true)
    // Each one is a live session of the manager, so the window can route to it.
    for (const s of opened) expect(manager.get(s.ref)).toBe(s)
    expect(await manager.resolveRecoveryDialog("decide-later")).toEqual([])
    await manager.dispose()
  })

  test("Restore of a file that is gone asks where to save the copy (C1)", async () => {
    const { platform, manager } = await setup()
    const gone = `${ROOT}/gone.kimo`
    await platform.recovery.write({
      id: "gone0000000000aa",
      sourceRef: gone,
      name: "gone.kimo",
      reason: "snapshot",
      text: addNode(docText(), "Recovered1"),
      edits: 2,
    })
    platform.control.killPid(1000)
    let asked = 0
    platform.dialogs.saveFile = async () => {
      asked++
      return `${ROOT}/gone (recovered).kimo`
    }
    const s = await manager.resolveRecovery("gone0000000000aa", "restore")
    expect(asked).toBe(1)
    expect(s?.ref).toBe(`${ROOT}/gone (recovered).kimo`)
    expect(nodeNames(platform.control.readFile(`${ROOT}/gone (recovered).kimo`))).toContain(
      "Recovered1",
    )
    expect(await platform.recovery.list()).toEqual([])
    await manager.dispose()
  })

  test("entries older than 30 days are pruned before the dialog lists them (C2)", async () => {
    const { platform, manager } = await setup()
    await platform.recovery.write({
      id: "old0000000000000",
      sourceRef: FILE,
      name: "marketing.kimo",
      reason: "snapshot",
      text: docText(),
      edits: 1,
    })
    platform.control.killPid(1000)
    platform.control.tick(31 * 24 * 60 * 60 * 1000)
    expect(await manager.recoveryCandidates()).toEqual([])
    expect(await platform.recovery.list()).toEqual([])
    await manager.dispose()
  })
})

describe("untitled files", () => {
  test("a new file autosaves to recovery only; the first ⌘S asks where to save it", async () => {
    const { platform, manager } = await fastSetup({})
    const s = await manager.newUntitled()
    expect(s.untitled).toBe(true)
    const st = s.state()
    expect(st.phase).toBe("ready")
    expect(st.saveStatus).toMatchObject({ kind: "unsaved", target: "recovery", untitled: true })
    // Edits snapshot to recovery, never to a file.
    s.store.apply(
      { op: "insert", id: "Rect000001", node: { type: "rect", name: "A", w: 10, h: 10 } },
      { origin: "user" },
    )
    const id = untitledRecoveryId(s.ref)
    let entries = await platform.recovery.list()
    for (let i = 0; i < 50 && !entries.some((e) => e.id === id); i++) {
      await sleep(20)
      entries = await platform.recovery.list()
    }
    const entry = entries.find((e) => e.id === id)
    expect(entry).toMatchObject({ sourceRef: null, reason: "untitled", edits: 1 })
    // The open untitled session hides its own entry from the launch dialog.
    expect((await manager.recoveryCandidates()).some((c) => c.entry.id === id)).toBe(false)

    const asked: unknown[] = []
    platform.dialogs.saveFile = async (o) => {
      asked.push(o)
      return "/Users/me/Projects/loom/landing.kimo"
    }
    await s.save()
    expect(asked).toEqual([expect.objectContaining({ suggestedName: "Untitled.kimo" })])
    expect(s.untitled).toBe(false)
    expect(s.ref).toBe("/Users/me/Projects/loom/landing.kimo")
    expect(platform.control.readFile(s.ref)).toContain('"Rect000001"')
    expect(s.state().saveStatus.kind).toBe("saved")
    expect((await platform.recovery.list()).some((e) => e.id === id)).toBe(false)
    expect(manager.get(s.ref)).toBe(s)
    await s.dispose()
  })

  test("cancelling the save panel keeps the untitled document", async () => {
    const { manager } = await setup({})
    const s = await manager.newUntitled()
    await s.save()
    expect(s.untitled).toBe(true)
    await s.dispose()
  })

  test("the new-files folder is where the first Save as starts", async () => {
    const { platform, manager } = await setup(
      {},
      { settings: { "files.newFilesDir": "/Users/me/Design" } },
    )
    let options: { defaultDir?: string } | undefined
    platform.dialogs.saveFile = async (o) => {
      options = o as never
      return null
    }
    const s = await manager.newUntitled()
    await s.saveAs()
    expect(options?.defaultDir).toBe("/Users/me/Design")
    await s.dispose()
  })
})
