/**
 * Board 20 "M4 Gaps" (TsJoM): the Text section model (rules table H7uymL), the File menu
 * shortcuts, the window title rule (G1gEPp), the banner priority (vgNUe) and the desktop
 * new-file flow (V7ey1Q: untitled → recovery autosave → first ⌘S opens the save panel).
 */
import { describe, expect, test } from "bun:test"
import type { NodeData } from "@kimo/editor-state"
import { menuShortcut } from "../src/editor/FileMenu"
import {
  alignOf,
  caseOf,
  caseValue,
  decorationOf,
  decorationValue,
  growOf,
  growOps,
  letterSpacingText,
  lineHeightText,
  parseLetterSpacing,
  parseLineHeight,
  styleOps,
  weightName,
} from "../src/editor/text"
import {
  BANNER_PRIORITY,
  type Banner,
  isEdited,
  isUntitledRef,
  pickBanner,
  saveStatusLabel,
  untitledRecoveryId,
  untitledRef,
  windowTitle,
} from "../src/platform/contract"
import { FILE, fixture, setup, sleep, waitFor } from "./m4-helpers"

const text = (style?: Record<string, unknown>, extra: Record<string, unknown> = {}): NodeData =>
  ({
    type: "text",
    parent: null,
    order: "a0",
    content: "Plan less.",
    ...(style ? { style } : {}),
    ...extra,
  }) as NodeData

describe("Text section model (H7uymL)", () => {
  test("display values follow the board: 110%, -2% of 48, Semi Bold, Auto", () => {
    const n = text({ font: "Inter", weight: 600, size: 48, lineHeight: 1.1, letterSpacing: -0.96 })
    expect(lineHeightText(n)).toBe("110%")
    expect(letterSpacingText(n)).toBe("-2%")
    expect(weightName(600)).toBe("Semi Bold")
    expect(lineHeightText(text())).toBe("Auto")
    expect(lineHeightText(text({ lineHeight: { px: 24 } }))).toBe("24px")
    expect(letterSpacingText(text())).toBe("0%")
    expect(lineHeightText(text({ lineHeight: { $ref: "lh/tight" } }))).toBe("$lh/tight")
  })

  test("parsing: line height ratio = % / 100, letter spacing px = % × size / 100", () => {
    expect(parseLineHeight("110%")).toBe(1.1)
    expect(parseLineHeight("140")).toBe(1.4)
    expect(parseLineHeight("auto")).toBeUndefined()
    expect(parseLineHeight("24px")).toEqual({ px: 24 })
    expect(parseLineHeight("abc")).toBeNull()
    expect(parseLetterSpacing("-2%", 48)).toBe(-0.96)
    expect(parseLetterSpacing("1.5px", 48)).toBe(1.5)
    expect(parseLetterSpacing("x", 48)).toBeNull()
  })

  test("enums: defaults are removed, decoration exclusive, case is render-time", () => {
    expect(alignOf(text())).toBe("left")
    expect(decorationOf(text({ decoration: ["underline", "strike"] }))).toBeNull()
    expect(decorationOf(text({ decoration: ["strike"] }))).toBe("strike")
    expect(decorationValue("none")).toBeUndefined()
    expect(decorationValue("underline")).toEqual(["underline"])
    expect(caseOf(text({ case: "title" }))).toBe("title")
    expect(caseValue("none")).toBeUndefined()
  })

  test("styleOps: one update per node; an emptied style is removed", () => {
    const sel = [
      { id: "T1", node: text({ case: "upper" }) },
      { id: "T2", node: text({ size: 20, case: "upper" }) },
    ]
    expect(styleOps(sel, "case", () => undefined)).toEqual([
      { op: "update", id: "T1", unset: ["style"] },
      { op: "update", id: "T2", set: { style: { size: 20 } } },
    ])
    expect(styleOps(sel.slice(0, 1), "align", () => "center")).toEqual([
      { op: "update", id: "T1", set: { style: { case: "upper", align: "center" } } },
    ])
  })

  test("Resizing: auto / fixed width / fixed size keep the laid-out box", () => {
    const sel = [{ id: "T1", node: text(undefined, { grow: "fixed-width", w: 272 }) }]
    const laid = () => ({ w: 272, h: 61.6 })
    expect(growOf(sel[0]?.node as NodeData)).toBe("fixed-width")
    expect(growOps(sel, "auto", laid)).toEqual([
      { op: "update", id: "T1", unset: ["grow", "w", "h"] },
    ])
    expect(growOps(sel, "fixed", laid)).toEqual([
      { op: "update", id: "T1", set: { grow: "fixed", w: 272, h: 61.6 } },
    ])
    expect(growOps([{ id: "T2", node: text() }], "fixed-width", laid)).toEqual([
      { op: "update", id: "T2", set: { grow: "fixed-width", w: 272 }, unset: ["h"] },
    ])
  })
})

