/**
 * Board 27 §8 (desing.pen d7gkR): "Replace main with selection" and broken overrides.
 *
 * - {@link planReplaceMain} (rule Y4XQq6 "Replace with selection"): the selection's layers
 *   become the main's children; the main keeps id, name, props (targets re-matched) and position.
 *   Instance overrides re-attach by layer name path, then by type + order. Unmatched overrides
 *   are not lost: they are stashed on the instance under node meta
 *   {@link BROKEN_OVERRIDES_META_KEY} (opaque, never rendered) and listed by
 *   {@link brokenOverrides}. One op group (one undo step).
 * - {@link brokenOverrides} (rule Kpf1o "Broken overrides"): overrides whose layer no longer
 *   resolves (live keys, after a library update or a hand edit, and stashed ones) or whose bound
 *   variable no longer exists.
 * - {@link planFixOverrides}: the Review dialog's Apply — Remap · Reset · Keep per row, all at
 *   once.
 */
import { type ComponentScope, instanceSwaps, isLocated, locate, resolveIdPath } from "../components"
import { isObject } from "../json"
import { isRef, splitQualified } from "../resolve"
import { isNodeType, nodeKeys } from "../schema/nodes"
import { compareCodeUnits } from "../tree"
import { wouldCycle } from "./components"
import {
  fail,
  nodeTable,
  ok,
  type Plan,
  type PlanContext,
  type PlanNote,
  type PlanOp,
} from "./plan"

type Rec = Record<string, unknown>

/** Node meta key holding an instance's unmatched overrides (opaque list, spec §9.7). */
export const BROKEN_OVERRIDES_META_KEY = "kimo.overrides.broken"

/** One stashed override: its old key, the override itself, and the old layer's name path/type. */
export interface StashedOverride {
  key: string
  override: Rec
  /** Name path of the layer it targeted ("Badge/Label"), when known. */
  path?: string
  type?: string
}

const scopeOf = (ctx: PlanContext): ComponentScope => ({ doc: ctx.doc, libraries: ctx.libraries })

/** Ordered children of every parent (by `order`, then id). */
function childIndex(nodes: Record<string, Rec>): Map<string, string[]> {
  const by = new Map<string, string[]>()
  for (const [id, n] of Object.entries(nodes)) {
    if (typeof n.parent !== "string") continue
    const l = by.get(n.parent)
    if (l) l.push(id)
    else by.set(n.parent, [id])
  }
  for (const l of by.values())
    l.sort(
      (a, b) =>
        compareCodeUnits(String(nodes[a]?.order ?? ""), String(nodes[b]?.order ?? "")) ||
        compareCodeUnits(a, b),
    )
  return by
}

const nameOf = (n: Rec | undefined): string =>
  typeof n?.name === "string" && n.name ? n.name : String(n?.type ?? "layer")

/** Layer facts used for matching: name path from the root, type, parent, index among same-type siblings. */
interface LayerInfo {
  id: string
  path: string
  type: string
  parent: string
  typeIndex: number
}

function layersUnder(
  nodes: Record<string, Rec>,
  kids: Map<string, string[]>,
  roots: readonly string[],
  rootParent: string,
  prefix: string,
): LayerInfo[] {
  const out: LayerInfo[] = []
  const visit = (ids: readonly string[], parent: string, base: string) => {
    const typeCount = new Map<string, number>()
    for (const id of ids) {
      const n = nodes[id]
      if (!n) continue
      const type = String(n.type)
      const k = typeCount.get(type) ?? 0
      typeCount.set(type, k + 1)
      const path = base ? `${base}/${nameOf(n)}` : nameOf(n)
      out.push({ id, path, type, parent, typeIndex: k })
      visit(kids.get(id) ?? [], id, path)
    }
  }
  visit(roots, rootParent, prefix)
  return out
}

/** Visual (non-placement, non-identity) keys copied from the source root onto the main. */
const KEEP_ON_MAIN = new Set([
  "type",
  "parent",
  "at",
  "order",
  "name",
  "x",
  "y",
  "position",
  "locked",
  "meta",
  "component",
  "page",
  "theme",
  "placeholder",
])

/** Result of {@link replaceMainPreview}: the Replace dialog's three lines (board 27 FM0o5). */
export interface ReplaceMainPreview {
  /** Instances (of the main and of components derived from it) whose overrides are re-keyed. */
  instances: number
  /** Overrides that re-attach. */
  kept: number
  /** Overrides that can't be matched (go to the Fix broken overrides review). */
  unmatched: number
}

