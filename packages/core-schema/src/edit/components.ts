/**
 * Planners for components, instances, overrides, declared props and slots (spec §9; M3,
 * ADR 0011; desing.pen boards 11, 12, 13, 15). Each returns a {@link Plan}: ops for ONE
 * `store.apply` (one undo step) plus notes for the UI.
 */
import {
  applySetEntry,
  COMPONENT_DESCRIPTION_META_KEY,
  type ComponentScope,
  componentOfInstance,
  type DeclaredProp,
  declaredProps,
  derivedChain,
  instanceSwaps,
  isComponentNode,
  isLocated,
  type LocatedNode,
  locate,
  nodesOf,
  qualify,
  qualifyPath,
  resolveIdPath,
} from "../components"
import { documentLookup, qualifyNodeData } from "../expand"
import { isObject, setOwn } from "../json"
import { isRef, splitQualified } from "../resolve"
import type { PropDef } from "../schema/nodes"
import { compareCodeUnits } from "../tree"
import {
  fail,
  idGenerator,
  nodeTable,
  ok,
  orderBetween,
  ownedAt,
  type Plan,
  type PlanContext,
  type PlanNote,
  type PlanOp,
} from "./plan"

type Rec = Record<string, unknown>

/** Fields a `set` on a nested instance takes at its top level (§9.3); others go in `props`. */
const INSTANCE_SET_FIELDS = new Set([
  "of",
  "props",
  "args",
  "theme",
  "name",
  "x",
  "y",
  "position",
  "locked",
  "meta",
])

/** Placement fields (§5.2). */
const PLACEMENT = ["parent", "at", "order", "name", "x", "y", "position", "theme", "locked", "meta"]

const scopeOf = (ctx: PlanContext): ComponentScope => ({ doc: ctx.doc, libraries: ctx.libraries })

const node = (ctx: PlanContext, id: string): Rec | undefined => {
  const n = nodeTable(ctx.doc)[id]
  return isObject(n) ? n : undefined
}

/** The component a local instance instantiates, or a failure plan. */
function componentOfLocal(ctx: PlanContext, instanceId: string): LocatedNode | Plan {
  const inst = node(ctx, instanceId)
  if (!inst) return fail("NOT_FOUND", `Node ${instanceId} does not exist`, instanceId)
  if (inst.type !== "instance")
    return fail("NOT_AN_INSTANCE", `${instanceId} is not an instance`, instanceId)
  const c = locate(scopeOf(ctx), String(inst.of))
  if (isLocated(c)) return c
  if (c.reason === "library-not-loaded" || c.reason === "nested-library")
    return fail("LIBRARY_NOT_LOADED", `The library of ${String(inst.of)} is not loaded`, instanceId)
  return fail("NOT_FOUND", `Component ${String(inst.of)} does not exist`, instanceId)
}

const isPlan = (v: unknown): v is Plan => isObject(v) && typeof v.ok === "boolean"

/**
 * True when placing an instance of `of` at `host` (a local node: the new parent, or the
 * instance being swapped) would make a component contain itself (§9.1 `INSTANCE_CYCLE`):
 * some component enclosing `host` (along parent links, through instance-owned nodes) is
 * reachable from `of` through derived chains and the instances inside component content.
 * Only local components can enclose `host`, and library content never reaches the consumer.
 */
export function wouldCycle(
  ctx: PlanContext,
  host: string | null,
  of: string,
  extraHosts: Iterable<string> = [],
): boolean {
  const nodes = nodeTable(ctx.doc)
  const hosts = new Set<string>()
  for (const h of extraHosts) if (!h.includes(":")) hosts.add(h)
  const seen = new Set<string>()
  let cur: unknown = host
  while (typeof cur === "string" && !seen.has(cur)) {
    seen.add(cur)
    const n = nodes[cur]
    if (!isObject(n)) break
    if (n.component) hosts.add(cur)
    cur = n.parent
  }
  if (hosts.size === 0) return false
  // Local instances by enclosing component (one pass), then BFS from `of`. Swaps and
  // instance-prop args count too: they place a component inside the components holding the
  // target (as in the validator's INSTANCE_CYCLE check and the expansion's cycle guard).
  const inside = new Map<string, string[]>()
  const edge = (from: string, to: unknown) => {
    if (typeof to !== "string") return
    const l = inside.get(from)
    if (l) l.push(to)
    else inside.set(from, [to])
  }
  const scope = scopeOf(ctx)
  for (const n of Object.values(nodes)) {
    if (n.type !== "instance" || typeof n.of !== "string") continue
    const enclosing: string[] = []
    const seenUp = new Set<string>()
    let p: unknown = n.parent
    while (typeof p === "string" && !seenUp.has(p)) {
      seenUp.add(p)
      const pn = nodes[p]
      if (!isObject(pn)) break
      if (pn.component) enclosing.push(p)
      p = pn.parent
    }
    for (const e of enclosing) edge(e, n.of)
    if (!isObject(n.overrides) && !isObject(n.args)) continue
    const c = locate(scope, n.of)
    if (!isLocated(c)) continue
    const swaps = instanceSwaps(scope, c, n)
    if (swaps.size === 0) continue
    for (const [path, to] of swaps)
      for (const h of [...enclosing, ...pathHolders(ctx, c, path, swaps)]) edge(h, to)
  }
  const reached = new Set<string>()
  const queue = [of]
  while (queue.length) {
    const c = queue.pop() as string
    if (reached.has(c) || c.includes(":")) continue
    reached.add(c)
    if (hosts.has(c)) return true
    const n = nodes[c]
    if (isObject(n) && n.type === "instance" && typeof n.of === "string") queue.push(n.of)
    for (const o of inside.get(c) ?? []) queue.push(o)
  }
  return false
}

const cycleFail = (of: string, nodeId?: string) =>
  fail("CYCLE", `An instance of ${of} can't go inside its own component`, nodeId)

/**
 * The local components that hold the nested instance at `path` of an instance of `c`: `c`'s
 * derived chain and the (possibly swapped) component of every instance the path crosses. A
 * swap or instance-prop arg placing one of them at `path` nests a component in itself (the
 * expansion reports `INSTANCE_CYCLE`), so those are refused like a direct cycle.
 */
function pathHolders(
  ctx: PlanContext,
  c: LocatedNode,
  path: string,
  swaps: ReadonlyMap<string, string>,
): string[] {
  const scope = scopeOf(ctx)
  const out: string[] = []
  const add = (l: LocatedNode) => {
    for (const x of derivedChain(scope, l)) if (x.alias === null) out.push(x.id)
  }
  add(c)
  const segs = path.split("/")
  for (let i = 1; i < segs.length; i++) {
    const prefix = segs.slice(0, i).join("/")
    const r = resolveIdPath(scope, c, prefix, { swaps })
    if (!r.ok) break
    const sw = swaps.get(prefix)
    const comp = sw !== undefined ? locate(scope, sw) : componentOfInstance(scope, r.target)
    if (!isLocated(comp)) break
    add(comp)
  }
  return out
}

