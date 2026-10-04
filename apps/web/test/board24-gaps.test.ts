/**
 * Board 24 "Needs design — decided" (XCW1g) gaps: (a) link URL rule, (b) custom OpenType tag,
 * (i) untitled close prompt, (j) SVG rejection details + sanitized import on consent,
 * (k) missing font weight, (l) conflict "+N" menu, (m) web tab title, (n) banner priority vs
 * "Ready to commit".
 */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  closePromptLoss,
  conflictMenuWidth,
  isOpenTypeTag,
  middleTruncatePath,
  parseFeatureValue,
  parseLinkUrl,
  svgRejectionReport,
} from "@kimo/ui"
import { conflictSessionFactory } from "../src/conflicts"
import { customFeatureValue } from "../src/editor/sections/TextSection"
import { missingWeight, renderedWeight } from "../src/fonts"
import {
  BANNER_PRIORITY,
  type Banner,
  bannerCopy,
  hasUnsavedChanges,
  pickBanner,
  TAB_TITLE_MAX,
  tabTitle,
  windowTitle,
} from "../src/platform/contract"
import { createSessionManager } from "../src/platform/session"
import { prepareSvg, SvgRejectedError, shortRef, svgRejection } from "../src/svg-import"
import { FILE, fixture, nodeMerge, ROOT, setup, sleep, waitFor } from "./m4-helpers"

describe("(a) Link… popover URL rule (NpwJS)", () => {
  test("http(s), mailto:, tel: and #frame only; empty removes", () => {
    expect(parseLinkUrl("  https://kimo.dev/pricing ")).toEqual({
      kind: "ok",
      url: "https://kimo.dev/pricing",
      scheme: "http",
    })
    expect(parseLinkUrl("http://localhost:3000").kind).toBe("ok")
    expect(parseLinkUrl("mailto:hi@kimo.dev")).toMatchObject({ kind: "ok", scheme: "mailto" })
    expect(parseLinkUrl("tel:+1 555 0100")).toMatchObject({ kind: "ok", scheme: "tel" })
    expect(parseLinkUrl("#Pricing")).toMatchObject({ kind: "ok", scheme: "frame" })
    expect(parseLinkUrl("")).toEqual({ kind: "empty" })
    expect(parseLinkUrl("   ")).toEqual({ kind: "empty" })
    for (const bad of [
      "kimo.dev",
      "javascript:alert(1)",
      "ftp://x.y/z",
      "data:text/html,x",
      "https://",
      "#",
      "mailto:nobody",
      "tel:abc",
    ])
      expect(parseLinkUrl(bad).kind).toBe("invalid")
  })
})

describe("(b) OpenType Custom tag (Ehror)", () => {
  test("tag exactly 4 chars a–z 0–9; value 0–99, default 1", () => {
    expect(isOpenTypeTag("cv11")).toBe(true)
    expect(isOpenTypeTag("ss03")).toBe(true)
    expect(isOpenTypeTag("CV11")).toBe(false)
    expect(isOpenTypeTag("cv1")).toBe(false)
    expect(isOpenTypeTag("cv111")).toBe(false)
    expect(isOpenTypeTag("cv-1")).toBe(false)
    expect(parseFeatureValue("")).toBe(1)
    expect(parseFeatureValue("0")).toBe(0)
    expect(parseFeatureValue("99")).toBe(99)
    expect(parseFeatureValue("100")).toBeNull()
    expect(parseFeatureValue("-1")).toBeNull()
    expect(parseFeatureValue("1.5")).toBeNull()
    expect(customFeatureValue(1)).toBe(true)
    expect(customFeatureValue(2)).toBe(2)
    expect(customFeatureValue(0)).toBe(0)
  })
})

