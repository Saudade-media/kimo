/**
 * The ops compiler for `kimo_apply_ops` (ADR 0013 §5): wire ops → ONE editor-state op group.
 *
 * Each wire op is compiled against the document *as changed by the earlier ops of the call*:
 * low-level ops map 1:1 (`toStoreOp`), `copy` / `replace` expand against the document, and M3
 * commands go through `planCommand`. To give planners that view without committing anything,
 * the compiler replays the call on a scratch replica (an exact Yjs clone of the store, so order
 * keys and ids agree) and collects the scratch's *normalized* ops, which are replayable input.
 * The handler then applies them to the real store in one `apply` (one transaction, one undo
 * step, the caller's origin, `baseRevision`, `dryRun`), so the result is identical to the
 * scratch's and atomic: any failure leaves the real store untouched.
 */
import type { Libraries } from "@kimo/core-schema"
import {
  addPageOps,
  createDocStore,
  type DocStore,
  deletePageOps,
  generateId,
  movePageOps,
  type NodeData,
  type NormalizedOp,
  type Op,
  pagesOf,
  planCommand,
  renamePageOps,
} from "@kimo/editor-state"
import type { ToolError } from "../envelope"
import { toCommand, toStoreOp, type WireOp } from "../ops"
import { mapOpError, mapPlanError } from "./util"

export interface CompiledNote {
  code: string
  message: string
  nodeId?: string
}

export type CompileResult =
  | {
      ok: true
      /** Normalized ops to apply to the real store, in order. */
      ops: NormalizedOp[]
      /** For each entry of `ops`, the index of the wire op that produced it. */
      wireIndex: number[]
      /** `@key` (or node name / id) → new id, in creation order. */
      created: { key: string; id: string }[]
      notes: CompiledNote[]
      /** The `@key` state after this call (feed it to the next part of a streamed call). */
      state: CompileState
    }
  | {
      ok: false
      errors: ToolError[]
      /** Set when the failure is an `@key` reference to a node no op has created yet. */
      unresolved?: string
    }

/**
 * `@key` names a part of a call created (keys and copies). A streamed call is compiled in parts
 * (each batch of ops as it arrives); the state carries the names of the earlier parts.
 */
export interface CompileState {
  keys: ReadonlyMap<string, string>
  copies: ReadonlyMap<string, ReadonlyMap<string, string>>
}

export interface CompileOptions {
  newId?: () => string
  libraries?: Libraries
  /** Names created by earlier parts of the same call (streamed calls). */
  state?: CompileState
  /** Index of `wire[0]` in the whole call (error paths and `wireIndex` use whole-call indexes). */
  offset?: number
}

class CompileError extends Error {
  constructor(
    readonly error: ToolError,
    readonly unresolved?: string,
  ) {
    super(error.message)
  }
}

/** Builds a scratch replica of `store` (no validation; the real apply validates). */
function scratchOf(store: DocStore): DocStore {
  const s = createDocStore(undefined, { validation: "none", autoRepair: false })
  s.applyUpdate(store.encodeStateAsUpdate())
  return s
}

const SCRATCH_ORIGIN = "mcp:compiler.scratch" as const
const TREE_FIELDS = new Set(["parent", "order", "at", "id"])