/**
 * Drops the override keys (under `prefix`, `""` = all) of instance `instanceId` that no
 * longer resolve once `next` (its new `of` component, args and overrides) applies — e.g. deep
 * overrides of a nested instance that was just swapped. Owned nodes of dropped slot/replace
 * entries are deleted. Mutates `overrides`; pushes ops and OVERRIDE_DROPPED notes.
 */
function dropStaleOverrides(
  ctx: PlanContext,
  c: LocatedNode,
  instanceId: string,
  next: Rec,
  overrides: Rec,
  prefix: string,
  ops: PlanOp[],
  notes: PlanNote[],
): void {
  const scope = scopeOf(ctx)
  const swaps = instanceSwaps(scope, c, { ...next, overrides })
  for (const k of Object.keys(overrides)) {
    if (prefix !== "" && !k.startsWith(`${prefix}/`)) continue
    const r = resolveIdPath(scope, c, k, { swaps })
    const ov = overrides[k]
    const slotOk = r.ok && (!isObject(ov) || ov.slot !== true || isObject(r.target.node.slot))
    if (slotOk || (!r.ok && r.unchecked !== undefined)) continue
    delete overrides[k]
    notes.push({
      code: "OVERRIDE_DROPPED",
      message: `Override "${k}" dropped`,
      nodeId: instanceId,
      key: k,
    })
    for (const id of ownedAt(ctx.doc, instanceId, k)) ops.push({ op: "delete", id })
  }
}

/** Refuses edits of a component that belongs to a linked library (read-only, §11). */
const libraryReadOnly = (id: string): Plan | null =>
  aliasOfQId(id) !== null ? fail("LIBRARY_READ_ONLY", `${id} is from a linked library`, id) : null

// --- Create ---------------------------------------------------------------------------------

/** Options of {@link planCreateComponent}. */
export interface CreateComponentOptions {
  /** Layer name of the new main (default: the node's name). */
  name?: string
  /**
   * Wrap the selection in a new frame that becomes the main: required for several nodes.
   * Box in the shared parent's coordinate space (the host reads it from the layout).
   */
  wrap?: { x: number; y: number; w: number; h: number; name?: string }
}

/**
 * Create component (⌥⌘K, board 12): turns the selection into a main **in place**. One
 * non-instance node → `component: true`; one instance → a derived component (§9.1); several
 * nodes (siblings) → a new frame wrapping them, marked `component`. Keeps the optional
 * `components` index in sync.
 */
export function planCreateComponent(
  ctx: PlanContext,
  ids: readonly string[],
  options: CreateComponentOptions = {},
): Plan {
  if (ids.length === 0) return fail("INVALID", "Nothing selected")
  for (const id of ids) {
    const n = node(ctx, id)
    if (!n) return fail("NOT_FOUND", `Node ${id} does not exist`, id)
    if (typeof n.at === "string" || node(ctx, String(n.parent))?.type === "instance")
      return fail("INVALID", "Instance content can't become a component — detach first", id)
  }
  const index = (ctx.doc as unknown as Rec).components
  const withIndex = (cid: string): PlanOp[] =>
    Array.isArray(index) && !index.includes(cid)
      ? [{ op: "setHeader", set: { components: [...index, cid] } }]
      : []
  if (ids.length === 1 && !options.wrap) {
    const id = ids[0] as string
    const n = node(ctx, id) as Rec
    if (n.component) return fail("INVALID", `${id} is already a component`, id)
    const set: Rec = { component: true }
    if (options.name !== undefined) set.name = options.name
    return ok([...withIndex(id), { op: "update", id, set }], [], [id])
  }
  if (!options.wrap) return fail("INVALID", "Several nodes need a wrapping frame box")
  const parents = new Set(ids.map((id) => (node(ctx, id) as Rec).parent))
  if (parents.size !== 1) return fail("INVALID", "Selected nodes must share a parent")
  const parent = [...parents][0] as string | null
  const w = options.wrap
  const frameId = idGenerator(ctx)()
  const first = [...ids].sort((a, b) =>
    compareCodeUnits(String(node(ctx, a)?.order), String(node(ctx, b)?.order)),
  )[0] as string
  const frame: Rec = {
    type: "frame",
    name: w.name ?? options.name ?? "Component",
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    component: true,
  }
  const ops: PlanOp[] = [
    { op: "insert", id: frameId, node: frame, parent, order: String(node(ctx, first)?.order) },
  ]
  for (const id of ids) {
    const n = node(ctx, id) as Rec
    ops.push({ op: "move", id, parent: frameId, order: String(n.order) })
    const set: Rec = {}
    if (typeof n.x === "number") set.x = n.x - w.x
    if (typeof n.y === "number") set.y = n.y - w.y
    if (Object.keys(set).length) ops.push({ op: "update", id, set })
  }
  return ok([...ops, ...withIndex(frameId)], [], [frameId])
}

/** Where a new instance goes. */
export interface InstancePlacement {
  parent: string | null
  /** For slot content: the slot IdPath of `parent` (an instance); writes `{ slot: true }`. */
  at?: string
  index?: number
  x?: number
  y?: number
  name?: string
  /** Explicit id (default: generated). */
  id?: string
}

/**
 * Inserts an instance of `of` (a local component id or `alias:id`). With `at`, the instance
 * becomes slot content of instance `parent` (board 13 "drop on a slot"), adding the `slot`
 * override when missing.
 */
export function planCreateInstance(
  ctx: PlanContext,
  of: string,
  placement: InstancePlacement,
): Plan {
  const c = locate(scopeOf(ctx), of)
  if (!isLocated(c)) {
    if (c.reason === "library-not-loaded" || c.reason === "alias-unknown")
      return fail("LIBRARY_NOT_LOADED", `The library of ${of} is not linked or loaded`)
    return fail("NOT_FOUND", `Component ${of} does not exist`)
  }
  if (!isComponentNode(c.node)) return fail("NOT_A_COMPONENT", `${of} is not a component`)
  if (wouldCycle(ctx, placement.parent, of)) return cycleFail(of)
  const id = placement.id ?? idGenerator(ctx)()
  const body: Rec = { type: "instance", of }
  if (placement.name !== undefined) body.name = placement.name
  if (placement.x !== undefined) body.x = placement.x
  if (placement.y !== undefined) body.y = placement.y
  const ops: PlanOp[] = []
  if (placement.at !== undefined) {
    const slot = ensureSlot(ctx, String(placement.parent), placement.at)
    if (isPlan(slot)) return slot
    ops.push(...slot)
  }
  const insert: PlanOp = { op: "insert", id, node: body, parent: placement.parent }
  if (placement.at !== undefined) insert.at = placement.at
  if (placement.index !== undefined) insert.index = placement.index
  ops.push(insert)
  return ok(ops, [], [id])
}

