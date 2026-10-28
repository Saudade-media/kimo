/**
 * Pure helpers behind the M3 panels (no React): layer kinds and override dots from the expanded
 * view's provenance, the Overrides summary of an instance, component names and asset groups.
 * Unit-tested in test/m3-model.test.ts.
 */
import {
  type DeclaredProp,
  declaredProps,
  type ExpandedView,
  instanceSwaps,
  isLocated,
  type KimoDocument,
  type Libraries,
  libraryComponents,
  localComponents,
  locate,
  resolveIdPath,
  splitQualified,
} from "@kimo/core-schema"
import type { LayerKind } from "@kimo/ui"

type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)

/** Node display name: `name`, else its type. */
export function nameOf(n: Readonly<Rec> | undefined | null, fallback = "Layer"): string {
  if (!n) return fallback
  return typeof n.name === "string" && n.name ? n.name : String(n.type ?? fallback)
}

/**
 * The M3 row kind of a view node (board 02c legend): main `component`, derived component,
 * instance (`diamond`), replaced child, slot frame — or null for a plain layer.
 */
export function layerKind(view: ExpandedView, id: string): LayerKind | null {
  const n = view.getNode(id)
  if (!n) return null
  // The expanded root of an instance drops `component`; a derived component (an instance
  // marked `component`) is recognized from its real node (§9.1).
  const real = view.isVirtual(id) ? undefined : view.base.getNode(id)
  if (real?.type === "instance" && real.component) return "derived"
  if (n.component)
    return n.type === "instance" || view.origin(id)?.instance?.derived ? "derived" : "component"
  const o = view.origin(id)
  if (n.type === "instance" || o?.instance) return "instance"
  if (o?.owned?.mode === "replace") return "replaced"
  if (n.type === "frame" && isObj(n.slot)) return "slot"
  return null
}

/**
 * Name of the main-component layer a replacement node stands in for (board 11 LayerRow/
 * Replaced `Uh0kH`: the row keeps the replaced layer's name, e.g. "Price"), or null when the
 * node is not a replacement or the path does not resolve.
 */
export function replacedName(
  view: ExpandedView,
  doc: Pick<KimoDocument, "nodes" | "imports">,
  libraries: Libraries,
  id: string,
): string | null {
  const owned = view.origin(id)?.owned
  if (owned?.mode !== "replace") return null
  const of = view.origin(owned.instance)?.instance?.of
  const c = of ? mainOf(doc, libraries, of) : null
  if (!c) return null
  const r = resolveIdPath({ doc, libraries }, c, owned.at, {
    swaps: instanceSwaps({ doc, libraries }, c, view.base.getNode(owned.instance) ?? {}),
  })
  return r.ok ? nameOf(r.target.node) : null
}

/** True when the node carries an instance's own override (dot in layers). */
export function isOverridden(view: ExpandedView, id: string): boolean {
  const o = view.origin(id)
  if (!o) return false
  if (o.owned) return true
  if (o.slot?.overridden) return true
  return o.overrides.some((x) => x.layer !== "derived")
}

/** The component node an instance (view id) instantiates, with its namespace. */
function mainOf(doc: Pick<KimoDocument, "nodes" | "imports">, libraries: Libraries, of: string) {
  const r = locate({ doc, libraries }, of)
  return isLocated(r) ? r : null
}

/** Display name of a component QId (`ui:btn` → "Button"); falls back to the id. */
export function componentName(
  doc: Pick<KimoDocument, "nodes" | "imports">,
  libraries: Libraries,
  of: string,
): string {
  const m = mainOf(doc, libraries, of)
  return m ? nameOf(m.node, of) : of
}

/** Declared props of the component an instance uses (empty when it can't be located). */
export function propsOfInstance(
  doc: Pick<KimoDocument, "nodes" | "imports">,
  libraries: Libraries,
  of: string,
): DeclaredProp[] {
  const m = mainOf(doc, libraries, of)
  return m ? declaredProps({ doc, libraries }, m) : []
}

type OverrideKindTag = "props" | "args" | "set" | "slot" | "replace"

