/**
 * Resolving stored merge conflicts: the `ConflictSession` over a real DocStore (each pick is one
 * undo step, take-all touches open rows only, Mark resolved & save leaves a clean file) and
 * `diffOps` reproducing core-schema's reference side applications through `store.apply`, and a
 * git merge in an open file down to the commit command it hands out.
 */
import { describe, expect, test } from "bun:test"
import {
  applyConflictSide,
  type KimoDocument,
  listConflicts,
  MERGE_FEATURE,
  parse,
  serialize,
} from "@kimo/core-schema"
import { createDocStore, type DocStore } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { conflictSessionFactory, createConflictSession, diffOps } from "../../src/conflicts"
import { commitCommand, shellEscapePath, type Toast } from "../../src/platform/contract"
import { createSessionManager } from "../../src/platform/session"
import { FILE, fixture, nodeMerge, ROOT, sleep, waitFor } from "../session-helpers"

// biome-ignore lint/suspicious/noExplicitAny: tests poke at JSON
type Loose = any

const board18 = () => parse(fixture("lint/CONFLICT_OPEN--board-18.kimo"))

function setup(doc: KimoDocument = board18()) {
  const store = createDocStore()
  store.loadDocument(doc)
  const saves: string[] = []
  const toasts: Toast[] = []
  let ready = false
  const session = createConflictSession({
    store,
    fileName: "marketing.kimo",
    save: async () => {
      saves.push(serialize(store.toDocument()))
    },
    addToast: (t) => toasts.push(t),
    showMergeReady: (v = true) => {
      ready = v
    },
    gitMerging: async () => true,
    onReject: () => {},
  })
  return { store, session, saves, toasts, ready: () => ready }
}

const conflicts = (store: DocStore) =>
  (store.toHeader() as { conflicts?: Record<string, { applied: string; resolved?: boolean }> })
    .conflicts

describe("conflict session", () => {
  test("rows list the conflicts by layer with their resolved state", () => {
    const { session } = setup()
    expect(session.rows().map((r) => [r.group, r.property, r.resolved])).toEqual([
      ["Hero", "fill", false],
      ["Headline", "content", false],
      ["CTA Row", "gap", true],
      ["Button / Primary", "label", true],
      ["Footer › Legal", "node", true],
    ])
    expect(session.counts()).toEqual({ total: 5, open: 2, resolved: 3 })
  })

  test("a pick applies live, resolves the row, and is one undo step", () => {
    const { store, session } = setup()
    const before = serialize(store.toDocument())
    let notified = 0
    session.subscribe(() => notified++)
    session.choose("CfHeroFil1", "theirs")
    expect(store.getNode("Hero000001")?.fill).toBe("#FFFFFF")
    expect(conflicts(store)?.CfHeroFil1).toMatchObject({ applied: "theirs", resolved: true })
    expect(session.counts()).toEqual({ total: 5, open: 1, resolved: 4 })
    expect(notified).toBeGreaterThan(0)
    store.undo("user")
    expect(serialize(store.toDocument())).toBe(before)
    expect(session.counts().open).toBe(2)
  })

  test("re-picking a resolved node conflict restores the deleted subtree exactly", () => {
    const { store, session } = setup()
    expect(store.hasNode("Legal00001")).toBe(false)
    session.choose("CfLegal001", "ours")
    expect(store.getNode("Legal00001")).toMatchObject({ fill: "#F4F4F2", w: 640 })
    session.choose("CfLegal001", "theirs")
    expect(store.hasNode("Legal00001")).toBe(false)
  })

  test("Take all theirs applies to open rows only, in one undo step", () => {
    const { store, session } = setup()
    session.chooseAll("theirs")
    expect(store.getNode("Hero000001")?.fill).toBe("#FFFFFF")
    expect(store.getNode("Headline01")?.content).toBe("Plan less, ship more.")
    // Resolved rows keep their choice (CTA Row kept ours: gap 12).
    expect((store.getNode("CtaRow0001")?.layout as { gap: number } | undefined)?.gap).toBe(12)
    expect(session.counts().open).toBe(0)
    store.undo("user")
    expect(session.counts().open).toBe(2)
  })

  test("Reopen marks a resolved conflict open again (one undo step), body unchanged", () => {
    const { store, session } = setup()
    const before = serialize(store.toDocument())
    const body = store.getNode("CtaRow0001")
    session.reopen("CfCtaGap01")
    expect(conflicts(store)?.CfCtaGap01?.resolved).toBeUndefined()
    expect(store.getNode("CtaRow0001")).toEqual(body)
    expect(session.counts()).toEqual({ total: 5, open: 3, resolved: 2 })
    store.undo("user")
    expect(serialize(store.toDocument())).toBe(before)
  })

  test("Mark resolved & save is refused while rows are open, then saves a clean file", async () => {
    const t = setup()
    await expect(t.session.markResolvedAndSave()).rejects.toThrow("still open")
    expect(t.saves).toHaveLength(0)
    t.session.chooseAll("ours")
    await t.session.markResolvedAndSave()
    expect(t.saves).toHaveLength(1)
    const saved = parse(t.saves[0] as string) as Loose
    expect(saved.conflicts).toBeUndefined()
    expect(saved.merge).toBeUndefined()
    expect(saved.features ?? []).not.toContain(MERGE_FEATURE)
    expect(t.toasts).toEqual([{ kind: "merge-saved", resolved: 5, fileName: "marketing.kimo" }])
    expect(t.ready()).toBe(true)
    // Finishing is itself one undo step.
    t.store.undo("user")
    expect(conflicts(t.store)).toBeDefined()
  })

  test("a rejected finish throws its cause and saves nothing", async () => {
    const t = setup()
    t.session.chooseAll("ours")
    const apply = t.store.apply.bind(t.store)
    t.store.apply = ((...args: Parameters<typeof apply>) =>
      args[1]?.label === "Mark resolved"
        ? { ok: false, errors: [{ message: "The document is read-only" }] }
        : apply(...args)) as typeof t.store.apply
    await expect(t.session.markResolvedAndSave()).rejects.toThrow("The document is read-only")
    expect(t.saves).toHaveLength(0)
    expect(t.toasts).toHaveLength(0)
  })
})

