/**
 * `YjsDocStore`: the v1 {@link DocStore} on Yjs (teardown 9.2–9.4, ADR 0003).
 *
 * Shape of the Y.Doc (mirrors the `.kimo` file 1:1):
 * - `nodes`:  Y.Map<id, Y.Map<field, JSON>> — the flat node table; each top-level node field
 *   is one map entry, so concurrent edits of different fields merge;
 * - `header`: root members other than `nodes`, `variables` and `themes` (whole values);
 * - `variables`: name → variable; `themes`: axis → values;
 * - `flags`: presence of empty `variables` / `themes` objects (exact round trips);
 * - `moves`: id → {@link MoveRecord} of the node's last reparenting, for cycle repair.
 *
 * Only this file imports Yjs; consumers see plain JSON and opaque binary updates.
 */
import {
  compareSiblings,
  formatStatus,
  jsonEqual,
  type KimoDocument,
  type ValidationIssue,
  type ValidationResult,
  validate,
} from "@kimo/core-schema"
import * as Y from "yjs"
import { Draft, type DraftBase, OpFailure } from "./draft"
import { randomToken } from "./ids"
import { cloneJson, deepFreeze, setOwn } from "./json"
import { flattenOps, type NodeData, type NormalizedOp, type Op } from "./ops"
import { isLocalOrigin, type LocalOrigin, type Origin, type RemoteOrigin } from "./origin"
import { type MoveRecord, planTreeRepairs, type TreeFields, type TreeRepair } from "./repair"
import {
  type ApplyOptions,
  type ApplyResult,
  type ChangeCause,
  type DocStore,
  type DocStoreOptions,
  DocumentInvalidError,
  type LoadOptions,
  type OpError,
  type OpLogEntry,
  type ReadOnlyState,
  type Revision,
  type StoreChange,
  sameRevision,
  type UndoResult,
} from "./types"

/** Root members stored outside the `header` map. */
const SPLIT_KEYS = new Set(["nodes", "variables", "themes"])

const issueKey = (i: ValidationIssue) => `${i.code}\u0000${i.path}`

/** Extracts the node id from a JSON Pointer such as `/nodes/<id>/fill`. */
function nodeIdOf(pointer: string): string | undefined {
  const m = /^\/nodes\/([^/]+)/.exec(pointer)
  return m ? (m[1] as string).replace(/~1/g, "/").replace(/~0/g, "~") : undefined
}

/** {@link DocStore} implementation on a Yjs document. */
export class YjsDocStore implements DocStore {
  private readonly ydoc: Y.Doc
  private readonly yHeader: Y.Map<unknown>
  private readonly yVars: Y.Map<unknown>
  private readonly yThemes: Y.Map<unknown>
  private readonly yFlags: Y.Map<unknown>
  private readonly yNodes: Y.Map<Y.Map<unknown>>
  private readonly yMoves: Y.Map<unknown>

  /** Frozen plain-JSON mirror of the node table, kept in sync by observers. */
  private readonly mirror = new Map<string, NodeData>()
  /** parent id (null = root) → child ids, any `at`. */
  private readonly byParent = new Map<string | null, Set<string>>()

  private epoch = randomToken(8)
  private seq = 0
  private ro: ReadOnlyState | null = null
  private destroyed = false

  private readonly managers = new Map<LocalOrigin, Y.UndoManager>()
  private readonly changeListeners = new Set<(c: StoreChange) => void>()
  private readonly updateListeners = new Set<(u: Uint8Array, o: Origin) => void>()
  private readonly entries: OpLogEntry[] = []

  /** Context of the transaction being run by this store (origin and cause). */
  private tx: { origin: Origin; cause: ChangeCause } | null = null
  private pendingNodes = new Set<string>()
  private pendingHeader = false
  private baseline: { key: string; errors: Set<string>; warnings: Set<string> } | null = null

  private readonly options: Required<Omit<DocStoreOptions, "validateOptions" | "random">> &
    Pick<DocStoreOptions, "validateOptions" | "random">

