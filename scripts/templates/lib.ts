/**
 * Template authoring kit (see README.md next to this file). A template is a module exporting
 * `template: Template`; its `build(b)` describes tokens, components and pages through the
 * `TemplateBuilder` below, which turns them into typed `@kimo/editor-state` ops. The build
 * script (`scripts/build-templates.ts`) applies them to a `DocStore`, writes the canonical
 * `.kimo`, validates it strictly, runs the design check and renders the PNGs.
 *
 * Everything here is deterministic: ids come from keys (`b.id("BtnLabel")`) or a per-template
 * counter, order keys are generated without jitter, so a rebuild is byte-identical.
 */
import type { Libraries } from "../../packages/core-schema/src/index"
import {
  createDocStore,
  createEmptyDocument,
  type DocStore,
  type Op,
} from "../../packages/editor-state/src/index"

export type Category =
  | "Website"
  | "Web app"
  | "Mobile"
  | "eCommerce"
  | "Dashboard"
  | "Design system"
  | "Portfolio"
  | "Presentation"
  | "Other"

export interface Template {
  /** Folder and file name, kebab-case (`saas-marketing`). */
  slug: string
  /** Shown in the gallery ("Ledgerline marketing site"). */
  name: string
  category: Category
  /** One plain sentence (docs/style/writing.md). */
  description: string
  /** 2-letter id prefix, unique across templates (ids are `<prefix><key>`). */
  prefix: string
  build(b: TemplateBuilder): void
}

export type Body = Record<string, unknown>
export interface Ref {
  $ref: string
}
/** Content placed into an instance's slot: `parent` = the instance, `at` = the slot path. */
export interface SlotParent {
  inst: string
  at: string
}
export type Parent = string | SlotParent

export const ref = (name: string): Ref => ({ $ref: name })
/** Fill the parent's free space (main axis) or stretch (cross axis). */
export const FILL = { mode: "fill" } as const
export const fill = (weight: number) => ({ mode: "fill", weight }) as const
export const FIT = { mode: "fit" } as const

/** Layout shorthands accepted at the top level of `row` / `col` props. */
export interface Flex {
  gap?: number | Ref
  pad?: number | Ref | (number | Ref)[]
  align?: "start" | "center" | "end" | "stretch" | "baseline"
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly"
  wrap?: boolean
  crossGap?: number | Ref
}
const FLEX_KEYS = ["gap", "pad", "align", "justify", "wrap", "crossGap"] as const

/** Node props plus an optional deterministic `key` (the node id is `<prefix><key>`). */
export type Props = Body & { key?: string; name?: string }

export interface TokenDef {
  /** `name → light/dark pair or one value`; stored as `color/<name>` (axis `mode`). */
  colors?: Record<string, string | readonly [light: string, dark: string]>
  /** Full names (`space/4`, `radius/md`, `size/avatar`) → number. */
  numbers?: Record<string, number>
  /** `name → TextStyle` (Inter or JetBrains Mono, which render offline); stored as `type/<name>`. */
  type?: Record<string, Body>
  /** `name → shadow effect(s)`; stored as `shadow/<name>`. Shadow colors live here only. */
  shadows?: Record<string, Body | Body[]>
}

/** A declared component prop, with targets written as keys (resolved to ids). */
export type PropSpec =
  | { kind: "text"; key: string; default: string }
  | { kind: "boolean"; key: string; default: boolean }
  | { kind: "instance"; key: string; default: string }
  | { kind: "slot"; key: string }
  | { kind: "enum"; options: Record<string, Record<string, unknown>> }

/** Prop helpers: `p.text("BtnLabel", "Button")`, `p.variants({ primary: { "root.fill": … } })`. */
export const p = {
  text: (key: string, def: string): PropSpec => ({ kind: "text", key, default: def }),
  bool: (key: string, def = true): PropSpec => ({ kind: "boolean", key, default: def }),
  swap: (key: string, defaultComponent: string): PropSpec => ({
    kind: "instance",
    key,
    default: defaultComponent,
  }),
  slot: (key: string): PropSpec => ({ kind: "slot", key }),
  /**
   * An enum prop. Each option maps `"<key path>.<field>"` to a value, e.g.
   * `{ "root.fill": b.c("accent"), "BtnLabel.fill": b.c("on-accent"), "root.layout/pad": [8, 12] }`.
   * `root` names the component root. The first option should restate the main's own values.
   */
  variants: (options: Record<string, Record<string, unknown>>): PropSpec => ({
    kind: "enum",
    options,
  }),
}