interface ReplaceComputation {
  ops: PlanOp[]
  notes: PlanNote[]
  preview: ReplaceMainPreview
}

/** True when `id` is `anc` or below it. */
function isUnder(nodes: Record<string, Rec>, id: string, anc: string): boolean {
  const seen = new Set<string>()
  for (let cur: unknown = id; typeof cur === "string" && !seen.has(cur); cur = nodes[cur]?.parent) {
    if (cur === anc) return true
    seen.add(cur)
  }
  return false
}

/** Local instances of `componentId` and of local components derived from it (transitively). */
function family(nodes: Record<string, Rec>, componentId: string): string[] {
  const fam = new Set([componentId])
  let grew = true
  while (grew) {
    grew = false
    for (const [id, n] of Object.entries(nodes))
      if (n.type === "instance" && n.component && fam.has(String(n.of)) && !fam.has(id)) {
        fam.add(id)
        grew = true
      }
  }
  return Object.entries(nodes)
    .filter(([id, n]) => n.type === "instance" && fam.has(String(n.of)) && id !== componentId)
    .map(([id]) => id)
    .sort(compareCodeUnits)
}

/** Can this replacement go ahead? Null when it can (rule: 1 main + 1 other non-instance node). */
export function replaceMainRefusal(
  ctx: PlanContext,
  mainId: string,
  sourceId: string,
): Plan | null {
  const nodes = nodeTable(ctx.doc)
  const main = nodes[mainId]
  const src = nodes[sourceId]
  if (!main || !src) return fail("NOT_FOUND", "Select a main component and one other layer")
  if (!main.component || main.type === "instance")
    return fail("NOT_A_COMPONENT", `${nameOf(main)} is not a main component`, mainId)
  if (mainId === sourceId || isUnder(nodes, sourceId, mainId) || isUnder(nodes, mainId, sourceId))
    return fail("INVALID", "The selection can't contain or sit inside the main", sourceId)
  if (src.type === "instance")
    return fail("INVALID", "Replace with a layer, not an instance", sourceId)
  if (src.component) return fail("INVALID", "The selection is a component itself", sourceId)
  if (typeof src.at === "string")
    return fail("INVALID", "Slot content can't replace a main", sourceId)
  // Instances inside the selection must not make the main contain itself.
  const kids = childIndex(nodes)
  const stack = [sourceId]
  while (stack.length) {
    const id = stack.pop() as string
    const n = nodes[id]
    if (n?.type === "instance" && typeof n.of === "string" && wouldCycle(ctx, mainId, n.of))
      return fail("CYCLE", `${nameOf(n)} would put "${nameOf(main)}" inside itself`, id)
    stack.push(...(kids.get(id) ?? []))
  }
  return null
}