describe("(i) Untitled close prompt (a3Y0Fb)", () => {
  test("copy: frames count", () => {
    expect(closePromptLoss(12)).toBe("its 12 frames are")
    expect(closePromptLoss(1)).toBe("its 1 frame is")
    expect(closePromptLoss(0)).toBe("its contents are")
  })

  const frame = (id: string) => ({
    op: "insert" as const,
    id,
    node: { type: "frame", name: id, w: 100, h: 100 },
  })

  test("no edits: closes silently; saved-before files never ask", async () => {
    const { manager } = await setup()
    const u = await manager.newUntitled()
    expect(u.needsClosePrompt).toBe(false)
    expect(await u.requestClose()).toBe(true)
    const s = await manager.open(FILE)
    s.store.apply(frame("Frame00001"), { origin: "user" })
    expect(s.needsClosePrompt).toBe(false)
    expect(await s.requestClose()).toBe(true)
  })

  test("Cancel keeps it open; Don't save discards the recovery entry", async () => {
    const { platform, manager } = await setup({})
    const s = await manager.newUntitled()
    s.store.apply(frame("Frame00001"), { origin: "user" })
    s.store.apply(frame("Frame00002"), { origin: "user" })
    expect(s.needsClosePrompt).toBe(true)
    const first = s.requestClose()
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt")
    expect(s.state().closePrompt).toEqual({ fileName: "Untitled", frames: 2 })
    s.respondToClose("cancel")
    expect(await first).toBe(false)
    expect(s.state().closePrompt).toBeNull()
    await s.writeUntitledSnapshot()
    const id = s.untitledRecoveryId as string
    expect((await platform.recovery.list()).some((e) => e.id === id)).toBe(true)

    const second = s.requestClose()
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt again")
    s.respondToClose("discard")
    expect(await second).toBe(true)
    expect((await platform.recovery.list()).some((e) => e.id === id)).toBe(false)
  })

  test("Save… opens the save panel; a cancelled panel keeps the window open", async () => {
    const { platform, manager } = await setup({})
    const s = await manager.newUntitled()
    s.store.apply(frame("Frame00001"), { origin: "user" })
    let answer: string | null = null
    platform.dialogs.saveFile = async () => answer
    const cancelled = s.confirmClose()
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt")
    s.respondToClose("save")
    expect(await cancelled).toBe(false)
    expect(s.untitled).toBe(true)
    answer = `${ROOT}/landing.kimo`
    const saved = s.confirmClose()
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt")
    s.respondToClose("save")
    expect(await saved).toBe(true)
    expect(s.untitled).toBe(false)
    expect(platform.control.readFile(`${ROOT}/landing.kimo`)).toContain('"Frame00001"')
    await s.dispose()
  })

  test("window close-requested asks; Cancel answers false (window stays)", async () => {
    const { platform, manager } = await setup({})
    const handlers: (() => Promise<boolean> | boolean)[] = []
    platform.window.onCloseRequested = (h) => {
      handlers.push(h)
      return () => {}
    }
    manager.install()
    const s = await manager.newUntitled()
    s.store.apply(frame("Frame00001"), { origin: "user" })
    const r = handlers[0]?.() as Promise<boolean>
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt")
    s.respondToClose("cancel")
    expect(await r).toBe(false)
    const r2 = handlers[0]?.() as Promise<boolean>
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt")
    s.respondToClose("discard")
    expect(await r2).toBe(true)
  })
})

describe("(j) SVG rejection details (nx2kl)", () => {
  const source = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
    '<path d="M0 0L1 1"/>',
    "<g>",
    "<script>alert(1)</script>",
    "</g>",
    '<use href="https://cdn.example.com/assets/x.svg#a"/>',
    "<foreignObject><div>hi</div></foreignObject>",
    '<rect width="1" height="1" onload="x()"/>',
    "</svg>",
  ].join("\n")

  test("each removed construct with its line, code and why, in source order", async () => {
    const err = (await prepareSvg(source, "logo.svg").catch((e: unknown) => e)) as SvgRejectedError
    expect(err).toBeInstanceOf(SvgRejectedError)
    expect(err.message).toBe("Couldn't import logo.svg — it contains a script")
    expect(err.items.map((i) => [i.line, i.code, i.why])).toEqual([
      [4, "<script>", "scripts are never imported"],
      [6, 'href="https://cdn…/x.svg#a"', "external refs blocked"],
      [7, "<foreignObject>", "HTML inside SVG unsupported"],
      [8, 'onload="…"', "event handlers stripped"],
    ])
    expect(err.details[0]).toBe("<script> · line 4")
    const report = svgRejectionReport("logo.svg", err.items)
    expect(report.split("\n")).toHaveLength(5)
    expect(report).toContain("L4\t<script>\tscripts are never imported")
  })

  test("repeated constructs get their own lines", () => {
    const r = svgRejection(["script", "script"], "<svg>\n<script/>\n\n<script/>\n</svg>")
    expect(r?.items.map((i) => i.line)).toEqual([2, 4])
  })

  test("shortRef middle-truncates long references", () => {
    expect(shortRef("#a")).toBe("#a")
    expect(shortRef("https://cdn.example.com/x.svg")).toBe("https://cdn…/x.svg")
  })

  test("Import without these: the sanitized SVG imports on explicit consent", async () => {
    const p = await prepareSvg(source, "logo.svg", { allowRemoved: true })
    const text = new TextDecoder().decode(p.imageBytes)
    expect(text).not.toContain("script")
    expect(text).not.toContain("onload")
    expect(text).not.toContain("foreignObject")
    expect(text).not.toContain("cdn.example")
    expect(text).toContain("M0 0L1 1")
  })
})