export interface ComponentOptions {
  /** Id key of the root (the component id is `b.id(key)`). */
  key: string
  /** Section of the Components page it is shown in (default "Components"). */
  section?: string
  description?: string
  props?: Record<string, PropSpec>
  /** Root frame props (`layout` or the `row`/`col` shorthands via `dir`). */
  root: Body & Flex & { dir?: "row" | "column" }
}

export interface UseOptions {
  key?: string
  name?: string
  /** Declared props: text, boolean, enum option names, component ids for instance props. */
  args?: Record<string, unknown>
  /** Visual props of the root (`w`, `h`, `fill`, …). */
  props?: Body
  /** Property overrides by key path (`"BtnLabel"`, `"CardBtn/BtnLabel"`). */
  set?: Record<string, Body>
  /** Key paths to hide. */
  hide?: string[]
  /** Slot content by key path: the callback adds nodes to the slot. */
  slots?: Record<string, (into: SlotParent) => void>
}

interface PageRec {
  id: string
  name: string
  /** 0 Cover, 1 author pages (screens, flows), 2 Components, 3 Foundations. */
  rank: number
  x: number
  roots: string[]
}

export interface CoverOptions {
  /** Small line above the title (the category or the product's one-word kind). */
  eyebrow: string
  title: string
  description: string
  /** Builds the preview on the right (a column frame, fill width and height, 40 px padding). */
  preview: (area: string) => void
}

export interface BuiltPage {
  id: string
  name: string
  kind: "cover" | "screens" | "components" | "foundations"
  roots: string[]
}

export interface BuiltTemplate {
  store: DocStore
  pages: BuiltPage[]
  /** Screen frames (every root of a "screens" page), in page then left-to-right order. */
  screens: { id: string; name: string; page: string }[]
  /** The light `color/bg` value (preview backdrop). */
  backdrop: string
  /** Every text content string, for the writing-style scan. */
  copy: string[]
}

const SCREEN_GAP = 160
/** Tokens the kit itself uses (cover, Components and Foundations pages). */
export const REQUIRED_COLORS = ["bg", "surface", "ink", "muted", "border", "accent"] as const
export const REQUIRED_TYPE = ["display", "heading", "body", "label"] as const

export class TemplateBuilder {
  private readonly nodes: Op[] = []
  private readonly ids = new Set<string>()
  private readonly vars: Record<string, Body> = {}
  private readonly pagesList: PageRec[] = []
  private compBoard: string | null = null
  private readonly sections = new Map<string, string>()
  private counter = 0
  private themed = false
  private hasCover = false
  readonly copy: string[] = []

  constructor(readonly tpl: Template) {
    if (!/^[A-Za-z]{2}$/.test(tpl.prefix)) throw new Error(`${tpl.slug}: prefix must be 2 letters`)
  }

  // --- ids ---------------------------------------------------------------------------------

  /** The id a key maps to (`<prefix><key>`); the key is letters and digits only. */
  id(key: string): string {
    if (key === "root") throw new Error("`root` is only meaningful inside a component prop")
    if (!/^[A-Za-z0-9]+$/.test(key)) throw new Error(`${this.tpl.slug}: bad key "${key}"`)
    // Ids are 6–24 characters: short keys are padded with zeros.
    const id = `${this.tpl.prefix}${key}`.padEnd(6, "0")
    if (id.length > 24)
      throw new Error(`${this.tpl.slug}: key "${key}" gives id "${id}" (6–24 chars)`)
    return id
  }
  /** An IdPath from keys: `path("CardBtn", "BtnLabel")` → `<id>/<id>`. */
  path(...keys: string[]): string {
    return keys.map((k) => this.id(k)).join("/")
  }
  private keyPath(path: string): string {
    return path
      .split("/")
      .map((k) => this.id(k))
      .join("/")
  }
  private nextId(): string {
    this.counter += 1
    return `${this.tpl.prefix}${this.counter.toString(36).padStart(6, "0")}`
  }