function computeReplace(
  ctx: PlanContext,
  mainId: string,
  sourceId: string,
): ReplaceComputation | Plan {
  const refusal = replaceMainRefusal(ctx, mainId, sourceId)
  if (refusal) return refusal
  const nodes = nodeTable(ctx.doc)
  const main = nodes[mainId] as Rec
  const src = nodes[sourceId] as Rec
  const kids = childIndex(nodes)
  const container = src.type === "frame" || src.type === "group"
  const oldTop = kids.get(mainId) ?? []
  const newTop = container ? (kids.get(sourceId) ?? []) : [sourceId]
  const oldLayers = layersUnder(nodes, kids, oldTop, mainId, "")
  const newLayers = layersUnder(nodes, kids, newTop, mainId, "")
  // New children per (mapped) parent, by type, for the type + order fallback.
  const newByParent = new Map<string, LayerInfo[]>()
  for (const l of newLayers) {
    const list = newByParent.get(l.parent)
    if (list) list.push(l)
    else newByParent.set(l.parent, [l])
  }
  const map = new Map<string, string>([[mainId, mainId]])
  const used = new Set<string>()
  for (const o of oldLayers) {
    const byName = newLayers.find((n) => !used.has(n.id) && n.path === o.path)
    let pick = byName
    if (!pick) {
      const parent = map.get(o.parent)
      if (parent !== undefined) {
        const siblings = (newByParent.get(parent) ?? []).filter((n) => n.type === o.type)
        const cand = siblings[o.typeIndex]
        if (cand && !used.has(cand.id)) pick = cand
      }
    }
    if (pick) {
      map.set(o.id, pick.id)
      used.add(pick.id)
    }
  }
  const oldInfo = new Map(oldLayers.map((l) => [l.id, l]))

  const ops: PlanOp[] = []
  const notes: PlanNote[] = []
  // 1. The old layers go; the selection's layers move in (keeping their ids and order keys).
  for (const c of oldTop) ops.push({ op: "delete", id: c })
  for (const c of newTop)
    ops.push({ op: "move", id: c, parent: mainId, order: String(nodes[c]?.order ?? "a0") })
  // 2. The main takes the selection root's look (same type) and keeps id, name, props, position.
  const set: Rec = {}
  const unset: string[] = []
  if (container && src.type === main.type) {
    for (const [k, v] of Object.entries(src)) if (!KEEP_ON_MAIN.has(k)) set[k] = structuredClone(v)
    for (const k of Object.keys(main))
      if (!KEEP_ON_MAIN.has(k) && !Object.hasOwn(src, k)) unset.push(k)
  }
  // 3. Declared props: targets re-matched; a target that can't be matched drops the declaration.
  const remapPath = (path: string): string | null => {
    const [first, ...rest] = path.split("/")
    const to = map.get(first as string)
    return to === undefined ? null : [to, ...rest].join("/")
  }
  const remapProps = (owner: string, comp: unknown, root: string): Rec | null => {
    if (!isObject(comp) || !isObject(comp.props)) return null
    const props: Rec = {}
    let changed = false
    for (const [name, raw] of Object.entries(comp.props)) {
      if (!isObject(raw)) continue
      const def: Rec = { ...raw }
      if (typeof def.target === "string" && def.target !== root) {
        const to = remapPath(def.target)
        if (to === null) {
          notes.push({
            code: "PROP_DROPPED",
            message: `Prop "${name}" dropped: its layer is gone`,
            nodeId: owner,
            key: name,
          })
          changed = true
          continue
        }
        if (to !== def.target) changed = true
        def.target = to
      }
      if (isObject(def.targets)) {
        const targets: Rec = {}
        for (const [opt, list] of Object.entries(def.targets)) {
          if (!Array.isArray(list)) continue
          targets[opt] = list.flatMap((t) => {
            if (!isObject(t) || typeof t.target !== "string") return []
            if (t.target === root) return [t]
            const to = remapPath(t.target)
            changed = true
            return to === null ? [] : [{ ...t, target: to }]
          })
        }
        def.targets = targets
      }
      props[name] = def
    }
    if (!changed) return null
    return { ...comp, props }
  }
  const mainProps = remapProps(mainId, main.component, mainId)
  if (mainProps) set.component = mainProps
  if (Object.keys(set).length || unset.length)
    ops.push({ op: "update", id: mainId, set, ...(unset.length ? { unset } : {}) })
  // 4. Instances: re-key overrides; unmatched ones go to the stash.
  const insts = family(nodes, mainId)
  let kept = 0
  let unmatched = 0
  const fits = (key: string, ov: Rec, to: string): boolean => {
    const [first, ...rest] = to.split("/")
    const target = nodes[first as string]
    if (!target) return false
    const old = oldInfo.get(key.split("/")[0] as string)
    if (rest.length > 0) {
      // A deeper path crosses the nested instance: it must still be an instance of the same component.
      const oldNode = old ? nodes[old.id] : undefined
      return target.type === "instance" && oldNode?.of === target.of
    }
    if (ov.slot === true) return target.type === "frame" && isObject(target.slot)
    if (ov.replace === true) return true
    if (isObject(ov.set)) {
      const t = String(target.type)
      if (!isNodeType(t)) return false
      if (t === "instance") return true
      const keys = nodeKeys(t)
      return Object.keys(ov.set).every((k) => keys.has(k))
    }
    return true
  }
  for (const iid of insts) {
    const inst = nodes[iid] as Rec
    const overrides = isObject(inst.overrides) ? inst.overrides : {}
    const next: Rec = {}
    const stash: StashedOverride[] = []
    const rekey = new Map<string, string>()
    for (const [key, ov] of Object.entries(overrides)) {
      if (!isObject(ov)) continue
      const to = remapPath(key)
      if (to !== null && fits(key, ov, to) && !Object.hasOwn(next, to)) {
        next[to] = ov
        if (to !== key) rekey.set(key, to)
        kept++
      } else {
        const info = oldInfo.get(key.split("/")[0] as string)
        stash.push({
          key,
          override: structuredClone(ov),
          ...(info ? { path: info.path, type: info.type } : {}),
        })
        unmatched++
      }
    }
    // Derived components re-match their own prop targets too.
    const derivedProps = inst.component ? remapProps(iid, inst.component, iid) : null
    const touched = rekey.size > 0 || stash.length > 0 || derivedProps
    if (!touched) continue
    const iset: Rec = {}
    const iunset: string[] = []
    if (Object.keys(next).length) iset.overrides = next
    else if (inst.overrides !== undefined) iunset.push("overrides")
    if (stash.length) {
      const meta = isObject(inst.meta) ? { ...inst.meta } : {}
      const prev = Array.isArray(meta[BROKEN_OVERRIDES_META_KEY])
        ? (meta[BROKEN_OVERRIDES_META_KEY] as unknown[])
        : []
      meta[BROKEN_OVERRIDES_META_KEY] = [...prev, ...stash]
      iset.meta = meta
    }
    if (derivedProps) iset.component = derivedProps
    ops.push({ op: "update", id: iid, set: iset, ...(iunset.length ? { unset: iunset } : {}) })
    // Slot / replace content follows its override; stashed ones' content moves next to the
    // instance (kept on the canvas, not lost).
    for (const [cid, c] of Object.entries(nodes)) {
      if (c.parent !== iid || typeof c.at !== "string") continue
      const to = rekey.get(c.at)
      if (to !== undefined)
        ops.push({ op: "move", id: cid, parent: iid, at: to, order: String(c.order) })
      else if (!Object.hasOwn(next, c.at)) {
        ops.push({
          op: "move",
          id: cid,
          parent: typeof inst.parent === "string" ? inst.parent : null,
          at: null,
          order: `${String(inst.order ?? "a0")}V`,
        })
        notes.push({
          code: "SLOT_CONTENT_DELETED",
          message: `Content of "${c.at}" moved next to the instance`,
          nodeId: cid,
        })
      }
    }
  }
  // 5. The selection's root goes (its layers moved into the main).
  if (container) ops.push({ op: "delete", id: sourceId })
  return { ops, notes, preview: { instances: insts.length, kept, unmatched } }
}