/** Ops adding `{ slot: true }` at `path` of `instanceId` when missing (validated target). */
function ensureSlot(ctx: PlanContext, instanceId: string, path: string): PlanOp[] | Plan {
  const c = componentOfLocal(ctx, instanceId)
  if (isPlan(c)) return c
  const inst = node(ctx, instanceId) as Rec
  const swaps = instanceSwaps(scopeOf(ctx), c, inst)
  const r = resolveIdPath(scopeOf(ctx), c, path, { swaps })
  if (!r.ok) return fail("PATH_UNRESOLVED", `"${path}" does not resolve: ${r.reason}`, instanceId)
  if (r.target.node.type !== "frame" || !isObject(r.target.node.slot))
    return fail("NOT_A_SLOT", `"${path}" is not a slot`, instanceId)
  const overrides = isObject(inst.overrides) ? inst.overrides : {}
  const cur = overrides[path]
  if (isObject(cur) && cur.slot === true) return []
  const notes: PlanOp[] = []
  return [
    ...notes,
    { op: "update", id: instanceId, set: { overrides: { ...overrides, [path]: { slot: true } } } },
  ]
}

// --- Overrides ------------------------------------------------------------------------------

/** One override change on an instance (per path, per kind). */
export type OverrideChange =
  /** Merge fields into the `set` at `path` (`path` `""` = the instance's `props`). */
  | { kind: "set"; set: Rec }
  /** Make `path` (a slot frame) take instance content; optional nodes are inserted into it. */
  | { kind: "slot"; content?: readonly { id?: string; node: Rec }[] }
  /** Replace the node at `path` with `node` (removes a previous replacement). */
  | { kind: "replace"; node: Rec; id?: string }

/** Changes one override of `instanceId` at `path` (board 11). */
export function planSetOverride(
  ctx: PlanContext,
  instanceId: string,
  path: string,
  change: OverrideChange,
): Plan {
  const c = componentOfLocal(ctx, instanceId)
  if (isPlan(c)) return c
  const inst = node(ctx, instanceId) as Rec
  if (path === "") {
    if (change.kind !== "set") return fail("INVALID", "The root takes props only", instanceId)
    const props = { ...(isObject(inst.props) ? inst.props : {}), ...change.set }
    for (const [k, v] of Object.entries(change.set)) if (v === undefined) delete props[k]
    return ok([{ op: "update", id: instanceId, set: { props: nonEmpty(props) } }])
  }
  const swaps = instanceSwaps(scopeOf(ctx), c, inst)
  const r = resolveIdPath(scopeOf(ctx), c, path, { swaps })
  if (!r.ok) return fail("PATH_UNRESOLVED", `"${path}" does not resolve: ${r.reason}`, instanceId)
  const overrides: Rec = { ...(isObject(inst.overrides) ? inst.overrides : {}) }
  const cur = overrides[path]
  const ops: PlanOp[] = []
  const notes: PlanNote[] = []
  const newId = idGenerator(ctx)
  switch (change.kind) {
    case "set": {
      if (typeof change.set.of === "string") {
        const target = locate(scopeOf(ctx), change.set.of)
        if (!isLocated(target))
          return fail("NOT_FOUND", `Component ${change.set.of} is not available`)
        if (!isComponentNode(target.node))
          return fail("NOT_A_COMPONENT", `${change.set.of} is not a component`, instanceId)
        if (wouldCycle(ctx, instanceId, change.set.of, pathHolders(ctx, c, path, swaps)))
          return cycleFail(change.set.of, instanceId)
      }
      if (isObject(cur) && !isObject(cur.set))
        return fail(
          "INVALID",
          `"${path}" already has a ${Object.keys(cur)[0]} override`,
          instanceId,
        )
      const set: Rec = { ...(isObject(cur) && isObject(cur.set) ? cur.set : {}) }
      // A nested instance takes instance fields; visual fields go inside `set.props` (§9.3).
      const toInstance = r.target.node.type === "instance"
      const props: Rec = { ...(isObject(set.props) ? set.props : {}) }
      for (const [k, v] of Object.entries(change.set)) {
        const into = toInstance && !INSTANCE_SET_FIELDS.has(k) ? props : set
        if (v === undefined) delete into[k]
        else into[k] = v
      }
      if (toInstance) {
        if (Object.keys(props).length) set.props = props
        else delete set.props
      }
      if (Object.keys(set).length) overrides[path] = { set }
      else delete overrides[path]
      // A swap (or its reset) changes what deeper paths resolve against.
      if (Object.hasOwn(change.set, "of"))
        dropStaleOverrides(ctx, c, instanceId, inst, overrides, path, ops, notes)
      break
    }
    case "slot": {
      if (r.target.node.type !== "frame" || !isObject(r.target.node.slot))
        return fail("NOT_A_SLOT", `"${path}" is not a slot`, instanceId)
      if (isObject(cur) && cur.replace === true)
        return fail("INVALID", "Reset the replacement first")
      overrides[path] = { slot: true }
      ops.push({ op: "update", id: instanceId, set: { overrides } })
      for (const item of change.content ?? [])
        ops.push({
          op: "insert",
          id: item.id ?? newId(),
          node: item.node,
          parent: instanceId,
          at: path,
        })
      return ok(ops)
    }
    case "replace": {
      for (const old of ownedAt(ctx.doc, instanceId, path)) ops.push({ op: "delete", id: old })
      overrides[path] = { replace: true }
      ops.push({ op: "update", id: instanceId, set: { overrides } })
      const id = change.id ?? newId()
      ops.push({ op: "insert", id, node: change.node, parent: instanceId, at: path })
      return ok(ops, [], [id])
    }
  }
  ops.push({ op: "update", id: instanceId, set: { overrides: nonEmpty(overrides) } })
  return ok(ops, notes)
}

/** What {@link planResetOverride} removes. */
export interface ResetOptions {
  /** Only these `set` fields (or `props` fields for path `""`); default: the whole entry. */
  fields?: readonly string[]
}

/**
 * Resets one override entry (override dot click, Overrides popover row reset, "Reset
 * overrides on Title"). Slot/replace entries delete their instance-owned nodes.
 */
export function planResetOverride(
  ctx: PlanContext,
  instanceId: string,
  path: string,
  options: ResetOptions = {},
): Plan {
  const inst = node(ctx, instanceId)
  if (inst?.type !== "instance")
    return fail("NOT_AN_INSTANCE", `${instanceId} is not an instance`, instanceId)
  if (path === "") {
    if (!isObject(inst.props)) return ok([])
    if (!options.fields) return ok([{ op: "update", id: instanceId, unset: ["props"] }])
    const props = { ...inst.props }
    for (const f of options.fields) delete props[f]
    return ok([{ op: "update", id: instanceId, set: { props: nonEmpty(props) } }])
  }
  const overrides: Rec = { ...(isObject(inst.overrides) ? inst.overrides : {}) }
  const cur = overrides[path]
  if (!isObject(cur)) return ok([])
  const ops: PlanOp[] = []
  if (isObject(cur.set) && options.fields) {
    const set = { ...cur.set }
    const props: Rec | null = isObject(set.props) ? { ...set.props } : null
    for (const f of options.fields) {
      delete set[f]
      if (props) delete props[f]
    }
    if (props && !options.fields.includes("props")) {
      if (Object.keys(props).length) set.props = props
      else delete set.props
    }
    if (Object.keys(set).length) overrides[path] = { set }
    else delete overrides[path]
  } else {
    delete overrides[path]
    for (const id of ownedAt(ctx.doc, instanceId, path)) ops.push({ op: "delete", id })
  }
  ops.push({ op: "update", id: instanceId, set: { overrides: nonEmpty(overrides) } })
  return ok(ops)
}