  constructor(options: DocStoreOptions = {}) {
    this.options = {
      validation: options.validation ?? "full",
      logLimit: options.logLimit ?? 1000,
      now: options.now ?? Date.now,
      jitter: options.jitter ?? 3,
      autoRepair: options.autoRepair ?? true,
      validateOptions: options.validateOptions,
      random: options.random,
    }
    this.ydoc = new Y.Doc()
    this.yHeader = this.ydoc.getMap("header")
    this.yVars = this.ydoc.getMap("variables")
    this.yThemes = this.ydoc.getMap("themes")
    this.yFlags = this.ydoc.getMap("flags")
    this.yNodes = this.ydoc.getMap("nodes")
    this.yMoves = this.ydoc.getMap("moves")

    this.yNodes.observeDeep((events) => {
      for (const e of events) {
        if (e.target === this.yNodes) {
          for (const key of (e as Y.YMapEvent<unknown>).keysChanged) this.refresh(key)
        } else {
          const id = e.path[0]
          if (typeof id === "string") this.refresh(id)
        }
      }
    })
    const headerChanged = () => {
      this.pendingHeader = true
    }
    this.yHeader.observe(headerChanged)
    this.yVars.observe(headerChanged)
    this.yThemes.observe(headerChanged)
    this.yFlags.observe(headerChanged)

    this.ydoc.on("afterTransaction", (tr) => this.afterTransaction(tr))
    this.ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      if (this.updateListeners.size === 0) return
      const o = this.tx?.origin ?? (typeof origin === "string" ? (origin as Origin) : "remote")
      for (const l of [...this.updateListeners]) l(update, o)
    })
  }

  // --- Reading --------------------------------------------------------------------------------

  get revision(): Revision {
    return Object.freeze({ epoch: this.epoch, seq: this.seq })
  }

  get readOnly(): ReadOnlyState | null {
    return this.ro
  }

  get size(): number {
    return this.mirror.size
  }

  getNode(id: string): NodeData | undefined {
    return this.mirror.get(id)
  }

  hasNode(id: string): boolean {
    return this.mirror.has(id)
  }

  nodeIds(): string[] {
    return [...this.mirror.keys()]
  }

  children(parent: string | null, at?: string | null): string[] {
    const want = at ?? undefined
    const list: { id: string; order: string }[] = []
    for (const id of this.byParent.get(parent) ?? []) {
      const n = this.mirror.get(id) as NodeData
      if ((n.at ?? undefined) === want) list.push({ id, order: String(n.order) })
    }
    return list.sort(compareSiblings).map((e) => e.id)
  }

  toDocument(): KimoDocument {
    return cloneJson(new Draft(this.base(), this.draftOptions()).toDocument())
  }

  // --- Writing --------------------------------------------------------------------------------

  apply(ops: Op | readonly Op[], options: ApplyOptions): ApplyResult {
    this.assertAlive()
    const fail = (errors: OpError[]): ApplyResult => ({
      ok: false,
      errors,
      revision: this.revision,
    })
    if (!isLocalOrigin(options.origin)) {
      return fail([{ code: "INVALID_OP", message: `Invalid origin ${String(options.origin)}` }])
    }
    if (this.ro) return fail([{ code: "READ_ONLY", message: this.ro.reason }])
    const before = this.revision
    if (options.baseRevision && !sameRevision(options.baseRevision, before)) {
      return fail([
        {
          code: "REVISION_CONFLICT",
          message: `Document is at ${before.epoch}:${before.seq}, not ${options.baseRevision.epoch}:${options.baseRevision.seq}`,
        },
      ])
    }

    const draft = new Draft(this.base(), this.draftOptions())
    const forward: NormalizedOp[] = []
    const inverseGroups: NormalizedOp[][] = []
    const opPathByNode = new Map<string, string>()
    for (const { op, path } of flattenOps(ops)) {
      try {
        const step = draft.apply(op)
        forward.push(...step.forward)
        inverseGroups.push(step.inverse)
        for (const f of step.forward) if ("id" in f) opPathByNode.set(f.id, path)
        if (op.op === "delete") for (const id of draft.deleted) opPathByNode.set(id, path)
      } catch (e) {
        if (e instanceof OpFailure) return fail([e.toOpError(path)])
        throw e
      }
    }
    const inverse = inverseGroups.reverse().flat()

    let warnings: ValidationIssue[] = []
    let candidateResult: ValidationResult | null = null
    if (this.options.validation === "full" && draft.touched) {
      const base = this.baselineIssues()
      candidateResult = validate(draft.toDocument(), this.options.validateOptions)
      const errors = candidateResult.errors.filter((i) => !base.errors.has(issueKey(i)))
      if (errors.length > 0) {
        return fail(
          errors.map((issue) => {
            const nodeId = nodeIdOf(issue.path)
            const e: OpError = { code: "SCHEMA_VIOLATION", message: issue.message, issue }
            if (nodeId !== undefined) {
              e.nodeId = nodeId
              const p = opPathByNode.get(nodeId)
              if (p !== undefined) e.path = p
            }
            return e
          }),
        )
      }
      warnings = candidateResult.warnings.filter((i) => !base.warnings.has(issueKey(i)))
    }

    const success = (revision: Revision, dryRun: boolean): ApplyResult => ({
      ok: true,
      before,
      revision,
      ops: forward,
      inverse,
      created: [...draft.created],
      deleted: [...draft.deleted],
      warnings,
      dryRun,
    })
    if (options.dryRun) return success(before, true)
    if (!draft.touched) return success(before, false)

    this.managerFor(options.origin)
    this.transact(options.origin, "ops", () => this.commit(draft))
    const after = this.revision
    if (candidateResult) this.baseline = this.baselineFrom(candidateResult, after)
    const entry: OpLogEntry = {
      kind: "ops",
      origin: options.origin,
      revision: after,
      time: this.options.now(),
      ops: forward,
      inverse,
    }
    if (options.label !== undefined) entry.label = options.label
    this.log_(entry)
    return success(after, false)
  }

  loadDocument(doc: KimoDocument, options: LoadOptions = {}): void {
    this.assertAlive()
    if (options.validate !== false) {
      const status = formatStatus((doc as { format?: unknown }).format)
      if (status !== "current") {
        throw new DocumentInvalidError([
          {
            code:
              status === "newer"
                ? "FORMAT_NEWER"
                : status === "older"
                  ? "FORMAT_OLDER"
                  : "FORMAT_INVALID",
            path: "/format",
            message: `Format must be current to load for editing (got ${status})`,
            severity: "error",
          },
        ])
      }
      const r = validate(doc, this.options.validateOptions)
      if (!r.ok) throw new DocumentInvalidError(r.errors)
    }
    const src = cloneJson(doc) as unknown as Record<string, unknown>
    const origin = options.origin ?? "file"
    this.transact(origin, "load", () => {
      // Header members.
      for (const k of [...this.yHeader.keys()]) if (!Object.hasOwn(src, k)) this.yHeader.delete(k)
      for (const [k, v] of Object.entries(src)) {
        if (SPLIT_KEYS.has(k)) continue
        if (!jsonEqual(this.yHeader.get(k), v)) this.yHeader.set(k, v)
      }
      syncRecord(this.yVars, asRecord(src.variables))
      syncRecord(this.yThemes, asRecord(src.themes))
      setFlag(this.yFlags, "variables", Object.hasOwn(src, "variables"))
      setFlag(this.yFlags, "themes", Object.hasOwn(src, "themes"))
      // Nodes.
      const nodes = asRecord(src.nodes)
      for (const id of [...this.yNodes.keys()]) {
        if (!Object.hasOwn(nodes, id)) {
          this.yNodes.delete(id)
          this.yMoves.delete(id)
        }
      }
      for (const [id, n] of Object.entries(nodes)) {
        if (typeof n !== "object" || n === null || Array.isArray(n)) continue
        this.writeNode(id, n as Record<string, unknown>)
      }
    })
    if (options.newEpoch !== false) {
      this.epoch = randomToken(8)
      this.seq = 0
      this.clearHistory()
      this.baseline = null
    }
    this.log_({ kind: "load", origin, revision: this.revision, time: this.options.now() })
  }

  setReadOnly(reason: string | null): void {
    this.ro = reason === null ? null : Object.freeze({ reason })
  }

  repair(): TreeRepair[] {
    this.assertAlive()
    if (this.ro) return []
    const nodes = new Map<string, TreeFields>()
    for (const [id, n] of this.mirror) {
      const parent = typeof n.parent === "string" ? n.parent : null
      const f: { parent: string | null; order: string; at?: string } = {
        parent,
        order: typeof n.order === "string" ? n.order : "",
      }
      if (typeof n.at === "string") f.at = n.at
      nodes.set(id, f)
    }
    const moves = new Map<string, MoveRecord>()
    for (const [id, rec] of this.yMoves.entries()) {
      if (isMoveRecord(rec)) moves.set(id, rec)
    }
    const repairs = planTreeRepairs(nodes, moves)
    if (repairs.length === 0) return repairs
    this.transact("system", "repair", () => {
      for (const r of repairs) {
        const y = this.yNodes.get(r.id)
        if (!y) continue
        if (y.get("parent") !== r.parent) y.set("parent", r.parent)
        if (r.at === undefined) {
          if (y.has("at")) y.delete("at")
        } else if (y.get("at") !== r.at) y.set("at", r.at)
        if (y.get("order") !== r.order) y.set("order", r.order)
      }
    })
    this.log_({ kind: "repair", revision: this.revision, time: this.options.now(), repairs })
    return repairs
  }

  // --- History --------------------------------------------------------------------------------

  undo(origin: LocalOrigin): UndoResult {
    return this.replay(origin, "undo")
  }

  redo(origin: LocalOrigin): UndoResult {
    return this.replay(origin, "redo")
  }

  canUndo(origin: LocalOrigin): boolean {
    return this.managers.get(origin)?.canUndo() ?? false
  }

  canRedo(origin: LocalOrigin): boolean {
    return this.managers.get(origin)?.canRedo() ?? false
  }

  clearHistory(origin?: LocalOrigin): void {
    if (origin !== undefined) this.managers.get(origin)?.clear()
    else for (const m of this.managers.values()) m.clear()
  }

  log(): readonly OpLogEntry[] {
    return this.entries
  }

  // --- Events and sync ------------------------------------------------------------------------

  onChange(listener: (change: StoreChange) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  onUpdate(listener: (update: Uint8Array, origin: Origin) => void): () => void {
    this.updateListeners.add(listener)
    return () => this.updateListeners.delete(listener)
  }

  encodeStateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc)
  }

  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, stateVector)
  }

  applyUpdate(update: Uint8Array, origin: RemoteOrigin = "remote"): void {
    this.assertAlive()
    const prev = this.tx
    this.tx = { origin, cause: "update" }
    try {
      Y.applyUpdate(this.ydoc, update, origin)
    } finally {
      this.tx = prev
    }
    if (this.options.autoRepair && prev === null) this.repair()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const m of this.managers.values()) m.destroy()
    this.managers.clear()
    this.changeListeners.clear()
    this.updateListeners.clear()
    this.ydoc.destroy()
  }

  // --- Internals ------------------------------------------------------------------------------

  private assertAlive(): void {
    if (this.destroyed) throw new Error("DocStore has been destroyed")
  }

  private draftOptions() {
    const orderKeys: { jitter: number; random?: () => number } = { jitter: this.options.jitter }
    if (this.options.random) orderKeys.random = this.options.random
    return { now: this.options.now, orderKeys }
  }

  /** Read view of the committed state for drafts. */
  private base(): DraftBase {
    const empty: ReadonlySet<string> = new Set()
    return {
      getNode: (id) => this.mirror.get(id),
      childIdsOf: (parent) => this.byParent.get(parent) ?? empty,
      getVariable: (name) => this.yVars.get(name),
      variableNames: () => this.yVars.keys(),
      getThemeAxis: (axis) => this.yThemes.get(axis) as readonly string[] | undefined,
      themeAxes: () => this.yThemes.keys(),
      header: () => {
        const h: Record<string, unknown> = {}
        for (const [k, v] of this.yHeader.entries()) setOwn(h, k, v)
        return h
      },
      hasVariables: () => this.yFlags.get("variables") === true,
      hasThemes: () => this.yFlags.get("themes") === true,
      nodeEntries: () => this.mirror.entries(),
    }
  }

  private transact(origin: Origin, cause: ChangeCause, fn: () => void): void {
    const prev = this.tx
    this.tx = { origin, cause }
    try {
      this.ydoc.transact(fn, origin)
    } finally {
      this.tx = prev
    }
  }

  /** Writes the draft overlay into the Y.Doc (inside a transaction). */
  private commit(draft: Draft): void {
    for (const [id, n] of draft.nodes) {
      if (n === null) {
        if (this.yNodes.has(id)) this.yNodes.delete(id)
        if (this.yMoves.has(id)) this.yMoves.delete(id)
      } else {
        this.writeNode(id, n)
      }
    }
    for (const [id, rec] of draft.moves) this.yMoves.set(id, { ...rec })
    for (const [name, v] of draft.variables) {
      if (v === null) this.yVars.delete(name)
      else this.yVars.set(name, cloneJson(v))
    }
    for (const [axis, v] of draft.themes) {
      if (v === null) this.yThemes.delete(axis)
      else this.yThemes.set(axis, cloneJson(v))
    }
    if (draft.variablesTouched) setFlag(this.yFlags, "variables", this.yVars.size > 0)
    if (draft.themesTouched) setFlag(this.yFlags, "themes", this.yThemes.size > 0)
  }

  /** Creates or diff-updates one node map. */
  private writeNode(id: string, n: Readonly<Record<string, unknown>>): void {
    const y = this.yNodes.get(id)
    if (!y) {
      const entries = Object.keys(n).map((k) => [k, cloneJson(n[k])] as [string, unknown])
      this.yNodes.set(id, new Y.Map(entries))
      return
    }
    const old = this.mirror.get(id) ?? (y.toJSON() as Record<string, unknown>)
    for (const k of Object.keys(old)) if (!Object.hasOwn(n, k)) y.delete(k)
    for (const k of Object.keys(n)) {
      if (!Object.hasOwn(old, k) || !jsonEqual(old[k], n[k])) y.set(k, cloneJson(n[k]))
    }
  }

  /** Re-reads one node from the Y.Doc into the mirror and the parent index. */
  private refresh(id: string): void {
    const old = this.mirror.get(id)
    if (old) this.byParent.get(parentKey(old))?.delete(id)
    const y = this.yNodes.get(id)
    if (y instanceof Y.Map) {
      const n = deepFreeze(y.toJSON()) as NodeData
      this.mirror.set(id, n)
      const key = parentKey(n)
      let set = this.byParent.get(key)
      if (!set) {
        set = new Set()
        this.byParent.set(key, set)
      }
      set.add(id)
    } else {
      this.mirror.delete(id)
    }
    this.pendingNodes.add(id)
  }

  private afterTransaction(tr: Y.Transaction): void {
    if (tr.changed.size === 0 && tr.deleteSet.clients.size === 0) return
    this.seq++
    const origin: Origin =
      this.tx?.origin ?? (typeof tr.origin === "string" ? (tr.origin as Origin) : "remote")
    const change: StoreChange = {
      origin,
      cause: this.tx?.cause ?? "update",
      revision: this.revision,
      nodes: this.pendingNodes,
      header: this.pendingHeader,
    }
    this.pendingNodes = new Set()
    this.pendingHeader = false
    for (const l of [...this.changeListeners]) l(change)
  }

  private managerFor(origin: LocalOrigin): Y.UndoManager {
    let m = this.managers.get(origin)
    if (!m) {
      m = new Y.UndoManager(
        [this.yHeader, this.yVars, this.yThemes, this.yFlags, this.yNodes, this.yMoves],
        { trackedOrigins: new Set([origin]), captureTimeout: 0 },
      )
      this.managers.set(origin, m)
    }
    return m
  }

  private replay(origin: LocalOrigin, kind: "undo" | "redo"): UndoResult {
    this.assertAlive()
    const m = this.managers.get(origin)
    const nothing: UndoResult = { ok: false, stale: false, revision: this.revision, repairs: [] }
    if (this.ro || !m) return nothing
    const stack = kind === "undo" ? m.undoStack : m.redoStack
    if (stack.length === 0) return nothing
    // Yjs keeps popping until an item has an effect; expose only the top item so that one
    // call replays exactly one op group, and report a stale (no-op) group instead.
    const rest = stack.splice(0, stack.length - 1)
    const prev = this.tx
    this.tx = { origin, cause: kind }
    let item: unknown
    try {
      item = kind === "undo" ? m.undo() : m.redo()
    } finally {
      this.tx = prev
      stack.unshift(...rest)
    }
    if (item == null) return { ...nothing, stale: true }
    this.log_({ kind, origin, revision: this.revision, time: this.options.now() })
    const repairs = this.options.autoRepair ? this.repair() : []
    return { ok: true, stale: false, revision: this.revision, repairs }
  }

  private baselineIssues(): { errors: Set<string>; warnings: Set<string> } {
    const rev = this.revision
    const key = `${rev.epoch}:${rev.seq}`
    if (this.baseline?.key !== key) {
      const doc = new Draft(this.base(), this.draftOptions()).toDocument()
      this.baseline = this.baselineFrom(validate(doc, this.options.validateOptions), rev)
    }
    return this.baseline as { errors: Set<string>; warnings: Set<string> }
  }

  private baselineFrom(r: ValidationResult, rev: Revision) {
    return {
      key: `${rev.epoch}:${rev.seq}`,
      errors: new Set(r.errors.map(issueKey)),
      warnings: new Set(r.warnings.map(issueKey)),
    }
  }

  private log_(entry: OpLogEntry): void {
    this.entries.push(entry)
    const over = this.entries.length - this.options.logLimit
    if (over > 0) this.entries.splice(0, over)
  }
}

function parentKey(n: NodeData): string | null {
  return typeof n.parent === "string" ? n.parent : null
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function syncRecord(y: Y.Map<unknown>, rec: Record<string, unknown>): void {
  for (const k of [...y.keys()]) if (!Object.hasOwn(rec, k)) y.delete(k)
  for (const [k, v] of Object.entries(rec)) if (!jsonEqual(y.get(k), v)) y.set(k, v)
}

function setFlag(y: Y.Map<unknown>, key: string, value: boolean): void {
  if (value) {
    if (y.get(key) !== true) y.set(key, true)
  } else if (y.has(key)) y.delete(key)
}

function isMoveRecord(v: unknown): v is MoveRecord {
  if (typeof v !== "object" || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.t === "number" &&
    (r.prevParent === null || typeof r.prevParent === "string") &&
    typeof r.prevOrder === "string"
  )
}

/** Creates an empty-or-loaded Yjs store. Validates `doc` (see {@link DocStore.loadDocument}). */
export function createDocStore(
  doc?: KimoDocument,
  options: DocStoreOptions & { load?: LoadOptions } = {},
): YjsDocStore {
  const store = new YjsDocStore(options)
  if (doc) store.loadDocument(doc, options.load)
  return store
}
