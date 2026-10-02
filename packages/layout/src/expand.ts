/**
 * Instance expansion (spec §9): a {@link NodeSource} wrapper under which every `instance` node
 * reads as its component's root (with `props`, `args` and `overrides` applied) and has the
 * component's descendants as children.
 *
 * Expanded descendants get synthetic ids `<instance id>/<IdPath key>`: the key is the
 * descendant's id in the component's namespace (`id`, or `alias:id` for a library), one segment
 * per instance boundary — exactly the IdPath an override uses (§9.5), so `inst1/btnLabel` is the
 * node an override `"btnLabel"` of `inst1` targets. Instance-owned nodes (§9.4) of a top-level
 * instance keep their real ids; those owned by a nested instance inside a component are
 * descendants of that component and get synthetic ids like any other.
 *
 * Expansion is lazy (on the first `getNode`/`children` of an instance) and cached for the
 * wrapper's lifetime: create a new wrapper (or call `invalidate()`) after the store changes.
 */
import { isObject, type KimoDocument, type Libraries, splitQualified } from "@kimo/core-schema"
import type { LayoutIssue, LayoutNodeData, NodeSource } from "./types"

/** Options for {@link expandInstances}. */
export interface ExpandOptions {
  /** Imported libraries by alias (for `alias:id` components). */
  libraries?: Libraries
  /** Called for each expansion problem (also kept per instance in `issues(id)`). */
  onIssue?: (issue: LayoutIssue) => void
}

/** A node source with instances expanded. */
export interface ExpandedNodeSource extends NodeSource {
  /** The wrapped (unexpanded) source. */
  readonly base: NodeSource
  /** True for ids that exist only in the expansion (`<instance>/<path>`). */
  isSynthetic(id: string): boolean
  /** Expansion issues reported for an instance (missing component, cycle, …). */
  issues(id: string): readonly LayoutIssue[]
  /** Number of instances expanded so far. */
  readonly instanceCount: number
  /** Drops every cached expansion. */
  invalidate(): void
}

/** Keys an override `set` may not change (§9.3). */
const FORBIDDEN_SET = new Set(["type", "parent", "at", "order", "component", "overrides"])
/** Placement fields: an instance's own, never taken from the component root (§5.2). */
const PLACEMENT = ["parent", "at", "order", "name", "x", "y", "position", "theme", "locked", "meta"]

interface Ns {
  alias: string | null
  src: NodeSource
}

/** Where a node lives while expanding: its namespace, its out-id prefix and the overrides. */
interface Ctx {
  ns: Ns
  /** null = real ids (the top level); else ids become `${prefix}/${key}`. */
  prefix: string | null
  /** Overrides keyed by IdPath relative to the instance being expanded. */
  layers: Layers | null
  /** Components being expanded (cycle guard). */
  stack: readonly string[]
}

/** The owner of a slot/replace override: the instance whose `at` children fill it. */
interface Owner {
  ctx: Ctx
  realId: string
  key: string
}

interface LayerEntry {
  sets: Record<string, unknown>[]
  slot?: Owner
  replace?: Owner
}
type Layers = Map<string, LayerEntry>

const entryOf = (layers: Layers, key: string): LayerEntry => {
  let e = layers.get(key)
  if (!e) {
    e = { sets: [] }
    layers.set(key, e)
  }
  return e
}

/** `low` then `high` (high wins). */
function combine(low: Layers, high: Layers): Layers {
  const out: Layers = new Map()
  for (const src of [low, high])
    for (const [k, e] of src) {
      const t = entryOf(out, k)
      t.sets.push(...e.sets)
      if (e.slot) t.slot = e.slot
      if (e.replace) t.replace = e.replace
    }
  return out
}

/** The layers below a nested instance at `key`, re-keyed relative to it. */
function sublayers(layers: Layers | null, key: string): Layers {
  const out: Layers = new Map()
  if (!layers) return out
  const p = `${key}/`
  for (const [k, e] of layers) if (k.startsWith(p)) out.set(k.slice(p.length), e)
  return out
}

function applySets(n: LayoutNodeData, sets: readonly Record<string, unknown>[] | undefined) {
  if (!sets || sets.length === 0) return n
  const out: Record<string, unknown> = { ...n }
  for (const s of sets)
    for (const [k, v] of Object.entries(s)) if (!FORBIDDEN_SET.has(k)) out[k] = v
  return out as LayoutNodeData
}