/** Compiles a call. Never touches `store`. */
export function compileWireOps(
  store: DocStore,
  wire: readonly WireOp[],
  options: CompileOptions = {},
): CompileResult {
  const newId = options.newId ?? (() => generateId())
  const scratch = scratchOf(store)
  const offset = options.offset ?? 0
  const keys = new Map<string, string>(options.state?.keys ?? [])
  /** Copy key → original id → id of its copy (for `@key/<id>` references). */
  const copies = new Map<string, ReadonlyMap<string, string>>(options.state?.copies ?? [])
  const out: NormalizedOp[] = []
  const wireIndex: number[] = []
  const created: { key: string; id: string }[] = []
  const notes: CompiledNote[] = []
  try {
    wire.forEach((op, at) => {
      const i = at + offset
      const path = `ops[${i}]`
      const resolve = (ref: string): string => {
        if (!ref.startsWith("@")) return ref
        const slash = ref.indexOf("/")
        if (slash > 0) {
          // `@copyKey/<original id>`: the copy of that node inside a subtree copied earlier.
          const inside = copies.get(ref.slice(1, slash))?.get(ref.slice(slash + 1))
          if (!inside)
            throw new CompileError(
              {
                code: "INVALID_INPUT",
                message: `${ref} does not name a node inside a subtree copied earlier in this call.`,
                path,
                suggestion: "Use @<copy key>/<id of the original node>, after the copy op.",
              },
              copies.has(ref.slice(1, slash)) ? undefined : ref,
            )
          return inside
        }
        const id = keys.get(ref.slice(1))
        if (!id)
          throw new CompileError(
            {
              code: "INVALID_INPUT",
              message: `${ref} does not name a node created earlier in this call.`,
              path,
              suggestion: "Give the creating op a key and place it before this op.",
            },
            ref,
          )
        return id
      }
      const remember = (key: string | undefined, id: string, fallback?: unknown) => {
        if (key !== undefined) {
          if (keys.has(key))
            throw new CompileError({
              code: "INVALID_INPUT",
              message: `Duplicate key "${key}" in this call.`,
              path: `${path}.key`,
            })
          keys.set(key, id)
        }
        created.push({ key: key ?? (typeof fallback === "string" && fallback ? fallback : id), id })
      }
      let ops: Op[]
      switch (op.op) {
        case "insert": {
          const o = toStoreOp({ ...op, node: lenientNode(op.node) }, resolve, newId)
          ops = [o]
          remember(op.key, (o as { id: string }).id, op.node.name)
          break
        }
        case "update": {
          const target = scratch.getNode(resolve(op.id))
          ops = [toStoreOp(lenientUpdate(op, target?.type), resolve, newId)]
          break
        }
        case "move":
        case "delete":
        case "set_variables":
        case "set_theme_axes":
          ops = [toStoreOp(op, resolve, newId)]
          break
        case "copy": {
          const r = copyOps(scratch, op, resolve, newId, path)
          ops = r.ops
          remember(op.key, r.rootId, r.name)
          if (op.key) copies.set(op.key, r.ids)
          // The copies of the top levels, so later calls address them without a query.
          const label = op.key ?? (typeof r.name === "string" && r.name ? r.name : r.rootId)
          for (const [orig, id] of r.shallow.slice(0, COPY_CREATED_MAX))
            created.push({ key: `${label}/${orig}`, id })
          break
        }
        case "replace":
          ops = replaceOps(scratch, resolve(op.id), lenientNode(op.node), path)
          break
        case "page": {
          const r = pageOps(scratch, op, newId, path)
          ops = r.ops
          if (op.action === "add" && r.pageId) remember(op.key, r.pageId, op.name)
          break
        }
        default: {
          const command = toCommand(op, resolve, newId)
          const plan = planCommand(scratch.toDocument(), command, {
            libraries: options.libraries,
            newId,
          })
          if (!plan.ok) throw new CompileError(mapPlanError(plan.error, path))
          ops = plan.ops as Op[]
          for (const n of plan.notes) {
            const note: CompiledNote = { code: n.code, message: n.message }
            const nodeId = (n as { nodeId?: string }).nodeId
            if (nodeId) note.nodeId = nodeId
            notes.push(note)
          }
          if (op.op === "instantiate" && command.cmd === "createInstance")
            remember(op.key, command.placement.id as string, op.name)
          else if (op.op === "make_component") {
            const id = plan.select?.[0] ?? resolve(op.ids[0] as string)
            remember(op.key, id, op.name)
          }
        }
      }
      if (ops.length === 0) return
      const r = scratch.apply(ops, { origin: SCRATCH_ORIGIN })
      if (!r.ok)
        throw new CompileError(
          mapOpError(r.errors[0] as never, (p) => p.replace(/^ops(\[\d+\])?/, path)),
        )
      for (const n of r.ops) {
        out.push(n)
        wireIndex.push(i)
      }
    })
  } catch (e) {
    if (e instanceof CompileError)
      return { ok: false, errors: [e.error], ...(e.unresolved ? { unresolved: e.unresolved } : {}) }
    throw e
  } finally {
    scratch.destroy()
  }
  return { ok: true, ops: out, wireIndex, created, notes, state: { keys, copies } }
}

