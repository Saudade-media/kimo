/**
 * Board 27 §3 "Raster import" (nfBn1) in the real editor (m4-app harness, a `.kimo` on disk):
 * - dragging files over the canvas shows the drop overlay (vgvYj): tint + 2 px border, the frame
 *   under the pointer outlined with its tag, the InsertionBar in an auto-layout target, the
 *   bottom pill; one measured pass against the node values;
 * - the drop imports image rectangles into the target slot, scaled to its content width;
 * - an unsupported file and an oversized one each get their warning toast (L2qTa) while the
 *   rest still imports; a paste of image data lands at the viewport centre ("Pasted image").
 */
import type { Page } from "playwright"
import { disk, harnessUrl, SITE } from "./m4-app.e2e"
import { type E2EContext, expect, type Scenario } from "./run"

type Store = {
  getNode(id: string): Record<string, unknown> | undefined
  children(p: string | null): string[]
  nodeIds(): string[]
  undo(o: string): unknown
}
type Kimo = {
  __kimoApp?: unknown
  __kimo?: {
    session: {
      store: Store
      apply(ops: unknown, label?: string): boolean
      ui: { getState(): { selection: string[]; select(ids: string[]): void } }
    }
    canvas(): {
      renderer: unknown
      zoomToFit(ids?: string[], padding?: number): void
      layout(): { nodes: Map<string, { world: { x: number; y: number; w: number; h: number } }> }
      worldToScreen(p: { x: number; y: number }): { x: number; y: number }
    } | null
  }
}
declare const window: Kimo & Window

async function editor(ctx: E2EContext) {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}${disk(`${SITE}/home.kimo`)}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Kimo).__kimoApp)
  await ctx.page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
  await ctx.page.waitForFunction(
    () => !!window.__kimo?.session && !!window.__kimo.canvas()?.renderer,
    undefined,
    { timeout: 15_000 },
  )
}

/** Adds the vignette's "Gallery" (auto layout ↓, 240 × 260, padding 12, gap 10, two photos). */
async function gallery(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(() => {
    const k = window.__kimo
    if (!k) throw new Error("no editor")
    k.session.apply(
      [
        {
          op: "insert",
          id: "GalleryE2E1",
          parent: null,
          node: {
            type: "frame",
            name: "Gallery",
            x: 5000,
            y: 5000,
            w: 240,
            h: 260,
            fill: "#FFFFFF",
            layout: { dir: "column", gap: 10, pad: 12 },
          },
        },
        {
          op: "insert",
          id: "PhotoE2E01",
          parent: "GalleryE2E1",
          node: { type: "rect", name: "Photo 1", w: 216, h: 96, fill: "#D9D4CC" },
        },
        {
          op: "insert",
          id: "PhotoE2E02",
          parent: "GalleryE2E1",
          node: { type: "rect", name: "Photo 2", w: 216, h: 96, fill: "#D9D4CC" },
        },
      ],
      "Gallery",
    )
    k.session.ui.getState().select([])
    const c = k.canvas()
    c?.zoomToFit(["GalleryE2E1"], 200)
    const w = c?.layout().nodes.get("GalleryE2E1")?.world
    const host = document.querySelector(".canvas-host__canvas")?.getBoundingClientRect()
    if (!w || !c || !host) throw new Error("no layout")
    const tl = c.worldToScreen({ x: w.x, y: w.y })
    const br = c.worldToScreen({ x: w.x + w.w, y: w.y + w.h })
    return { x: host.x + tl.x, y: host.y + tl.y, w: br.x - tl.x, h: br.y - tl.y }
  })
}