describe("diffOps", () => {
  test("reproduces every reference side application through store.apply", () => {
    const doc = board18()
    for (const { id } of listConflicts(doc))
      for (const side of ["ours", "theirs", "base"] as const) {
        const store = createDocStore()
        store.loadDocument(doc)
        let target: KimoDocument
        try {
          target = applyConflictSide(store.toDocument(), id, side)
        } catch {
          continue
        }
        const r = store.apply(
          { op: "batch", ops: diffOps(store.toDocument(), target) },
          { origin: "user" },
        )
        expect(r.ok).toBe(true)
        expect(serialize(store.toDocument())).toBe(serialize(target))
      }
  })
})

describe("a git merge in an open file", () => {
  test("git merge, resolve all, Save: 'Ready to commit' replaces the git banner and the conflicts leave the file; undo brings them back", async () => {
    const platform = createMemoryPlatform({
      files: { [FILE]: fixture("lint/CONFLICT_OPEN--board-18.kimo") },
      settings: { "files.autosaveIntervalMs": 250, "files.recoverySnapshotMs": 250 },
    })
    await platform.settings.ready
    const manager = createSessionManager({
      platform,
      merge: nodeMerge,
      createConflictSession: conflictSessionFactory() as never,
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
    // Every conflict resolved, not saved: the banner stays.
    s.conflicts?.chooseAll("ours")
    expect(s.state().banner).toMatchObject({ kind: "merge-conflicts", open: 0 })
    // Mark resolved and save: "Ready to commit" takes the git banner's slot.
    await s.runAction("mark-resolved-save")
    await waitFor(() => s.state().banner?.kind === "merge-ready", 2000, "ready to commit")
    // Resolved AND saved: the conflict table is gone from the file on disk.
    expect(platform.control.readFile(FILE)).not.toContain('"conflicts"')
    expect(s.provider?.pauses.has("git")).toBe(true)
    // A resolution undone: conflicts are back, the git (conflicts) banner returns.
    s.store.undo("user")
    await sleep(20)
    expect(s.state().banner?.kind).toBe("merge-conflicts")
    await s.dispose()
  })

  test("the commit command escapes the file name for the shell", () => {
    expect(shellEscapePath("Pricing page.kimo")).toBe("Pricing\\ page.kimo")
    expect(shellEscapePath("a;rm -rf ~.kimo")).toBe("a\\;rm\\ -rf\\ \\~.kimo")
    expect(commitCommand("Pricing page.kimo")).toBe("git add Pricing\\ page.kimo && git commit")
  })
})