describe("(k) Missing font weight (QfSAK)", () => {
  test("rendered weight = nearest face (lighter wins a tie), tooltip copy", () => {
    expect(renderedWeight(700, [400, 600])).toBe(600)
    expect(renderedWeight(500, [400, 600])).toBe(400)
    expect(renderedWeight(300, [])).toBeNull()
    expect(missingWeight("Inter", 700, new Set([400, 600]))).toEqual({
      title: "Inter Bold (700) isn't installed",
      body: "Showing Semi Bold 600. Install the weight or pick another.",
      rendered: 600,
    })
    expect(missingWeight("Inter", 600, new Set([400, 600]))).toBeNull()
    expect(missingWeight("Inter", 700, null)).toBeNull()
  })
})

describe("(l) Conflict '+N' menu (c2CNAR)", () => {
  const m = (s: string) => s.length * 6
  test("paths middle-truncate by segment, then by characters", () => {
    const path = ["Pricing", "Plans", "Cards", "Item 3"]
    expect(middleTruncatePath(path, 1000, m)).toBe("Pricing / Plans / Cards / Item 3")
    expect(middleTruncatePath(path, m("Pricing / … / Cards / Item 3"), m)).toBe(
      "Pricing / … / Cards / Item 3",
    )
    expect(middleTruncatePath(path, m("Pricing / … / Item 3"), m)).toBe("Pricing / … / Item 3")
    expect(m(middleTruncatePath(path, 60, m))).toBeLessThanOrEqual(60)
  })
  test("width 240, grows to 320 for long names, min 200 on a narrow viewport", () => {
    const measure = (t: string) => t.length * 6
    const short = [{ id: "a", path: ["Navbar", "Logo"], meta: "text" }]
    expect(conflictMenuWidth(short, measure)).toBe(240)
    const long = [{ id: "b", path: ["A very long frame name", "Another long group"], meta: "fill" }]
    expect(conflictMenuWidth(long, measure)).toBeGreaterThan(240)
    const huge = [{ id: "c", path: ["x".repeat(80)], meta: "fill" }]
    expect(conflictMenuWidth(huge, measure)).toBe(320)
    expect(conflictMenuWidth(short, measure, 150)).toBe(200)
  })
})