/** "Reset all overrides" / Instance section Reset: props, args, overrides and owned nodes. */
export function planResetAll(ctx: PlanContext, instanceId: string): Plan {
  const inst = node(ctx, instanceId)
  if (inst?.type !== "instance")
    return fail("NOT_AN_INSTANCE", `${instanceId} is not an instance`, instanceId)
  const ops: PlanOp[] = []
  for (const [id, n] of Object.entries(nodeTable(ctx.doc)))
    if (n.parent === instanceId) ops.push({ op: "delete", id })
  const unset = ["props", "args", "overrides"].filter((k) => k in inst)
  if (unset.length) ops.push({ op: "update", id: instanceId, unset })
  return ok(ops)
}

/**
 * Delete pressed on a layer inside an instance (board 15): descendants of an instance can't
 * be deleted (§9.3), so the layer is hidden with `set: { visible: false }` instead.
 */
export function planHideInInstance(ctx: PlanContext, instanceId: string, path: string): Plan {
  const p = planSetOverride(ctx, instanceId, path, { kind: "set", set: { visible: false } })
  if (!p.ok) return p
  return ok(p.ops, [
    { code: "HIDDEN_INSTEAD", message: "Hidden instead of deleted", nodeId: instanceId, key: path },
  ])
}

// --- Args, swap -----------------------------------------------------------------------------

/** Sets (or, with `undefined`, removes) declared-prop args of an instance (Properties section). */
export function planSetArgs(
  ctx: PlanContext,
  instanceId: string,
  args: Readonly<Record<string, unknown>>,
): Plan {
  const c = componentOfLocal(ctx, instanceId)
  if (isPlan(c)) return c
  const props = declaredProps(scopeOf(ctx), c)
  const inst = node(ctx, instanceId) as Rec
  const swaps = instanceSwaps(scopeOf(ctx), c, inst)
  const next: Rec = { ...(isObject(inst.args) ? inst.args : {}) }
  let swapped = false
  for (const [name, value] of Object.entries(args)) {
    const prop = props.find((p) => p.name === name)
    if (!prop) return fail("INVALID", `No prop "${name}" on this component`, instanceId)
    if (prop.def.type === "slot")
      return fail("INVALID", "Slot props take content, not a value", instanceId)
    if (prop.def.type === "instance" && typeof value === "string") {
      const target = locate(scopeOf(ctx), value)
      if (!isLocated(target)) return fail("NOT_FOUND", `Component ${value} is not available`)
      if (!isComponentNode(target.node))
        return fail("NOT_A_COMPONENT", `${value} is not a component`, instanceId)
      if (wouldCycle(ctx, instanceId, value, pathHolders(ctx, c, prop.path, swaps)))
        return cycleFail(value, instanceId)
    }
    if (prop.def.type === "instance") swapped = true
    if (value === undefined) delete next[name]
    else next[name] = value
  }
  const ops: PlanOp[] = []
  const notes: PlanNote[] = []
  if (swapped && isObject(inst.overrides)) {
    const overrides: Rec = { ...inst.overrides }
    dropStaleOverrides(ctx, c, instanceId, { ...inst, args: next }, overrides, "", ops, notes)
    if (notes.length)
      ops.push({ op: "update", id: instanceId, set: { overrides: nonEmpty(overrides) } })
  }
  ops.unshift({ op: "update", id: instanceId, set: { args: nonEmpty(next) } })
  return ok(ops, notes)
}

/**
 * Swap instance (board 13 popover): sets `of`, keeping `props`, the args the new component
 * declares and the overrides whose id paths still resolve (slot overrides must still target a
 * slot); the rest is dropped (their owned nodes deleted) and listed in the notes.
 * `path` swaps a nested instance through a `set: { of }` override instead.
 */
export function planSwapInstance(
  ctx: PlanContext,
  instanceId: string,
  newOf: string,
  path = "",
): Plan {
  if (path !== "")
    return planSetOverride(ctx, instanceId, path, { kind: "set", set: { of: newOf } })
  const inst = node(ctx, instanceId)
  if (inst?.type !== "instance")
    return fail("NOT_AN_INSTANCE", `${instanceId} is not an instance`, instanceId)
  const c = locate(scopeOf(ctx), newOf)
  if (!isLocated(c)) return fail("NOT_FOUND", `Component ${newOf} is not available`)
  if (!isComponentNode(c.node)) return fail("NOT_A_COMPONENT", `${newOf} is not a component`)
  if (wouldCycle(ctx, instanceId, newOf)) return cycleFail(newOf, instanceId)
  const notes: PlanNote[] = []
  const ops: PlanOp[] = []
  const set: Rec = { of: newOf }
  const unset: string[] = []
  if (isObject(inst.args)) {
    const names = new Set(declaredProps(scopeOf(ctx), c).map((p) => p.name))
    const args: Rec = {}
    for (const [k, v] of Object.entries(inst.args)) {
      if (names.has(k)) args[k] = v
      else notes.push({ code: "ARG_DROPPED", message: `Arg "${k}" dropped`, key: k })
    }
    if (Object.keys(args).length) set.args = args
    else unset.push("args")
  }
  if (isObject(inst.overrides)) {
    const overrides: Rec = {}
    const swaps = instanceSwaps(scopeOf(ctx), c, { ...inst, args: set.args })
    for (const [k, ov] of Object.entries(inst.overrides)) {
      const r = resolveIdPath(scopeOf(ctx), c, k, { swaps })
      const slotOk = !isObject(ov) || ov.slot !== true || (r.ok && isObject(r.target.node.slot))
      if (r.ok && slotOk) overrides[k] = ov
      else {
        notes.push({ code: "OVERRIDE_DROPPED", message: `Override "${k}" dropped`, key: k })
        for (const id of ownedAt(ctx.doc, instanceId, k)) ops.push({ op: "delete", id })
      }
    }
    if (Object.keys(overrides).length) set.overrides = overrides
    else unset.push("overrides")
  }
  ops.push({ op: "update", id: instanceId, set, ...(unset.length ? { unset } : {}) })
  return ok(ops, notes)
}

// --- Detach ---------------------------------------------------------------------------------

interface Holder {
  alias: string | null
  id: string
  /** True for the instance being detached (its owned nodes are moved, not copied). */
  top: boolean
}
interface FlatEntry {
  sets: Rec[]
  slot?: { holder: Holder; rawKey: string }
  replace?: { holder: Holder; rawKey: string }
}