/** The Replace dialog's counts, or the refusal. */
export function replaceMainPreview(
  ctx: PlanContext,
  mainId: string,
  sourceId: string,
): ReplaceMainPreview | Plan {
  const r = computeReplace(ctx, mainId, sourceId)
  return "preview" in r ? r.preview : r
}

/** Replace main with selection (one op group); selects the main afterwards. */
export function planReplaceMain(ctx: PlanContext, mainId: string, sourceId: string): Plan {
  const r = computeReplace(ctx, mainId, sourceId)
  if (!("preview" in r)) return r
  return ok(r.ops, r.notes, [mainId])
}

// --- Broken overrides ---------------------------------------------------------------------------

/** One broken override (a row of the Fix broken overrides dialog, board 27 ZNXQU). */
export interface BrokenOverride {
  /** The instance holding it. */
  instance: string
  /** Its override key (the old IdPath). */
  key: string
  /** `layer`: the key no longer resolves; `variable`: a binding in its `set` names no variable. */
  kind: "layer" | "variable"
  /** `stash`: kept in node meta (after Replace with selection); `live`: in `overrides`. */
  source: "stash" | "live"
  /** For `variable`: the field whose binding broke, and the variable it names. */
  field?: string
  variable?: string
  /** The override. */
  override: Rec
  /** Old layer name path ("Badge/Label") and type, when known. */
  path?: string
  type?: string
}

/** Variables a binding may name: local ones and those of loaded libraries (`alias:name`). */
function variableNames(ctx: PlanContext): {
  has(name: string): boolean
  loaded(alias: string): boolean
} {
  const local = new Set(Object.keys((ctx.doc.variables ?? {}) as Rec))
  return {
    has(name) {
      const { alias, name: n } = splitQualified(name)
      if (alias === null) return local.has(n)
      const lib = ctx.libraries?.[alias]
      return !lib || Object.hasOwn((lib.variables ?? {}) as Rec, n)
    },
    loaded(alias) {
      return Boolean(ctx.libraries?.[alias])
    },
  }
}

/**
 * Broken overrides of local instances (of `componentId`'s family, or of every component):
 * stashed ones, live keys that don't resolve, and set bindings to missing variables.
 */