  // --- tokens --------------------------------------------------------------------------------

  tokens(def: TokenDef): this {
    for (const [name, v] of Object.entries(def.colors ?? {})) {
      if (typeof v === "string")
        this.vars[`color/${name}`] = { type: "color", group: "color", value: v }
      else {
        this.themed = true
        this.vars[`color/${name}`] = {
          type: "color",
          group: "color",
          value: [
            { value: v[0], when: { mode: "light" } },
            { value: v[1], when: { mode: "dark" } },
          ],
        }
      }
    }
    for (const [name, v] of Object.entries(def.numbers ?? {}))
      this.vars[name] = { type: "number", group: name.split("/")[0], value: v }
    for (const [name, v] of Object.entries(def.type ?? {}))
      this.vars[`type/${name}`] = { type: "typography", group: "typography", value: v }
    for (const [name, v] of Object.entries(def.shadows ?? {}))
      this.vars[`shadow/${name}`] = { type: "shadow", group: "shadow", value: v }
    return this
  }
  private need(name: string): Ref {
    if (!this.vars[name]) throw new Error(`${this.tpl.slug}: unknown variable "${name}"`)
    return ref(name)
  }
  /** Color token `color/<name>`. */
  c(name: string): Ref {
    return this.need(`color/${name}`)
  }
  /** Number token by full name (`space/4`, `radius/md`). */
  n(name: string): Ref {
    return this.need(name)
  }
  /** Text style bound to `type/<name>`; `extra` overrides single fields (align, case, …). */
  ty(name: string, extra: Body = {}): Body {
    return { typography: this.need(`type/${name}`), ...extra }
  }
  /** Shadow token `shadow/<name>` (for `effects`). */
  shadow(name: string): Ref {
    return this.need(`shadow/${name}`)
  }
  /** The light (or only) value of `color/<name>`. */
  lightValue(name: string): string {
    return this.modeValue(name, 0)
  }
  private modeValue(name: string, i: 0 | 1): string {
    const v = this.vars[`color/${name}`]?.value
    if (typeof v === "string") return v
    if (Array.isArray(v)) return (v[i] as { value: string }).value
    throw new Error(`${this.tpl.slug}: unknown color "${name}"`)
  }

  // --- pages ---------------------------------------------------------------------------------

  private addPage(name: string, rank: number): PageRec {
    const rec: PageRec = {
      id: `${this.tpl.prefix}Page${this.pagesList.length + 1}`,
      name,
      rank,
      x: 0,
      roots: [],
    }
    this.pagesList.push(rec)
    return rec
  }
  /**
   * A category page for screens ("Screens", or "Desktop" / "Mobile"), listed after the Cover in
   * creation order. Components and Foundations are added by the kit.
   */
  page(name: string): string {
    return this.addPage(name, 1).id
  }
  private placeRoot(rec: PageRec, name: string, props: Body): string {
    const w = typeof props.w === "number" ? props.w : 1440
    const id = this.add(null, {
      type: "frame",
      name,
      ...this.flex({ dir: "column", ...props }),
      x: rec.x,
      y: 0,
      page: rec.id,
    })
    rec.x += w + SCREEN_GAP
    rec.roots.push(id)
    return id
  }
  /**
   * A screen frame on a screens page, placed right of the previous one (flow order). Desktop
   * screens are 1440 wide with a fitting height; mobile screens 390×844.
   */
  screen(page: string, name: string, props: Props & Flex & { dir?: "row" | "column" }): string {
    const rec = this.pagesList.find((pg) => pg.id === page && pg.rank === 1)
    if (!rec) throw new Error(`${this.tpl.slug}: ${page} is not a screens page`)
    return this.placeRoot(rec, name, props)
  }