/**
 * Detach instance (⌥⌘B, board 15 confirm): the instance becomes plain layers — ONE level is
 * materialized (nested instances stay instances, carrying the outer overrides of their paths).
 * Overrides become local values; slot content and replacements stay as regular children
 * (moved, so their ids survive); library content is rewritten into the consumer's namespace.
 * The new root gets a new id (returned in `select`); a detached derived component stays a
 * component (`component: true`, its prop declarations dropped).
 */
export function planDetachInstance(ctx: PlanContext, instanceId: string): Plan {
  const c = componentOfLocal(ctx, instanceId)
  if (isPlan(c)) return c
  const scope = scopeOf(ctx)
  const inst = node(ctx, instanceId) as Rec
  const chain = derivedChain(scope, c)
  const root = chain[chain.length - 1] as LocatedNode
  if (root.node.type === "instance")
    return fail("LIBRARY_NOT_LOADED", "The component chain can't be resolved", instanceId)
  const notes: PlanNote[] = []
  const newId = idGenerator(ctx)
  const ops: PlanOp[] = []

  // Layers, lowest first: derived links (base-most first), then the instance itself.
  const layers = new Map<string, FlatEntry>()
  const entry = (k: string) => {
    let e = layers.get(k)
    if (!e) {
      e = { sets: [] }
      layers.set(k, e)
    }
    return e
  }
  const holders: { loc: LocatedNode; comp: LocatedNode; top: boolean }[] = []
  for (let i = chain.length - 2; i >= 0; i--)
    holders.push({ loc: chain[i] as LocatedNode, comp: chain[i + 1] as LocatedNode, top: false })
  holders.push({ loc: { alias: null, id: instanceId, node: inst }, comp: c, top: true })
  for (const h of holders) {
    const a = h.loc.alias
    const n = h.loc.node
    const holder: Holder = { alias: a, id: h.loc.id, top: h.top }
    if (isObject(n.props)) entry("").sets.push(importValue(scope, a, n.props) as Rec)
    if (isObject(n.args)) {
      const props = declaredProps(scope, h.comp)
      for (const [name, value] of Object.entries(n.args)) {
        const p = props.find((x) => x.name === name)
        const eff = p ? argSet(p, importValue(scope, a, value), a) : null
        if (eff) entry(p?.path ?? "").sets.push(eff)
        // Board 27 §8 (a): the chosen enum option's targets.
        if (p?.targets && typeof value === "string")
          for (const t of p.targets[value] ?? [])
            entry(t.path).sets.push({ [t.field]: importValue(scope, a, t.value) })
      }
    }
    if (isObject(n.overrides))
      for (const [raw, ov] of Object.entries(n.overrides)) {
        if (!isObject(ov)) continue
        const e = entry(qualifyPath(raw, a))
        if (isObject(ov.set)) e.sets.push(importNodeData(scope, a, ov.set))
        else if (ov.slot === true) e.slot = { holder, rawKey: raw }
        else if (ov.replace === true) e.replace = { holder, rawKey: raw }
      }
  }

  const lookups = new Map<string | null, ReturnType<typeof documentLookup>>()
  const lookup = (alias: string | null) => {
    let l = lookups.get(alias)
    if (!l) {
      l = documentLookup(alias === null ? ctx.doc : { nodes: nodesOf(scope, alias) as never })
      lookups.set(alias, l)
    }
    return l
  }

  /** Copies (or, for the detached instance's own nodes, moves) owned nodes into place. */
  const takeOwned = (
    owner: { holder: Holder; rawKey: string },
    parent: string,
    at: string | null,
    order?: string,
  ) => {
    const { holder, rawKey } = owner
    const ids = lookup(holder.alias).children(holder.id, rawKey)
    for (const oid of order !== undefined ? ids.slice(0, 1) : ids) {
      if (holder.top) {
        const mv: PlanOp = { op: "move", id: oid, parent, at }
        mv.order = order ?? String(node(ctx, oid)?.order)
        ops.push(mv)
      } else copySubtree(holder.alias, oid, parent, at, order)
    }
  }

  /** Inserts a namespaced copy of a subtree of namespace `alias` (new ids). */
  const copySubtree = (
    alias: string | null,
    srcId: string,
    parent: string,
    at: string | null,
    order?: string,
  ) => {
    const src = lookup(alias).getNode(srcId)
    if (!src) return
    const id = newId()
    const data = importNodeData(scope, alias, src)
    delete data.component
    data.order = order ?? src.order
    const ins: PlanOp = { op: "insert", id, node: stripTree(data), parent }
    if (at !== null) ins.at = qualifyPath(at, alias)
    ops.push(ins)
    for (const cid of lookup(alias).children(srcId)) copySubtree(alias, cid, id, null)
    if (src.type === "instance" && isObject(src.overrides))
      for (const k of Object.keys(src.overrides))
        for (const oid of lookup(alias).children(srcId, k)) copySubtree(alias, oid, id, k)
  }

  /** Materializes the children of `srcParent` (component content, namespace `alias`). */
  const walk = (alias: string | null, srcParent: string, parent: string) => {
    for (const cid of lookup(alias).children(srcParent)) {
      const src = lookup(alias).getNode(cid)
      if (!src) continue
      const key = qualify(alias, cid)
      const e = layers.get(key)
      if (e?.replace) {
        takeOwned(e.replace, parent, null, src.order)
        continue
      }
      const data = importNodeData(scope, alias, src)
      for (const s of e?.sets ?? [])
        for (const [k, v] of Object.entries(s)) applySetEntry(data, k, v)
      delete data.component
      const id = newId()
      data.order = src.order
      if (data.type === "instance") {
        // Nested instance: stays an instance; outer layers of deeper paths become its own.
        const ov: Rec = isObject(data.overrides) ? { ...data.overrides } : {}
        const prefix = `${key}/`
        const deeper = [...layers].filter(([k]) => k.startsWith(prefix))
        const outerSlots = new Set<string>()
        for (const [k, de] of deeper) {
          const sub = k.slice(prefix.length)
          if (de.slot || de.replace) {
            ov[sub] = de.slot ? { slot: true } : { replace: true }
            outerSlots.add(sub)
          } else if (de.sets.length) {
            const prev = ov[sub]
            if (isObject(prev) && !isObject(prev.set)) {
              notes.push({
                code: "OVERRIDE_DROPPED",
                message: `"${k}" can't restyle a slot/replace target; dropped`,
                key: k,
              })
              continue
            }
            const prevSet = isObject(prev) && isObject(prev.set) ? prev.set : {}
            const merged: Rec = { ...prevSet }
            // Enum-target keys `<property>/<key>` (board 27 §8 a) are baked into the property
            // read from the nested component's node at that path.
            const nestedLoc = typeof data.of === "string" ? locate(scope, data.of) : null
            const at =
              isLocated(nestedLoc) &&
              de.sets.some((x) => Object.keys(x).some((k) => k.includes("/")))
                ? resolveIdPath(scope, nestedLoc, sub)
                : null
            const baseNode = at?.ok ? at.target.node : {}
            for (const x of de.sets)
              for (const [k, v] of Object.entries(x)) {
                const top = k.split("/")[0] as string
                if (k.includes("/") && !Object.hasOwn(merged, top) && isObject(baseNode[top]))
                  merged[top] = structuredClone(baseNode[top])
                applySetEntry(merged, k, v)
              }
            ov[sub] = { set: merged }
          }
        }
        // Outer keys that no longer resolve in the nested instance (e.g. deep overrides left
        // behind by a swap of it) are dropped, so the copy stays valid.
        const nested = typeof data.of === "string" ? locate(scope, data.of) : null
        const stale = new Set<string>()
        if (isLocated(nested)) {
          const swaps = instanceSwaps(scope, nested, { ...data, overrides: ov })
          for (const [k] of deeper) {
            const sub = k.slice(prefix.length)
            const r = resolveIdPath(scope, nested, sub, { swaps })
            if (r.ok || r.unchecked !== undefined) continue
            stale.add(k)
            delete ov[sub]
            notes.push({ code: "OVERRIDE_DROPPED", message: `Override "${k}" dropped`, key: k })
          }
        }
        if (Object.keys(ov).length) data.overrides = ov
        ops.push({ op: "insert", id, node: stripTree(data), parent })
        for (const [k, de] of deeper) {
          if (stale.has(k)) continue
          const sub = k.slice(prefix.length)
          const own = de.slot ?? de.replace
          if (own) takeOwned(own, id, sub)
        }
        // The nested instance's own content nodes (authored in the component), unless replaced.
        if (isObject(src.overrides))
          for (const k of Object.keys(src.overrides)) {
            const qk = qualifyPath(k, alias)
            if (outerSlots.has(qk)) continue
            for (const oid of lookup(alias).children(cid, k)) copySubtree(alias, oid, id, k)
          }
        continue
      }
      if (data.type === "frame") delete data.slot
      ops.push({ op: "insert", id, node: stripTree(data), parent })
      if (e?.slot) takeOwned(e.slot, id, null)
      else walk(alias, cid, id)
    }
  }

  // Root.
  const rootId = newId()
  const rootData = importNodeData(scope, root.alias, root.node)
  for (const s of layers.get("")?.sets ?? [])
    for (const [k, v] of Object.entries(s)) applySetEntry(rootData, k, v)
  for (const k of PLACEMENT) delete rootData[k]
  delete rootData.component
  const pins: Rec = {}
  for (let i = chain.length - 1; i >= 0; i--) {
    const t = (chain[i] as LocatedNode).node.theme
    if (isObject(t))
      Object.assign(
        pins,
        importNodeData(scope, (chain[i] as LocatedNode).alias, { theme: t }).theme as Rec,
      )
  }
  if (isObject(inst.theme)) Object.assign(pins, inst.theme)
  for (const k of PLACEMENT) if (inst[k] !== undefined && k !== "theme") rootData[k] = inst[k]
  if (rootData.name === undefined && typeof root.node.name === "string")
    rootData.name = root.node.name
  if (Object.keys(pins).length) rootData.theme = pins
  if (inst.component) {
    rootData.component = true
    if (isObject(inst.component) && isObject(inst.component.props))
      notes.push({
        code: "PROP_DROPPED",
        message: "Prop declarations of the derived component dropped",
      })
  }
  const parent = (inst.parent as string | null) ?? null
  delete rootData.parent
  delete rootData.at
  const ins: PlanOp = { op: "insert", id: rootId, node: stripTree(rootData), parent }
  if (typeof inst.at === "string") ins.at = inst.at
  ops.push(ins)
  walk(root.alias, root.id, rootId)
  // Owned nodes of the instance that matched nothing are deleted with it.
  ops.push({ op: "delete", id: instanceId })
  const index = (ctx.doc as unknown as Rec).components
  if (Array.isArray(index) && index.includes(instanceId))
    ops.push({
      op: "setHeader",
      set: { components: index.map((x) => (x === instanceId ? rootId : x)) },
    })
  // A binding baked from the component can name a local variable that is gone (deleted
  // concurrently on another replica): the detached copy drops it instead of failing the edit.
  const vars = (ctx.doc as unknown as Rec).variables
  const known = (name: string) => isObject(vars) && Object.hasOwn(vars, name)
  for (const op of ops) {
    if (op.op !== "insert" || !isObject(op.node)) continue
    const dropped = dropMissingBindings(op.node as Rec, known)
    for (const name of dropped)
      notes.push({
        code: "BINDING_DETACHED",
        message: `Variable "${name}" no longer exists; its binding was dropped`,
        nodeId: op.id,
      })
  }
  notes.push({ code: "INSTANCE_DETACHED", message: "Detached", nodeId: instanceId })
  return ok(ops, notes, [rootId])
}

