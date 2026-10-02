/**
 * The op layer's working copy: applies ops to an overlay over the committed state, normalizing
 * them and computing their inverses, without touching the CRDT. The store validates the
 * resulting candidate document and only then commits the overlay in one transaction.
 */
import { compareSiblings, type KimoDocument, type Variable } from "@kimo/core-schema"
import { generateId, isNodeId } from "./ids"
import { cloneJson, isPlainObject, NotJsonError, setOwn } from "./json"
import type {
  DeleteOp,
  InsertOp,
  MoveOp,
  NodeData,
  NormalizedOp,
  Op,
  SetThemesOp,
  SetVariablesOp,
  UpdateOp,
} from "./ops"
import { isOrderKey, type OrderKeyOptions, planInsertKeys } from "./order-key"
import type { MoveRecord } from "./repair"
import type { OpError, OpErrorCode } from "./types"

/** Read access to the committed state. */
export interface DraftBase {
  getNode(id: string): NodeData | undefined
  /** Ids of nodes whose `parent` is `parent` (any `at`). */
  childIdsOf(parent: string | null): Iterable<string>
  getVariable(name: string): unknown
  variableNames(): Iterable<string>
  getThemeAxis(axis: string): readonly string[] | undefined
  themeAxes(): Iterable<string>
  /** Root members other than `nodes`, `variables` and `themes`. */
  header(): Record<string, unknown>
  /** Whether `variables` / `themes` are present even when empty. */
  hasVariables(): boolean
  hasThemes(): boolean
  /** All committed nodes (no copies). */
  nodeEntries(): Iterable<[string, NodeData]>
}

/** Thrown inside the draft to reject the whole group. */
export class OpFailure extends Error {
  constructor(
    readonly code: OpErrorCode,
    message: string,
    readonly nodeId?: string,
  ) {
    super(message)
  }

  toOpError(path: string): OpError {
    const e: OpError = { code: this.code, message: this.message, path }
    if (this.nodeId !== undefined) e.nodeId = this.nodeId
    return e
  }
}

/** Keys an `update` op may not touch. */
const TREE_KEYS = new Set(["type", "parent", "at", "order"])

/** Output of applying one op. */
export interface DraftStep {
  forward: NormalizedOp[]
  inverse: NormalizedOp[]
}

/** Options for {@link Draft}. */
export interface DraftOptions {
  now: () => number
  orderKeys: OrderKeyOptions
}

type Leaf = Exclude<Op, { op: "batch" }>

/** An overlay of pending changes over a {@link DraftBase}. */
export class Draft {
  /** id → new node data, or null when deleted. */
  readonly nodes = new Map<string, NodeData | null>()
  readonly variables = new Map<string, unknown>()
  readonly themes = new Map<string, readonly string[] | null>()
  /** Reparenting moves performed (for cycle repair metadata). */
  readonly moves = new Map<string, MoveRecord>()
  readonly created: string[] = []
  readonly deleted: string[] = []
  variablesTouched = false
  themesTouched = false

  constructor(
    private readonly base: DraftBase,
    private readonly options: DraftOptions,
  ) {}

  /** Current node data (overlay first). */
  get(id: string): NodeData | undefined {
    if (this.nodes.has(id)) return this.nodes.get(id) ?? undefined
    return this.base.getNode(id)
  }

  /** Ids whose parent is `parent` (any `at`), reflecting the overlay. */
  childIds(parent: string | null): string[] {
    const out: string[] = []
    for (const id of this.base.childIdsOf(parent)) if (!this.nodes.has(id)) out.push(id)
    for (const [id, n] of this.nodes) if (n && n.parent === parent) out.push(id)
    return out
  }

  /** Siblings in the `(parent, at)` group, sorted, optionally excluding one id. */
  siblings(parent: string | null, at: string | undefined, exclude?: string) {
    const list: { id: string; order: string }[] = []
    for (const id of this.childIds(parent)) {
      if (id === exclude) continue
      const n = this.get(id) as NodeData
      if ((n.at ?? undefined) !== at) continue
      list.push({ id, order: typeof n.order === "string" ? n.order : "" })
    }
    return list.sort(compareSiblings)
  }

  /** Applies one leaf op. @throws {OpFailure} */
  apply(op: Leaf): DraftStep {
    if (!op || typeof op !== "object") throw new OpFailure("INVALID_OP", "Op must be an object")
    switch (op.op) {
      case "insert":
        return this.insert(op)
      case "update":
        return this.update(op)
      case "move":
        return this.move(op)
      case "delete":
        return this.remove(op)
      case "setVariables":
        return this.setVariables(op)
      case "setThemes":
        return this.setThemes(op)
      default:
        throw new OpFailure(
          "INVALID_OP",
          `Unknown op ${JSON.stringify((op as { op: unknown }).op)}`,
        )
    }
  }

