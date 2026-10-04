/**
 * Board 25 "v1 Polish" §6 small states (GF9SG): (a) close prompt width + title truncation,
 * (b) invalid link rule, (c) SVG rejection "+N more", (d) OpenType font support (GSUB / GPOS
 * feature detection from font bytes), (e) "Ready to commit" (copy → Copied, stays until git is
 * clean, × until the next git change), (f) no "Abort merge".
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { deflateSync } from "node:zlib"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  CLOSE_PROMPT_MAX_NAME,
  closePromptName,
  customTagHint,
  DIALOG_WIDTH,
  parseLinkUrl,
  SvgRejectionDetails,
} from "@kimo/ui"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { conflictSessionFactory } from "../src/conflicts"
import { customFeatures } from "../src/editor/sections/TextSection"
import { featureListTags, fontFeatureTags, sfntFeatureTags } from "../src/fonts/font-features"
import { createFontSystem } from "../src/fonts/font-system"
import { type Banner, bannerCopy, commitCommand, shellEscapePath } from "../src/platform/contract"
import { createSessionManager } from "../src/platform/session"
import { FILE, fixture, nodeMerge, ROOT, sleep, waitFor } from "./m4-helpers"

const FONTS = join(import.meta.dir, "../../../packages/renderer/assets/fonts")
const inter = () => new Uint8Array(readFileSync(join(FONTS, "Inter-Regular.ttf")))

describe("(a) close prompt · width (AyYDq)", () => {
  test("quick confirms are 400 (dialog.size 'sm'); forms 480; Export 880", () => {
    expect(DIALOG_WIDTH).toEqual({ sm: 400, md: 480, export: 880 })
  })
  test("title keeps names up to 28 chars; longer names truncate in the middle", () => {
    expect(closePromptName("Untitled 3")).toBe("Untitled 3")
    const name28 = "a".repeat(CLOSE_PROMPT_MAX_NAME)
    expect(closePromptName(name28)).toBe(name28)
    const long = "Brand exploration — homepage hero ration 3"
    const t = closePromptName(long)
    expect([...t].length).toBe(CLOSE_PROMPT_MAX_NAME)
    expect(t.startsWith("Brand explo")).toBe(true)
    expect(t.endsWith("ation 3")).toBe(true)
    expect(t).toContain("…")
  })
})

describe("(b) link popover · invalid URL (u0adcp)", () => {
  test("no scheme is not an error: auto-prefixed https://", () => {
    expect(parseLinkUrl("pricing.com")).toEqual({
      kind: "ok",
      url: "https://pricing.com",
      scheme: "http",
      prefixed: true,
    })
    expect(parseLinkUrl("www.kimo.design/pricing?x=1#a")).toMatchObject({
      kind: "ok",
      url: "https://www.kimo.design/pricing?x=1#a",
    })
  })
  test("invalid scheme / unparsable stays invalid", () => {
    for (const bad of [
      "javascript:alert(1)",
      "ftp://x.com",
      "data:text/html,x",
      "not a link",
      "kimo",
    ])
      expect(parseLinkUrl(bad).kind).toBe("invalid")
  })
})

describe("(c) SVG rejection · '+N more' (J30Nk)", () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    line: i * 4 + 4,
    code: `<el${i}>`,
    why: "removed",
  }))
  test("max 5 reason rows, then '+3 more' · 'in the copied report' (not a link)", () => {
    const html = renderToStaticMarkup(
      createElement(SvgRejectionDetails, {
        fileName: "logo.svg",
        items,
        onHide() {},
        onCopyReport() {},
        onCancel() {},
        onImport() {},
      }),
    )
    expect(html.match(/kimo-svg-rejection__code/g)?.length).toBe(5)
    expect(html).toContain(">+3 more<")
    expect(html).toContain(">in the copied report<")
    expect(html).not.toMatch(/<a\b/)
  })
})

/** Same font, wrapped as a 1-face TrueType collection (table offsets shifted by the header). */
function asTtc(ttf: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + ttf.byteLength)
  const v = new DataView(out.buffer)
  out.set([0x74, 0x74, 0x63, 0x66]) // ttcf
  v.setUint32(4, 0x00010000)
  v.setUint32(8, 1)
  v.setUint32(12, 16)
  out.set(ttf, 16)
  const n = v.getUint16(16 + 4)
  for (let i = 0; i < n; i++) {
    const r = 16 + 12 + i * 16
    v.setUint32(r + 8, v.getUint32(r + 8) + 16)
  }
  return out
}

