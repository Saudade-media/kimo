/**
 * `.pen` → `.kimo` conversion (teardown §10 mapping table, §13 "plain-JSON files only").
 *
 * Pure: no I/O. Image fills need their bytes stored as Kimo assets first, so a host calls
 * {@link penImageUrls}, stores each image (getting `./assets/<hash>.<ext>`) and passes the
 * mapping as {@link PenImportOptions.images}. Everything else converts in memory.
 *
 * The main differences the converter bridges:
 * - Flat `.pen` props become Kimo structs (`layout`, `style`, `stroke`, sized `w`/`h`).
 * - `"$name"` strings become `{ "$ref": "name" }` bindings; `fill_container(900)` becomes
 *   `{ mode: "fill", fallback: 900 }`.
 * - A frame without `layout` is a horizontal flex row in `.pen`, so `dir: "row"` is explicit.
 * - `ref` instances: root props go to `props`, `descendants` become tagged overrides. A `set`
 *   replaces a property wholesale, so each override is the diff between the converted target
 *   (with every override above it merged in, `.pen`-side) and the converted target as authored.
 * - A `ref` with its own `children` (they replace the component's) becomes a plain node, a
 *   component when it is `reusable`, since no Kimo override targets an instance's root.
 * - Ids that do not fit Kimo's grammar (`.pen` uses 5 characters) are re-keyed, consistently in
 *   every override path.
 */

import type { KimoDocument } from "../schema/document"
import { HEX_COLOR_PATTERN, VARIABLE_NAME_PATTERN } from "../schema/primitives"
import { featuresNeeded } from "../validate/index"
import { FORMAT_VERSION, SCHEMA_URL } from "../version"
import type { PenDocument, PenNode, PenThemedValue } from "./types"

type Obj = Record<string, unknown>

/** Options for {@link importPen}. */
export interface PenImportOptions {
  /** Document name (`meta.name`), e.g. the file name without extension. */
  name?: string
  /**
   * Asset reference (`./assets/<hash>.<ext>`) of each image fill URL, exactly as the URL is
   * written in the `.pen` file. A URL without an entry becomes a missing asset (checkerboard).
   */
  images?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
}

/** Something the converter could not carry over exactly. */
export interface PenImportWarning {
  code:
    | "ID_UNKNOWN"
    | "OVERRIDE_UNRESOLVED"
    | "OVERRIDE_UNSET"
    | "IMAGE_MISSING"
    | "PAINT_DROPPED"
    | "PAINT_APPROXIMATED"
    | "VARIABLE_MISSING"
    | "VARIABLE_RENAMED"
    | "IMPORTS_UNSUPPORTED"
    | "INSTANCE_DETACHED"
    | "VALUE_INVALID"
  message: string
  /** `.pen` id of the node concerned, when there is one. */
  node?: string
  /** How many times this warning occurred (identical messages are folded). */
  count: number
}

export interface PenImportResult {
  doc: KimoDocument
  warnings: PenImportWarning[]
  /** `.pen` id → Kimo id, for every id that was re-keyed or kept. */
  ids: ReadonlyMap<string, string>
}

const ID_RE = /^[A-Za-z0-9]{6,24}$/
const VAR_RE = new RegExp(VARIABLE_NAME_PATTERN)
const HEX_RE = new RegExp(HEX_COLOR_PATTERN)
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** True for a parsed `.pen` document (schema 2.x: `version` + `children`, no `.kimo` header). */
export function isPenDocument(value: unknown): value is PenDocument {
  if (!isObj(value)) return false
  return (
    typeof value.version === "string" &&
    /^\d+\.\d+/.test(value.version) &&
    Array.isArray(value.children) &&
    value.format === undefined &&
    value.$schema === undefined
  )
}

/** Every image fill URL of a `.pen` document (unique, in document order). */
export function penImageUrls(pen: PenDocument): string[] {
  const out = new Set<string>()
  const visitPaints = (v: unknown) => {
    for (const f of list(v))
      if (isObj(f) && f.type === "image" && typeof f.url === "string" && f.url) out.add(f.url)
  }
  const visit = (n: PenNode) => {
    visitPaints(n.fill)
    visitPaints(n.stroke)
    for (const c of n.children ?? []) visit(c)
    for (const d of Object.values(n.descendants ?? {})) if (isObj(d)) visit(d as PenNode)
  }
  for (const c of pen.children) visit(c)
  return [...out]
}

/** Shader and script files a `.pen` document references (relative URLs, unique). */
export function penFileUrls(pen: PenDocument): string[] {
  const out = new Set<string>()
  const visit = (n: PenNode) => {
    for (const f of list(n.fill))
      if (isObj(f) && f.type === "shader" && typeof f.url === "string") out.add(f.url)
    if (n.type === "script" && typeof n.scriptUri === "string") out.add(n.scriptUri)
    for (const c of n.children ?? []) visit(c)
    for (const d of Object.values(n.descendants ?? {})) if (isObj(d)) visit(d as PenNode)
  }
  for (const c of pen.children) visit(c)
  return [...out]
}

/** Converts a parsed `.pen` document to a `.kimo` document. Never throws on odd content. */
export function importPen(pen: PenDocument, options: PenImportOptions = {}): PenImportResult {
  return new PenImporter(pen, options).run()
}

/** The `n`th sibling order key: `a0`…`az`, `b00`…`bzz`, `c000`… (fractional-index heads). */
export function penOrderKey(n: number): string {
  let width = 1
  let span = DIGITS.length
  let head = 0
  while (n >= span) {
    n -= span
    width++
    head++
    span *= DIGITS.length
  }
  let s = ""
  for (let i = 0; i < width; i++) {
    s = DIGITS[n % DIGITS.length] + s
    n = Math.floor(n / DIGITS.length)
  }
  return String.fromCharCode(97 + head) + s
}

// --- Value helpers ----------------------------------------------------------------------------

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]
}

function isVarRef(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("$") && v.length > 1
}

function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`
  if (isObj(v))
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(",")}}`
  return JSON.stringify(v)
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

/** Drops `undefined` members (so a struct built field by field stays minimal). */
function compact<T extends Obj>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

const BLEND: Record<string, string> = {
  normal: "normal",
  darken: "darken",
  multiply: "multiply",
  linearBurn: "linear-burn",
  colorBurn: "color-burn",
  light: "lighten",
  lighten: "lighten",
  screen: "screen",
  linearDodge: "linear-dodge",
  colorDodge: "color-dodge",
  overlay: "overlay",
  softLight: "soft-light",
  hardLight: "hard-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
}