  // --- Ops ------------------------------------------------------------------------------------

  private insert(op: InsertOp): DraftStep {
    if (!op.node || typeof op.node !== "object" || Array.isArray(op.node)) {
      throw new OpFailure("INVALID_OP", "insert needs a `node` object")
    }
    const body = json(op.node, "node") as Record<string, unknown>
    if (typeof body.type !== "string") throw new OpFailure("INVALID_OP", "node.type is required")
    const id = op.id ?? (typeof body.id === "string" ? body.id : undefined) ?? this.freshId()
    if (!isNodeId(id)) throw new OpFailure("INVALID_ID", `Invalid node id ${JSON.stringify(id)}`)
    if (this.get(id)) throw new OpFailure("NODE_EXISTS", `Node ${id} already exists`, id)
    if ("id" in body) delete body.id

    const parent = pick(op.parent, body.parent as string | null | undefined) ?? null
    const at = nonNull(pick(op.at, body.at as string | null | undefined))
    this.checkParent(parent)
    const steps: DraftStep = { forward: [], inverse: [] }
    const order = this.placeOrder(
      parent,
      at,
      op.order ?? asString(body.order),
      op.index,
      null,
      steps,
    )

    delete body.parent
    delete body.at
    delete body.order
    const node = { type: body.type, parent } as Record<string, unknown>
    if (at !== undefined) node.at = at
    node.order = order
    for (const k of Object.keys(body)) if (k !== "type") setOwn(node, k, body[k])

    this.nodes.set(id, node as NodeData)
    this.created.push(id)
    steps.forward.push({ op: "insert", id, node: node as NodeData })
    steps.inverse.unshift({ op: "delete", id })
    return steps
  }

  private update(op: UpdateOp): DraftStep {
    const n = this.requireNode(op.id)
    const set: Record<string, unknown> = {}
    const unset = new Set<string>()
    for (const [k, v] of Object.entries(record(op.set, "set", op.id))) {
      if (TREE_KEYS.has(k)) {
        throw new OpFailure("INVALID_OP", `update cannot change "${k}" (use move)`, op.id)
      }
      if (v === undefined) unset.add(k)
      else setOwn(set, k, json(v, `set/${k}`))
    }
    for (const k of stringList(op.unset, "unset", op.id)) {
      if (TREE_KEYS.has(k)) {
        throw new OpFailure("INVALID_OP", `update cannot remove "${k}"`, op.id)
      }
      if (Object.hasOwn(set, k)) {
        throw new OpFailure("INVALID_OP", `"${k}" is both set and unset`, op.id)
      }
      unset.add(k)
    }
    const next: Record<string, unknown> = {}
    for (const k of Object.keys(n)) if (!unset.has(k)) setOwn(next, k, n[k])
    for (const k of Object.keys(set)) setOwn(next, k, set[k])

    const inv = {
      op: "update" as const,
      id: op.id,
      set: {} as Record<string, unknown>,
      unset: [] as string[],
    }
    for (const k of [...Object.keys(set), ...unset]) {
      if (Object.hasOwn(n, k)) setOwn(inv.set, k, n[k])
      else if (!inv.unset.includes(k)) inv.unset.push(k)
    }
    this.nodes.set(op.id, next as NodeData)
    return {
      forward: [{ op: "update", id: op.id, set, unset: [...unset] }],
      inverse: [inv],
    }
  }

  private move(op: MoveOp): DraftStep {
    const n = this.requireNode(op.id)
    if (op.parent === undefined) throw new OpFailure("INVALID_OP", "move needs `parent`", op.id)
    const parent = op.parent
    const at = nonNull(op.at)
    this.checkParent(parent)
    const seen = new Set<string>()
    for (let p: string | null = parent; p !== null && !seen.has(p); ) {
      if (p === op.id) {
        throw new OpFailure("CYCLE", `Moving ${op.id} under ${parent} would create a cycle`, op.id)
      }
      seen.add(p)
      const pn = this.get(p)
      p = pn && typeof pn.parent === "string" ? pn.parent : null
    }
    const steps: DraftStep = { forward: [], inverse: [] }
    const order = this.placeOrder(parent, at, op.order, op.index, op.id, steps)
    const next: Record<string, unknown> = {}
    for (const k of Object.keys(n)) if (k !== "at") setOwn(next, k, n[k])
    next.parent = parent
    if (at !== undefined) next.at = at
    next.order = order
    this.nodes.set(op.id, next as NodeData)

    const fwd: NormalizedOp = { op: "move", id: op.id, parent, order }
    if (at !== undefined) fwd.at = at
    const inv: NormalizedOp = { op: "move", id: op.id, parent: n.parent, order: n.order }
    if (n.at !== undefined) inv.at = n.at
    steps.forward.push(fwd)
    steps.inverse.unshift(inv)
    if (n.parent !== parent || n.at !== at) {
      const rec: { -readonly [K in keyof MoveRecord]: MoveRecord[K] } = {
        t: this.options.now(),
        prevParent: n.parent,
        prevOrder: n.order,
      }
      if (n.at !== undefined) rec.prevAt = n.at
      this.moves.set(op.id, rec)
    }
    return steps
  }