/** Same font as WOFF 1 with zlib-compressed tables. */
function asWoff(ttf: Uint8Array): Uint8Array {
  const src = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength)
  const n = src.getUint16(4)
  const tables: { tag: Uint8Array; data: Uint8Array; orig: number; sum: number }[] = []
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16
    const off = src.getUint32(r + 8)
    const len = src.getUint32(r + 12)
    const raw = ttf.subarray(off, off + len)
    const z = new Uint8Array(deflateSync(raw))
    tables.push({
      tag: ttf.subarray(r, r + 4),
      data: z.byteLength < len ? z : raw,
      orig: len,
      sum: src.getUint32(r + 4),
    })
  }
  let size = 44 + n * 20
  const offsets = tables.map((t) => {
    const o = size
    size += (t.data.byteLength + 3) & ~3
    return o
  })
  const out = new Uint8Array(size)
  const v = new DataView(out.buffer)
  out.set([0x77, 0x4f, 0x46, 0x46]) // wOFF
  v.setUint32(4, 0x00010000)
  v.setUint32(8, size)
  v.setUint16(12, n)
  for (const [i, t] of tables.entries()) {
    const r = 44 + i * 20
    out.set(t.tag, r)
    v.setUint32(r + 4, offsets[i] as number)
    v.setUint32(r + 8, t.data.byteLength)
    v.setUint32(r + 12, t.orig)
    v.setUint32(r + 16, t.sum)
    out.set(t.data, offsets[i] as number)
  }
  return out
}

describe("(d) OpenType · font support (g95jKz, rule v0gB4)", () => {
  test("reads GSUB ∪ GPOS FeatureList tags from a real TTF (bundled Inter)", () => {
    const tags = sfntFeatureTags(inter())
    expect(tags).not.toBeNull()
    // GSUB features of the bundled subset + GPOS kern / mark.
    for (const t of ["calt", "frac", "tnum", "kern", "mark"]) expect(tags?.has(t)).toBe(true)
    // Not in the bundled Inter subset: the "not in font" case.
    for (const t of ["smcp", "ss02", "zero"]) expect(tags?.has(t)).toBe(false)
  })
  test("TTC (first face) and WOFF 1 (zlib tables) give the same tags; WOFF 2 is unknown", async () => {
    const want = [...(sfntFeatureTags(inter()) ?? [])].sort()
    expect([...(sfntFeatureTags(asTtc(inter())) ?? [])].sort()).toEqual(want)
    expect(sfntFeatureTags(asWoff(inter()))).toBeNull() // compressed: async path only
    expect([...((await fontFeatureTags(asWoff(inter()))) ?? [])].sort()).toEqual(want)
    const woff2 = new Uint8Array(64)
    woff2.set([0x77, 0x4f, 0x46, 0x32])
    expect(await fontFeatureTags(woff2)).toBeNull()
    expect(await fontFeatureTags(new Uint8Array([1, 2, 3]))).toBeNull()
  })
  test("cached per byte array", async () => {
    const b = inter()
    expect(fontFeatureTags(b)).toBe(fontFeatureTags(b))
  })
  test("FeatureList parsing is bounds-safe", () => {
    expect([...featureListTags(new Uint8Array(4))]).toEqual([])
  })
  test("font system: features of the resolved face; unknown without bytes", async () => {
    const platform = createMemoryPlatform({})
    const bytes = inter()
    const sys = createFontSystem({
      platform,
      faceBytes: (k) => (k.family === "Inter" ? bytes : null),
    })
    expect(
      (await sys.features({ family: "Inter", weight: 400, style: "normal" }))?.has("tnum"),
    ).toBe(true)
    expect(await sys.features({ family: "Nope", weight: 400, style: "normal" })).toBeNull()
    sys.dispose()
  })
  test("hint copy (rule kkH4N): in font / isn't in font / unknown → format hint", () => {
    expect(customTagHint("cv11", "Inter", true)).toBe("cv11 is in Inter")
    expect(customTagHint("zero", "Inter Display", false)).toBe(
      "zero isn't in Inter Display — it will be saved but has no effect",
    )
    expect(customTagHint("zero", "Inter", null)).toBe("4 characters, a–z 0–9")
    expect(customTagHint("zer", "Inter", false)).toBe("4 characters, a–z 0–9")
  })
  test("custom rows: active tags without a row of their own", () => {
    expect(customFeatures({ liga: false, tnum: true, ss02: true, zero: 2, cv11: 0 })).toEqual([
      "ss02",
    ])
  })
})

