/**
 * A decoded Figma copy (see `parseFigmaClipboard`) as Kimo nodes, ready to paste.
 *
 * Pure: no I/O. Image fills need their bytes stored as Kimo assets first, so a host calls
 * {@link figmaImageHashes}, downloads each image (the copy's `imageHashes` metadata has signed
 * URLs), stores it, and passes the hash → asset reference map as `images`.
 *
 * Mapping, in short:
 * - The copied nodes are the children of the copy's visible page; component mains travel on an
 *   internal page and are only read to expand instances.
 * - Instances are expanded into frames: the main's subtree, with the instance's overrides
 *   (`symbolOverrides`, then `derivedSymbolData`, matched by `overrideKey` paths) and component
 *   property assignments (text, visibility, instance swap) applied. Nested instances expand the
 *   same way with the remaining path segments.
 * - Auto layout becomes `layout`; hug/fill sizing becomes `fit`/`fill` sizes; absolute children
 *   keep `position: "absolute"`. Groups (frames with `resizeToFit`) become groups.
 * - Text keeps its runs (`styleOverrideTable` + `characterStyleIDs`) as spans.
 * - Vectors are decoded from their vector network. Boolean operations have no result geometry
 *   on the clipboard, so they paste as a group of their operands (reported).
 */
import { penOrderKey } from "@kimo/core-schema"
import type { KiwiValue } from "./kiwi"
import { vectorNetworkPath } from "./vector"

// biome-ignore lint/suspicious/noExplicitAny: Figma records come from a schema read at runtime; fields are checked where read
type Obj = Record<string, any>

/** Something the converter could not carry over exactly. */
export interface FigmaImportWarning {
  code:
    | "NODE_UNSUPPORTED"
    | "BOOLEAN_FLATTENED"
    | "IMAGE_MISSING"
    | "PAINT_UNSUPPORTED"
    | "EFFECT_UNSUPPORTED"
    | "MAIN_MISSING"
    | "VECTOR_INVALID"
  message: string
  count: number
}

export interface FigmaConvertOptions {
  /** A fresh Kimo node id. */
  newId: () => string
  /** Image hash (40 hex) → stored asset reference (`./assets/<hash>.<ext>`). */
  images?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
}

export interface FigmaConvertResult {
  /** Top-level node ids, in paint order (back to front). */
  roots: string[]
  /** Kimo nodes by id: roots have `parent: null` and their source position in `x`/`y`. */
  nodes: Record<string, Obj>
  /** Source boxes of the roots. */
  boxes: Record<string, { x: number; y: number; w: number; h: number }>
  /** Font families used by text. */
  fonts: string[]
  warnings: FigmaImportWarning[]
}

const INVALID = 4294967295
const MAX_DEPTH = 64

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d)
const round = (n: number, p = 1000) => {
  const r = Math.round(n * p) / p
  return Object.is(r, -0) ? 0 : r
}

function guidKey(g: unknown): string | null {
  if (!isObj(g)) return null
  const s = g.sessionID
  const l = g.localID
  if (typeof s !== "number" || typeof l !== "number" || s === INVALID || l === INVALID) return null
  return `${s}:${l}`
}