/**
 * Removes `{ $ref }` bindings to local variables `known` rejects, in place (object members are
 * deleted, array entries filtered). Library refs (`alias:name`) are left alone. Returns the
 * dropped variable names.
 */
function dropMissingBindings(data: Rec, known: (name: string) => boolean): string[] {
  const dropped: string[] = []
  const missing = (v: unknown) => {
    if (!isRef(v)) return false
    const q = splitQualified(v.$ref)
    if (q.alias !== null || known(q.name)) return false
    dropped.push(q.name)
    return true
  }
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        if (missing(v[i])) v.splice(i, 1)
        else visit(v[i])
      }
    } else if (isObject(v)) {
      for (const k of Object.keys(v)) {
        if (missing(v[k])) delete v[k]
        else visit(v[k])
      }
    }
  }
  visit(data)
  return dropped
}

/** Node data without tree fields (the op gives parent/at; order is kept when present). */
function stripTree(data: Rec): Rec {
  const out = { ...data }
  delete out.parent
  delete out.at
  return out
}

/** `args` value → set (§9.6), with instance-prop QIds in the consumer's namespace. */
function argSet(p: DeclaredProp, value: unknown, alias: string | null): Rec | null {
  const def = p.def as unknown as Rec
  switch (def.type) {
    case "text":
      return { content: value }
    case "boolean":
      return { visible: value }
    case "instance":
      return typeof value === "string"
        ? { of: alias !== null && !value.includes(":") ? `${alias}:${value}` : value }
        : null
    case "enum":
      return typeof value === "string" &&
        typeof def.field === "string" &&
        typeof def.target === "string" &&
        isObject(def.options) &&
        Object.hasOwn(def.options, value)
        ? { [def.field]: def.options[value] }
        : null
    default:
      return null
  }
}

/** A value written in library `alias` (bindings) in the consumer's namespace. */
function importValue(scope: ComponentScope, alias: string | null, v: unknown): unknown {
  void scope
  if (alias === null) return structuredClone(v)
  return qualifyRefs(v, alias)
}