  /** The Cover page: one 1440×900 frame with eyebrow, title, description and a preview. */
  cover(opts: CoverOptions): string {
    if (this.hasCover) throw new Error(`${this.tpl.slug}: one cover only`)
    this.hasCover = true
    const rec = this.addPage("Cover", 0)
    const frame = this.placeRoot(rec, "Cover", {
      key: "Cover",
      dir: "row",
      w: 1440,
      h: 900,
      clip: true,
      fill: this.c("bg"),
      gap: 72,
      pad: [96, 0, 96, 96],
      align: "center",
    })
    const texts = this.col(frame, "Intro", { w: 520, gap: 24 })
    this.text(
      texts,
      opts.eyebrow,
      this.ty("label", { case: "upper", letterSpacing: 1.2 }),
      this.c("accent"),
      {
        name: "Eyebrow",
      },
    )
    this.para(texts, opts.title, this.ty("display"), this.c("ink"), { name: "Title" })
    this.para(
      texts,
      opts.description,
      this.ty("body", { size: 20, lineHeight: 1.5 }),
      this.c("muted"),
      {
        name: "Description",
      },
    )
    const area = this.col(frame, "Preview", {
      w: FILL,
      h: FILL,
      radius: [24, 0, 0, 24],
      fill: this.c("surface"),
      stroke: { paint: this.c("border"), width: { t: 1, b: 1, l: 1 } },
      clip: true,
      pad: 40,
      gap: 24,
    })
    opts.preview(area)
    return frame
  }

  // --- nodes ---------------------------------------------------------------------------------

  /** Inserts a node (appended to its siblings) and returns its id. */
  add(parent: Parent | null, node: Props): string {
    const { key, ...rest } = node
    const id = key ? this.id(key) : this.nextId()
    if (this.ids.has(id)) throw new Error(`${this.tpl.slug}: duplicate id ${id}`)
    this.ids.add(id)
    const body: Body = { ...rest }
    let par: string | null
    if (parent && typeof parent === "object") {
      par = parent.inst
      body.at = parent.at
    } else par = parent
    if (body.type === "text" && typeof body.content === "string") this.copy.push(body.content)
    this.nodes.push({ op: "insert", id, parent: par, node: body as never })
    return id
  }
  private flex(props: Body & Flex & { dir?: "row" | "column" }): Body {
    const out: Body = {}
    const layout: Body = { ...((props.layout as Body) ?? {}) }
    for (const [k, v] of Object.entries(props)) {
      if (k === "dir") layout.dir = v
      else if ((FLEX_KEYS as readonly string[]).includes(k)) layout[k] = v
      else out[k] = v
    }
    if (layout.dir) out.layout = layout
    return out
  }
  /** A frame (no layout unless `layout` is given). */
  frame(parent: Parent, name: string, props: Props = {}): string {
    return this.add(parent, { type: "frame", name, ...props })
  }
  /** A frame with a row auto layout; `gap`/`pad`/`align`/`justify`/`wrap` go into `layout`. */
  row(parent: Parent, name: string, props: Props & Flex = {}): string {
    return this.add(parent, { type: "frame", name, ...this.flex({ dir: "row", ...props }) })
  }
  /** A frame with a column auto layout. */
  col(parent: Parent, name: string, props: Props & Flex = {}): string {
    return this.add(parent, { type: "frame", name, ...this.flex({ dir: "column", ...props }) })
  }
  /** One line (or hand-broken lines) of text, sized to its content. */
  text(parent: Parent, content: string, style: Body, fill: Ref, props: Props = {}): string {
    return this.add(parent, {
      type: "text",
      name: props.name ?? (content.length > 40 ? `${content.slice(0, 39)}…` : content),
      content,
      style,
      fill,
      ...props,
    })
  }
  /** Wrapping text that fills the parent's width (`w` fill, grow fixed-width). */
  para(parent: Parent, content: string, style: Body, fill: Ref, props: Props = {}): string {
    return this.text(parent, content, style, fill, { w: FILL, grow: "fixed-width", ...props })
  }
  /** A lucide icon. */
  icon(parent: Parent, icon: string, size: number, color: Ref, props: Props = {}): string {
    return this.add(parent, {
      type: "icon",
      name: `Icon/${icon}`,
      set: "lucide",
      icon,
      w: size,
      h: size,
      color,
      ...props,
    })
  }
  rect(parent: Parent, name: string, props: Props): string {
    return this.add(parent, { type: "rect", name, ...props })
  }
  ellipse(parent: Parent, name: string, props: Props): string {
    return this.add(parent, { type: "ellipse", name, ...props })
  }
  /** A 1 px line: horizontal (fills the width) or vertical (fills the height). */
  divider(parent: Parent, color: Ref, vertical = false): string {
    return this.rect(
      parent,
      "Divider",
      vertical ? { w: 1, h: FILL, fill: color } : { w: FILL, h: 1, fill: color },
    )
  }