describe("(m) Web tab title (i3wgk)", () => {
  test("[●] {file} [· state] — Kimo, highest state only", () => {
    expect(tabTitle({ fileName: null })).toBe("Kimo")
    expect(tabTitle({ fileName: "Pricing page.kimo" })).toBe("Pricing page — Kimo")
    expect(tabTitle({ fileName: "Untitled 3", unsaved: true })).toBe("● Untitled 3 — Kimo")
    expect(tabTitle({ fileName: "Pricing page", agent: "Claude Code" })).toBe(
      "Pricing page · Claude Code editing — Kimo",
    )
    expect(tabTitle({ fileName: "Pricing page", readOnly: true, agent: "Claude Code" })).toBe(
      "Pricing page · read-only — Kimo",
    )
    expect(
      tabTitle({ fileName: "Pricing page", conflicts: 2, readOnly: true, agent: "Claude Code" }),
    ).toBe("Pricing page · 2 conflicts — Kimo")
    expect(tabTitle({ fileName: "Pricing page", conflicts: 1 })).toBe(
      "Pricing page · 1 conflict — Kimo",
    )
  })
  test("max 60 chars: the file name truncates, never the suffix", () => {
    const t = tabTitle({ fileName: "A".repeat(80), unsaved: true, agent: "Claude Code" })
    expect([...t].length).toBe(TAB_TITLE_MAX)
    expect(t.startsWith("● AAA")).toBe(true)
    expect(t.endsWith("… · Claude Code editing — Kimo")).toBe(true)
  })
  test("windowTitle on the web uses the tab format; ● only when not safe", () => {
    expect(windowTitle({ os: "web", fileName: "home.kimo", folder: "site", conflicts: 2 })).toBe(
      "home · 2 conflicts — Kimo",
    )
    expect(windowTitle({ os: "web", fileName: null, folder: null })).toBe("Kimo")
    expect(
      hasUnsavedChanges({ kind: "unsaved", dirtySince: 0, autosaveAt: 5, target: "file" }),
    ).toBe(false)
    expect(
      hasUnsavedChanges({ kind: "unsaved", dirtySince: 0, autosaveAt: null, target: "file" }),
    ).toBe(true)
    expect(
      hasUnsavedChanges({
        kind: "unsaved",
        dirtySince: 0,
        autosaveAt: null,
        target: "recovery",
        untitled: true,
      }),
    ).toBe(true)
    expect(hasUnsavedChanges({ kind: "saved", savedAt: 0, ref: FILE })).toBe(false)
  })
})

describe("(n) Banner priority vs 'Ready to commit' (a9ykr0)", () => {
  const locked: Banner = {
    kind: "locked",
    severity: "warning",
    fileName: "a",
    holder: { pid: 1, appLabel: "kimo", sinceIso: "" } as never,
  }
  const git: Banner = {
    kind: "git-operation",
    severity: "warning",
    operation: "merge",
    unsavedEdits: 0,
  }
  const ready: Banner = { kind: "merge-ready", severity: "info", fileName: "a" }
  test("1 locked / read-only › 2 disk › 3 git › 4 ready to commit", () => {
    expect(BANNER_PRIORITY).toEqual([
      "failed-load",
      "locked",
      "newer-format",
      "save-failed",
      "merge-conflicts",
      "git-operation",
      "merge-ready",
    ])
    expect(pickBanner([git, locked])?.kind).toBe("locked")
    expect(pickBanner([ready, git])?.kind).toBe("git-operation")
  })
  test("step 2 copy: all resolved, not saved → CTA Save", () => {
    const fmt = {
      os: "macos" as const,
      formatBytes: String,
      formatTime: String,
      displayDir: String,
    }
    const c = bannerCopy(
      {
        kind: "merge-conflicts",
        severity: "warning",
        info: { ours: "feature/pricing", theirs: "main" } as never,
        open: 0,
        resolved: 3,
        total: 3,
      },
      fmt,
    )
    expect(c.title).toBe("Merging main → feature/pricing")
    expect(c.body).toBe("All conflicts resolved. Save to mark them resolved for git.")
    expect(c.actions).toEqual([{ id: "mark-resolved-save", label: "Save", variant: "primary" }])
  })

  test("session: git merge → resolve all → Save → 'Ready to commit' replaces the git banner; undo brings it back", async () => {
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
    // Step 2: every conflict resolved, not saved: the banner stays, its CTA becomes Save.
    s.conflicts?.chooseAll("ours")
    const st = s.state()
    expect(st.banner).toMatchObject({ kind: "merge-conflicts", open: 0 })
    // Step 3: Save (Mark resolved & save) → "Ready to commit" in the git banner's slot.
    await s.runAction("mark-resolved-save")
    await waitFor(() => s.state().banner?.kind === "merge-ready", 2000, "ready to commit")
    // "Resolved AND saved": the conflict table is gone from the file on disk.
    expect(platform.control.readFile(FILE)).not.toContain('"conflicts"')
    expect(s.provider?.pauses.has("git")).toBe(true)
    // A resolution undone: conflicts are back, the git (conflicts) banner returns.
    s.store.undo("user")
    await sleep(20)
    expect(s.state().banner?.kind).toBe("merge-conflicts")
    await s.dispose()
  })
})