/** One row of the Overrides popover (board 11 `P7Nxi`). */
interface OverrideEntry {
  kind: OverrideKindTag
  /** `props` key, arg name or override IdPath. */
  path: string
  /** Display path (layer name for overrides). */
  label: string
  /** Value preview. */
  value: string
  /** What reset removes: `resetOverride(instance, path, { fields })` or `setArgs`. */
  reset:
    | { cmd: "props"; field: string }
    | { cmd: "args"; name: string }
    | { cmd: "override"; path: string }
}

function preview(v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (isObj(v) && typeof v.$ref === "string") return v.$ref
  if (v === undefined) return ""
  const s = JSON.stringify(v)
  return s.length > 24 ? `${s.slice(0, 23)}…` : s
}

/** The instance's own override entries, in precedence order (props → args → overrides). */
export function overrideEntries(
  instance: Readonly<Rec>,
  pathName: (path: string) => string,
  ownedCount: (path: string) => number,
  ownedName: (path: string) => string | null,
): OverrideEntry[] {
  const out: OverrideEntry[] = []
  if (isObj(instance.props))
    for (const [k, v] of Object.entries(instance.props))
      out.push({
        kind: "props",
        path: k,
        label: k,
        value: preview(v),
        reset: { cmd: "props", field: k },
      })
  if (isObj(instance.args))
    for (const [k, v] of Object.entries(instance.args))
      out.push({
        kind: "args",
        path: k,
        label: k,
        value: preview(v),
        reset: { cmd: "args", name: k },
      })
  if (isObj(instance.overrides))
    for (const [k, ov] of Object.entries(instance.overrides)) {
      if (!isObj(ov)) continue
      if (ov.slot === true) {
        const n = ownedCount(k)
        out.push({
          kind: "slot",
          path: k,
          label: pathName(k),
          value: `${n} ${n === 1 ? "child" : "children"}`,
          reset: { cmd: "override", path: k },
        })
      } else if (ov.replace === true)
        out.push({
          kind: "replace",
          path: k,
          label: pathName(k),
          value: `→ ${ownedName(k) ?? "layer"}`,
          reset: { cmd: "override", path: k },
        })
      else if (isObj(ov.set))
        out.push({
          kind: "set",
          path: k,
          label: pathName(k),
          value: Object.keys(ov.set).join(", "),
          reset: { cmd: "override", path: k },
        })
    }
  return out
}

/** "props 1 · args 2 · overrides 2" (board 11 Overrides Summary; slot + replace + set count as overrides). */
export function summaryText(entries: readonly OverrideEntry[]): string {
  const props = entries.filter((e) => e.kind === "props").length
  const args = entries.filter((e) => e.kind === "args").length
  const ov = entries.length - props - args
  return `props ${props} · args ${args} · overrides ${ov}`
}

/** A component listed in Assets / Swap / pickers. */
export interface ComponentItem {
  /** `of` value: local id or `alias:id`. */
  qid: string
  alias: string | null
  id: string
  name: string
  /** Derived: base component name ("from Primary"). */
  from: string | null
}

export function listComponents(
  doc: Pick<KimoDocument, "nodes" | "imports">,
  libraries: Libraries,
  alias: string | null,
): ComponentItem[] {
  const ids =
    alias === null ? localComponents(doc as KimoDocument) : libraryComponents(libraries, alias)
  const nodes = (alias === null ? doc.nodes : (libraries[alias]?.nodes ?? {})) as Record<
    string,
    Rec
  >
  return ids
    .map((qid) => {
      const { name: id } = alias === null ? { name: qid } : splitQualified(qid)
      const n = nodes[id]
      let from: string | null = null
      if (n?.type === "instance" && typeof n.of === "string") {
        const base = nodes[splitQualified(n.of).name]
        from = base ? nameOf(base, n.of) : n.of
      }
      return { qid, alias, id, name: nameOf(n, id), from }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Assets groups: name segments before the last "/" (board 13 note: Card/Pricing → Card). */
export function groupByPath<T extends { name: string }>(items: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const i = it.name.lastIndexOf("/")
    const g = i < 0 ? "" : it.name.slice(0, i)
    const l = groups.get(g)
    if (l) l.push(it)
    else groups.set(g, [it])
  }
  return [...groups.entries()].sort((a, b) =>
    a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0]),
  )
}

/** Case-insensitive match on name and qid. */
export function matches(item: { name: string; qid?: string }, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return item.name.toLowerCase().includes(q) || (item.qid ?? "").toLowerCase().includes(q)
}