function qualifyRefs(v: unknown, alias: string): unknown {
  if (isRef(v)) return v.$ref.includes(":") ? v : { $ref: `${alias}:${v.$ref}` }
  if (Array.isArray(v)) return v.map((x) => qualifyRefs(x, alias))
  if (isObject(v)) {
    const out: Rec = {}
    for (const [k, x] of Object.entries(v)) setOwn(out, k, k === "meta" ? x : qualifyRefs(x, alias))
    return out
  }
  return v
}

/**
 * Node data (or a `set`) written in library `alias`, rewritten for the consumer: bindings,
 * theme pin keys, `of`, `slot.suggested`, override keys and instance-prop arg values.
 */
function importNodeData(scope: ComponentScope, alias: string | null, n: Readonly<Rec>): Rec {
  if (alias === null) return structuredClone(n) as Rec
  const out = qualifyNodeData(qualifyRefs(n, alias) as Rec, alias)
  if (isObject(n.overrides)) {
    const ov: Rec = {}
    for (const [k, v] of Object.entries(n.overrides)) {
      const q = qualifyRefs(v, alias) as Rec
      if (isObject(q.set) && typeof q.set.of === "string" && !q.set.of.includes(":"))
        q.set = { ...q.set, of: `${alias}:${q.set.of}` }
      ov[qualifyPath(k, alias)] = q
    }
    out.overrides = ov
  }
  if (isObject(n.args) && typeof n.of === "string") {
    const c = locate(scope, n.of, alias)
    if (isLocated(c)) {
      const props = declaredProps(scope, c)
      const args: Rec = { ...(out.args as Rec) }
      for (const [k, v] of Object.entries(args))
        if (
          props.find((p) => p.name === k)?.def.type === "instance" &&
          typeof v === "string" &&
          !v.includes(":")
        )
          args[k] = `${alias}:${v}`
      out.args = args
    }
  }
  return out
}

// --- Declared props -------------------------------------------------------------------------

/**
 * Declares a prop on a component (board 12 "Add prop"). The new declaration is ordered last;
 * `def.target` is an IdPath from the component, or the component's own id for the root.
 * Redeclaring an inherited prop on a derived component overrides it by name.
 */
export function planDeclareProp(
  ctx: PlanContext,
  componentId: string,
  name: string,
  def: PropDef,
): Plan {
  const ro = libraryReadOnly(componentId)
  if (ro) return ro
  const comp = node(ctx, componentId)
  if (!comp?.component)
    return fail("NOT_A_COMPONENT", `${componentId} is not a component`, componentId)
  const own = isObject(comp.component) && isObject(comp.component.props) ? comp.component.props : {}
  if (Object.hasOwn(own, name))
    return fail("CONFLICT", `Prop "${name}" already exists`, componentId)
  const loc: LocatedNode = { alias: null, id: componentId, node: comp }
  const last = declaredProps(scopeOf(ctx), loc).reduce<string | null>(
    (m, p) => (p.order && (m === null || compareCodeUnits(p.order, m) > 0) ? p.order : m),
    null,
  )
  const inherited = declaredProps(scopeOf(ctx), loc).find((p) => p.name === name)
  const order = def.order ?? inherited?.order ?? orderBetween(last, null)
  return writeProps(componentId, comp, { ...own, [name]: { ...def, order } })
}

/** Changes a declaration (type, target, field, options, default, order) and/or renames it. */
export function planUpdateProp(
  ctx: PlanContext,
  componentId: string,
  name: string,
  patch: Partial<Record<string, unknown>> & { rename?: string },
): Plan {
  const ro = libraryReadOnly(componentId)
  if (ro) return ro
  const comp = node(ctx, componentId)
  if (!comp?.component)
    return fail("NOT_A_COMPONENT", `${componentId} is not a component`, componentId)
  const own = isObject(comp.component) && isObject(comp.component.props) ? comp.component.props : {}
  const cur = own[name]
  if (!isObject(cur)) return fail("NOT_FOUND", `Prop "${name}" is not declared here`, componentId)
  const { rename, ...fields } = patch
  const next: Rec = { ...cur, ...fields }
  for (const [k, v] of Object.entries(fields)) if (v === undefined) delete next[k]
  const props: Rec = { ...own }
  const notes: PlanNote[] = []
  const ops: PlanOp[] = []
  const typeChanged = fields.type !== undefined && fields.type !== cur.type
  if (rename !== undefined && rename !== name) {
    if (Object.hasOwn(own, rename))
      return fail("CONFLICT", `Prop "${rename}" already exists`, componentId)
    delete props[name]
    props[rename] = next
  } else props[name] = next
  const w = writeProps(componentId, comp, props)
  if (!w.ok) return w
  ops.push(...w.ops)
  // Instances (of this component and of components derived from it) carry the args.
  for (const iid of instancesOfFamily(ctx, componentId)) {
    const inst = node(ctx, iid) as Rec
    if (!isObject(inst.args) || !Object.hasOwn(inst.args, name)) continue
    const args: Rec = { ...inst.args }
    const value = args[name]
    delete args[name]
    if (typeChanged)
      notes.push({
        code: "ARG_DROPPED",
        message: `Arg "${name}" dropped (type changed)`,
        nodeId: iid,
        key: name,
      })
    else if (rename !== undefined) args[rename] = value
    ops.push({ op: "update", id: iid, set: { args: nonEmpty(args) } })
  }
  return ok(ops, notes)
}

/**
 * Removes a declaration (board 12: declaration only; instance args for it are dropped with a
 * note). On a derived component this drops its redeclaration and falls back to the base.
 */
export function planRemoveProp(ctx: PlanContext, componentId: string, name: string): Plan {
  const ro = libraryReadOnly(componentId)
  if (ro) return ro
  const comp = node(ctx, componentId)
  if (!comp?.component)
    return fail("NOT_A_COMPONENT", `${componentId} is not a component`, componentId)
  const own = isObject(comp.component) && isObject(comp.component.props) ? comp.component.props : {}
  if (!Object.hasOwn(own, name))
    return fail("NOT_FOUND", `Prop "${name}" is not declared here`, componentId)
  const props = { ...own }
  delete props[name]
  const w = writeProps(componentId, comp, props)
  if (!w.ok) return w
  const ops = [...w.ops]
  const notes: PlanNote[] = []
  const loc: LocatedNode = { alias: null, id: componentId, node: comp }
  const stillDeclared = derivedChain(scopeOf(ctx), loc)
    .slice(1)
    .some(
      (l) =>
        isObject(l.node.component) &&
        isObject(l.node.component.props) &&
        name in l.node.component.props,
    )
  if (!stillDeclared)
    for (const iid of instancesOfFamily(ctx, componentId)) {
      const inst = node(ctx, iid) as Rec
      if (!isObject(inst.args) || !Object.hasOwn(inst.args, name)) continue
      const args = { ...inst.args }
      delete args[name]
      ops.push({ op: "update", id: iid, set: { args: nonEmpty(args) } })
      notes.push({ code: "ARG_DROPPED", message: `Arg "${name}" dropped`, nodeId: iid, key: name })
    }
  return ok(ops, notes)
}