/** Wraps `base` so instances read as expanded component trees. */
export function expandInstances(base: NodeSource, options: ExpandOptions = {}): ExpandedNodeSource {
  const libs = options.libraries ?? {}
  const local: Ns = { alias: null, src: base }
  const libNs = new Map<string, Ns | null>()
  let data = new Map<string, LayoutNodeData>()
  let kids = new Map<string, string[]>()
  let issueMap = new Map<string, LayoutIssue[]>()
  let count = 0

  const report = (nodeId: string, code: LayoutIssue["code"], message: string, path?: string) => {
    const issue: LayoutIssue = { code, severity: "warning", nodeId, message }
    if (path) issue.path = path
    const list = issueMap.get(nodeId)
    if (list) list.push(issue)
    else issueMap.set(nodeId, [issue])
    options.onIssue?.(issue)
  }

  const library = (alias: string): Ns | null => {
    if (!libNs.has(alias)) {
      const doc = libs[alias] as KimoDocument | undefined
      libNs.set(alias, doc ? { alias, src: librarySource(doc) } : null)
    }
    return libNs.get(alias) ?? null
  }

  const qualify = (ns: Ns, id: string) => (ns.alias ? `${ns.alias}:${id}` : id)

  /** Resolves a component QId as seen from namespace `ns`. */
  const resolveQId = (
    qid: unknown,
    ns: Ns,
  ): { ns: Ns; id: string; node: LayoutNodeData } | string => {
    if (typeof qid !== "string" || !qid) return "instance has no `of`"
    const { alias, name } = splitQualified(qid)
    let target = ns
    if (alias !== null) {
      if (ns.alias !== null && alias !== ns.alias)
        return `component ${qid} is in a library imported by a library (not resolved in 0.1)`
      const lib = ns.alias === alias ? ns : library(alias)
      if (!lib) return `library "${alias}" is not loaded`
      target = lib
    }
    const node = target.src.getNode(name)
    if (!node) return `component ${qid} not found`
    return { ns: target, id: name, node }
  }

  /** Declared props of a component, following derived components (§9.6). */
  const declaredProps = (
    node: LayoutNodeData,
    ns: Ns,
    depth = 0,
  ): Record<string, Record<string, unknown>> => {
    let out: Record<string, Record<string, unknown>> = {}
    if (node.type === "instance" && depth < 32) {
      const r = resolveQId(node.of, ns)
      if (typeof r !== "string") out = declaredProps(r.node, r.ns, depth + 1)
    }
    const c = node.component
    if (isObject(c) && isObject(c.props))
      for (const [k, v] of Object.entries(c.props)) if (isObject(v)) out = { ...out, [k]: v }
    return out
  }

  /** An instance's own overrides (props → root, args → targets, overrides), lowest first. */
  const ownLayers = (inst: LayoutNodeData, comp: LayoutNodeData, compNs: Ns, owner: Owner) => {
    const layers: Layers = new Map()
    if (isObject(inst.props)) entryOf(layers, "").sets.push(inst.props)
    if (isObject(inst.args)) {
      const defs = declaredProps(comp, compNs)
      for (const [name, value] of Object.entries(inst.args)) {
        const def = defs[name]
        if (!def || typeof def.target !== "string") continue
        let set: Record<string, unknown> | null = null
        if (def.type === "text") set = { content: value }
        else if (def.type === "boolean") set = { visible: value }
        else if (def.type === "instance") set = { of: value }
        else if (def.type === "enum" && typeof def.field === "string" && isObject(def.options)) {
          if (typeof value === "string" && Object.hasOwn(def.options, value))
            set = { [def.field]: def.options[value] }
        }
        if (set) entryOf(layers, def.target).sets.push(set)
      }
    }
    if (isObject(inst.overrides))
      for (const [key, ov] of Object.entries(inst.overrides)) {
        if (!isObject(ov)) continue
        const e = entryOf(layers, key)
        if (isObject(ov.set)) e.sets.push(ov.set)
        else if (ov.slot === true) e.slot = { ...owner, key }
        else if (ov.replace === true) e.replace = { ...owner, key }
      }
    return layers
  }

  const pushKid = (parent: string, id: string) => {
    const l = kids.get(parent)
    if (l) l.push(id)
    else kids.set(parent, [id])
  }

  /**
   * Expands instance `inst` (already merged with any override targeting it) at `outId`.
   * `owner` is where the instance itself lives; `outer` holds overrides from enclosing instances.
   */
  const expandInstance = (
    outId: string,
    inst: LayoutNodeData,
    owner: Omit<Owner, "key">,
    outer: Layers,
    placement: Record<string, unknown>,
  ) => {
    count++
    kids.set(outId, [])
    const placeholder = (why: string, code: LayoutIssue["code"] = "UNSUPPORTED_NODE") => {
      report(outId, code, why, "/of")
      // Keep the instance (drawn as a placeholder); its `props` still size it.
      data.set(outId, { ...inst, ...placement } as LayoutNodeData)
    }
    const r = resolveQId(inst.of, owner.ctx.ns)
    if (typeof r === "string") return placeholder(r)
    const compKey = `${r.ns.alias ?? ""}:${r.id}`
    if (owner.ctx.stack.includes(compKey))
      return placeholder(`instance cycle through ${qualify(r.ns, r.id)}`, "CYCLE")
    if (!r.node.component)
      report(outId, "UNSUPPORTED_NODE", `${qualify(r.ns, r.id)} is not a component`, "/of")
    const layers = combine(ownLayers(inst, r.node, r.ns, { ...owner, key: "" }), outer)
    const stack = [...owner.ctx.stack, compKey]
    if (r.node.type === "instance") {
      // Derived component: paths resolve through it (§9.5); its owned nodes are descendants.
      const ctx: Ctx = { ns: r.ns, prefix: outId, layers: null, stack }
      expandInstance(outId, r.node, { ctx, realId: r.id }, layers, placement)
      return
    }
    const root: Record<string, unknown> = { ...applySets(r.node, layers.get("")?.sets) }
    delete root.component
    for (const k of PLACEMENT) delete root[k]
    data.set(outId, { ...root, ...placement } as LayoutNodeData)
    const ctx: Ctx = { ns: r.ns, prefix: outId, layers, stack }
    emitChildren(outId, r.id, null, ctx)
  }

  const emitChildren = (outParent: string, srcParent: string, key: string | null, ctx: Ctx) => {
    const slot = key !== null ? ctx.layers?.get(key)?.slot : undefined
    if (slot) {
      for (const id of slot.ctx.ns.src.children(slot.realId, slot.key))
        emitNode(id, slot.ctx, outParent)
      return
    }
    for (const id of ctx.ns.src.children(srcParent)) emitNode(id, ctx, outParent)
  }

  const emitNode = (srcId: string, ctx: Ctx, outParent: string) => {
    const n = ctx.ns.src.getNode(srcId)
    if (!n) return
    const key = qualify(ctx.ns, srcId)
    const entry = ctx.layers?.get(key)
    if (entry?.replace) {
      const rep = entry.replace
      const first = rep.ctx.ns.src.children(rep.realId, rep.key)[0]
      if (first !== undefined) emitNode(first, rep.ctx, outParent)
      return
    }
    const outId = ctx.prefix === null ? srcId : `${ctx.prefix}/${key}`
    pushKid(outParent, outId)
    const merged = applySets(n, entry?.sets)
    if (merged.type === "instance") {
      const placement: Record<string, unknown> = { parent: outParent }
      for (const k of PLACEMENT)
        if (k !== "parent" && merged[k] !== undefined) placement[k] = merged[k]
      delete placement.at
      expandInstance(outId, merged, { ctx, realId: srcId }, sublayers(ctx.layers, key), placement)
      return
    }
    const out: Record<string, unknown> = { ...merged, parent: outParent }
    delete out.at
    data.set(outId, out as LayoutNodeData)
    emitChildren(outId, srcId, key, ctx)
  }

  const expandTop = (id: string, n: LayoutNodeData) => {
    const ctx: Ctx = { ns: local, prefix: null, layers: null, stack: [] }
    const placement: Record<string, unknown> = {}
    for (const k of PLACEMENT) if (n[k] !== undefined) placement[k] = n[k]
    expandInstance(id, n, { ctx, realId: id }, new Map(), placement)
  }

  const ensure = (id: string): void => {
    if (data.has(id)) return
    const n = base.getNode(id)
    if (n) {
      if (n.type === "instance") expandTop(id, n)
      return
    }
    const slash = id.indexOf("/")
    if (slash > 0) ensure(id.slice(0, slash))
  }

  return {
    base,
    getNode(id) {
      ensure(id)
      return data.get(id) ?? base.getNode(id)
    },
    children(parent, at) {
      if (parent !== null && at == null) {
        ensure(parent)
        const k = kids.get(parent)
        if (k) return k
      }
      return base.children(parent, at)
    },
    isSynthetic: (id) => id.includes("/") && base.getNode(id) === undefined,
    issues: (id) => issueMap.get(id) ?? [],
    get instanceCount() {
      return count
    },
    invalidate() {
      data = new Map()
      kids = new Map()
      issueMap = new Map()
      libNs.clear()
      count = 0
    },
  }
}

/** A node source over a library document, including instance-owned (`at`) children. */
function librarySource(doc: Pick<KimoDocument, "nodes">): NodeSource {
  const nodes = doc.nodes as Record<string, LayoutNodeData>
  const byParent = new Map<string, string[]>()
  for (const [id, n] of Object.entries(nodes)) {
    if (!isObject(n) || typeof n.parent !== "string") continue
    const k = `${n.parent}\u0000${typeof n.at === "string" ? n.at : ""}`
    const l = byParent.get(k)
    if (l) l.push(id)
    else byParent.set(k, [id])
  }
  for (const l of byParent.values())
    l.sort((a, b) => {
      const oa = (nodes[a] as LayoutNodeData).order
      const ob = (nodes[b] as LayoutNodeData).order
      return oa < ob ? -1 : oa > ob ? 1 : a < b ? -1 : a > b ? 1 : 0
    })
  return {
    getNode: (id) => (Object.hasOwn(nodes, id) ? nodes[id] : undefined),
    children: (parent, at) =>
      parent === null ? [] : (byParent.get(`${parent}\u0000${at ?? ""}`) ?? []),
  }
}