  // --- components ----------------------------------------------------------------------------

  /** The Components page board (created on first use). */
  private board(): string {
    if (this.compBoard) return this.compBoard
    const rec = this.addPage("Components", 2)
    const id = this.placeRoot(rec, "Components", {
      key: "LibBoard",
      w: 1600,
      fill: this.c("bg"),
      gap: 56,
      pad: 64,
    })
    this.pageTitle(
      id,
      "Components",
      "Every main used on the screens. Edit a main and its instances follow.",
    )
    this.compBoard = id
    return id
  }
  private pageTitle(parent: string, title: string, sub: string) {
    const head = this.col(parent, "Header", { w: FILL, gap: 8 })
    this.text(
      head,
      `${this.tpl.name}: ${title.toLowerCase()}`,
      this.ty("heading", { size: 40 }),
      this.c("ink"),
      {
        name: "Title",
      },
    )
    this.text(head, sub, this.ty("body"), this.c("muted"), { name: "Subtitle" })
  }
  private sectionIn(parent: string, name: string, items: Props & Flex = {}): string {
    const s = this.col(parent, name, { w: FILL, gap: 24 })
    const head = this.col(s, "Section header", { w: FILL, gap: 12 })
    this.text(head, name, this.ty("label", { case: "upper", letterSpacing: 1 }), this.c("muted"), {
      name: "Section title",
    })
    this.divider(head, this.c("border"))
    return this.row(s, `${name} items`, {
      w: FILL,
      gap: 40,
      align: "start",
      wrap: true,
      crossGap: 40,
      ...items,
    })
  }
  private section(name: string): string {
    const found = this.sections.get(name)
    if (found) return found
    const items = this.sectionIn(this.board(), name)
    this.sections.set(name, items)
    return items
  }
  /** A labeled cell holding one main on the Components page. */
  private cell(section: string | undefined, label: string): string {
    const cell = this.col(this.section(section ?? "Components"), label, { gap: 12 })
    this.text(cell, label, this.ty("label"), this.c("muted"), { name: "Label" })
    return cell
  }

  /**
   * Defines a component (a main on the Components page, labeled with its name) and returns
   * its id. `build` adds the children to the root; give targeted nodes a `key`.
   */
  component(name: string, opts: ComponentOptions, build?: (root: string) => void): string {
    const rootId = this.id(opts.key)
    const props: Body = {}
    let i = 0
    for (const [prop, spec] of Object.entries(opts.props ?? {})) {
      props[prop] = { ...this.propDef(spec, rootId), order: `a${i.toString(36)}` }
      i++
    }
    const id = this.add(this.cell(opts.section, name), {
      type: "frame",
      name,
      key: opts.key,
      component: Object.keys(props).length ? { props } : true,
      ...this.flex(opts.root),
      ...(opts.description ? { meta: { "kimo.component.description": opts.description } } : {}),
    })
    build?.(id)
    return id
  }
  private target(path: string, rootId: string): string {
    return path === "root" ? rootId : this.keyPath(path)
  }
  private propDef(spec: PropSpec, rootId: string): Body {
    switch (spec.kind) {
      case "text":
        return {
          type: "text",
          target: this.target(spec.key, rootId),
          field: "content",
          default: spec.default,
        }
      case "boolean":
        return {
          type: "boolean",
          target: this.target(spec.key, rootId),
          field: "visible",
          default: spec.default,
        }
      case "instance":
        return { type: "instance", target: this.target(spec.key, rootId), default: spec.default }
      case "slot":
        return { type: "slot", target: this.target(spec.key, rootId) }
      case "enum": {
        const options: Body = {}
        const targets: Body = {}
        for (const [opt, sets] of Object.entries(spec.options)) {
          options[opt] = null
          targets[opt] = Object.entries(sets).map(([k, value]) => {
            const dot = k.indexOf(".")
            if (dot < 0) throw new Error(`${this.tpl.slug}: enum target "${k}" needs <key>.<field>`)
            return { target: this.target(k.slice(0, dot), rootId), field: k.slice(dot + 1), value }
          })
        }
        return { type: "enum", options, targets }
      }
    }
  }