export function brokenOverrides(ctx: PlanContext, componentId?: string): BrokenOverride[] {
  const nodes = nodeTable(ctx.doc)
  const scope = scopeOf(ctx)
  const vars = variableNames(ctx)
  const ids = componentId
    ? family(nodes, componentId)
    : Object.keys(nodes)
        .filter((id) => nodes[id]?.type === "instance")
        .sort(compareCodeUnits)
  const out: BrokenOverride[] = []
  for (const iid of ids) {
    const inst = nodes[iid] as Rec
    const meta = isObject(inst.meta) ? inst.meta : {}
    const stash = meta[BROKEN_OVERRIDES_META_KEY]
    if (Array.isArray(stash))
      for (const s of stash)
        if (isObject(s) && typeof s.key === "string" && isObject(s.override))
          out.push({
            instance: iid,
            key: s.key,
            kind: "layer",
            source: "stash",
            override: s.override,
            ...(typeof s.path === "string" ? { path: s.path } : {}),
            ...(typeof s.type === "string" ? { type: s.type } : {}),
          })
    if (!isObject(inst.overrides) || typeof inst.of !== "string") continue
    const c = locate(scope, inst.of)
    if (!isLocated(c)) continue
    const swaps = instanceSwaps(scope, c, inst)
    for (const [key, ov] of Object.entries(inst.overrides)) {
      if (!isObject(ov)) continue
      const r = resolveIdPath(scope, c, key, { swaps })
      if (!r.ok && r.unchecked === undefined) {
        out.push({ instance: iid, key, kind: "layer", source: "live", override: ov })
        continue
      }
      if (isObject(ov.set))
        for (const [field, v] of Object.entries(ov.set))
          if (isRef(v) && !vars.has(v.$ref))
            out.push({
              instance: iid,
              key,
              kind: "variable",
              source: "live",
              field,
              variable: v.$ref,
              override: ov,
            })
    }
  }
  return out
}

/** A remap candidate for a broken row. */
export interface RemapCandidate {
  /** Layer: the new IdPath (a descendant id). Variable: the variable name. */
  value: string
  /** "Tag/Label", "$brand:accent". */
  label: string
}

/**
 * Remap suggestions, best first: for a layer, descendants of the component whose type takes
 * every overridden field (name path match first, then same type, then document order); for a
 * variable, variables of the same type (similar name first).
 */
export function remapCandidates(ctx: PlanContext, b: BrokenOverride): RemapCandidate[] {
  const nodes = nodeTable(ctx.doc)
  const inst = nodes[b.instance]
  if (b.kind === "variable") {
    const doc = ctx.doc
    const all: [string, Rec][] = Object.entries((doc.variables ?? {}) as Record<string, Rec>)
    for (const [alias, lib] of Object.entries(ctx.libraries ?? {}))
      for (const [n, v] of Object.entries((lib.variables ?? {}) as Record<string, Rec>))
        all.push([`${alias}:${n}`, v])
    const leaf = (s: string) => s.split(/[/:]/).pop() ?? s
    const want = leaf(b.variable ?? "")
    return all
      .filter(([n]) => n !== b.variable)
      .sort(
        ([a], [c]) =>
          Number(leaf(c) === want) - Number(leaf(a) === want) ||
          Number(c.split(":")[0] === (b.variable ?? "").split(":")[0]) -
            Number(a.split(":")[0] === (b.variable ?? "").split(":")[0]) ||
          compareCodeUnits(a, c),
      )
      .map(([n]) => ({ value: n, label: `$${n}` }))
  }
  if (!inst || typeof inst.of !== "string") return []
  const c = locate(scopeOf(ctx), inst.of)
  if (!isLocated(c) || c.alias !== null) return []
  const kids = childIndex(nodes)
  const layers = layersUnder(nodes, kids, kids.get(c.id) ?? [], c.id, "")
  const fields = isObject(b.override.set) ? Object.keys(b.override.set) : []
  const ok = layers.filter((l) => {
    if (b.override.slot === true) return isObject(nodes[l.id]?.slot)
    if (!isNodeType(l.type) || l.type === "instance")
      return fields.length === 0 || l.type === "instance"
    const keys = nodeKeys(l.type)
    return fields.every((f) => keys.has(f))
  })
  const score = (l: LayerInfo) =>
    (b.path && l.path === b.path ? 4 : 0) +
    (b.path && l.path.split("/").pop() === b.path.split("/").pop() ? 2 : 0) +
    (b.type && l.type === b.type ? 1 : 0)
  return ok
    .map((l, i) => ({ l, i, s: score(l) }))
    .sort((a, z) => z.s - a.s || a.i - z.i)
    .map(({ l }) => ({ value: l.id, label: l.path }))
}