/** Dispatches a file drag (dragover; then drop when `drop`) at client point `p`. */
async function dragFiles(
  page: Page,
  p: { x: number; y: number },
  files: { name: string; w?: number; h?: number; bytes?: number; text?: string; type: string }[],
  drop: boolean,
) {
  await page.evaluate(
    async ({ p, files, drop }) => {
      const dt = new DataTransfer()
      for (const f of files) {
        let blob: Blob
        if (f.w && f.h) {
          const c = new OffscreenCanvas(f.w, f.h)
          const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D
          g.fillStyle = "#3a7"
          g.fillRect(0, 0, f.w, f.h)
          blob = await c.convertToBlob({ type: "image/png" })
        } else if (f.bytes) blob = new Blob([new Uint8Array(f.bytes)])
        else blob = new Blob([f.text ?? ""])
        dt.items.add(new File([blob], f.name, { type: f.type }))
      }
      const target = document.querySelector(".editor__canvas") as HTMLElement
      const init = { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, dataTransfer: dt }
      target.dispatchEvent(new DragEvent("dragenter", init))
      target.dispatchEvent(new DragEvent("dragover", init))
      if (drop) target.dispatchEvent(new DragEvent("drop", init))
    },
    { p, files, drop },
  )
}

type Diff = { what: string; design: string | number; got: string | number }
function check(diffs: Diff[], what: string, design: string | number, got: string | number) {
  const ok =
    typeof design === "number" && typeof got === "number"
      ? Math.abs(design - got) < 0.6
      : String(design) === String(got)
  if (!ok) diffs.push({ what, design, got })
}