describe("(e) 'Ready to commit' (tzFIU / LsjRG)", () => {
  test("command escapes the path; copy names the resolved count, then 'Copied'", () => {
    expect(shellEscapePath("Pricing page.kimo")).toBe("Pricing\\ page.kimo")
    expect(commitCommand("Pricing page.kimo")).toBe("git add Pricing\\ page.kimo && git commit")
    const fmt = { os: "macos" } as never
    const ready: Banner = {
      kind: "merge-ready",
      severity: "info",
      fileName: "Pricing page.kimo",
      resolved: 3,
    }
    const a = bannerCopy(ready, fmt)
    expect(a.title).toBe("Ready to commit")
    expect(a.body).toBe("3 conflicts resolved and saved to Pricing page.kimo.")
    expect(a.actions.map((x) => [x.id, x.label, x.variant])).toEqual([
      ["review-changes", "Review changes", "secondary"],
      ["copy-commit-command", "Commit in terminal…", "primary"],
    ])
    const b = bannerCopy({ ...ready, copied: true }, fmt)
    expect(b.body).toBe(
      "Copied 'git add Pricing\\ page.kimo && git commit' — run it in your terminal.",
    )
    expect(b.actions[1]).toEqual({
      id: "copy-commit-command",
      label: "Copied",
      variant: "primary",
      icon: "check",
    })
  })

  test("(f) no 'Abort merge' in any merge banner", () => {
    const fmt = { os: "macos" } as never
    for (const open of [0, 2]) {
      const c = bannerCopy(
        {
          kind: "merge-conflicts",
          severity: "warning",
          info: null,
          open,
          resolved: 2 - open,
          total: 2,
        },
        fmt,
      )
      expect(c.actions.some((x) => /abort/i.test(x.label))).toBe(false)
    }
  })

  test("session: copy keeps the banner (Copied); × hides it until the next git change; git clean removes it", async () => {
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
    const merging = {
      branch: "main",
      head: "abc",
      operation: "merge" as const,
      indexLocked: false,
      fileStatus: "conflict" as const,
      changedCount: 1,
    }
    platform.control.setGit(ROOT, merging, { kind: "operation-started", operation: "merge" })
    await waitFor(() => s.provider?.pauses.has("git") === true, 2000, "git pause")
    s.conflicts?.chooseAll("ours")
    await s.runAction("mark-resolved-save")
    await waitFor(() => s.state().banner?.kind === "merge-ready", 2000, "ready to commit")
    const b0 = s.state().banner as Extract<Banner, { kind: "merge-ready" }>
    expect(b0.resolved).toBeGreaterThan(0)
    expect(b0.nodes?.length).toBeGreaterThan(0)
    expect(b0.copied).toBe(false)
    await s.runAction("copy-commit-command")
    expect(s.state().banner).toMatchObject({ kind: "merge-ready", copied: true })
    s.dismissMergeReady()
    expect(s.state().banner?.kind).not.toBe("merge-ready")
    // The next git change (still merging) brings it back.
    platform.control.setGit(ROOT, { ...merging, changedCount: 2 }, {
      kind: "index-changed",
    } as never)
    await waitFor(() => s.state().banner?.kind === "merge-ready", 2000, "back after git change")
    // git is clean (the commit was made): the banner leaves.
    platform.control.setGit(
      ROOT,
      { ...merging, operation: null, fileStatus: "clean", changedCount: 0 } as never,
      { kind: "operation-finished", operation: "merge" } as never,
    )
    await waitFor(() => s.state().banner === null, 2000, "gone when git is clean")
    await sleep(10)
    await s.dispose()
  })
})