/** One row's choice in the Review dialog. */
export type OverrideFix =
  | { action: "keep" }
  | { action: "reset" }
  /** Layer: the new key; variable: the new variable name. */
  | { action: "remap"; to: string }

/** A fix addressed to one broken override. */
export interface OverrideFixRequest {
  instance: string
  key: string
  kind: BrokenOverride["kind"]
  source: BrokenOverride["source"]
  field?: string
  fix: OverrideFix
}

/** Apply: every Remap / Reset at once (Keep leaves the row as it is). One op group. */
export function planFixOverrides(ctx: PlanContext, fixes: readonly OverrideFixRequest[]): Plan {
  const nodes = nodeTable(ctx.doc)
  const byInst = new Map<string, OverrideFixRequest[]>()
  for (const f of fixes) {
    if (f.fix.action === "keep") continue
    const l = byInst.get(f.instance)
    if (l) l.push(f)
    else byInst.set(f.instance, [f])
  }
  const ops: PlanOp[] = []
  for (const [iid, list] of byInst) {
    const inst = nodes[iid]
    if (inst?.type !== "instance") return fail("NOT_AN_INSTANCE", `${iid} is not an instance`, iid)
    const overrides: Rec = isObject(inst.overrides) ? { ...inst.overrides } : {}
    const meta: Rec = isObject(inst.meta) ? { ...inst.meta } : {}
    let stash: StashedOverride[] = Array.isArray(meta[BROKEN_OVERRIDES_META_KEY])
      ? (meta[BROKEN_OVERRIDES_META_KEY] as StashedOverride[]).slice()
      : []
    const moveAt = new Map<string, string>()
    for (const f of list) {
      if (f.kind === "variable") {
        const ov = overrides[f.key]
        if (!isObject(ov) || !isObject(ov.set) || f.field === undefined) continue
        const s = { ...ov.set }
        if (f.fix.action === "reset") delete s[f.field]
        else if (f.fix.action === "remap") s[f.field] = { $ref: f.fix.to }
        if (Object.keys(s).length) overrides[f.key] = { ...ov, set: s }
        else delete overrides[f.key]
        continue
      }
      let ov: Rec | undefined
      if (f.source === "stash") {
        const i = stash.findIndex((s) => s.key === f.key)
        if (i < 0) continue
        ov = stash[i]?.override
        stash = stash.filter((_, j) => j !== i)
      } else {
        ov = isObject(overrides[f.key]) ? (overrides[f.key] as Rec) : undefined
        delete overrides[f.key]
      }
      if (f.fix.action === "remap" && ov) {
        const prev = overrides[f.fix.to]
        overrides[f.fix.to] =
          isObject(prev) && isObject(prev.set) && isObject(ov.set)
            ? { set: { ...prev.set, ...ov.set } }
            : ov
        if (f.source === "live") moveAt.set(f.key, f.fix.to)
      }
    }
    const set: Rec = {}
    const unset: string[] = []
    if (Object.keys(overrides).length) set.overrides = overrides
    else if (inst.overrides !== undefined) unset.push("overrides")
    if (stash.length) meta[BROKEN_OVERRIDES_META_KEY] = stash
    else delete meta[BROKEN_OVERRIDES_META_KEY]
    if (Object.keys(meta).length) set.meta = meta
    else if (inst.meta !== undefined) unset.push("meta")
    ops.push({ op: "update", id: iid, set, ...(unset.length ? { unset } : {}) })
    for (const [cid, c] of Object.entries(nodes)) {
      if (c.parent !== iid || typeof c.at !== "string") continue
      const to = moveAt.get(c.at)
      if (to !== undefined)
        ops.push({ op: "move", id: cid, parent: iid, at: to, order: String(c.order) })
    }
  }
  return ok(ops)
}

/** The declared props of the component a local instance instantiates (Review rows' context). */
export function componentOfFamily(ctx: PlanContext, instanceId: string): string | null {
  const nodes = nodeTable(ctx.doc)
  const seen = new Set<string>()
  let cur = nodes[instanceId]
  while (cur?.type === "instance" && typeof cur.of === "string" && !seen.has(cur.of)) {
    seen.add(cur.of)
    const next = nodes[cur.of]
    if (!next) return null
    if (next.type !== "instance") return cur.of
    cur = next
  }
  return null
}