const ICON_SETS: Record<string, string> = {
  lucide: "lucide",
  feather: "feather",
  phosphor: "phosphor",
  "Material Symbols Outlined": "material-outlined",
  "Material Symbols Rounded": "material-rounded",
  "Material Symbols Sharp": "material-sharp",
}

const FONT_WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
}

/** `.pen` entity keys that are not visual (never part of an instance's `props`). */
const PEN_NON_VISUAL = new Set([
  "id",
  "type",
  "ref",
  "descendants",
  "children",
  "name",
  "x",
  "y",
  "layoutPosition",
  "theme",
  "reusable",
  "context",
  "metadata",
])

/** Kimo keys a `set` override or instance `props` may not carry. */
const SET_FORBIDDEN = new Set(["type", "parent", "at", "order", "component", "overrides"])
const PROPS_FORBIDDEN = new Set([
  ...SET_FORBIDDEN,
  "name",
  "x",
  "y",
  "position",
  "theme",
  "locked",
  "meta",
  "page",
])

/** Kimo node types that may have children. */
const CONTAINERS = new Set(["frame", "group"])

// --- The importer -----------------------------------------------------------------------------

class PenImporter {
  private readonly byId = new Map<string, PenNode>()
  /** `.pen` id → the ref whose `descendants` authored the node (replacement or slot content). */
  private readonly owners = new Map<string, string>()
  private readonly ids = new Map<string, string>()
  private readonly used = new Set<string>()
  private readonly nodes: Record<string, Obj> = {}
  private readonly warnings = new Map<string, PenImportWarning>()
  private readonly varNames = new Map<string, string>()
  private readonly effMemo = new Map<string, PenNode | undefined>()
  private readonly defaultTheme: Record<string, string> = {}

  constructor(
    private readonly pen: PenDocument,
    private readonly options: PenImportOptions,
  ) {}

  run(): PenImportResult {
    const pen = this.pen
    for (const [axis, values] of Object.entries(pen.themes ?? {}))
      if (Array.isArray(values) && typeof values[0] === "string")
        this.defaultTheme[axis] = values[0]
    this.registerVariables()
    for (const c of pen.children ?? []) this.collect(c)
    if (pen.imports && Object.keys(pen.imports).length > 0)
      this.warn(
        "IMPORTS_UNSUPPORTED",
        "Imported .pen libraries are not converted; their components are missing",
      )
    ;(pen.children ?? []).forEach((c, i) => {
      if (isObj(c)) this.convertTree(c, null, undefined, penOrderKey(i))
    })

    const doc: Obj = {
      $schema: SCHEMA_URL,
      format: FORMAT_VERSION,
    }
    const meta: Obj = compact({
      name: this.options.name,
      createdWith: `pen.dev ${pen.version}`,
      "pen.fileToken": typeof pen.fileToken === "string" ? pen.fileToken : undefined,
    })
    doc.meta = meta
    const themes = this.themes()
    if (themes) doc.themes = themes
    const variables = this.variables()
    if (variables) doc.variables = variables
    doc.nodes = this.nodes
    const features = new Set<string>()
    for (const n of Object.values(this.nodes)) for (const f of featuresNeeded(n)) features.add(f)
    if (features.size) doc.features = [...features].sort()
    return {
      doc: doc as unknown as KimoDocument,
      warnings: [...this.warnings.values()],
      ids: this.ids,
    }
  }

  // --- Warnings ---------------------------------------------------------------------------------

  private warn(code: PenImportWarning["code"], message: string, node?: string): void {
    const key = `${code}\u0000${message}`
    const w = this.warnings.get(key)
    if (w) w.count++
    else this.warnings.set(key, compact({ code, message, node, count: 1 }))
  }

  // --- Ids --------------------------------------------------------------------------------------

  /** Indexes `n`'s subtree; `owner` is the ref whose `descendants` authored it, if any. */
  private collect(n: PenNode, owner?: string): void {
    if (!isObj(n)) return
    if (typeof n.id === "string" && !this.byId.has(n.id)) {
      this.byId.set(n.id, n)
      if (owner !== undefined) this.owners.set(n.id, owner)
    }
    for (const c of n.children ?? []) this.collect(c, owner)
    const self = typeof n.id === "string" ? n.id : undefined
    for (const d of Object.values(n.descendants ?? {})) {
      if (!isObj(d)) continue
      if (typeof d.type === "string") this.collect(d as PenNode, self)
      else for (const c of (d as PenNode).children ?? []) this.collect(c, self)
    }
  }

  /**
   * The Kimo key of `.pen` override path `segs`. A replacement or slot node a ref authors in
   * its own `descendants` is reached in `.pen` by crossing that ref, but in Kimo it is an
   * instance-owned node, which sits in the ref's own scope: that crossing is dropped.
   */
  private kimoPath(segs: readonly string[]): string {
    const out: string[] = []
    segs.forEach((s, i) => {
      const next = segs[i + 1]
      if (next === undefined || this.owners.get(next) !== s) out.push(this.kid(s))
    })
    return out.join("/")
  }

  /** Kimo id of a `.pen` id (stable for the whole import). */
  private kid(penId: string | undefined): string {
    if (typeof penId !== "string" || penId === "") return this.fresh("n")
    const known = this.ids.get(penId)
    if (known) return known
    let id = penId
    if (!ID_RE.test(id) || this.used.has(id)) {
      const base = penId.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || "n"
      id = base.padEnd(6, "0")
      for (let i = 0; !ID_RE.test(id) || this.used.has(id) || this.byIdClash(id, penId); i++)
        id = `${base}${penOrderKey(i)}`.padEnd(6, "0").slice(0, 24)
    }
    this.ids.set(penId, id)
    this.used.add(id)
    return id
  }

  /** True when `id` is some other `.pen` node's own (valid) id, which it must keep. */
  private byIdClash(id: string, penId: string): boolean {
    return id !== penId && this.byId.has(id) && ID_RE.test(id)
  }

  private fresh(prefix: string): string {
    for (let i = 0; ; i++) {
      const id = `${prefix}${penOrderKey(i)}`.padEnd(6, "0")
      if (!this.used.has(id) && !this.byId.has(id)) {
        this.used.add(id)
        return id
      }
    }
  }

