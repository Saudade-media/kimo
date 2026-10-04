/**
 * SVG emitter (teardown §9.2: "SVG from an IR emitter", not CanvasKit). One standalone SVG per
 * exported root, positioned from a layout pass: shapes and frames as paths, gradients and image
 * patterns, strokes with align/dash/caps, clipping, opacity, blend modes, layer blur and drop
 * shadows as filters, icons as glyph paths, text as `<text>` with font information.
 */

import { cssBlend, featureSettings } from "../css/style"
import { fmt } from "../ir/color"
import { kebab } from "../ir/names"
import type { ExportIssueCode, IRDocument, IRNode } from "../ir/types"
import { type El, el, text, toHtml } from "./el"
import { rrectPath, shapePath } from "./geometry"
import { buildScene, type SceneNode, type SceneOptions } from "./scene"
import { type IconLookup, SvgPainter } from "./svgpaint"
import type { ExportFile } from "./types"

export interface SvgOptions extends SceneOptions {
  icons?: IconLookup
}

const n = (v: number) => fmt(v, 3)
const matrix = (m: readonly number[]) =>
  m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1
    ? m[4] === 0 && m[5] === 0
      ? null
      : `translate(${n(m[4] as number)} ${n(m[5] as number)})`
    : `matrix(${m.map((x) => n(x)).join(" ")})`

/** One `<root>.svg` per exported root. */
export function emitSvg(ir: IRDocument, options: SvgOptions): ExportFile[] {
  const files: ExportFile[] = []
  const used = new Set<string>()
  for (const root of ir.roots) {
    const svg = svgOf(ir, root, options)
    if (!svg) continue
    let name = kebab(root.name ?? root.key, "root")
    for (let i = 2; used.has(name); i++) name = `${kebab(root.name ?? root.key, "root")}-${i}`
    used.add(name)
    files.push({ path: `${name}.svg`, contents: svg })
  }
  return files
}