/** Moves a declaration before `before` (null = last) in display order (drag reorder). */
export function planReorderProp(
  ctx: PlanContext,
  componentId: string,
  name: string,
  before: string | null,
): Plan {
  const ro = libraryReadOnly(componentId)
  if (ro) return ro
  const comp = node(ctx, componentId)
  if (!comp?.component)
    return fail("NOT_A_COMPONENT", `${componentId} is not a component`, componentId)
  const list = declaredProps(scopeOf(ctx), { alias: null, id: componentId, node: comp }).filter(
    (p) => p.name !== name,
  )
  const i = before === null ? list.length : list.findIndex((p) => p.name === before)
  if (i < 0) return fail("NOT_FOUND", `Prop "${before}" not found`, componentId)
  const lo = i > 0 ? (list[i - 1] as DeclaredProp).order || null : null
  const hiRaw = i < list.length ? (list[i] as DeclaredProp).order : null
  const hi = hiRaw === "" ? null : hiRaw
  let order: string
  try {
    order = orderBetween(lo, hi)
  } catch {
    return fail("INVALID", "Can't place the prop there; reorder its neighbours first")
  }
  const own = isObject(comp.component) && isObject(comp.component.props) ? comp.component.props : {}
  const cur = own[name]
  if (!isObject(cur)) return fail("LIBRARY_READ_ONLY", "Inherited props are read-only", componentId)
  return writeProps(componentId, comp, { ...own, [name]: { ...cur, order } })
}

function writeProps(id: string, comp: Rec, props: Rec): Plan {
  const def = isObject(comp.component) ? { ...comp.component } : {}
  if (Object.keys(props).length) def.props = props
  else delete def.props
  return ok([{ op: "update", id, set: { component: Object.keys(def).length ? def : true } }])
}

/** Local instances of `componentId` and of local components derived from it (transitively). */
function instancesOfFamily(ctx: PlanContext, componentId: string): string[] {
  const nodes = nodeTable(ctx.doc)
  const family = new Set([componentId])
  let grew = true
  while (grew) {
    grew = false
    for (const [id, n] of Object.entries(nodes))
      if (n.type === "instance" && n.component && family.has(String(n.of)) && !family.has(id)) {
        family.add(id)
        grew = true
      }
  }
  return Object.entries(nodes)
    .filter(([id, n]) => n.type === "instance" && family.has(String(n.of)) && id !== componentId)
    .map(([id]) => id)
    .sort(compareCodeUnits)
}

// --- Slots ----------------------------------------------------------------------------------

/**
 * Slot toggle / suggestions (board 12 Slot section). `slot` = `{ suggested }` turns it on or
 * edits suggestions; `null` turns it off — which deletes every instance's content for this
 * slot (board 15 "Turn off slot" confirm: pass `deleteContent: true`, else `IN_USE`) and the
 * slot prop declarations that target it.
 */
export function planSetSlot(
  ctx: PlanContext,
  frameId: string,
  slot: { suggested?: readonly string[] } | null,
  options: { deleteContent?: boolean } = {},
): Plan {
  const ro = libraryReadOnly(frameId)
  if (ro) return ro
  const frame = node(ctx, frameId)
  if (!frame) return fail("NOT_FOUND", `Node ${frameId} does not exist`, frameId)
  if (frame.type !== "frame") return fail("NOT_A_SLOT", "Only frames can be slots", frameId)
  if (slot !== null) {
    const value: Rec = {}
    if (slot.suggested?.length) value.suggested = [...new Set(slot.suggested)]
    return ok([{ op: "update", id: frameId, set: { slot: value } }])
  }
  if (!isObject(frame.slot)) return ok([])
  const ops: PlanOp[] = [{ op: "update", id: frameId, unset: ["slot"] }]
  const notes: PlanNote[] = []
  const scope = scopeOf(ctx)
  let held = 0
  for (const [iid, inst] of Object.entries(nodeTable(ctx.doc))) {
    if (inst.type !== "instance" || !isObject(inst.overrides)) continue
    const c = locate(scope, String(inst.of))
    if (!isLocated(c)) continue
    const overrides = { ...inst.overrides }
    let touched = false
    for (const [k, ov] of Object.entries(inst.overrides)) {
      if (!isObject(ov) || ov.slot !== true) continue
      const r = resolveIdPath(scope, c, k)
      if (!r.ok || r.target.alias !== null || r.target.id !== frameId) continue
      const owned = ownedAt(ctx.doc, iid, k)
      held += owned.length
      for (const id of owned) ops.push({ op: "delete", id })
      delete overrides[k]
      touched = true
      notes.push({
        code: "SLOT_CONTENT_DELETED",
        message: `${owned.length} layer(s) deleted`,
        nodeId: iid,
        key: k,
      })
    }
    if (touched) ops.push({ op: "update", id: iid, set: { overrides: nonEmpty(overrides) } })
  }
  if (held > 0 && !options.deleteContent)
    return fail("IN_USE", `${held} layer(s) in instances fill this slot`, frameId)
  // Slot props targeting the frame.
  for (const [cid, comp] of Object.entries(nodeTable(ctx.doc))) {
    if (!isObject(comp.component) || !isObject(comp.component.props)) continue
    const props = { ...comp.component.props }
    let changed = false
    for (const [name, p] of Object.entries(props)) {
      if (!isObject(p) || p.type !== "slot" || typeof p.target !== "string") continue
      const r = resolveIdPath(scope, { alias: null, id: cid, node: comp }, p.target)
      if (r.ok && r.target.alias === null && r.target.id === frameId) {
        delete props[name]
        changed = true
        notes.push({
          code: "PROP_DROPPED",
          message: `Slot prop "${name}" removed`,
          nodeId: cid,
          key: name,
        })
      }
    }
    if (changed) {
      const w = writeProps(cid, comp, props)
      if (w.ok) ops.push(...w.ops)
    }
  }
  return ok(ops, notes)
}

/** Sets or clears a component's description (`meta["kimo.component.description"]`). */
export function planSetComponentDescription(
  ctx: PlanContext,
  componentId: string,
  text: string | null,
): Plan {
  const ro = libraryReadOnly(componentId)
  if (ro) return ro
  const comp = node(ctx, componentId)
  if (!comp?.component)
    return fail("NOT_A_COMPONENT", `${componentId} is not a component`, componentId)
  const meta: Rec = { ...(isObject(comp.meta) ? comp.meta : {}) }
  if (text === null || text === "") delete meta[COMPONENT_DESCRIPTION_META_KEY]
  else meta[COMPONENT_DESCRIPTION_META_KEY] = text
  return ok([{ op: "update", id: componentId, set: { meta: nonEmpty(meta) } }])
}

/** `undefined` for an empty object (an update then removes the field). */
function nonEmpty(o: Rec): Rec | undefined {
  return Object.keys(o).length ? o : undefined
}

/** Used by imports: the qualified-id alias of a reference, or null. */
export function aliasOfQId(qid: unknown): string | null {
  return typeof qid === "string" ? splitQualified(qid).alias : null
}
