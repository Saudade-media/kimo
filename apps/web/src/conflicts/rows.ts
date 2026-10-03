/**
 * Board 18 rows: the stored conflicts of a document as {@link ConflictRowView}s, with the labels
 * the design shows. Order (board 20 "Group icons", note AApU5): Document (header conflicts),
 * Variables, then nodes in layer order. Pure: reads the store through {@link ConflictSource}.
 */
import {
  type Conflict,
  type ConflictSide,
  type MergeInfo,
  type Placement,
  pointerTokens,
  sideValue,
} from "@kimo/core-schema"
import type { NodeData } from "@kimo/editor-state"
import { kindLabel } from "../editor/props"
import type { ConflictRowView, ConflictSideView } from "../platform/contract"

/** What the rows read from the document. A `DocStore` satisfies it. */
export interface ConflictSource {
  getNode(id: string): NodeData | undefined
  children(parent: string | null, at?: string | null): string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** Short label of a merge side: the last path segment ("feat/pricing-v2" → "pricing-v2"). */
export const shortLabel = (label: string) => label.split("/").filter(Boolean).pop() ?? label

/** "main ← feat/pricing-v2 · base 4e1a9c2" (board 18 Summary › Source); null without labels. */
export function sourceLine(info: MergeInfo | null): string | null {
  if (!info) return null
  const parts: string[] = []
  if (info.ours && info.theirs) parts.push(`${info.ours} ← ${info.theirs}`)
  else if (info.theirs) parts.push(info.theirs)
  if (info.base) parts.push(`base ${info.base}`)
  return parts.length > 0 ? parts.join(" · ") : null
}

/** Display name of a node: its name; an unnamed instance takes its component's name. */
export function displayName(node: Obj | undefined, src: ConflictSource, depth = 0): string {
  if (!node) return "Layer"
  if (typeof node.name === "string" && node.name.length > 0) return node.name
  if (node.type === "instance" && typeof node.of === "string" && depth < 8) {
    const main = src.getNode(node.of)
    if (main) return displayName(main as Obj, src, depth + 1)
  }
  return kindLabel(node as NodeData)
}

/** A parent placement as a path: "Hero › CTA Row" (the top-level frame is left out). */
export function placementLabel(p: Placement, src: ConflictSource): string {
  if (p.parent === null) return "Page"
  const chain: string[] = []
  const seen = new Set<string>()
  for (let id: string | null = p.parent; id !== null && !seen.has(id); ) {
    seen.add(id)
    const n = src.getNode(id) as Obj | undefined
    if (!n) break
    chain.unshift(displayName(n, src))
    id = typeof n.parent === "string" ? n.parent : null
  }
  if (chain.length > 1) chain.shift()
  return chain.join(" › ") || "Page"
}

/** A JSON value as one short line ("#E8590C", "12", "$brand", "Linear", "3 items"). */
export function formatValue(v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (v === null) return "null"
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`
  if (isObj(v)) {
    if (typeof v.$ref === "string") return `$${v.$ref}`
    if (v.space === "oklch") return `oklch(${v.l} ${v.c} ${v.h})`
    if (v.space === "display-p3") return `color(display-p3 ${v.r} ${v.g} ${v.b})`
    if (typeof v.kind === "string") return v.kind.charAt(0).toUpperCase() + v.kind.slice(1)
    if (typeof v.mode === "string") return v.mode.charAt(0).toUpperCase() + v.mode.slice(1)
    const s = JSON.stringify(v)
    return s.length > 48 ? `${s.slice(0, 47)}…` : s
  }
  return String(v)
}

const swatchOf = (v: unknown): string | null => (typeof v === "string" && HEX.test(v) ? v : null)

const PLACEMENT = new Set(["type", "parent", "order", "at"])

/** "Edited · 2 props" for a node side against the base. */
function nodeSummary(node: Obj, base: Obj | undefined): string {
  if (!base) return "Added"
  if (node.type !== base.type) return `Type · ${String(node.type)}`
  const keys = new Set([...Object.keys(node), ...Object.keys(base)])
  let n = 0
  for (const k of keys)
    if (!PLACEMENT.has(k) && JSON.stringify(node[k]) !== JSON.stringify(base[k])) n++
  return n === 0 ? "Unchanged" : `Edited · ${n} prop${n === 1 ? "" : "s"}`
}

/** A node as stored at the merge base: "Legal · 600×24" (board 20 note h0kgW). */
function nodeBaseLabel(node: Obj, src: ConflictSource): string {
  const name = displayName(node, src)
  const w = node.w
  const h = node.h
  return typeof w === "number" && typeof h === "number"
    ? `${name} · ${formatValue(w)}×${formatValue(h)}`
    : name
}

/** The ConflictChoice data of one side. */
export function sideView(c: Conflict, side: ConflictSide, src: ConflictSource): ConflictSideView {
  const v = sideValue(c, side)
  const base: ConflictSideView = {
    side,
    caption: side,
    display: "",
    swatch: null,
    absent: !v.present,
  }
  if (!v.present) {
    // Board 20 (ConflictRow/Base note h0kgW): "a side that adds a node shows base absent".
    base.display =
      side === "base"
        ? "absent"
        : c.kind === "node" || (c.kind === "variable" && !c.when)
          ? "Deleted"
          : "Unset"
    return base
  }
  switch (c.kind) {
    case "node": {
      if (side === "base") {
        base.display = nodeBaseLabel(v.value as Obj, src)
        return base
      }
      const b = sideValue(c, "base")
      base.display = nodeSummary(v.value as Obj, b.present ? (b.value as Obj) : undefined)
      return base
    }
    case "move":
      base.display = placementLabel(v.value as Placement, src)
      return base
    case "variable": {
      const value = c.when ? v.value : (v.value as Obj).value
      if (!c.when && Array.isArray(value) && value.every((e) => isObj(e) && "value" in e)) {
        base.display = `${value.length} themed values`
        return base
      }
      base.display = formatValue(value)
      base.swatch = swatchOf(value)
      return base
    }
    default:
      base.display = formatValue(v.value)
      base.swatch = swatchOf(v.value)
      return base
  }
}

const APPLIED_VERB = {
  ours: "kept ours",
  theirs: "took theirs",
  base: "took base",
  edited: "edited",
} as const

/**
 * ConflictRow/Resolved and the Resolved list's "Choice": "kept ours · 12", "took theirs",
 * "took theirs · deleted". The applied value follows when it is a number or the side is absent.
 */
export function resolvedLabel(c: Conflict): string {
  const verb = APPLIED_VERB[c.applied]
  if (c.applied === "edited") return verb
  const v = sideValue(c, c.applied)
  if (!v.present) return `${verb} · deleted`
  if (typeof v.value === "number") return `${verb} · ${v.value}`
  return verb
}

/** The node a conflict belongs to (null for variable and header conflicts). */
export const conflictNode = (c: Conflict): string | null =>
  c.kind === "prop" || c.kind === "node" || c.kind === "move" ? c.node : null

/** The best known version of a conflict's node (body first, then the sides). */
function nodeData(c: Conflict, src: ConflictSource): Obj | undefined {
  const id = conflictNode(c)
  if (!id) return undefined
  const live = src.getNode(id) as Obj | undefined
  if (live) return live
  if (c.kind === "node")
    for (const s of ["ours", "theirs", "base"] as const) {
      const v = sideValue(c, s)
      if (v.present && isObj(v.value)) return v.value
    }
  return undefined
}

/** Group header labels of variable and header conflicts (board 20 zBg7u / Isy2f). */
export const VARIABLES_GROUP = "Variables"
export const DOCUMENT_GROUP = "Document"

function groupLabel(c: Conflict, src: ConflictSource): string {
  if (c.kind === "variable") return VARIABLES_GROUP
  if (c.kind === "header") return DOCUMENT_GROUP
  const n = nodeData(c, src)
  const name = displayName(n, src)
  if (c.kind === "node" && n && typeof n.parent === "string") {
    const parent = src.getNode(n.parent) as Obj | undefined
    if (parent) return `${displayName(parent, src)} › ${name}`
  }
  return name
}

function propertyLabel(c: Conflict): string {
  switch (c.kind) {
    case "prop":
      return pointerTokens(c.path).pop() ?? c.path
    case "node":
      return "node"
    case "move":
      return "parent"
    case "variable":
      return c.when ? [`$${c.variable}`, ...Object.values(c.when)].join(" · ") : `$${c.variable}`
    case "header":
      return pointerTokens(c.path).pop() ?? c.path
  }
}

function kindHint(c: Conflict): ConflictRowView["kindLabel"] {
  if (c.kind === "move") return "moved twice"
  if (c.kind === "node" && (!sideValue(c, "ours").present || !sideValue(c, "theirs").present))
    return "deleted vs edited"
  return "both changed"
}

/** Sibling-index path of a node from the root (layer order key); absent nodes sort last. */
function layerPath(id: string, src: ConflictSource, fallback: Obj | undefined): number[] {
  const path: number[] = []
  const seen = new Set<string>()
  let cur: string | null = id
  let node = (src.getNode(id) as Obj | undefined) ?? fallback
  while (cur !== null && node && !seen.has(cur)) {
    seen.add(cur)
    const parent = typeof node.parent === "string" ? node.parent : null
    const at = typeof node.at === "string" ? node.at : null
    const sibs = src.children(parent, at)
    const i = sibs.indexOf(cur)
    path.unshift(i < 0 ? sibs.length : i)
    cur = parent
    node = parent !== null ? (src.getNode(parent) as Obj | undefined) : undefined
  }
  return path
}

function comparePaths(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if ((a[i] as number) !== (b[i] as number)) return (a[i] as number) - (b[i] as number)
  return a.length - b.length
}

/** Rows for every stored conflict: header conflicts, variables, then nodes in layer order. */
export function conflictRows(
  conflicts: Readonly<Record<string, Conflict>> | undefined,
  src: ConflictSource,
): ConflictRowView[] {
  if (!conflicts) return []
  const entries = Object.entries(conflicts).map(([id, c]) => {
    const node = conflictNode(c)
    const rank = c.kind === "header" ? 0 : c.kind === "variable" ? 1 : 2
    const key = node ? layerPath(node, src, nodeData(c, src)) : []
    return { id, c, rank, key, node }
  })
  entries.sort(
    (x, y) =>
      x.rank - y.rank ||
      comparePaths(x.key, y.key) ||
      (x.c.kind === "variable" && y.c.kind === "variable"
        ? x.c.variable < y.c.variable
          ? -1
          : x.c.variable > y.c.variable
            ? 1
            : 0
        : 0) ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  )
  return entries.map(({ id, c, node }) => {
    const resolved = c.resolved === true
    return {
      id,
      kind: c.kind,
      nodeId: node,
      group: groupLabel(c, src),
      property: propertyLabel(c),
      kindLabel: kindHint(c),
      ours: sideView(c, "ours", src),
      theirs: sideView(c, "theirs", src),
      base: sideView(c, "base", src),
      applied: c.applied,
      resolved,
      resolvedLabel: resolved ? resolvedLabel(c) : null,
    }
  })
}

/** Rows grouped by owner (a node, all variables, the document), keeping row order. */
export function groupRows(
  rows: readonly ConflictRowView[],
): { key: string; rows: ConflictRowView[] }[] {
  const groups = new Map<string, ConflictRowView[]>()
  for (const r of rows) {
    const key = r.nodeId ?? (r.kind === "variable" ? "variables" : "header")
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  return [...groups].map(([key, rs]) => ({ key, rows: rs }))
}