/** At most this many `created` entries for the inside of one copy (depth 1–2). */
export const COPY_CREATED_MAX = 60

/**
 * Board 31 token pass: slips agents make with `update` are accepted as what they mean, instead
 * of costing a failed call: `set.unset: [...]` is the op's own `unset`, a `null` value in `set`
 * removes that field (the format itself never stores null), a text node's `text` string is
 * its `content`, and `width` / `height` are `w` / `h`.
 */
function lenientUpdate(
  op: Extract<WireOp, { op: "update" }>,
  type?: unknown,
): Extract<WireOp, { op: "update" }> {
  if (!op.set) return op
  const set: Record<string, unknown> = {}
  const unset = [...(op.unset ?? [])]
  for (const [k, v] of Object.entries(op.set)) {
    if (k === "unset" && Array.isArray(v) && v.every((x) => typeof x === "string"))
      unset.push(...(v as string[]))
    else if (v === null) unset.push(k)
    else if (k === "text" && type === "text" && typeof v === "string" && !("content" in op.set))
      set.content = v
    else set[k] = v
  }
  const out: Extract<WireOp, { op: "update" }> = { op: "update", id: op.id }
  const sized = sizeAliases(set)
  if (Object.keys(sized).length) out.set = sized as typeof op.set
  if (unset.length) out.unset = [...new Set(unset)]
  return out
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Layout fields agents write next to a frame's `layout` instead of inside it. */
const LAYOUT_SLIPS: Record<string, string> = {
  dir: "dir",
  gap: "gap",
  pad: "pad",
  padding: "pad",
  justify: "justify",
  align: "align",
}

/**
 * A new node body as meant: a `null` field is an absent field, a text node's `text` string (the
 * most common slip, borrowed from other formats) is its `content`, a text color written in its
 * `style` (`fill` / `color`) is the node's `fill`, and a frame's layout fields written beside
 * `layout` (or with `dir`) go inside it. Measured with Claude Code: these slips each cost a
 * failed call and a round trip.
 */
function lenientNode<T extends Record<string, unknown>>(node: T): T {
  let out: Record<string, unknown> = node
  if (Object.values(node).some((v) => v === null))
    out = Object.fromEntries(Object.entries(node).filter(([, v]) => v !== null))
  if (out.type === "text" && typeof out.text === "string" && out.content === undefined) {
    const { text, ...rest } = out
    out = { ...rest, content: text }
  }
  if (out.type === "text" && isPlain(out.style) && out.fill === undefined) {
    const { fill, color, ...style } = out.style
    const paint = fill ?? color
    if (typeof paint === "string" || isPlain(paint) || Array.isArray(paint))
      out = { ...out, style, fill: paint }
  }
  if (out.type === "frame" && (isPlain(out.layout) || typeof out.dir === "string")) {
    const layout: Record<string, unknown> = { ...(isPlain(out.layout) ? out.layout : {}) }
    const rest: Record<string, unknown> = {}
    let moved = false
    for (const [k, v] of Object.entries(out)) {
      const to = LAYOUT_SLIPS[k]
      if (to && layout[to] === undefined) {
        layout[to] = v
        moved = true
      } else rest[k] = v
    }
    if (moved) out = { ...rest, layout }
  }
  return sizeAliases(out) as T
}

/** `width` / `height` are `w` / `h` (no node type has fields with those names). */
function sizeAliases<T extends Record<string, unknown>>(o: T): T {
  if (!("width" in o) && !("height" in o)) return o
  const { width, height, ...rest } = o as Record<string, unknown>
  return {
    ...rest,
    ...(width !== undefined && rest.w === undefined ? { w: width } : {}),
    ...(height !== undefined && rest.h === undefined ? { h: height } : {}),
  } as T
}

/** Maps a path of the final apply (`ops[j]...`) back to the wire op (`ops[i]`). */
export function wirePath(path: string, wireIndex: readonly number[]): string {
  const m = /^ops\[(\d+)\]/.exec(path)
  if (!m) return path
  const i = wireIndex[Number(m[1])]
  return i === undefined ? path : `ops[${i}]`
}

// --- pages (spec §5.6) ------------------------------------------------------------------------

function pageOps(
  doc: DocStore,
  op: Extract<WireOp, { op: "page" }>,
  newId: () => string,
  path: string,
): { ops: Op[]; pageId?: string } {
  const need = (v: unknown, field: string): string => {
    if (typeof v === "string" && v) return v
    throw new CompileError({
      code: "INVALID_INPUT",
      message: `page ${op.action} needs ${field}.`,
      path: `${path}.${field}`,
    })
  }
  const exists = (id: string) => {
    if (!pagesOf(doc).some((p) => p.id === id))
      throw new CompileError({
        code: "INVALID_INPUT",
        message: `Page ${id} does not exist.`,
        path: `${path}.id`,
        suggestion: "Read pages[].id with kimo_get_state.",
      })
    return id
  }
  switch (op.action) {
    case "add": {
      const r = addPageOps(doc, { name: need(op.name, "name"), id: newId() })
      if (op.index === undefined) return { ops: r.ops, pageId: r.pageId }
      // Appended, then moved to `index` (the move is computed on a throwaway replica).
      return {
        ops: [...r.ops, ...movePageAfterAdd(doc, r.ops, r.pageId, op.index)],
        pageId: r.pageId,
      }
    }
    case "rename":
      return { ops: renamePageOps(doc, exists(need(op.id, "id")), need(op.name, "name")) }
    case "move":
      return { ops: movePageOps(doc, exists(need(op.id, "id")), op.index ?? 0) }
    case "delete": {
      const id = exists(need(op.id, "id"))
      const ops = deletePageOps(doc, id)
      if (!ops.length)
        throw new CompileError({
          code: "INVALID_INPUT",
          message: "The last page of a document can't be deleted.",
          path: `${path}.id`,
        })
      return { ops }
    }
  }
}

/** Ops moving a page just added by `added` to `index` (computed on a throwaway replica). */
function movePageAfterAdd(doc: DocStore, added: Op[], pageId: string, index: number): Op[] {
  const s = scratchOf(doc)
  try {
    s.apply(added, { origin: SCRATCH_ORIGIN })
    return movePageOps(s, pageId, index)
  } finally {
    s.destroy()
  }
}

// --- copy / replace ------------------------------------------------------------------------

function childIndex(store: DocStore): Map<string, string[]> {
  const kids = new Map<string, string[]>()
  for (const id of store.nodeIds()) {
    const n = store.getNode(id) as NodeData
    if (typeof n.parent !== "string") continue
    let l = kids.get(n.parent)
    if (!l) {
      l = []
      kids.set(n.parent, l)
    }
    l.push(id)
  }
  return kids
}

function copyOps(
  scratch: DocStore,
  op: Extract<WireOp, { op: "copy" }>,
  resolve: (r: string) => string,
  newId: () => string,
  path: string,
): {
  ops: Op[]
  rootId: string
  name: unknown
  ids: Map<string, string>
  shallow: [string, string][]
} {
  const src = resolve(op.id)
  const root = scratch.getNode(src)
  if (!root)
    throw new CompileError({
      code: "NODE_NOT_FOUND",
      message: `Node ${src} does not exist.`,
      path: `${path}.id`,
      nodeId: src,
    })
  const kids = childIndex(scratch)
  const ids = new Map<string, string>([[src, newId()]])
  const queue = [src]
  const ops: Op[] = []
  const rootBody: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(root)) if (!TREE_FIELDS.has(k)) rootBody[k] = v
  // A copy of a component main is a plain frame (instantiate makes instances).
  delete rootBody.component
  for (const [k, v] of Object.entries(sizeAliases(op.set ?? {})))
    if (v === null) delete rootBody[k]
    else rootBody[k] = v
  const insertRoot: Op = {
    op: "insert",
    id: ids.get(src) as string,
    parent: op.parent === "root" ? null : resolve(op.parent),
    node: rootBody,
  }
  if (op.at !== undefined) insertRoot.at = op.at
  if (op.index !== undefined) insertRoot.index = op.index
  ops.push(insertRoot)
  while (queue.length) {
    const p = queue.shift() as string
    for (const c of kids.get(p) ?? []) {
      const n = scratch.getNode(c) as NodeData
      const id = newId()
      ids.set(c, id)
      const body: Record<string, unknown> = { ...n, parent: ids.get(p) as string }
      ops.push({ op: "insert", id, node: body })
      queue.push(c)
    }
  }
  // Depth 1 and 2 of the copied subtree, breadth first (`ids` is in insertion order).
  const depth = new Map<string, number>([[src, 0]])
  const shallow: [string, string][] = []
  for (const [orig, id] of ids) {
    if (orig === src) continue
    const d = (depth.get((scratch.getNode(orig) as NodeData).parent as string) ?? 9) + 1
    depth.set(orig, d)
    if (d <= 2) shallow.push([orig, id])
  }
  return { ops, rootId: ids.get(src) as string, name: rootBody.name, ids, shallow }
}