  private remove(op: DeleteOp): DraftStep {
    this.requireNode(op.id)
    const ids: string[] = []
    const queue = [op.id]
    while (queue.length > 0) {
      const id = queue.shift() as string
      ids.push(id)
      queue.push(...this.childIds(id))
    }
    const inverse: NormalizedOp[] = []
    for (const id of ids) {
      inverse.push({ op: "insert", id, node: this.get(id) as NodeData })
      this.nodes.set(id, null)
      this.moves.delete(id)
      this.deleted.push(id)
    }
    return { forward: [{ op: "delete", id: op.id }], inverse }
  }

  private setVariables(op: SetVariablesOp): DraftStep {
    const set: Record<string, Variable> = {}
    const unset: string[] = []
    const inv = {
      op: "setVariables" as const,
      set: {} as Record<string, Variable>,
      unset: [] as string[],
    }
    const remember = (name: string) => {
      if (Object.hasOwn(inv.set, name) || inv.unset.includes(name)) return
      const old = this.variable(name)
      if (old === undefined) inv.unset.push(name)
      else setOwn(inv.set, name, old)
    }
    for (const [name, v] of Object.entries(record(op.set, "set"))) {
      if (v === undefined) continue
      remember(name)
      const c = json(v, `set/${name}`)
      setOwn(set, name, c)
      this.variables.set(name, c)
    }
    for (const name of stringList(op.unset, "unset")) {
      if (Object.hasOwn(set, name)) {
        throw new OpFailure("INVALID_OP", `Variable "${name}" is both set and unset`)
      }
      remember(name)
      unset.push(name)
      this.variables.set(name, null)
    }
    this.variablesTouched = true
    return { forward: [{ op: "setVariables", set, unset }], inverse: [inv] }
  }

  private setThemes(op: SetThemesOp): DraftStep {
    const set: Record<string, string[]> = {}
    const unset: string[] = []
    const inv = {
      op: "setThemes" as const,
      set: {} as Record<string, string[]>,
      unset: [] as string[],
    }
    const remember = (axis: string) => {
      if (Object.hasOwn(inv.set, axis) || inv.unset.includes(axis)) return
      const old = this.themeAxis(axis)
      if (old === undefined) inv.unset.push(axis)
      else setOwn(inv.set, axis, [...old])
    }
    for (const [axis, values] of Object.entries(record(op.set, "set"))) {
      if (values === undefined) continue
      if (!Array.isArray(values))
        throw new OpFailure("INVALID_OP", `Theme axis "${axis}" needs an array`)
      remember(axis)
      const c = json(values, `set/${axis}`) as string[]
      setOwn(set, axis, c)
      this.themes.set(axis, c)
    }
    for (const axis of stringList(op.unset, "unset")) {
      if (Object.hasOwn(set, axis)) {
        throw new OpFailure("INVALID_OP", `Theme axis "${axis}" is both set and unset`)
      }
      remember(axis)
      unset.push(axis)
      this.themes.set(axis, null)
    }
    this.themesTouched = true
    return { forward: [{ op: "setThemes", set, unset }], inverse: [inv] }
  }

  // --- Helpers ----------------------------------------------------------------------------

  /** Current variable value (overlay first). */
  variable(name: string): unknown {
    if (this.variables.has(name)) return this.variables.get(name) ?? undefined
    return this.base.getVariable(name)
  }

  /** Current theme axis values (overlay first). */
  themeAxis(axis: string): readonly string[] | undefined {
    if (this.themes.has(axis)) return this.themes.get(axis) ?? undefined
    return this.base.getThemeAxis(axis)
  }

  /** True when any change is pending. */
  get touched(): boolean {
    return this.nodes.size > 0 || this.variablesTouched || this.themesTouched
  }