  /** A derived component: an instance of `base` marked as a component (a fixed variant). */
  derive(
    base: string,
    name: string,
    key: string,
    opts: Omit<UseOptions, "key" | "slots"> & { section?: string; description?: string } = {},
  ): string {
    const { section, description, ...use } = opts
    return this.use(this.cell(section, name), base, {
      ...use,
      key,
      name,
      component: true,
      ...(description ? { meta: { "kimo.component.description": description } } : {}),
    } as UseOptions)
  }

  /** An instance of `comp` in `parent`. */
  use(parent: Parent, comp: string, opts: UseOptions = {}): string {
    const overrides: Body = {}
    for (const [k, v] of Object.entries(opts.set ?? {})) overrides[this.keyPath(k)] = { set: v }
    for (const k of opts.hide ?? []) {
      const path = this.keyPath(k)
      const prev = (overrides[path] as { set?: Body } | undefined)?.set ?? {}
      overrides[path] = { set: { ...prev, visible: false } }
    }
    for (const k of Object.keys(opts.slots ?? {})) overrides[this.keyPath(k)] = { slot: true }
    const extra = opts as UseOptions & { component?: boolean; meta?: Body }
    const id = this.add(parent, {
      type: "instance",
      of: comp,
      ...(opts.key ? { key: opts.key } : {}),
      ...(opts.name ? { name: opts.name } : {}),
      ...(extra.component ? { component: true } : {}),
      ...(extra.meta ? { meta: extra.meta } : {}),
      ...(opts.props ? { props: opts.props } : {}),
      ...(opts.args ? { args: opts.args } : {}),
      ...(Object.keys(overrides).length ? { overrides } : {}),
    })
    for (const [k, fn] of Object.entries(opts.slots ?? {})) fn({ inst: id, at: this.keyPath(k) })
    return id
  }

  // --- foundations ---------------------------------------------------------------------------