function replaceOps(
  scratch: DocStore,
  id: string,
  node: Record<string, unknown>,
  path: string,
): Op[] {
  const old = scratch.getNode(id)
  if (!old)
    throw new CompileError({
      code: "NODE_NOT_FOUND",
      message: `Node ${id} does not exist.`,
      path: `${path}.id`,
      nodeId: id,
    })
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) if (!TREE_FIELDS.has(k)) body[k] = v
  if (body.type === old.type) {
    const set: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body)) if (k !== "type") set[k] = v
    const unset = Object.keys(old).filter(
      (k) => !TREE_FIELDS.has(k) && k !== "type" && !Object.hasOwn(body, k),
    )
    return [{ op: "update", id, set, unset }]
  }
  const placed: Record<string, unknown> = { ...body, parent: old.parent, order: old.order }
  if (old.at !== undefined) placed.at = old.at
  return [
    { op: "delete", id },
    { op: "insert", id, node: placed },
  ]
}

/** Node ids an op group touched (inserted, updated, moved, deleted), in order, unique. */
export function touchedIds(ops: readonly NormalizedOp[]): string[] {
  const seen = new Set<string>()
  for (const o of ops) if ("id" in o) seen.add(o.id)
  return [...seen]
}

/**
 * Board 31 "Agent cursor": the layer an agent's pointer moves to after an edit lands — the last
 * layer the edit added (the last `insert` in op order, so a copy counts as its last copied
 * layer), else the last layer it changed. Deleted layers, header changes and edits that only set
 * or clear `placeholder` never move it (undefined: the pointer stays where it is).
 */
export function pointerTarget(ops: readonly unknown[] | undefined): string | undefined {
  if (!ops?.length) return undefined
  const deleted = new Set<string>()
  for (const raw of ops) {
    const o = raw as { op?: string; id?: unknown }
    if (o.op === "delete" && typeof o.id === "string") deleted.add(o.id)
  }
  let inserted: string | undefined
  let changed: string | undefined
  for (const raw of ops) {
    const o = raw as { op?: string; id?: unknown; set?: unknown; unset?: unknown }
    if (typeof o.id !== "string" || deleted.has(o.id)) continue
    if (o.op === "insert") inserted = o.id
    else if (o.op === "move") changed = o.id
    else if (o.op === "update") {
      const keys = [
        ...Object.keys((o.set as Record<string, unknown> | undefined) ?? {}),
        ...((o.unset as string[] | undefined) ?? []),
      ]
      if (keys.some((k) => k !== "placeholder")) changed = o.id
    }
  }
  return inserted ?? changed
}