  // --- Variables --------------------------------------------------------------------------------

  private registerVariables(): void {
    const names = Object.keys(this.pen.variables ?? {})
    // Valid names keep theirs; a renamed one never takes a name already in use ("a b" next to "a-b").
    const taken = new Set(names.filter((n) => VAR_RE.test(n)))
    for (const name of names) {
      let k = name
      if (!VAR_RE.test(k)) {
        const base =
          name
            .replace(/^\$+/, "")
            .replace(/[\s:]+/g, "-")
            .slice(0, 120) || "var"
        k = base
        for (let i = 2; taken.has(k); i++) k = `${base}-${i}`
        taken.add(k)
        this.warn("VARIABLE_RENAMED", `Variable "${name}" renamed to "${k}"`)
      }
      this.varNames.set(name, k)
    }
  }

  /** A binding for `"$name"`, or undefined (with a warning) when the variable does not exist. */
  private ref(v: string, quiet = false, type?: string): { $ref: string } | undefined {
    const name = this.varNames.get(v.slice(1))
    if (name && (!type || this.pen.variables?.[v.slice(1)]?.type === type)) return { $ref: name }
    if (!quiet) this.warn("VARIABLE_MISSING", `Variable "${v.slice(1)}" is not defined`)
    return undefined
  }

  /** The literal value of `v`, following `"$name"` through the default theme. */
  private lit(v: unknown, depth = 0): unknown {
    if (!isVarRef(v) || depth > 16) return v
    const variable = this.pen.variables?.[v.slice(1)]
    if (!variable) return undefined
    let value = variable.value
    if (Array.isArray(value)) {
      const entries = value as PenThemedValue[]
      const hit = entries.find(
        (e) =>
          isObj(e) &&
          isObj(e.theme) &&
          Object.entries(e.theme).every(([a, x]) => this.defaultTheme[a] === x),
      )
      value = (hit ?? entries[0])?.value
    }
    return this.lit(value, depth + 1)
  }

  private litNum(v: unknown, fallback: number): number {
    const x = this.lit(v)
    return typeof x === "number" && Number.isFinite(x) ? x : fallback
  }

  private litBool(v: unknown, fallback: boolean): boolean {
    const x = this.lit(v)
    return typeof x === "boolean" ? x : fallback
  }

  /** A Num field: number or binding. */
  private num(v: unknown, min?: number): unknown {
    if (isVarRef(v)) return this.ref(v)
    if (typeof v !== "number" || !Number.isFinite(v)) return undefined
    return min !== undefined ? Math.max(min, v) : v
  }

  private bool(v: unknown): unknown {
    if (isVarRef(v)) return this.ref(v)
    return typeof v === "boolean" ? v : undefined
  }

  /** A string field: a binding when `"$name"` names a variable, else the literal text. */
  private str(v: unknown): unknown {
    if (isVarRef(v)) return this.ref(v, true, "string") ?? v
    return typeof v === "string" ? v : undefined
  }