  /** The Foundations page: color swatches (light and dark), type scale, spacing, radius, shadows. */
  private foundations() {
    const rec = this.addPage("Foundations", 3)
    const board = this.placeRoot(rec, "Foundations", {
      key: "Foundations",
      w: 1600,
      fill: this.c("bg"),
      gap: 56,
      pad: 64,
    })
    this.pageTitle(
      board,
      "Foundations",
      "The tokens every layer binds to. Switch the mode axis to see dark values.",
    )
    const entries = Object.entries(this.vars)
    const colors = entries.filter(([, v]) => v.type === "color")
    if (colors.length) {
      const row = this.sectionIn(board, "Color", { wrap: false, gap: 24 })
      for (const mode of this.themed ? (["light", "dark"] as const) : (["light"] as const)) {
        const panel = this.col(row, mode === "light" ? "Light" : "Dark", {
          w: FILL,
          gap: 20,
          pad: 28,
          radius: 16,
          fill: this.c("bg"),
          stroke: { paint: this.c("border") },
          ...(this.themed ? { theme: { mode } } : {}),
        })
        this.text(
          panel,
          mode === "light" ? "Light" : "Dark",
          this.ty("heading", { size: 18 }),
          this.c("ink"),
          {
            name: "Mode",
          },
        )
        const grid = this.row(panel, "Swatches", { w: FILL, gap: 16, wrap: true, crossGap: 20 })
        for (const [name] of colors) {
          const short = name.slice("color/".length)
          const sw = this.col(grid, name, { w: 104, gap: 8 })
          this.rect(sw, "Swatch", {
            w: 104,
            h: 64,
            radius: 10,
            fill: ref(name),
            stroke: { paint: this.c("border") },
          })
          this.text(sw, short, this.ty("label", { size: 12 }), this.c("ink"), { name: "Name" })
          this.text(
            sw,
            this.modeValue(short, mode === "light" ? 0 : 1).toUpperCase(),
            this.ty("body", { size: 11 }),
            this.c("muted"),
            {
              name: "Value",
            },
          )
        }
      }
    }
    const types = entries.filter(([, v]) => v.type === "typography")
    if (types.length) {
      const col = this.sectionIn(board, "Type")
      this.setColumn(col, 20)
      for (const [name, v] of types) {
        const val = v.value as Body
        const row = this.row(col, name, { w: FILL, gap: 32, align: "center" })
        const spec = this.col(row, "Spec", { w: 220, gap: 4 })
        this.text(spec, name.slice("type/".length), this.ty("label"), this.c("ink"), {
          name: "Name",
        })
        const lh = typeof val.lineHeight === "number" ? ` / ${val.lineHeight}` : ""
        this.text(
          spec,
          `${String(val.font)} ${String(val.size)}${lh} · ${String(val.weight ?? 400)}`,
          this.ty("body", { size: 12 }),
          this.c("muted"),
          {
            name: "Values",
          },
        )
        this.text(row, this.tpl.name, { typography: ref(name) }, this.c("ink"), { name: "Sample" })
      }
    }
    const spaces = entries.filter(([k, v]) => v.type === "number" && k.startsWith("space/"))
    if (spaces.length) {
      const col = this.sectionIn(board, "Spacing")
      this.setColumn(col, 12)
      for (const [name] of spaces) {
        const row = this.row(col, name, { gap: 24, align: "center" })
        this.text(row, name, this.ty("label", { size: 12 }), this.c("muted"), {
          name: "Name",
          w: 120,
          grow: "fixed-width",
        })
        this.rect(row, "Bar", { w: ref(name), h: 16, radius: 4, fill: this.c("accent") })
      }
    }
    const radii = entries.filter(([k, v]) => v.type === "number" && k.startsWith("radius/"))
    if (radii.length) {
      const row = this.sectionIn(board, "Radius")
      for (const [name] of radii) {
        const cell = this.col(row, name, { gap: 10 })
        this.rect(cell, "Tile", {
          w: 88,
          h: 88,
          radius: ref(name),
          fill: this.c("surface"),
          stroke: { paint: this.c("border") },
        })
        this.text(cell, name, this.ty("label", { size: 12 }), this.c("muted"), { name: "Name" })
      }
    }
    const shadows = entries.filter(([, v]) => v.type === "shadow")
    if (shadows.length) {
      const row = this.sectionIn(board, "Shadow", { pad: [8, 8, 24, 8] })
      for (const [name] of shadows) {
        const cell = this.col(row, name, { gap: 14 })
        this.rect(cell, "Tile", {
          w: 160,
          h: 96,
          radius: 12,
          fill: this.c("surface"),
          effects: ref(name),
        })
        this.text(cell, name, this.ty("label", { size: 12 }), this.c("muted"), { name: "Name" })
      }
    }
  }
  /** Turns a section's item row (just created) into a column. */
  private setColumn(id: string, gap: number) {
    const op = this.nodes.find((o) => o.op === "insert" && o.id === id) as
      | { node: Body }
      | undefined
    if (op) op.node.layout = { dir: "column", gap }
  }

  // --- output --------------------------------------------------------------------------------