/** SVG markup of one root, or null when the layout has no box for it. */
export function svgOf(ir: IRDocument, root: IRNode, options: SvgOptions): string | null {
  const scene = buildScene(root, options)
  if (!scene) return null
  const issue = (code: ExportIssueCode, message: string, nodeId?: string) =>
    ir.issues.push({ code, message, ...(nodeId ? { nodeId } : {}) })
  const painter = new SvgPainter({ idPrefix: "k", onIssue: (c, m) => issue(c, m, root.id) })
  let filterCount = 0
  const fonts = new Set<string>()

  const draw = (s: SceneNode, isRoot: boolean): El | null => {
    const node = s.node
    const v = node.visual
    const g = el("g", [])
    const t = isRoot ? null : matrix(s.local)
    if (t) g.attrs.push(["transform", t])
    if (v.opacity && v.opacity.v < 1) g.attrs.push(["opacity", n(v.opacity.v)])
    const css: string[] = []
    if (v.blend) css.push(`mix-blend-mode:${cssBlend(v.blend)}`)
    if (v.isolate) css.push("isolation:isolate")
    if (css.length) g.attrs.push(["style", css.join(";")])
    // Filters: drop shadows and layer blur.
    const fx: El[] = []
    const drops = v.shadows.filter((x) => !x.inner)
    for (const sh of drops) {
      const [r, gg, b, a] = sh.color.rgba
      fx.push(
        el("feDropShadow", [
          ["dx", n(sh.x.v)],
          ["dy", n(sh.y.v)],
          ["stdDeviation", n(sh.blur.v / 2)],
          [
            "flood-color",
            `rgb(${Math.round(r * 255)} ${Math.round(gg * 255)} ${Math.round(b * 255)})`,
          ],
          ["flood-opacity", n(a)],
        ]),
      )
      if (sh.spread.v !== 0)
        issue("EFFECT_APPROXIMATED", "SVG drop shadows have no spread", node.id)
    }
    if (v.shadows.some((x) => x.inner))
      issue("EFFECT_APPROXIMATED", "inner shadows are not exported to SVG", node.id)
    if (v.blur && v.blur.v > 0) fx.push(el("feGaussianBlur", [["stdDeviation", n(v.blur.v / 2)]]))
    if (v.backdropBlur) issue("EFFECT_APPROXIMATED", "SVG has no background blur", node.id)
    if (fx.length) {
      const id = `k-fx${++filterCount}`
      painter.defs.push(
        el(
          "filter",
          [
            ["id", id],
            ["x", "-50%"],
            ["y", "-50%"],
            ["width", "200%"],
            ["height", "200%"],
            ["color-interpolation-filters", "sRGB"],
          ],
          fx,
        ),
      )
      g.attrs.push(["filter", `url(#${id})`])
    }

    const radii = v.radius?.map((r) => r.v) ?? null
    // Own geometry.
    let geom: { d: string; fillRule: string; transform: string | null } | null = null
    if (node.shape) geom = shapePath(node.shape, s.w, s.h, radii)
    else if (node.type === "frame" || node.type === "instance")
      geom = { d: rrectPath(s.w, s.h, radii), fillRule: "nonzero", transform: null }
    if (geom)
      g.children.push(...painter.fills(v.fills, geom.d, geom.fillRule, s.w, s.h, geom.transform))
    if (node.icon) {
      const glyph =
        options.icons?.get(node.icon.set, node.icon.name, node.icon.weight ?? undefined) ?? null
      g.children.push(...painter.icon(node.icon, glyph, s.w, s.h))
    }
    if (node.text && s.lines) g.children.push(...textEls(s, fonts, painter))

    // Children (clipped by a clipping frame).
    const kids = s.children.map((c) => draw(c, false)).filter((x): x is El => x !== null)
    if (kids.length) {
      if (v.clip) {
        const id = `k-clip${++filterCount}`
        painter.defs.push(
          el("clipPath", [["id", id]], [el("path", [["d", rrectPath(s.w, s.h, radii)]])]),
        )
        g.children.push(el("g", [["clip-path", `url(#${id})`]], kids))
      } else g.children.push(...kids)
    }
    if (geom && v.stroke) {
      const open = node.shape?.kind === "path" && !/[zZ]\s*$/.test(geom.d)
      g.children.push(
        ...painter.stroke(v.stroke, geom.d, geom.fillRule, s.w, s.h, geom.transform, open),
      )
    }
    if (g.children.length === 0) return null
    return g
  }

  const body = draw(scene, true)
  const defs = painter.defsEl()
  const svg = el(
    "svg",
    [
      ["xmlns", "http://www.w3.org/2000/svg"],
      ["width", n(scene.w)],
      ["height", n(scene.h)],
      ["viewBox", `0 0 ${n(scene.w)} ${n(scene.h)}`],
      ["fill", "none"],
    ],
    [...(defs ? [defs] : []), ...(body ? [body] : [])],
  )
  return `${toHtml(svg, 0, true)}\n`
}

function textEls(s: SceneNode, fonts: Set<string>, painter: SvgPainter): El[] {
  const t = s.node.text
  if (!t || !s.lines) return []
  const last = t.fills[t.fills.length - 1]
  const fill = last ? painter.paint(last, "fill", s.w, s.h) : null
  if (!fill) return []
  const p = t.style
  const style = (st: typeof p): [string, string][] => {
    const a: [string, string][] = [
      ["font-family", st.family.v],
      ["font-size", n(st.size.v)],
      ["font-weight", n(st.weight.v)],
    ]
    if (st.italic) a.push(["font-style", "italic"])
    if (st.letterSpacing.v !== 0) a.push(["letter-spacing", n(st.letterSpacing.v)])
    if (st.decoration.length)
      a.push([
        "text-decoration",
        st.decoration.map((d) => (d === "strike" ? "line-through" : d)).join(" "),
      ])
    if (Object.keys(st.features).length)
      a.push(["style", `font-feature-settings:${featureSettings(st.features)}`])
    fonts.add(st.family.v)
    return a
  }
  const out = el("text", [...style(p), ...fill, ["xml:space", "preserve"]])
  for (const line of s.lines) {
    const tspan = el("tspan", [
      ["x", n(line.x)],
      ["y", n(line.baseline)],
    ])
    for (const seg of line.segments) {
      if (seg.style === p || line.segments.length === 1) tspan.children.push(text(seg.text))
      else {
        const own = style(seg.style).filter(
          ([k, v]) => !style(p).some(([pk, pv]) => pk === k && pv === v),
        )
        tspan.children.push(el("tspan", own, [text(seg.text)]))
      }
    }
    out.children.push(tspan)
  }
  return [out]
}