describe("File menu (AsXP1)", () => {
  test("shortcuts: ⌘ on macOS, Ctrl / Shift+Ctrl elsewhere", () => {
    expect(menuShortcut("macos", "S", true)).toBe("⇧⌘S")
    expect(menuShortcut("windows", "S", true)).toBe("Shift+Ctrl+S")
    expect(menuShortcut("linux", ",")).toBe("Ctrl+,")
  })
})

describe("Window title rule (G1gEPp)", () => {
  const base = { fileName: "marketing.kimo", folder: "loom" }
  test("macOS: file — folder; edits are the close-button dot (not in the title)", () => {
    expect(windowTitle({ os: "macos", ...base })).toBe("marketing.kimo — loom")
    expect(windowTitle({ os: "macos", ...base, edited: true })).toBe("marketing.kimo — loom")
    expect(windowTitle({ os: "macos", ...base, readOnly: true })).toBe(
      "marketing.kimo — loom (read-only)",
    )
    expect(windowTitle({ os: "macos", fileName: "Untitled", folder: null, untitled: true })).toBe(
      "Untitled • not saved",
    )
    expect(windowTitle({ os: "macos", fileName: null, folder: null })).toBe("Kimo")
  })
  test("Windows / Linux: ● prefix when edited, - Kimo suffix", () => {
    expect(windowTitle({ os: "windows", ...base })).toBe("marketing.kimo — loom - Kimo")
    expect(windowTitle({ os: "linux", ...base, edited: true })).toBe(
      "● marketing.kimo — loom - Kimo",
    )
    expect(
      windowTitle({
        os: "windows",
        fileName: "Untitled",
        folder: null,
        untitled: true,
        edited: true,
      }),
    ).toBe("● Untitled • not saved - Kimo")
    expect(windowTitle({ os: "linux", ...base, readOnly: true })).toBe(
      "marketing.kimo — loom (read-only) - Kimo",
    )
    expect(windowTitle({ os: "windows", fileName: null, folder: null })).toBe("Kimo")
  })
  test("edited = Unsaved / Saving / Failed", () => {
    expect(isEdited({ kind: "saving", since: 0 })).toBe(true)
    expect(isEdited({ kind: "saved", savedAt: 0, ref: FILE })).toBe(false)
    expect(isEdited({ kind: "paused", reason: "git", operation: "merge" })).toBe(false)
  })
})

describe("Banner priority (vgNUe)", () => {
  const mergeConflicts: Banner = {
    kind: "merge-conflicts",
    severity: "warning",
    info: null,
    open: 2,
    resolved: 3,
    total: 5,
  }
  const gitMerge: Banner = {
    kind: "git-operation",
    severity: "warning",
    operation: "merge",
    unsavedEdits: 0,
  }
  // Board 24 (n) a9ykr0 (decided) supersedes board 20's order: locked / read-only first.
  test("order: lock / read-only > disk > stored conflicts > git operation > ready to commit", () => {
    expect(BANNER_PRIORITY).toEqual([
      "failed-load",
      "locked",
      "newer-format",
      "save-failed",
      "merge-conflicts",
      "git-operation",
      "merge-ready",
    ])
  })
  test("stored conflicts suppress the generic git merge banner", () => {
    expect(pickBanner([gitMerge, mergeConflicts])?.kind).toBe("merge-conflicts")
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
    expect(pickBanner([locked, gitMerge])?.kind).toBe("locked")
  })
})

describe("New file flow (V7ey1Q)", () => {
  test("untitled refs and recovery ids", () => {
    const ref = untitledRef("abc123")
    expect(isUntitledRef(ref)).toBe(true)
    expect(isUntitledRef(FILE)).toBe(false)
    expect(untitledRecoveryId(ref)).toBe("untitled-abc123")
  })

  test("opens immediately, autosaves to recovery only, first ⌘S opens the save panel", async () => {
    const { platform, manager } = await setup({})
    const s = await manager.newUntitled()
    expect(s.untitled).toBe(true)
    expect(s.fileName).toBe("Untitled")
    const st = s.state()
    expect(st.phase).toBe("ready")
    expect(st.saveStatus).toMatchObject({ kind: "unsaved", target: "recovery", untitled: true })
    expect(saveStatusLabel(st.saveStatus)).toBe("Not saved")
    expect(st.branchLabel).toBeNull()
    // Edits snapshot to recovery (autosave interval 250 ms in the test setup), never to a file.
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

    // First ⌘S: the native save panel, pre-filled "Untitled.kimo".
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
    expect(manager.lastFolder).toBe("/Users/me/Projects/loom")
    await s.dispose()
  })

  test("cancelling the save panel keeps the untitled document", async () => {
    const { manager } = await setup({})
    const s = await manager.newUntitled()
    await s.save()
    expect(s.untitled).toBe(true)
    await s.dispose()
  })
})

describe("Stored conflicts during a git merge", () => {
  test("conflicts banner + pill win over the git merge; ⌘S saves them as-is", async () => {
    const board18 = fixture("lint/CONFLICT_OPEN--board-18.kimo")
    const { platform, manager } = await setup({ [FILE]: board18 })
    const s = await manager.open(FILE)
    platform.control.setGit(
      "/Users/me/Projects/loom",
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