const hex = (bytes: unknown): string | null => {
  if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes)) return null
  return Array.from(bytes as ArrayLike<number>, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** Hashes (40 hex) of every image the copy's paints reference, including inside instances. */
export function figmaImageHashes(message: Record<string, KiwiValue>): string[] {
  const out = new Set<string>()
  const visit = (v: unknown, depth: number) => {
    if (depth > 32) return
    if (Array.isArray(v)) for (const x of v) visit(x, depth + 1)
    else if (isObj(v)) {
      if (v.type === "IMAGE" && isObj(v.image)) {
        const h = hex(v.image.hash)
        if (h) out.add(h)
      }
      for (const [k, x] of Object.entries(v)) if (k !== "derivedTextData") visit(x, depth + 1)
    }
  }
  visit(message.nodeChanges, 0)
  return [...out]
}

// --- Scene graph --------------------------------------------------------------------------------

/** A node after instance expansion: Figma props plus expanded children. */
interface VNode {
  p: Obj
  children: VNode[]
}

class Scene {
  readonly byGuid = new Map<string, Obj>()
  readonly children = new Map<string, Obj[]>()

  constructor(readonly message: Record<string, KiwiValue>) {
    const changes = Array.isArray(message.nodeChanges) ? (message.nodeChanges as Obj[]) : []
    for (const n of changes) {
      const k = guidKey(n.guid)
      if (k) this.byGuid.set(k, n)
    }
    for (const n of changes) {
      const parent = guidKey(n.parentIndex?.guid)
      if (!parent) continue
      const list = this.children.get(parent)
      if (list) list.push(n)
      else this.children.set(parent, [n])
    }
    for (const list of this.children.values())
      list.sort((a, b) => {
        const pa = String(a.parentIndex?.position ?? "")
        const pb = String(b.parentIndex?.position ?? "")
        return pa < pb ? -1 : pa > pb ? 1 : 0
      })
  }

  kids(n: Obj): Obj[] {
    const k = guidKey(n.guid)
    return (k && this.children.get(k)) || []
  }

  /** The copied nodes: children of the visible page(s), in order. */
  roots(): Obj[] {
    const pages = this.kids(this.byGuid.get("0:0") ?? {}).filter(
      (p) => p.type === "CANVAS" && p.internalOnly !== true && p.visible !== false,
    )
    return pages.flatMap((p) => this.kids(p))
  }

  blob(index: unknown): Uint8Array | null {
    const blobs = this.message.blobs
    if (!Array.isArray(blobs) || typeof index !== "number") return null
    const b: unknown = blobs[index]
    return isObj(b) && b.bytes instanceof Uint8Array ? b.bytes : null
  }
}

interface Override {
  path: string[]
  props: Obj
}

function overridesOf(list: unknown): Override[] {
  if (!Array.isArray(list)) return []
  const out: Override[] = []
  for (const o of list) {
    if (!isObj(o)) continue
    const guids = Array.isArray(o.guidPath?.guids) ? o.guidPath.guids : []
    const path = guids.map(guidKey).filter((k: string | null): k is string => k !== null)
    if (!path.length) continue
    const { guidPath: _, ...props } = o
    out.push({ path, props })
  }
  return out
}

/** Instance-expansion context: the overrides and property assignments in force. */
interface Ctx {
  overrides: Override[]
  derived: Override[]
  assigns: Map<string, Obj>
  depth: number
}

/** Fields an override never copies (identity and structure). */
const OVERRIDE_SKIP = new Set(["guid", "parentIndex", "overrideKey", "phase", "type"])

function applyProps(target: Obj, props: Obj) {
  for (const [k, v] of Object.entries(props)) if (!OVERRIDE_SKIP.has(k)) target[k] = v
}

class Expander {
  constructor(
    private readonly scene: Scene,
    private readonly warn: (code: FigmaImportWarning["code"], message: string) => void,
  ) {}

  /** A copied node, expanded. */
  node(n: Obj): VNode {
    return this.walk(n, { overrides: [], derived: [], assigns: new Map(), depth: 0 }, true)
  }

  private keyOf(n: Obj): string | null {
    return guidKey(n.overrideKey) ?? guidKey(n.guid)
  }

  private walk(src: Obj, ctx: Ctx, top: boolean): VNode {
    const p: Obj = { ...src }
    if (!top) {
      const key = this.keyOf(src)
      if (key) {
        for (const o of ctx.overrides)
          if (o.path.length === 1 && o.path[0] === key) applyProps(p, o.props)
        for (const o of ctx.derived)
          if (o.path.length === 1 && o.path[0] === key) applyProps(p, o.props)
      }
      this.applyRefs(p, ctx.assigns)
    }
    if (p.type === "INSTANCE") return this.instance(p, src, ctx, top)
    if (ctx.depth > MAX_DEPTH) return { p, children: [] }
    const children = this.scene
      .kids(src)
      .map((c) => this.walk(c, { ...ctx, depth: ctx.depth + 1 }, false))
    return { p, children }
  }

  /** Component property references (`componentPropRefs`) resolved against `assigns`. */
  private applyRefs(p: Obj, assigns: Map<string, Obj>) {
    if (!Array.isArray(p.componentPropRefs) || !assigns.size) return
    for (const ref of p.componentPropRefs) {
      const def = guidKey(ref?.defID)
      const value = def ? assigns.get(def) : undefined
      if (!value) continue
      switch (ref.componentPropNodeField) {
        case "TEXT_DATA": {
          const chars = value.textValue?.characters
          if (typeof chars === "string")
            p.textData = {
              ...(isObj(p.textData) ? p.textData : {}),
              characters: chars,
              characterStyleIDs: [],
              styleOverrideTable: p.textData?.styleOverrideTable,
            }
          break
        }
        case "VISIBLE":
          if (typeof value.boolValue === "boolean") p.visible = value.boolValue
          break
        case "OVERRIDDEN_SYMBOL_ID":
          if (guidKey(value.guidValue)) p.overriddenSymbolID = value.guidValue
          break
      }
    }
  }

  private instance(p: Obj, src: Obj, ctx: Ctx, top: boolean): VNode {
    const mainKey = guidKey(p.overriddenSymbolID) ?? guidKey(p.symbolData?.symbolID)
    const main = mainKey ? this.scene.byGuid.get(mainKey) : undefined
    if (!main || ctx.depth > MAX_DEPTH) {
      if (!main) this.warn("MAIN_MISSING", "An instance's main component was not in the copy")
      return { p: { ...p, type: "FRAME" }, children: [] }
    }
    const key = top ? null : this.keyOf(src)
    // Overrides from enclosing instances that reach into this one, with their head stripped.
    const inner = (list: Override[]) =>
      key
        ? list
            .filter((o) => o.path.length > 1 && o.path[0] === key)
            .map((o) => ({ path: o.path.slice(1), props: o.props }))
        : []
    const own = overridesOf(p.symbolData?.symbolOverrides)
    const ownDerived = overridesOf(p.derivedSymbolData)
    const assigns = new Map<string, Obj>()
    const addAssigns = (list: unknown) => {
      if (!Array.isArray(list)) return
      for (const a of list) {
        const def = guidKey(a?.defID)
        if (def && isObj(a.value)) assigns.set(def, a.value)
      }
    }
    addAssigns(p.componentPropAssignments)
    const next: Ctx = {
      overrides: [...own, ...inner(ctx.overrides)],
      derived: [...ownDerived, ...inner(ctx.derived)],
      assigns,
      depth: ctx.depth + 1,
    }
    // The root: the main's props, then the instance's own (it carries its root visual props),
    // then overrides addressed to the main itself.
    const root: Obj = { ...main }
    applyProps(root, p)
    const mainOverrideKey = this.keyOf(main)
    if (mainOverrideKey)
      for (const o of [...next.overrides, ...next.derived])
        if (o.path.length === 1 && o.path[0] === mainOverrideKey) applyProps(root, o.props)
    root.type = "FRAME"
    root.name = p.name ?? main.name
    root.guid = p.guid
    root.transform = p.transform ?? main.transform
    if (p.size) root.size = p.size
    if (typeof p.visible === "boolean") root.visible = p.visible
    const children = this.scene.kids(main).map((c) => this.walk(c, next, false))
    return { p: root, children }
  }
}

// --- Values -------------------------------------------------------------------------------------

const hex2 = (n: number) =>
  Math.round(Math.max(0, Math.min(1, n)) * 255)
    .toString(16)
    .padStart(2, "0")

function color(c: unknown, opacity = 1): string | null {
  if (!isObj(c)) return null
  const a = num(c.a, 1) * opacity
  const rgb = `#${hex2(num(c.r))}${hex2(num(c.g))}${hex2(num(c.b))}`
  return a >= 0.999 ? rgb.toUpperCase() : `${rgb}${hex2(a)}`.toUpperCase()
}

const BLEND: Record<string, string> = {
  DARKEN: "darken",
  MULTIPLY: "multiply",
  COLOR_BURN: "color-burn",
  LINEAR_BURN: "linear-burn",
  LIGHTEN: "lighten",
  SCREEN: "screen",
  COLOR_DODGE: "color-dodge",
  LINEAR_DODGE: "linear-dodge",
  OVERLAY: "overlay",
  SOFT_LIGHT: "soft-light",
  HARD_LIGHT: "hard-light",
  DIFFERENCE: "difference",
  EXCLUSION: "exclusion",
  HUE: "hue",
  SATURATION: "saturation",
  COLOR: "color",
  LUMINOSITY: "luminosity",
}

type M = [number, number, number, number, number, number]

/** Figma's 2×3 `{m00…m12}` as [a, b, c, d, e, f] (x' = a·x + c·y + e, y' = b·x + d·y + f). */
function matrix(t: unknown): M {
  if (!isObj(t)) return [1, 0, 0, 1, 0, 0]
  return [num(t.m00, 1), num(t.m10), num(t.m01), num(t.m11, 1), num(t.m02), num(t.m12)]
}

function invert(m: M): M | null {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (Math.abs(det) < 1e-12) return null
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

const apply = (m: M, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

// --- Conversion ---------------------------------------------------------------------------------

const SHAPES = new Set([
  "RECTANGLE",
  "ROUNDED_RECTANGLE",
  "ELLIPSE",
  "REGULAR_POLYGON",
  "STAR",
  "LINE",
  "VECTOR",
])
const CONTAINERS = new Set(["FRAME", "SYMBOL", "SECTION", "COMPONENT_SET", "GROUP"])

interface ParentInfo {
  /** The parent's auto layout direction, when it has one. */
  dir: "row" | "column" | null
}

class Converter {
  readonly nodes: Record<string, Obj> = {}
  readonly fonts = new Set<string>()
  private readonly warnings = new Map<string, FigmaImportWarning>()

  constructor(
    private readonly scene: Scene,
    private readonly options: FigmaConvertOptions,
  ) {}

  warn(code: FigmaImportWarning["code"], message: string) {
    const k = `${code}\n${message}`
    const w = this.warnings.get(k)
    if (w) w.count++
    else this.warnings.set(k, { code, message, count: 1 })
  }

  allWarnings(): FigmaImportWarning[] {
    return [...this.warnings.values()]
  }

  private image(hash: string): string | null {
    const images = this.options.images
    if (!images) return null
    const v = images instanceof Map ? images.get(hash) : (images as Record<string, string>)[hash]
    return typeof v === "string" ? v : null
  }

  // Paints

  paint(f: Obj, w: number, h: number): unknown {
    const visible = f.visible !== false
    const opacity = num(f.opacity, 1)
    const blend = typeof f.blendMode === "string" ? BLEND[f.blendMode] : undefined
    const extra = { ...(blend ? { blend } : {}), ...(visible ? {} : { visible: false }) }
    switch (f.type) {
      case "SOLID": {
        const c = color(f.color, opacity)
        if (!c) return null
        return Object.keys(extra).length ? { kind: "solid", color: c, ...extra } : c
      }
      case "GRADIENT_LINEAR":
      case "GRADIENT_RADIAL":
      case "GRADIENT_ANGULAR":
      case "GRADIENT_DIAMOND":
        return this.gradient(f, opacity, extra)
      case "IMAGE": {
        const hash = hex(f.image?.hash)
        let src = hash ? this.image(hash) : null
        if (!src) {
          this.warn("IMAGE_MISSING", "An image could not be downloaded from Figma")
          src = `./assets/${(hash ?? "0".repeat(16)).slice(0, 16)}.png`
        }
        const out: Obj = { kind: "image", src }
        const mode = f.imageScaleMode
        if (mode === "FIT") out.fit = "contain"
        else if (mode === "TILE") out.fit = "tile"
        else if (mode === "STRETCH" && isObj(f.transform)) {
          const [a, b, c, d, e, g] = matrix(f.transform)
          out.fit = "crop"
          out.crop = [a, b, c, d, e, g].map((n) => round(n, 1e6))
        }
        if (opacity !== 1) out.opacity = round(opacity)
        void w
        void h
        return { ...out, ...extra }
      }
      default:
        this.warn("PAINT_UNSUPPORTED", `A ${String(f.type).toLowerCase()} paint was dropped`)
        return null
    }
  }

  private gradient(f: Obj, opacity: number, extra: Obj): unknown {
    const stops = (Array.isArray(f.stops) ? f.stops : [])
      .map((s: Obj) => ({
        color: color(s.color),
        at: round(Math.max(0, Math.min(1, num(s.position)))),
      }))
      .filter((s: { color: string | null }) => s.color)
    if (stops.length < 2) return null
    // The paint transform maps the node's unit box to gradient space; its inverse places the
    // gradient's unit geometry in the box.
    const inv = invert(matrix(f.transform)) ?? [1, 0, 0, 1, 0, 0]
    const out: Obj = { stops }
    if (f.type === "GRADIENT_LINEAR") {
      const [x0, y0] = apply(inv, 0, 0.5)
      const [x1, y1] = apply(inv, 1, 0.5)
      const vx = x1 - x0
      const vy = y1 - y0
      const len = Math.hypot(vx, vy)
      out.kind = "linear"
      out.center = [round((x0 + x1) / 2), round((y0 + y1) / 2)]
      out.size = [1, round(len)]
      out.rotation = round((Math.atan2(-vx, -vy) * 180) / Math.PI, 100)
    } else {
      if (f.type === "GRADIENT_DIAMOND")
        this.warn("PAINT_UNSUPPORTED", "A diamond gradient pasted as radial")
      const [cx, cy] = apply(inv, 0.5, 0.5)
      // The unit circle's image: axis directions and lengths from the linear part.
      const ux = [inv[0] * 0.5, inv[1] * 0.5]
      const uy = [inv[2] * 0.5, inv[3] * 0.5]
      out.kind = f.type === "GRADIENT_ANGULAR" ? "angular" : "radial"
      out.center = [round(cx), round(cy)]
      out.size = [
        round(2 * Math.hypot(ux[0] as number, ux[1] as number)),
        round(2 * Math.hypot(uy[0] as number, uy[1] as number)),
      ]
      // Kimo rotates CCW (y down): the x axis turns to (cos, -sin).
      out.rotation = round((Math.atan2(-(ux[1] as number), ux[0] as number) * 180) / Math.PI, 100)
      if (out.kind === "angular") out.rotation = round(out.rotation - 90, 100)
    }
    if (opacity !== 1) out.opacity = round(opacity)
    return { kind: out.kind, ...out, ...extra }
  }

  paints(list: unknown, w: number, h: number): unknown[] | undefined {
    if (!Array.isArray(list)) return undefined
    return list.map((f) => (isObj(f) ? this.paint(f, w, h) : null)).filter((p) => p !== null)
  }

  // Strokes, radius, effects

  stroke(p: Obj, w: number, h: number): Obj | undefined {
    const paint = this.paints(p.strokePaints, w, h)
    if (!paint?.length) return undefined
    const out: Obj = { paint: paint.length === 1 ? paint[0] : paint }
    if (p.borderStrokeWeightsIndependent === true) {
      out.width = {
        t: round(num(p.borderTopWeight)),
        r: round(num(p.borderRightWeight)),
        b: round(num(p.borderBottomWeight)),
        l: round(num(p.borderLeftWeight)),
      }
    } else {
      const sw = num(p.strokeWeight, 1)
      if (sw !== 1) out.width = round(sw)
    }
    const align = { INSIDE: "inside", OUTSIDE: "outside", CENTER: "center" }[String(p.strokeAlign)]
    if (align && align !== "inside") out.align = align
    const cap = { ROUND: "round", SQUARE: "square" }[String(p.strokeCap)]
    if (cap) out.cap = cap
    const join = { ROUND: "round", BEVEL: "bevel" }[String(p.strokeJoin)]
    if (join) out.join = join
    if (Array.isArray(p.dashPattern) && p.dashPattern.length)
      out.dash = p.dashPattern.map((n: unknown) => round(Math.max(0, num(n))))
    return out
  }

  radius(p: Obj): unknown {
    const corners = [
      p.rectangleTopLeftCornerRadius,
      p.rectangleTopRightCornerRadius,
      p.rectangleBottomRightCornerRadius,
      p.rectangleBottomLeftCornerRadius,
    ]
    if (p.rectangleCornerRadiiIndependent === true && corners.some((c) => typeof c === "number")) {
      const r = corners.map((c) => round(Math.max(0, num(c))))
      return r.every((x) => x === r[0]) ? r[0] || undefined : r
    }
    const r = round(Math.max(0, num(p.cornerRadius)))
    return r || undefined
  }

  effects(list: unknown): Obj[] | undefined {
    if (!Array.isArray(list) || !list.length) return undefined
    const out: Obj[] = []
    for (const e of list) {
      if (!isObj(e)) continue
      const visible = e.visible !== false
      // Figma's blur radius is a little wider than Kimo's (same factor as pen.dev's renderer).
      const blur = round(Math.max(0, num(e.radius)) * 0.875, 100)
      if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
        out.push({
          kind: "shadow",
          ...(e.type === "INNER_SHADOW" ? { inner: true } : {}),
          x: round(num(e.offset?.x)),
          y: round(num(e.offset?.y)),
          blur,
          ...(num(e.spread) ? { spread: round(num(e.spread)) } : {}),
          color: color(e.color) ?? "#00000040",
          ...(typeof e.blendMode === "string" && BLEND[e.blendMode]
            ? { blend: BLEND[e.blendMode] }
            : {}),
          ...(visible ? {} : { visible: false }),
        })
      } else if (e.type === "FOREGROUND_BLUR" || e.type === "BACKGROUND_BLUR") {
        out.push({
          kind: e.type === "FOREGROUND_BLUR" ? "blur" : "backdrop-blur",
          radius: blur,
          ...(visible ? {} : { visible: false }),
        })
      } else {
        this.warn(
          "EFFECT_UNSUPPORTED",
          `A ${String(e.type).toLowerCase().replace(/_/g, " ")} effect was dropped`,
        )
      }
    }
    return out.length ? out : undefined
  }

  // Text

  textStyle(s: Obj, base: Obj | null): Obj {
    const out: Obj = {}
    const size = num(s.fontSize, num(base?.fontSize, 12))
    if (isObj(s.fontName)) {
      const family = String(s.fontName.family ?? "")
      if (family) {
        out.font = family
        this.fonts.add(family)
      }
      const style = String(s.fontName.style ?? "")
      out.weight = fontWeight(style)
      if (/italic|oblique/i.test(style)) out.italic = true
    }
    if (typeof s.fontSize === "number") out.size = round(s.fontSize, 100)
    if (isObj(s.lineHeight)) {
      const v = num(s.lineHeight.value)
      const u = s.lineHeight.units
      if (u === "PIXELS") out.lineHeight = { px: round(v, 100) }
      else if (u === "PERCENT" && v !== 100) out.lineHeight = round(v / 100, 1000)
      else if (u === "RAW") out.lineHeight = round(v, 1000)
    }
    if (isObj(s.letterSpacing)) {
      const v = num(s.letterSpacing.value)
      const ls = s.letterSpacing.units === "PERCENT" ? (v / 100) * size : v
      if (ls) out.letterSpacing = round(ls, 100)
    }
    const deco = { UNDERLINE: ["underline"], STRIKETHROUGH: ["strike"] }[String(s.textDecoration)]
    if (deco) out.decoration = deco
    const tcase = { UPPER: "upper", LOWER: "lower", TITLE: "title" }[String(s.textCase)]
    if (tcase) out.case = tcase
    if (isObj(s.hyperlink) && typeof s.hyperlink.url === "string") out.href = s.hyperlink.url
    return out
  }

  text(p: Obj, w: number, h: number): Obj {
    const { chars, ids } = withListMarkers(
      String(p.textData?.characters ?? ""),
      Array.isArray(p.textData?.characterStyleIDs) ? p.textData.characterStyleIDs : [],
      Array.isArray(p.textData?.lines) ? p.textData.lines : [],
    )
    const node: Obj = {}
    const style = this.textStyle(p, null)
    const align = { CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" }[
      String(p.textAlignHorizontal)
    ]
    if (align) style.align = align
    const valign = { CENTER: "middle", BOTTOM: "bottom" }[String(p.textAlignVertical)]
    if (valign) style.valign = valign
    node.style = style
    const fill = this.paints(p.fillPaints, w, h)
    if (fill) node.fill = fill.length === 1 ? fill[0] : fill
    // Runs: characterStyleIDs index styleOverrideTable per UTF-16 unit; missing ids are 0 (base).
    const table = new Map<number, Obj>()
    for (const s of Array.isArray(p.textData?.styleOverrideTable)
      ? p.textData.styleOverrideTable
      : [])
      if (isObj(s) && typeof s.styleID === "number") table.set(s.styleID, s)
    if (!ids.some((id) => id !== 0 && table.has(id))) {
      node.content = chars
      return node
    }
    const spans: Obj[] = []
    let start = 0
    for (let i = 1; i <= chars.length; i++) {
      const prev = ids[i - 1] ?? 0
      const cur = i < chars.length ? (ids[i] ?? 0) : -1
      if (cur === prev) continue
      const text = chars.slice(start, i)
      start = i
      const s = table.get(prev)
      const span: Obj = { text }
      if (s) {
        const st = this.textStyle(s, p)
        // Keep only what differs from the node style.
        for (const k of Object.keys(st))
          if (JSON.stringify(st[k]) === JSON.stringify(style[k])) delete st[k]
        if (Object.keys(st).length) span.style = st
        if (Array.isArray(s.fillPaints)) {
          const f = s.fillPaints.find(
            (x: Obj) => isObj(x) && x.type === "SOLID" && x.visible !== false,
          )
          const c = f ? color(f.color, num(f.opacity, 1)) : null
          if (c && JSON.stringify(c) !== JSON.stringify(node.fill)) span.fill = c
        }
      }
      spans.push(span)
    }
    node.content = spans
    return node
  }

  // Nodes

  convert(v: VNode, parentId: string | null, index: number, parent: ParentInfo): string | null {
    const p = v.p
    const type = String(p.type)
    const w = Math.max(0, num(p.size?.x))
    const h = Math.max(0, num(p.size?.y))
    let kind: string
    if (type === "TEXT") kind = "text"
    else if (type === "BOOLEAN_OPERATION") {
      this.warn("BOOLEAN_FLATTENED", "A boolean shape pasted as a group of its parts")
      kind = "group"
    } else if (CONTAINERS.has(type))
      kind = p.resizeToFit === true && !p.stackMode ? "group" : "frame"
    else if (SHAPES.has(type)) kind = type
    else {
      this.warn("NODE_UNSUPPORTED", `${type.toLowerCase().replace(/_/g, " ")} layers were skipped`)
      return null
    }

    const id = this.options.newId()
    const node: Obj = { parent: parentId, order: penOrderKey(index) }
    if (typeof p.name === "string" && p.name) node.name = p.name
    this.place(node, p, w, h)
    if (p.visible === false) node.visible = false
    if (num(p.opacity, 1) !== 1) node.opacity = round(num(p.opacity, 1))
    if (typeof p.blendMode === "string" && BLEND[p.blendMode]) node.blend = BLEND[p.blendMode]
    if (p.locked === true) node.locked = true
    if (parent.dir && p.stackPositioning === "ABSOLUTE") node.position = "absolute"

    const graphics = () => {
      const fill = this.paints(p.fillPaints, w, h)
      if (fill?.length) node.fill = fill.length === 1 ? fill[0] : fill
      const stroke = this.stroke(p, w, h)
      if (stroke) node.stroke = stroke
      const effects = this.effects(p.effects)
      if (effects) node.effects = effects
    }

    switch (kind) {
      case "group": {
        node.type = "group"
        const effects = this.effects(p.effects)
        if (effects) node.effects = effects
        break
      }
      case "frame": {
        node.type = "frame"
        graphics()
        const r = this.radius(p)
        if (r !== undefined) node.radius = r
        if (p.frameMaskDisabled !== true && type !== "SECTION") node.clip = true
        this.layout(node, p, w, h, parent)
        break
      }
      case "text": {
        node.type = "text"
        Object.assign(node, this.text(p, w, h))
        const stroke = this.stroke(p, w, h)
        if (stroke) node.stroke = stroke
        const effects = this.effects(p.effects)
        if (effects) node.effects = effects
        const grow = p.textAutoResize
        const sized = this.childSize(p, parent)
        if (grow === "WIDTH_AND_HEIGHT" && !sized.w) node.grow = "auto"
        else if (grow === "HEIGHT" || (grow === "WIDTH_AND_HEIGHT" && sized.w)) {
          node.grow = "fixed-width"
          node.w = sized.w ?? round(w)
        } else {
          node.grow = "fixed"
          node.w = sized.w ?? round(w)
          node.h = sized.h ?? round(h)
        }
        break
      }
      case "ELLIPSE": {
        node.type = "ellipse"
        graphics()
        this.size(node, p, w, h, parent)
        const arc = p.arcData
        if (isObj(arc)) {
          const s = num(arc.startingAngle)
          const e = num(arc.endingAngle, Math.PI * 2)
          const inner = num(arc.innerRadius)
          if (inner > 0 && inner < 1) node.innerRadius = round(inner)
          const sweep = ((e - s) * 180) / Math.PI
          if (Math.abs(sweep) < 359.99) {
            node.startAngle = round((-s * 180) / Math.PI, 100)
            node.sweepAngle = round(-sweep, 100)
          }
        }
        break
      }
      case "REGULAR_POLYGON":
      case "STAR": {
        node.type = "polygon"
        graphics()
        this.size(node, p, w, h, parent)
        node.sides = Math.max(3, Math.round(num(p.count, kind === "STAR" ? 5 : 3)))
        if (kind === "STAR")
          node.star = { ratio: round(Math.min(1, Math.max(0.01, num(p.starInnerScale, 0.38)))) }
        const r = this.radius(p)
        if (typeof r === "number") node.radius = r
        break
      }
      case "LINE": {
        node.type = "path"
        graphics()
        node.w = round(w)
        node.h = 0
        node.d = `M0 0 L${round(w)} 0`
        break
      }
      case "VECTOR": {
        node.type = "path"
        graphics()
        this.size(node, p, w, h, parent)
        const norm = p.vectorData?.normalizedSize
        const sx = isObj(norm) && num(norm.x) > 0 ? w / num(norm.x) : 1
        const sy = isObj(norm) && num(norm.y) > 0 ? h / num(norm.y) : 1
        const blob = this.scene.blob(p.vectorData?.vectorNetworkBlob)
        const path = blob ? vectorNetworkPath(blob, sx, sy) : null
        if (!path) {
          this.warn("VECTOR_INVALID", "A vector could not be read")
          return null
        }
        node.d = path.d
        if (path.fillRule !== "nonzero") node.fillRule = path.fillRule
        break
      }
      default: {
        node.type = "rect"
        graphics()
        this.size(node, p, w, h, parent)
        const r = this.radius(p)
        if (r !== undefined) node.radius = r
      }
    }

    this.nodes[id] = node
    if (node.type === "frame" || node.type === "group") {
      const dir =
        node.type === "frame" && isObj(node.layout) ? (node.layout.dir as "row" | "column") : null
      let i = 0
      for (const c of v.children) if (this.convert(c, id, i, { dir }) !== null) i++
      if (node.type === "group" && i === 0) {
        delete this.nodes[id]
        return null
      }
    }
    return id
  }

  /** Position, rotation and flips from the transform (Kimo rotates about the top-left corner). */
  private place(node: Obj, p: Obj, w: number, h: number) {
    const [a, b, c, d, e, f] = matrix(p.transform)
    const det = a * d - b * c
    const flip = det < 0
    // Rotation part: the matrix itself, or with x mirrored (Kimo flips inside the box).
    // Kimo's CCW rotation by r is x' = cos·x + sin·y, so sin is the y→x term (`c`).
    const rot = round((Math.atan2(c, flip ? -a : a) * 180) / Math.PI, 1000)
    // Kimo: world = T(x,y)·R·F(box); match the box centers.
    const [mcx, mcy] = [a * (w / 2) + c * (h / 2) + e, b * (w / 2) + d * (h / 2) + f]
    const r = (rot * Math.PI) / 180
    const cos = Math.cos(r)
    const sin = Math.sin(r)
    const rcx = cos * (w / 2) + sin * (h / 2)
    const rcy = -sin * (w / 2) + cos * (h / 2)
    node.x = round(mcx - rcx, 100)
    node.y = round(mcy - rcy, 100)
    if (rot !== 0) node.rotation = rot
    if (flip) node.flipX = true
  }

  /** Sizes a child of an auto-layout frame takes from its parent (`fill`), per axis. */
  private childSize(p: Obj, parent: ParentInfo): { w?: Obj; h?: Obj } {
    if (!parent.dir || p.stackPositioning === "ABSOLUTE") return {}
    const out: { w?: Obj; h?: Obj } = {}
    const grow = num(p.stackChildPrimaryGrow) > 0
    const stretch = p.stackChildAlignSelf === "STRETCH"
    const primary = parent.dir === "row" ? "w" : "h"
    const counter = parent.dir === "row" ? "h" : "w"
    if (grow) out[primary] = { mode: "fill" }
    if (stretch) out[counter] = { mode: "fill" }
    return out
  }

  private size(node: Obj, p: Obj, w: number, h: number, parent: ParentInfo) {
    const sized = this.childSize(p, parent)
    node.w = sized.w ?? round(w)
    node.h = sized.h ?? round(h)
  }

  private layout(node: Obj, p: Obj, w: number, h: number, parent: ParentInfo) {
    const sized = this.childSize(p, parent)
    const mode = p.stackMode
    if (mode !== "HORIZONTAL" && mode !== "VERTICAL") {
      node.w = sized.w ?? round(w)
      node.h = sized.h ?? round(h)
      return
    }
    const dir = mode === "HORIZONTAL" ? "row" : "column"
    const layout: Obj = { dir }
    const gap = num(p.stackSpacing)
    if (gap) layout.gap = round(gap)
    const left = num(p.stackHorizontalPadding)
    const top = num(p.stackVerticalPadding)
    const right = typeof p.stackPaddingRight === "number" ? p.stackPaddingRight : left
    const bottom = typeof p.stackPaddingBottom === "number" ? p.stackPaddingBottom : top
    const pad = [top, right, bottom, left].map((n) => round(Math.max(0, n)))
    if (pad.some((n) => n)) {
      if (pad.every((n) => n === pad[0])) layout.pad = pad[0]
      else if (pad[0] === pad[2] && pad[1] === pad[3]) layout.pad = [pad[0], pad[1]]
      else layout.pad = pad
    }
    const justify = {
      CENTER: "center",
      MAX: "end",
      SPACE_EVENLY: "between",
      SPACE_BETWEEN: "between",
    }[String(p.stackPrimaryAlignItems)]
    if (justify) layout.justify = justify
    const align = { CENTER: "center", MAX: "end", BASELINE: "baseline" }[
      String(p.stackCounterAlignItems)
    ]
    if (align) layout.align = align
    if (p.stackWrap === "WRAP") {
      layout.wrap = true
      if (num(p.stackCounterSpacing)) layout.crossGap = round(num(p.stackCounterSpacing))
    }
    if (p.bordersTakeSpace === true) layout.includeStroke = true
    node.layout = layout
    // Figma: an absent primary sizing hugs; counter sizing hugs only when it says so.
    const primaryHug = p.stackPrimarySizing !== "FIXED"
    const counterHug = String(p.stackCounterSizing ?? "").startsWith("RESIZE_TO_FIT")
    const hugW = dir === "row" ? primaryHug : counterHug
    const hugH = dir === "row" ? counterHug : primaryHug
    node.w = sized.w ?? (hugW ? { mode: "fit" } : round(w))
    node.h = sized.h ?? (hugH ? { mode: "fit" } : round(h))
  }
}

/**
 * Figma list paragraphs (`textData.lines`, one per `\n` paragraph) written into the text: Kimo
 * has no lists, so numbers and bullets become characters, with the paragraph's style.
 */
function withListMarkers(
  chars: string,
  ids: readonly number[],
  lines: readonly Obj[],
): { chars: string; ids: number[] } {
  if (!lines.some((l) => isObj(l) && /LIST/.test(String(l.lineType))))
    return { chars, ids: [...ids] }
  let out = ""
  const outIds: number[] = []
  const counters: number[] = []
  let line = 0
  let atStart = true
  for (let i = 0; i < chars.length; i++) {
    if (atStart) {
      atStart = false
      const l = lines[line]
      const level = Math.max(1, num(l?.indentationLevel, 1))
      let marker = ""
      if (l?.lineType === "ORDERED_LIST") {
        if (l.isFirstLineOfList === true || counters[level] === undefined)
          counters[level] = num(l.listStartOffset)
        counters.length = level + 1
        counters[level] = (counters[level] ?? 0) + 1
        marker = `${counters[level]}. `
      } else if (l?.lineType === "UNORDERED_LIST") {
        counters.length = level
        marker = level % 2 === 1 ? "• " : "◦ "
      } else counters.length = 0
      if (marker) {
        marker = "    ".repeat(level - 1) + marker
        out += marker
        for (let k = 0; k < marker.length; k++) outIds.push(ids[i] ?? 0)
      }
    }
    const ch = chars[i] as string
    out += ch
    outIds.push(ids[i] ?? 0)
    if (ch === "\n") {
      line++
      atStart = true
    }
  }
  return { chars: out, ids: outIds }
}

function fontWeight(style: string): number {
  const s = style.toLowerCase().replace(/[\s_-]+/g, "")
  if (/thin|hairline/.test(s)) return 100
  if (/extralight|ultralight/.test(s)) return 200
  if (/semibold|demibold/.test(s)) return 600
  if (/extrabold|ultrabold/.test(s)) return 800
  if (/black|heavy/.test(s)) return 900
  if (/bold/.test(s)) return 700
  if (/medium/.test(s)) return 500
  if (/light/.test(s)) return 300
  return 400
}

/** Converts a decoded Figma copy into Kimo nodes. */
export function convertFigma(
  message: Record<string, KiwiValue>,
  options: FigmaConvertOptions,
): FigmaConvertResult {
  const scene = new Scene(message)
  const converter = new Converter(scene, options)
  const expander = new Expander(scene, (code, msg) => converter.warn(code, msg))
  const roots: string[] = []
  const boxes: FigmaConvertResult["boxes"] = {}
  for (const n of scene.roots()) {
    const id = converter.convert(expander.node(n), null, roots.length, { dir: null })
    if (!id) continue
    roots.push(id)
    const node = converter.nodes[id] as Obj
    const w = Math.max(0, num(n.size?.x))
    const h = Math.max(0, num(n.size?.y))
    boxes[id] = { x: num(node.x), y: num(node.y), w, h }
  }
  return {
    roots,
    nodes: converter.nodes,
    boxes,
    fonts: [...converter.fonts].sort(),
    warnings: converter.allWarnings(),
  }
}