  private color(v: unknown): unknown {
    if (isVarRef(v)) return this.ref(v)
    if (typeof v !== "string") return undefined
    let c = v.trim()
    if (/^#[0-9A-Fa-f]{4}$/.test(c)) c = `#${[...c.slice(1)].map((d) => d + d).join("")}`
    if (HEX_RE.test(c)) return c
    this.warn("VALUE_INVALID", `Color "${v}" is not a hex color`)
    return undefined
  }

  private themes(): Obj | undefined {
    const out: Obj = {}
    for (const [axis, values] of Object.entries(this.pen.themes ?? {}))
      if (Array.isArray(values) && values.length) out[axis] = [...new Set(values.map(String))]
    return Object.keys(out).length ? out : undefined
  }

  private variables(): Obj | undefined {
    const out: Obj = {}
    for (const [name, v] of Object.entries(this.pen.variables ?? {})) {
      if (!isObj(v) || !["color", "number", "string", "boolean"].includes(String(v.type))) {
        this.warn("VALUE_INVALID", `Variable "${name}" has an unsupported type`)
        continue
      }
      const type = v.type as string
      const one = (x: unknown): unknown => {
        if (isVarRef(x)) return this.ref(x)
        if (type === "color") return this.color(x)
        if (type === "number") return typeof x === "number" ? x : undefined
        if (type === "boolean") return typeof x === "boolean" ? x : undefined
        return typeof x === "string" ? x : undefined
      }
      let value: unknown
      if (Array.isArray(v.value)) {
        const entries = (v.value as PenThemedValue[])
          .filter(isObj)
          .map((e) => {
            const val = one(e.value)
            if (val === undefined) return undefined
            const when = isObj(e.theme) && Object.keys(e.theme).length ? { ...e.theme } : undefined
            return compact({ value: val, when })
          })
          .filter((e) => e !== undefined)
        value = entries.length ? entries : undefined
      } else value = one(v.value)
      if (value === undefined) {
        this.warn("VALUE_INVALID", `Variable "${name}" has no usable value`)
        continue
      }
      out[this.varNames.get(name) ?? name] = { type, value }
    }
    return Object.keys(out).length ? out : undefined
  }

  // --- Sizes, paints, strokes, effects ----------------------------------------------------------

  private size(v: unknown): unknown {
    if (typeof v === "number") return Number.isFinite(v) ? Math.max(0, v) : undefined
    if (isVarRef(v)) return this.ref(v)
    if (typeof v !== "string") return undefined
    const m = /^(fill_container|fit_content)(?:\(\s*(-?[\d.]+)\s*\))?$/.exec(v.trim())
    if (!m) {
      this.warn("VALUE_INVALID", `Size "${v}" is not supported`)
      return undefined
    }
    const fallback = m[2] !== undefined ? Math.max(0, Number(m[2])) : undefined
    return compact({ mode: m[1] === "fill_container" ? "fill" : "fit", fallback })
  }

  private paints(v: unknown, node: PenNode): unknown {
    if (v === undefined || v === null) return undefined
    if (Array.isArray(v)) return v.map((f) => this.paint(f, node)).filter((p) => p !== undefined)
    return this.paint(v, node)
  }

  private paint(f: unknown, node: PenNode): unknown {
    if (typeof f === "string") return this.color(f)
    if (!isObj(f)) return undefined
    const visible = f.enabled === undefined ? undefined : this.litBool(f.enabled, true)
    const blend = typeof f.blendMode === "string" ? BLEND[f.blendMode] : undefined
    const opacity = f.opacity === undefined ? undefined : this.num(f.opacity)
    const off = visible === false ? false : undefined
    switch (f.type) {
      case "color": {
        const color = this.color(f.color)
        return color === undefined
          ? undefined
          : compact({ kind: "solid", color, blend, visible: off })
      }
      case "gradient": {
        const stops = list(f.colors)
          .filter(isObj)
          .map((s) => ({
            color: this.color(s.color),
            at: Math.min(1, Math.max(0, this.litNum(s.position, 0))),
          }))
          .filter((s) => s.color !== undefined)
        if (stops.length === 0) return undefined
        const first = stops[0]
        if (stops.length === 1 && first) stops.push({ ...first })
        const c = isObj(f.center) ? f.center : undefined
        const s = isObj(f.size) ? f.size : undefined
        return compact({
          kind: typeof f.gradientType === "string" ? f.gradientType : "linear",
          stops,
          center: c ? [this.litNum(c.x, 0.5), this.litNum(c.y, 0.5)] : undefined,
          size: s ? [this.litNum(s.width, 1), this.litNum(s.height, 1)] : undefined,
          rotation: f.rotation === undefined ? undefined : this.litNum(f.rotation, 0),
          opacity,
          blend,
          visible: off,
        })
      }
      case "image": {
        const url = typeof f.url === "string" ? f.url : ""
        const images = this.options.images
        const mapped = images instanceof Map ? images.get(url) : (images as Obj | undefined)?.[url]
        let src = typeof mapped === "string" ? mapped : undefined
        if (!src) {
          this.warn("IMAGE_MISSING", `Image "${url}" could not be loaded`, node.id)
          src = penImagePlaceholder(url)
        }
        let fit = f.mode === "contain" || f.mode === "stretch" ? f.mode : undefined
        let crop: number[] | undefined
        if (Array.isArray(f.transform) && f.transform.length === 6) {
          const inv = invertAffine(f.transform.map(Number))
          if (inv) {
            crop = inv
            if (fit !== "stretch")
              this.warn("PAINT_APPROXIMATED", "A cropped image fill is stretched to the node box")
            fit = "crop"
          }
        }
        return compact({ kind: "image", src, fit, crop, opacity, blend, visible: off })
      }
      case "mesh_gradient": {
        if (off === false) {
          this.warn("PAINT_DROPPED", "A disabled mesh gradient was dropped", node.id)
          return undefined
        }
        const colors = list(f.colors).map((c) => this.color(c))
        const cols =
          typeof f.columns === "number" ? f.columns : Math.round(Math.sqrt(colors.length))
        const rows = typeof f.rows === "number" ? f.rows : cols
        if (colors.some((c) => c === undefined) || colors.length !== cols * rows) {
          this.warn("PAINT_DROPPED", "A malformed mesh gradient was dropped", node.id)
          return undefined
        }
        const alpha = typeof opacity === "number" ? opacity : 1
        if ((blend && blend !== "normal") || isObj(opacity))
          this.warn("PAINT_APPROXIMATED", "Mesh gradient opacity or blend mode is not kept")
        return {
          kind: "mesh",
          cols,
          rows,
          colors: alpha < 1 ? colors.map((c) => withAlpha(c, alpha)) : colors,
          points: Array.isArray(f.points) ? f.points : [],
        }
      }
      case "shader": {
        if (off === false) {
          this.warn("PAINT_DROPPED", "A disabled shader fill was dropped", node.id)
          return undefined
        }
        const src = relativePath(f.url)
        if (!src) {
          this.warn("PAINT_DROPPED", `Shader "${String(f.url)}" is not a relative path`, node.id)
          return undefined
        }
        if (opacity !== undefined || (blend && blend !== "normal"))
          this.warn("PAINT_APPROXIMATED", "Shader fill opacity or blend mode is not kept")
        let uniforms: Obj | undefined
        if (isObj(f.uniforms)) {
          uniforms = {}
          for (const [k, u] of Object.entries(f.uniforms))
            uniforms[k] = isVarRef(u) ? this.ref(u) : u
          compact(uniforms)
        }
        return compact({ kind: "shader", src, uniforms })
      }
    }
    this.warn("PAINT_DROPPED", `Fill type "${String(f.type)}" is not supported`, node.id)
    return undefined
  }

  private stroke(n: PenNode): Obj | undefined {
    const paint = this.paints(n.stroke, n)
    if (paint === undefined) return undefined
    // `stroke: []` is an explicit "no stroke" (it matters as an instance override).
    if (Array.isArray(paint) && paint.length === 0)
      return Array.isArray(n.stroke) ? { paint } : undefined
    let width: unknown
    const w = n.strokeWidth
    if (isObj(w)) {
      width = compact({
        t: this.num(w.top, 0),
        r: this.num(w.right, 0),
        b: this.num(w.bottom, 0),
        l: this.num(w.left, 0),
      })
    } else width = this.num(w, 0)
    const align =
      n.strokeAlignment === "center"
        ? "center"
        : n.strokeAlignment === "outer"
          ? "outside"
          : n.strokeAlignment === "inner"
            ? "inside"
            : undefined
    return compact({
      paint,
      width,
      align,
      cap: typeof n.strokeLinecap === "string" ? n.strokeLinecap : undefined,
      join: typeof n.strokeLinejoin === "string" ? n.strokeLinejoin : undefined,
    })
  }

  private effects(v: unknown): unknown[] | undefined {
    if (v === undefined) return undefined
    const out: unknown[] = []
    for (const e of list(v)) {
      if (!isObj(e)) continue
      const visible =
        e.enabled === undefined ? undefined : this.litBool(e.enabled, true) ? undefined : false
      if (e.type === "shadow") {
        const o = isObj(e.offset) ? e.offset : {}
        out.push(
          compact({
            kind: "shadow",
            inner: e.shadowType === "inner" ? true : undefined,
            x: this.num(o.x) ?? 0,
            y: this.num(o.y) ?? 0,
            blur: this.num(e.blur, 0) ?? 0,
            spread: this.num(e.spread),
            color: this.color(e.color) ?? "#00000040",
            blend: typeof e.blendMode === "string" ? BLEND[e.blendMode] : undefined,
            visible,
          }),
        )
      } else if (e.type === "blur" || e.type === "background_blur") {
        out.push(
          compact({
            kind: e.type === "blur" ? "blur" : "backdrop-blur",
            radius: this.num(e.radius, 0) ?? 0,
            visible,
          }),
        )
      } else this.warn("VALUE_INVALID", `Effect type "${String(e.type)}" is not supported`)
    }
    return out
  }

  // --- Node bodies ------------------------------------------------------------------------------

  /** Placement fields shared by every node, instances included. */
  private placement(n: PenNode): Obj {
    const meta: Obj = {}
    if (typeof n.context === "string") meta["pen.context"] = n.context
    if (isObj(n.metadata)) meta["pen.metadata"] = n.metadata
    return compact({
      name: typeof n.name === "string" ? n.name : undefined,
      x: typeof n.x === "number" ? n.x : undefined,
      y: typeof n.y === "number" ? n.y : undefined,
      position: n.layoutPosition === "absolute" ? "absolute" : undefined,
      theme: isObj(n.theme) && Object.keys(n.theme).length ? { ...n.theme } : undefined,
      meta: Object.keys(meta).length ? meta : undefined,
    })
  }

  /** Base visual fields (every node type but instance). */
  private base(n: PenNode): Obj {
    return compact({
      ...this.placement(n),
      rotation: n.rotation === undefined ? undefined : this.litNum(n.rotation, 0),
      opacity: n.opacity === undefined ? undefined : this.num(n.opacity, 0),
      visible: n.enabled === undefined ? undefined : this.bool(n.enabled),
      flipX: n.flipX === undefined ? undefined : this.litBool(n.flipX, false),
      flipY: n.flipY === undefined ? undefined : this.litBool(n.flipY, false),
      component: n.reusable === true ? true : undefined,
      placeholder: n.placeholder === true ? true : undefined,
    })
  }

  private graphics(n: PenNode): Obj {
    return compact({
      fill: this.paints(n.fill, n),
      stroke: this.stroke(n),
      effects: this.effects(n.effect),
    })
  }

  private radius(v: unknown): unknown {
    if (Array.isArray(v) && v.length === 4) return v.map((r) => this.num(r, 0) ?? 0)
    return this.num(v, 0)
  }

  private textStyle(n: PenNode): Obj | undefined {
    let weight: unknown
    const fw = n.fontWeight
    if (isVarRef(fw)) {
      const lit = this.lit(fw)
      weight = typeof lit === "number" ? this.ref(fw) : fontWeight(lit)
    } else weight = fontWeight(fw)
    const fs = this.lit(n.fontStyle)
    const decoration = [
      this.litBool(n.underline, false) ? "underline" : undefined,
      this.litBool(n.strikethrough, false) ? "strike" : undefined,
    ].filter((d) => d !== undefined)
    const style = compact({
      font: n.fontFamily === undefined ? undefined : this.str(n.fontFamily),
      size: this.num(n.fontSize, 0.01),
      weight,
      italic: fs === "italic" || fs === "oblique" ? true : undefined,
      lineHeight: this.num(n.lineHeight, 0),
      letterSpacing: this.num(n.letterSpacing),
      align: typeof n.textAlign === "string" ? n.textAlign : undefined,
      valign: typeof n.textAlignVertical === "string" ? n.textAlignVertical : undefined,
      decoration: decoration.length ? decoration : undefined,
      href: typeof n.href === "string" ? n.href : undefined,
    })
    return Object.keys(style).length ? style : undefined
  }

  /** Kimo node fields of a non-`ref` `.pen` node (no `parent`, `order`, children). */
  private body(n: PenNode): Obj {
    const t = n.type
    switch (t) {
      case "frame": {
        const dir = n.layout === "none" ? null : n.layout === "vertical" ? "column" : "row"
        const layout = dir
          ? compact({
              dir,
              gap: this.num(n.gap),
              pad: this.padding(n.padding),
              justify: justify(n.justifyContent),
              align: typeof n.alignItems === "string" ? n.alignItems : undefined,
              includeStroke: n.layoutIncludeStroke === true ? true : undefined,
            })
          : undefined
        let slot: Obj | undefined
        if (Array.isArray(n.slot)) {
          const suggested = n.slot.filter((s) => typeof s === "string").map((s) => this.kid(s))
          slot = suggested.length ? { suggested } : {}
        }
        return compact({
          type: "frame",
          ...this.base(n),
          ...this.graphics(n),
          w: this.size(n.width),
          h: this.size(n.height),
          radius: this.radius(n.cornerRadius),
          clip: n.clip === undefined ? undefined : this.bool(n.clip),
          layout,
          slot,
        })
      }
      case "group":
        return compact({ type: "group", ...this.base(n), effects: this.effects(n.effect) })
      case "rectangle":
        return compact({
          type: "rect",
          ...this.base(n),
          ...this.graphics(n),
          w: this.size(n.width) ?? 0,
          h: this.size(n.height) ?? 0,
          radius: this.radius(n.cornerRadius),
        })
      case "ellipse": {
        const inner = n.innerRadius === undefined ? undefined : this.litNum(n.innerRadius, 0)
        return compact({
          type: "ellipse",
          ...this.base(n),
          ...this.graphics(n),
          w: this.size(n.width) ?? 0,
          h: this.size(n.height) ?? 0,
          innerRadius: inner === undefined ? undefined : Math.min(0.999, Math.max(0, inner)),
          startAngle: n.startAngle === undefined ? undefined : this.litNum(n.startAngle, 0),
          sweepAngle:
            n.sweepAngle === undefined
              ? undefined
              : Math.min(360, Math.max(-360, this.litNum(n.sweepAngle, 360))),
        })
      }
      case "polygon":
        return compact({
          type: "polygon",
          ...this.base(n),
          ...this.graphics(n),
          w: this.size(n.width) ?? 0,
          h: this.size(n.height) ?? 0,
          sides: Math.max(3, Math.round(this.litNum(n.polygonCount, 3))),
          radius: this.num(n.cornerRadius, 0),
        })
      case "path":
        return compact({
          type: "path",
          ...this.base(n),
          ...this.graphics(n),
          w: this.size(n.width),
          h: this.size(n.height),
          d: typeof n.geometry === "string" && n.geometry.trim() ? n.geometry : "M0 0",
          fillRule: n.fillRule === "evenodd" ? "evenodd" : undefined,
          viewBox:
            Array.isArray(n.viewBox) && n.viewBox.length === 4
              ? n.viewBox.map((x, i) => (i >= 2 ? Math.max(0, Number(x) || 0) : Number(x) || 0))
              : undefined,
        })
      case "text": {
        const growth = n.textGrowth
        const grow =
          growth === "fixed-width"
            ? "fixed-width"
            : growth === "fixed-width-height"
              ? "fixed"
              : undefined
        const content = this.str(n.content) ?? ""
        const g = this.graphics(n)
        return compact({
          type: "text",
          ...this.base(n),
          ...g,
          // `.pen` text has no fill by default (invisible); Kimo's default is text/default.
          fill: g.fill ?? [],
          w: grow ? this.size(n.width) : undefined,
          h: grow === "fixed" ? this.size(n.height) : undefined,
          content,
          grow,
          style: this.textStyle(n),
        })
      }
      case "icon": {
        const lib = this.lit(n.library)
        const set = typeof lib === "string" ? (ICON_SETS[lib] ?? lib) : "lucide"
        return compact({
          type: "icon",
          ...this.base(n),
          w: this.size(n.width) ?? 24,
          h: this.size(n.height) ?? 24,
          set,
          icon: this.str(n.icon) ?? "",
          weight: this.num(n.weight),
          color: this.iconColor(n),
          effects: this.effects(n.effect),
        })
      }
      case "note":
      case "prompt":
      case "context": {
        const content = this.lit(n.content)
        const body: Obj = compact({
          type: t === "prompt" ? "prompt" : "note",
          ...this.base(n),
          w: this.size(n.width),
          h: this.size(n.height),
          content: typeof content === "string" ? content : "",
          style: this.textStyle(n),
          model:
            t === "prompt" && typeof this.lit(n.model) === "string" ? this.lit(n.model) : undefined,
        })
        if (t === "context")
          body.meta = { ...(body.meta as Obj | undefined), "pen.type": "context" }
        return body
      }
      case "script": {
        const src = relativePath(n.scriptUri)
        if (!src) break
        let inputs: Obj | undefined
        if (isObj(n.inputs)) {
          inputs = {}
          for (const [k, u] of Object.entries(n.inputs)) inputs[k] = isVarRef(u) ? this.ref(u) : u
          compact(inputs)
        }
        return compact({
          type: "script",
          ...this.base(n),
          w: this.size(n.width) ?? 100,
          h: this.size(n.height) ?? 100,
          src,
          inputs,
          clip: n.clip === undefined ? undefined : this.bool(n.clip),
        })
      }
      case "browser":
        return compact({
          type: "browser",
          ...this.base(n),
          w: this.size(n.width) ?? 1280,
          h: this.size(n.height) ?? 800,
          url: typeof n.url === "string" && n.url ? n.url : "about:blank",
          device: typeof n.deviceId === "string" && n.deviceId ? n.deviceId : undefined,
          zoom: typeof n.zoom === "number" && n.zoom > 0 ? n.zoom : undefined,
          scrollX: typeof n.scrollX === "number" ? n.scrollX : undefined,
          scrollY: typeof n.scrollY === "number" ? n.scrollY : undefined,
          radius: this.radius(n.cornerRadius),
          stroke: this.stroke(n),
          effects: this.effects(n.effect),
        })
    }
    this.warn(
      "VALUE_INVALID",
      `Node type "${String(t)}" is not supported; kept as an empty frame`,
      n.id,
    )
    return compact({
      type: "frame",
      ...this.base(n),
      w: this.size(n.width),
      h: this.size(n.height),
    })
  }

  private padding(v: unknown): unknown {
    if (Array.isArray(v) && (v.length === 2 || v.length === 4))
      return v.map((p) => this.num(p, 0) ?? 0)
    if (Array.isArray(v) && v.length === 1) return this.num(v[0], 0)
    return this.num(v, 0)
  }

  private iconColor(n: PenNode): unknown {
    for (const f of list(n.fill).reverse()) {
      if (typeof f === "string") return this.color(f)
      if (isObj(f) && f.type === "color") return this.color(f.color)
      if (isObj(f)) {
        this.warn(
          "PAINT_APPROXIMATED",
          "Icons take one solid color; a gradient icon fill was dropped",
        )
        return undefined
      }
    }
    return undefined
  }

  // --- Components and instances -----------------------------------------------------------------

  /** `.pen` keys of `n` that style the node (what an instance carries over its component root). */
  private visual(n: PenNode): PenNode {
    const out: PenNode = {}
    for (const [k, v] of Object.entries(n)) if (!PEN_NON_VISUAL.has(k)) out[k] = v
    return out
  }

  /** The effective root of component `penId` (derived components merged onto their base). */
  private root(penId: string, depth = 0): PenNode | undefined {
    const n = this.byId.get(penId)
    if (!n || depth > 32) return undefined
    if (n.type !== "ref") return n
    const base = this.root(String(n.ref), depth + 1)
    return base ? merge(base, this.visual(n)) : undefined
  }

  /**
   * The `.pen` node at id path `segs` inside component `c`, as an instance of `c` sees it before
   * its own overrides: derived components' and nested instances' overrides merged in.
   */
  private eff(c: string, segs: string[], depth = 0): PenNode | undefined {
    const key = `${c}|${segs.join("/")}`
    if (this.effMemo.has(key)) return this.effMemo.get(key)
    this.effMemo.set(key, undefined)
    const n = this.byId.get(c)
    let out: PenNode | undefined
    if (n && depth < 32) {
      if (segs.length === 1) {
        out =
          n.type === "ref" ? this.eff(String(n.ref), segs, depth + 1) : this.byId.get(segs[0] ?? "")
      } else {
        const r = this.eff(c, [segs[0] ?? ""], depth + 1)
        out =
          r?.type === "ref"
            ? override(
                this.eff(String(r.ref), segs.slice(1), depth + 1),
                r.descendants?.[segs.slice(1).join("/")],
              )
            : undefined
      }
      if (n.type === "ref") out = override(out, n.descendants?.[segs.join("/")])
    }
    this.effMemo.set(key, out)
    return out
  }

  /**
   * Kimo `props` of an instance (or nested instance) `r`: its root diff over the component root,
   * plus the keys in `keep` (taken from `r`'s converted root) even when they equal the root's.
   */
  private rootProps(r: PenNode, keep: readonly string[] = []): Obj | undefined {
    const base = this.root(String(r.ref))
    if (!base) return undefined
    const vis = this.visual(r)
    if (Object.keys(vis).length === 0 && keep.length === 0) return undefined
    const next = this.body(merge(base, vis))
    const out = this.diff(next, this.body(base), PROPS_FORBIDDEN, r.id) ?? {}
    for (const k of keep) if (next[k] !== undefined) out[k] = next[k]
    return Object.keys(out).length ? out : undefined
  }

  /** The keys of `next` that differ from `prev`, minus `forbidden`. */
  private diff(
    next: Obj,
    prev: Obj,
    forbidden: ReadonlySet<string>,
    node?: string,
  ): Obj | undefined {
    const out: Obj = {}
    for (const [k, v] of Object.entries(next))
      if (!forbidden.has(k) && !same(v, prev[k])) out[k] = v
    for (const k of Object.keys(prev))
      if (!forbidden.has(k) && next[k] === undefined && k !== "w" && k !== "h")
        this.warn("OVERRIDE_UNSET", `An override that removes "${k}" is not kept`, node)
    return Object.keys(out).length ? out : undefined
  }

  private instance(n: PenNode): Obj {
    const of = this.kid(String(n.ref))
    if (!this.byId.has(String(n.ref)))
      this.warn("ID_UNKNOWN", `Instance of a missing component "${String(n.ref)}"`, n.id)
    return compact({
      type: "instance",
      ...this.placement(n),
      component: n.reusable === true ? true : undefined,
      of,
      props: this.rootProps(n),
    })
  }

  /** Converts `n.descendants` of instance `n` (Kimo id `id`) into overrides and owned nodes. */
  private overrides(n: PenNode, id: string): Obj | undefined {
    const out: Obj = {}
    const comp = String(n.ref)
    let order = 0
    const entries = Object.entries(n.descendants ?? {}).filter(([, v]) => isObj(v))
    for (let i = 0; i < entries.length; i++) {
      const [path, ov] = entries[i] as [string, PenNode]
      const segs = path.split("/")
      if (segs.some((s) => !this.byId.has(s))) {
        this.warn("OVERRIDE_UNRESOLVED", `Override path "${path}" names a missing node`, n.id)
        continue
      }
      const at = this.kimoPath(segs)
      const base = this.eff(comp, segs)
      if (!base) {
        this.warn("OVERRIDE_UNRESOLVED", `Override path "${path}" does not resolve`, n.id)
        continue
      }
      if (typeof ov.type === "string") {
        this.convertTree(ov, id, at, penOrderKey(order++))
        out[at] = { replace: true }
        continue
      }
      if (Array.isArray(ov.children)) {
        const { children, ...rest } = ov
        if (base.type === "frame" && Array.isArray(base.slot) && Object.keys(rest).length === 0) {
          for (const c of children) if (isObj(c)) this.convertTree(c, id, at, penOrderKey(order++))
          out[at] = { slot: true }
        } else {
          // A nested instance given children becomes a ref with its own children (see
          // `detach`); its old overrides address the component content those children replace.
          const replacement: PenNode = {
            ...merge({ ...base, descendants: undefined }, rest),
            id: undefined,
            children,
          }
          this.convertTree(replacement, id, at, penOrderKey(order++))
          out[at] = { replace: true }
        }
        continue
      }
      let set: Obj | undefined
      if (base.type === "ref" && !Array.isArray(base.children)) {
        const { descendants, ...own } = ov
        // Nested overrides of the nested instance continue as deeper paths of this instance.
        for (const [k, v] of Object.entries(descendants ?? {})) entries.push([`${path}/${k}`, v])
        set = this.instanceSet(base, merge(base, own))
      } else if (base.type === "ref") {
        // A ref with its own children is a plain node here (see `detach`), and its nested
        // overrides address those children, which sit in this same scope.
        const { descendants, ...own } = ov
        const scope = segs.slice(0, -1).join("/")
        for (const [k, v] of Object.entries(descendants ?? {}))
          entries.push([scope ? `${scope}/${k}` : k, v])
        const prev = this.body(this.detach(base))
        set = this.diff(this.body(this.detach(merge(base, own))), prev, SET_FORBIDDEN, n.id)
      } else {
        set = this.diff(this.body(merge(base, ov)), this.body(base), SET_FORBIDDEN, n.id)
      }
      if (set) out[at] = { set }
    }
    return Object.keys(out).length ? out : undefined
  }

  /** A `set` for nested instance `prev` becoming `next` (`of`, placement, `props`). */
  private instanceSet(prev: PenNode, next: PenNode): Obj | undefined {
    const out: Obj = {}
    if (next.ref !== prev.ref) out.of = this.kid(String(next.ref))
    const pp = this.placement(prev)
    const np = this.placement(next)
    for (const k of ["name", "x", "y", "position", "theme"])
      if (!same(np[k], pp[k]) && np[k] !== undefined) out[k] = np[k]
    // `set.props` replaces the nested instance's props wholesale: keep every key it had.
    const before = this.rootProps(prev)
    const props = this.rootProps(next, out.of === undefined ? Object.keys(before ?? {}) : [])
    if (out.of !== undefined || !same(props, before)) {
      if (props) out.props = props
      else
        this.warn(
          "OVERRIDE_UNSET",
          "An override that resets a nested instance is not kept",
          prev.id,
        )
    }
    return Object.keys(out).length ? out : undefined
  }

  /**
   * A `ref` that has its own `children` as a plain `.pen` node. Those children replace the
   * component's, which a Kimo instance cannot say (no override targets the root), so the ref
   * becomes a node of the component root's type with the ref's props merged over the root's.
   * The children are authored in the ref's scope: `.pen` override paths reach them without
   * crossing an instance boundary, so the same paths resolve in Kimo once the ref is a node.
   */
  private detach(n: PenNode): PenNode {
    const base = this.root(String(n.ref))
    const out: PenNode = { ...this.visual(base ?? {}), ...this.visual(n) }
    out.type = base?.type ?? "frame"
    out.id = n.id
    out.name = n.name ?? base?.name
    // Placement is the ref's own, never the component's (its canvas position, `reusable`).
    for (const k of ["x", "y", "layoutPosition", "reusable", "context", "metadata"])
      if (n[k] !== undefined) out[k] = n[k]
    const pins = base?.theme
    const theme = { ...(isObj(pins) ? pins : {}), ...(isObj(n.theme) ? n.theme : {}) }
    if (Object.keys(theme).length) out.theme = theme
    return compact(out)
  }

  /**
   * `children` with the `descendants` of the ref that owns them applied (same scope): a single
   * id overrides that node, a deeper path goes to the nested instance its first segment names.
   */
  private applyDescendants(
    children: PenNode[],
    descendants: PenNode["descendants"],
    owner?: string,
  ): PenNode[] {
    const own = new Map<string, PenNode>()
    const deeper = new Map<string, Record<string, PenNode>>()
    for (const [path, ov] of Object.entries(descendants ?? {})) {
      if (!isObj(ov)) continue
      const [head = "", ...rest] = path.split("/")
      if (rest.length === 0) own.set(head, ov)
      else deeper.set(head, { ...deeper.get(head), [rest.join("/")]: ov })
    }
    if (own.size === 0 && deeper.size === 0) return children
    const used = new Set<string>()
    const visit = (c: PenNode): PenNode => {
      if (!isObj(c)) return c
      const id = typeof c.id === "string" ? c.id : ""
      let out = override(c, own.get(id)) ?? c
      const nested = deeper.get(id)
      if (nested && out.type === "ref") out = merge(out, { descendants: nested })
      if (own.has(id) || (nested && out.type === "ref")) used.add(id)
      return Array.isArray(out.children) ? { ...out, children: out.children.map(visit) } : out
    }
    const result = children.map(visit)
    for (const head of [...own.keys(), ...deeper.keys()])
      if (!used.has(head))
        this.warn("OVERRIDE_UNRESOLVED", `Override path "${head}" names a missing node`, owner)
    return result
  }

  /** Converts `n` and its subtree into Kimo nodes under `parent`. */
  private convertTree(
    n: PenNode,
    parent: string | null,
    at: string | undefined,
    order: string,
  ): void {
    if (n.type === "ref" && Array.isArray(n.children)) {
      if (this.byId.has(String(n.ref)))
        this.warn("INSTANCE_DETACHED", "An instance with its own layers became a frame", n.id)
      else this.warn("ID_UNKNOWN", `Instance of a missing component "${String(n.ref)}"`, n.id)
      n = { ...this.detach(n), children: this.applyDescendants(n.children, n.descendants, n.id) }
    }
    const id = typeof n.id === "string" && n.id ? this.kid(n.id) : this.fresh("r")
    let node: Obj
    if (n.type === "ref") {
      node = this.instance(n)
    } else node = this.body(n)
    node.parent = parent
    if (at !== undefined) node.at = at
    node.order = order
    this.nodes[id] = node
    if (n.type === "ref") {
      const overrides = this.overrides(n, id)
      if (overrides) node.overrides = overrides
      return
    }
    const children = (n.children ?? []).filter(isObj)
    if (children.length && !CONTAINERS.has(String(node.type))) {
      this.warn("VALUE_INVALID", `Children of a ${String(node.type)} are dropped`, n.id)
      return
    }
    children.forEach((c, i) => {
      this.convertTree(c, id, undefined, penOrderKey(i))
    })
  }
}

// --- Small pure helpers -----------------------------------------------------------------------

/** `.pen`-side merge of an override onto a node: shallow, `descendants` merged per path. */
function merge(a: PenNode, b: PenNode): PenNode {
  const out: PenNode = { ...a, ...b }
  if (a.type !== undefined) out.type = a.type
  if (a.id !== undefined) out.id = a.id
  if (isObj(a.descendants) && isObj(b.descendants)) {
    const d: Record<string, PenNode> = { ...a.descendants }
    for (const [k, v] of Object.entries(b.descendants))
      d[k] = isObj(v) && typeof v.type !== "string" && isObj(d[k]) ? merge(d[k], v) : v
    out.descendants = d
  }
  return out
}

/** Applies one `descendants` value: a replacement (with `type`) or a property merge. */
function override(base: PenNode | undefined, ov: PenNode | undefined): PenNode | undefined {
  if (!isObj(ov)) return base
  if (typeof ov.type === "string") return ov
  return base ? merge(base, ov) : undefined
}

function justify(v: unknown): string | undefined {
  switch (v) {
    case "center":
    case "end":
    case "start":
      return v
    case "space_between":
      return "between"
    case "space_around":
      return "around"
    case "space_evenly":
      return "evenly"
  }
  return undefined
}

function fontWeight(v: unknown): number | undefined {
  if (typeof v === "number") return Math.min(1000, Math.max(1, v))
  if (typeof v !== "string") return undefined
  const n = Number(v)
  if (Number.isFinite(n) && v.trim() !== "") return Math.min(1000, Math.max(1, n))
  return FONT_WEIGHTS[v.toLowerCase().replace(/[\s_-]/g, "")]
}

/** `./x` form of a `.pen` relative URL, or null for an absolute URL or path. */
function relativePath(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null
  const u = url.trim().replace(/\\/g, "/")
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("/")) return null
  const rel = u.startsWith("./") || u.startsWith("../") ? u : `./${u}`
  return /\s/.test(rel) || rel.endsWith("/") ? null : rel.replace(/\/{2,}/g, "/")
}

/**
 * The stand-in asset reference an image fill gets when its URL could not be stored (it renders
 * as missing). A host that can load the image later swaps it for the stored asset.
 */
export function penImagePlaceholder(url: string): string {
  return `./assets/${placeholderHash(url)}.png`
}

function placeholderHash(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
}

function invertAffine(m: number[]): number[] | null {
  const [a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0] = m
  const det = a * d - b * c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const ia = d / det
  const ib = -b / det
  const ic = -c / det
  const id = a / det
  return [ia, ib, ic, id, -(ia * tx + ic * ty), -(ib * tx + id * ty)]
}

function withAlpha(c: unknown, alpha: number): unknown {
  if (typeof c !== "string" || !c.startsWith("#")) return c
  const hex = c.length === 4 ? `#${[...c.slice(1)].map((d) => d + d).join("")}` : c
  const base = hex.slice(0, 7)
  const a = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1
  const out = Math.round(Math.min(1, Math.max(0, a * alpha)) * 255)
  return `${base}${out.toString(16).padStart(2, "0").toUpperCase()}`
}