const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement("span")
    el.style.color = `var(${n})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)

export const scenarios: Scenario[] = [
  {
    name: "board27-raster: drop overlay + target (measured), drop into an auto-layout slot",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      const g = await gallery(page)
      // Over Photo 2's top half: slot 2 (between the photos).
      const over = { x: g.x + g.w / 2, y: g.y + g.h * 0.55 }
      const files = [
        { name: "team.jpg", type: "image/png", w: 480, h: 320 },
        { name: "photo.heic", type: "image/heic", text: "....ftypheic" },
      ]
      await dragFiles(page, over, files, false)
      await page.locator("[data-testid=raster-drop-overlay]").waitFor({ timeout: 5000 })
      const m = await page.evaluate(() => {
        const read = (sel: string) => {
          const e = document.querySelector(sel)
          if (!e) return null
          const r = e.getBoundingClientRect()
          const cs = getComputedStyle(e)
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            bw: Number.parseFloat(cs.borderTopWidth),
            bc: cs.borderTopColor,
            bg: cs.backgroundColor,
            radius: Number.parseFloat(cs.borderTopLeftRadius),
            opacity: Number(cs.opacity),
            display: cs.display,
            gap: Number.parseFloat(cs.columnGap) || 0,
            pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) =>
              Number.parseFloat(v),
            ),
            fs: Number.parseFloat(cs.fontSize),
            color: cs.color,
            text: e.textContent,
          }
        }
        const canvas = document.querySelector(".editor__canvas")?.getBoundingClientRect()
        return {
          canvas: canvas ? { x: canvas.x, y: canvas.y, w: canvas.width, h: canvas.height } : null,
          tint: read("[data-testid=raster-drop-tint]"),
          target: read("[data-testid=raster-drop-target]"),
          tag: read("[data-testid=raster-drop-tag]"),
          tagLabel: read(".raster-drop__tag-label"),
          bar: read("[data-testid=raster-drop-bar]"),
          barLine: read("[data-testid=raster-drop-bar] .raster-drop__line"),
          barCap: read("[data-testid=raster-drop-bar] .raster-drop__cap"),
          pill: read("[data-testid=raster-drop-pill]"),
          pillLabel: read(".raster-drop__pill-label"),
          pillMeta: read(".raster-drop__pill-meta"),
          chip: read("[data-testid=raster-drop-chip]"),
          chipName: read(".raster-drop__chip-name"),
        }
      })
      const sel = await token(page, "--kimo-selection")
      const onAccent = await token(page, "--kimo-on-accent")
      const inverse = await token(page, "--kimo-text-inverse")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const primary = await token(page, "--kimo-text-primary")
      const diffs: Diff[] = []
      const need = <T>(v: T | null, what: string): T => {
        expect(v, `overlay part ${what}`)
        return v
      }
      const canvas = need(m.canvas, "canvas")
      const tint = need(m.tint, "tint")
      const target = need(m.target, "target")
      const tag = need(m.tag, "tag")
      const tagLabel = need(m.tagLabel, "tagLabel")
      const bar = need(m.bar, "bar")
      const barLine = need(m.barLine, "barLine")
      const barCap = need(m.barCap, "barCap")
      const pill = need(m.pill, "pill")
      const pillLabel = need(m.pillLabel, "pillLabel")
      const pillMeta = need(m.pillMeta, "pillMeta")
      const chip = need(m.chip, "chip")
      const chipName = need(m.chipName, "chipName")
      // pQA7W: whole canvas, 2 px $selection, radius 8, opacity 0.9, display > 0.
      check(diffs, "overlay.x", canvas.x, tint.x)
      check(diffs, "overlay.w", canvas.w, tint.w)
      check(diffs, "overlay.h", canvas.h, tint.h)
      check(diffs, "overlay.border", 2, tint.bw)
      check(diffs, "overlay.borderColor", sel, tint.bc)
      check(diffs, "overlay.radius", 8, tint.radius)
      check(diffs, "overlay.opacity", 0.9, tint.opacity)
      // RBQV2: the Gallery's box, 2 px $selection.
      check(diffs, "target.x", g.x, target.x)
      check(diffs, "target.y", g.y, target.y)
      check(diffs, "target.w", g.w, target.w)
      check(diffs, "target.border", 2, target.bw)
      // u6Bi1: padding [3,8], gap 4, $selection pill, label text-xs $on-accent; 8 below, right +4.
      check(diffs, "tag.text", "Into Gallery · slot 2", tag.text ?? "")
      check(diffs, "tag.padding", "3,8,3,8", tag.pad.join(","))
      check(diffs, "tag.gap", 4, tag.gap)
      check(diffs, "tag.bg", sel, tag.bg)
      check(diffs, "tag.top", g.y + g.h + 8, tag.y)
      check(diffs, "tag.right", g.x + g.w + 4, tag.x + tag.w)
      check(diffs, "tag.label.fs", 11, tagLabel.fs)
      check(diffs, "tag.label.color", onAccent, tagLabel.color)
      // OGqUu: 6 high, 2 px bar, 2 × 6 caps, spans the content width.
      check(diffs, "bar.h", 6, bar.h)
      check(diffs, "bar.line.h", 2, barLine.h)
      check(diffs, "bar.cap.w", 2, barCap.w)
      check(diffs, "bar.cap.h", 6, barCap.h)
      check(diffs, "bar.line.bg", sel, barLine.bg)
      // Ty50V: $text-primary pill, padding [6,12], gap 8, 13 above the bottom, centred.
      check(diffs, "pill.padding", "6,12,6,12", pill.pad.join(","))
      check(diffs, "pill.gap", 8, pill.gap)
      check(diffs, "pill.bg", primary, pill.bg)
      check(diffs, "pill.bottom", canvas.y + canvas.h - 13, pill.y + pill.h)
      check(diffs, "pill.centre", canvas.x + canvas.w / 2, pill.x + pill.w / 2)
      check(diffs, "pill.label", "1 of 2 can't be imported", pillLabel.text ?? "")
      check(diffs, "pill.label.fs", 12, pillLabel.fs)
      check(diffs, "pill.label.color", inverse, pillLabel.color)
      check(diffs, "pill.meta", "PNG · JPEG · WebP · GIF", pillMeta.text ?? "")
      check(diffs, "pill.meta.fs", 11, pillMeta.fs)
      check(diffs, "pill.meta.color", tertiary, pillMeta.color)
      // S1Q0Y: 24 below the pointer, padding [3,8,3,6], gap 4, mono 11.
      check(diffs, "chip.top", over.y + 24, chip.y)
      check(diffs, "chip.left", over.x, chip.x)
      check(diffs, "chip.padding", "3,8,3,6", chip.pad.join(","))
      check(diffs, "chip.gap", 4, chip.gap)
      check(diffs, "chip.name.fs", 11, chipName.fs)
      ctx.log("measured diffs (overlay):", JSON.stringify(diffs))
      expect(diffs.length === 0, `overlay diffs: ${JSON.stringify(diffs)}`)

      // Drop: team → Gallery slot 2, scaled to the 216 content width; heic → warning toast.
      await dragFiles(page, over, files, true)
      await page
        .locator(".m3-toast", { hasText: "Imported 1 image into Gallery" })
        .waitFor({ timeout: 5000 })
      await page
        .locator(".m3-toast", {
          hasText: "photo.heic isn't supported. Use PNG, JPEG, WebP or GIF",
        })
        .waitFor({ timeout: 5000 })
      expect(
        (await page.locator("[data-testid=raster-drop-overlay]").count()) === 0,
        "overlay gone after the drop",
      )
      const ids = await page.evaluate(
        () => window.__kimo?.session.store.children("GalleryE2E1") ?? [],
      )
      const kids = await page.evaluate(
        (list) => list.map((id) => window.__kimo?.session.store.getNode(id)),
        ids,
      )
      const team = kids[1] as Record<string, unknown> | undefined
      expect(kids.length === 3, `3 children, got ${kids.length}`)
      expect(
        team?.name === "team" && team.type === "rect",
        `slot 2 = team rect: ${JSON.stringify(team)}`,
      )
      expect(team?.w === 216 && team.h === 144, `scaled 216 × 144: ${team?.w} × ${team?.h}`)
      const fill = team?.fill as { kind?: string; src?: string } | undefined
      expect(
        fill?.kind === "image" && /^\.\/assets\/[0-9a-f]{16}\.png$/.test(fill.src ?? ""),
        `image fill: ${JSON.stringify(fill)}`,
      )
      const sel2 = await page.evaluate(() => window.__kimo?.session.ui.getState().selection)
      expect(sel2?.length === 1 && sel2[0] === ids[1], `the import is selected: ${sel2}`)
    },
  },
  {
    name: "board27-raster: oversized file warns; paste of image data lands at the viewport centre",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      const before = await page.evaluate(() => window.__kimo?.session.store.nodeIds().length ?? 0)
      // 21 MB: over the 20 MB limit.
      await dragFiles(
        page,
        { x: 700, y: 450 },
        [{ name: "scan.png", type: "image/png", bytes: 21 * 1024 * 1024 }],
        true,
      )
      await page
        .locator(".m3-toast", { hasText: "scan.png is 21 MB. The limit is 20 MB per image" })
        .waitFor({ timeout: 5000 })
      const afterDrop = await page.evaluate(
        () => window.__kimo?.session.store.nodeIds().length ?? 0,
      )
      expect(afterDrop === before, "nothing imported for the oversized file")

      // Paste: clipboard image data (Chrome names it image.png) → "Pasted image".
      await page.evaluate(async () => {
        window.__kimo?.session.ui.getState().select([])
        const c = new OffscreenCanvas(64, 32)
        const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D
        g.fillRect(0, 0, 64, 32)
        const blob = await c.convertToBlob({ type: "image/png" })
        const dt = new DataTransfer()
        dt.items.add(new File([blob], "image.png", { type: "image/png" }))
        document.body.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, cancelable: true, bubbles: true }),
        )
      })
      await page
        .locator(".m3-toast", { hasText: "Pasted image · 64 × 32" })
        .waitFor({ timeout: 5000 })
      const pasted = await page.evaluate(() => {
        const s = window.__kimo?.session
        const id = s?.ui.getState().selection[0]
        return id ? s?.store.getNode(id) : undefined
      })
      expect(
        pasted?.name === "Pasted image" &&
          pasted.w === 64 &&
          pasted.h === 32 &&
          pasted.parent === null,
        `pasted node: ${JSON.stringify(pasted)}`,
      )
    },
  },
]