  /**
   * The candidate document (committed state + overlay) for validation. Shares (frozen) node
   * objects with the store; do not mutate.
   */
  toDocument(): KimoDocument {
    const doc: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(this.base.header())) setOwn(doc, k, v)
    const themes: Record<string, unknown> = {}
    for (const axis of this.base.themeAxes()) {
      if (!this.themes.has(axis)) setOwn(themes, axis, this.base.getThemeAxis(axis))
    }
    for (const [axis, v] of this.themes) if (v !== null) setOwn(themes, axis, v)
    if (Object.keys(themes).length > 0 || (this.base.hasThemes() && !this.themesTouched)) {
      doc.themes = themes
    }
    const vars: Record<string, unknown> = {}
    for (const name of this.base.variableNames()) {
      if (!this.variables.has(name)) setOwn(vars, name, this.base.getVariable(name))
    }
    for (const [name, v] of this.variables) if (v !== null) setOwn(vars, name, v)
    if (Object.keys(vars).length > 0 || (this.base.hasVariables() && !this.variablesTouched)) {
      doc.variables = vars
    }
    // Plain assignment is much faster than defineProperty; only "__proto__" needs the latter.
    const nodes: Record<string, unknown> = {}
    const put = (id: string, n: unknown) => {
      if (id === "__proto__") setOwn(nodes, id, n)
      else nodes[id] = n
    }
    for (const [id, n] of this.base.nodeEntries()) if (!this.nodes.has(id)) put(id, n)
    for (const [id, n] of this.nodes) if (n !== null) put(id, n)
    doc.nodes = nodes
    return doc as unknown as KimoDocument
  }

  private requireNode(id: string): NodeData {
    if (typeof id !== "string") throw new OpFailure("INVALID_OP", "Op needs a node `id`")
    const n = this.get(id)
    if (!n) throw new OpFailure("NODE_NOT_FOUND", `Node ${id} not found`, id)
    return n
  }

  private checkParent(parent: string | null): void {
    if (parent === null) return
    if (typeof parent !== "string")
      throw new OpFailure("INVALID_OP", "`parent` must be an id or null")
    if (!this.get(parent))
      throw new OpFailure("NODE_NOT_FOUND", `Parent ${parent} not found`, parent)
  }

  private freshId(): string {
    for (;;) {
      const id = generateId()
      if (!this.get(id)) return id
    }
  }

  /**
   * Resolves the order key for a node placed in `(parent, at)`: the explicit key when given,
   * else a key at `index` (default: end). Sibling re-keys needed to make room are appended to
   * `steps` as moves.
   */
  private placeOrder(
    parent: string | null,
    at: string | undefined,
    order: string | undefined,
    index: number | undefined,
    self: string | null,
    steps: DraftStep,
  ): string {
    if (order !== undefined) {
      if (typeof order !== "string")
        throw new OpFailure("INVALID_OP", "`order` must be a string order key", self ?? undefined)
      if (!isOrderKey(order))
        throw new OpFailure("INVALID_OP", `Invalid order key ${JSON.stringify(order)}`)
      return order
    }
    if (index !== undefined && !Number.isInteger(index))
      throw new OpFailure("INVALID_OP", "`index` must be an integer", self ?? undefined)
    const sibs = this.siblings(parent, at, self ?? undefined)
    const plan = planInsertKeys(
      sibs.map((s) => s.order),
      index ?? sibs.length,
      1,
      this.options.orderKeys,
    )
    for (const { index: i, order: o } of plan.rekey) {
      const s = sibs[i] as { id: string; order: string }
      const n = this.get(s.id) as NodeData
      const next: Record<string, unknown> = {}
      for (const k of Object.keys(n)) setOwn(next, k, n[k])
      next.order = o
      this.nodes.set(s.id, next as NodeData)
      const fwd: NormalizedOp = { op: "move", id: s.id, parent, order: o }
      const inv: NormalizedOp = { op: "move", id: s.id, parent, order: n.order }
      if (at !== undefined) {
        fwd.at = at
        inv.at = at
      }
      steps.forward.push(fwd)
      steps.inverse.unshift(inv)
    }
    return plan.keys[0] as string
  }
}

function json(v: unknown, path: string): unknown {
  try {
    return cloneJson(v, path)
  } catch (e) {
    if (e instanceof NotJsonError) throw new OpFailure("INVALID_OP", e.message)
    throw e
  }
}

/** An op's `set` member: absent, or a plain object (op shapes may come from untyped JSON). */
function record(v: unknown, name: string, id?: string): Record<string, unknown> {
  if (v === undefined) return {}
  if (!isPlainObject(v)) throw new OpFailure("INVALID_OP", `\`${name}\` must be an object`, id)
  return v
}

/** An op's `unset` member: absent, or an array of strings. */
function stringList(v: unknown, name: string, id?: string): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || !v.every((k) => typeof k === "string"))
    throw new OpFailure("INVALID_OP", `\`${name}\` must be an array of strings`, id)
  return v
}

const pick = <T>(a: T | undefined, b: T | undefined): T | undefined => (a !== undefined ? a : b)
const nonNull = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v)
const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