  /** Applies everything to a fresh store (validated per op group). */
  finish(libraries: Libraries = {}): BuiltTemplate {
    for (const c of REQUIRED_COLORS) this.c(c)
    for (const t of REQUIRED_TYPE) this.ty(t)
    if (!this.hasCover) throw new Error(`${this.tpl.slug}: no cover (b.cover)`)
    this.foundations()
    const pages = [...this.pagesList].sort((a, b) => a.rank - b.rank)
    const pageRec: Body = {}
    pages.forEach((pg, i) => {
      pageRec[pg.id] = { order: `p${String(i).padStart(2, "0")}`, name: pg.name }
    })
    const json = JSON.stringify(this.nodes)
    const features = new Set<string>()
    const types = new Set(Object.values(this.vars).map((v) => v.type))
    if (types.has("typography") || types.has("shadow") || types.has("dimension"))
      features.add("tokens/composite")
    if (json.includes('"wrap":true') || json.includes('"crossGap"')) features.add("layout/wrap")
    if (/"align":"(stretch|baseline)"/.test(json)) features.add("layout/stretch-baseline")
    if (/"(min|max)":/.test(json)) features.add("size/min-max")
    const header: Op[] = [
      {
        op: "setHeader",
        set: {
          meta: {
            name: this.tpl.name,
            "kimo.template": {
              slug: this.tpl.slug,
              category: this.tpl.category,
              description: this.tpl.description,
            },
          },
          features: [...features].sort(),
          pages: pageRec,
        },
      },
    ]
    if (this.themed) header.push({ op: "setThemes", set: { mode: ["light", "dark"] } })
    header.push({ op: "setVariables", set: this.vars as never })
    const store = createDocStore(createEmptyDocument(), {
      jitter: 0,
      validateOptions: { libraries },
    })
    for (const [label, ops] of [
      ["header", header],
      ["nodes", this.nodes],
    ] as const) {
      const r = store.apply(ops, { origin: "user", label })
      if (!r.ok) {
        console.error(JSON.stringify(r, null, 2).slice(0, 4000))
        throw new Error(`${this.tpl.slug}: ${label} ops rejected`)
      }
    }
    const kindOf = (rank: number): BuiltPage["kind"] =>
      rank === 0 ? "cover" : rank === 1 ? "screens" : rank === 2 ? "components" : "foundations"
    const nameOf = (id: string) => String(store.getNode(id)?.name ?? id)
    return {
      store,
      pages: pages.map((pg) => ({
        id: pg.id,
        name: pg.name,
        kind: kindOf(pg.rank),
        roots: [...pg.roots],
      })),
      screens: pages
        .filter((pg) => pg.rank === 1)
        .flatMap((pg) => pg.roots.map((id) => ({ id, name: nameOf(id), page: pg.name }))),
      backdrop: this.lightValue("bg"),
      copy: this.copy,
    }
  }
}

/** Builds one template module. */
export function buildTemplate(tpl: Template): BuiltTemplate {
  const b = new TemplateBuilder(tpl)
  tpl.build(b)
  return b.finish()
}

// --- house rules ---------------------------------------------------------------------------------

const COLOR_KEYS = new Set(["fill", "color", "paint", "colors"])
const isRawColor = (v: unknown): boolean =>
  typeof v === "string" ? /^#[0-9a-f]{3,8}$/i.test(v) : !!v && typeof v === "object" && "space" in v

/**
 * Raw colors in the node table (fills, strokes, icon colors, gradient stops, effects). Every
 * color must be a token binding; shadows bind `shadow/*` variables.
 */
export function rawColorIssues(nodes: Record<string, unknown>): string[] {
  const out: string[] = []
  const walk = (id: string, v: unknown, path: string, depth: number) => {
    if (depth > 10 || v === null || typeof v !== "object") return
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (path.endsWith("effects") && x && typeof x === "object") {
          out.push(`${id}: inline effect at ${path}; bind a shadow token`)
          return
        }
        if (
          isRawColor(x) &&
          (COLOR_KEYS.has(path.split(".").pop() ?? "") || path.endsWith("stops"))
        )
          out.push(`${id}: raw color ${JSON.stringify(x)} at ${path}[${i}]`)
        walk(id, x, `${path}[${i}]`, depth + 1)
      })
      return
    }
    for (const [k, x] of Object.entries(v as Body)) {
      if (k === "meta") continue
      if ((COLOR_KEYS.has(k) || k === "color") && isRawColor(x))
        out.push(`${id}: raw color ${JSON.stringify(x)} at ${path}.${k}`)
      walk(id, x, `${path}.${k}`, depth + 1)
    }
  }
  for (const [id, n] of Object.entries(nodes)) walk(id, n, "", 0)
  return out
}

/** Absolute positioning outside an intentional overlay (opt in with `meta: {"kimo.template.overlay": true}`). */
export function absoluteIssues(nodes: Record<string, Body>): string[] {
  const out: string[] = []
  for (const [id, n] of Object.entries(nodes)) {
    if (n.parent === null) continue
    const parent = nodes[n.parent as string]
    const overlay = (n.meta as Body | undefined)?.["kimo.template.overlay"] === true
    if (n.position === "absolute" && !overlay)
      out.push(`${id}: absolute without the overlay meta flag`)
    else if (parent && parent.type === "frame" && parent.layout === undefined && !overlay)
      out.push(`${id}: parent ${n.parent as string} has no auto layout`)
  }
  return out
}
