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
  createDocStore,
  type DocStore,
  generateId,
  type NodeData,
  type NormalizedOp,
  type Op,
  planCommand,
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
    }
  | { ok: false; errors: ToolError[] }

export interface CompileOptions {
  newId?: () => string
  libraries?: Libraries
}

class CompileError extends Error {
  constructor(readonly error: ToolError) {
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
  const keys = new Map<string, string>()
  const out: NormalizedOp[] = []
  const wireIndex: number[] = []
  const created: { key: string; id: string }[] = []
  const notes: CompiledNote[] = []
  try {
    wire.forEach((op, i) => {
      const path = `ops[${i}]`
      const resolve = (ref: string): string => {
        if (!ref.startsWith("@")) return ref
        const id = keys.get(ref.slice(1))
        if (!id)
          throw new CompileError({
            code: "INVALID_INPUT",
            message: `${ref} does not name a node created earlier in this call.`,
            path,
            suggestion: "Give the creating op a key and place it before this op.",
          })
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
          const o = toStoreOp(op, resolve, newId)
          ops = [o]
          remember(op.key, (o as { id: string }).id, op.node.name)
          break
        }
        case "update":
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
          break
        }
        case "replace":
          ops = replaceOps(scratch, resolve(op.id), op.node as Record<string, unknown>, path)
          break
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
    if (e instanceof CompileError) return { ok: false, errors: [e.error] }
    throw e
  } finally {
    scratch.destroy()
  }
  return { ok: true, ops: out, wireIndex, created, notes }
}

/** Maps a path of the final apply (`ops[j]...`) back to the wire op (`ops[i]`). */
export function wirePath(path: string, wireIndex: readonly number[]): string {
  const m = /^ops\[(\d+)\]/.exec(path)
  if (!m) return path
  const i = wireIndex[Number(m[1])]
  return i === undefined ? path : `ops[${i}]`
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
): { ops: Op[]; rootId: string; name: unknown } {
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
  Object.assign(rootBody, op.set ?? {})
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
  return { ops, rootId: ids.get(src) as string, name: rootBody.name }
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
