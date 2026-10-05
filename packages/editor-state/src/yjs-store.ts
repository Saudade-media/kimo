/**
 * `YjsDocStore`: the v1 {@link DocStore} on Yjs (teardown 9.2–9.4, ADR 0003).
 *
 * Shape of the Y.Doc (mirrors the `.kimo` file 1:1):
 * - `nodes`:  Y.Map<id, Y.Map<field, JSON>> — the flat node table; each top-level node field
 *   is one map entry, so concurrent edits of different fields merge. Record-valued instance
 *   fields (`overrides`, `args`, `props`) are nested Y.Maps keyed by IdPath / prop name, so
 *   concurrent overrides of different paths of one instance both survive;
 * - `header`: root members other than `nodes`, `variables` and `themes` (whole values, except
 *   `imports` and `pages`: nested Y.Maps by alias / page id, so two concurrent library links or
 *   new pages both survive);
 * - `variables`: name → variable; `themes`: axis → values;
 * - `flags`: presence of empty `variables` / `themes` objects (exact round trips);
 * - `moves`: id → {@link MoveRecord} of the node's last reparenting, for cycle repair.
 *
 * Only this file imports Yjs; consumers see plain JSON and opaque binary updates.
 */
import {
  compareSiblings,
  DOCUMENT_LEVEL_CODES,
  formatStatus,
  jsonEqual,
  type KimoDocument,
  structOrder,
  type ValidateOptions,
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
/** Record-valued node fields stored as nested Y.Maps (per-key last-writer-wins). */
const MERGED_NODE_FIELDS = new Set(["overrides", "args", "props"])
/** Record-valued header members stored as nested Y.Maps. */
const MERGED_HEADER_KEYS = new Set(["imports", "pages"])

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A Y value for field `k`: a prelim nested Y.Map for merged record fields, else JSON. */
function yValue(k: string, v: unknown, merged: ReadonlySet<string>): unknown {
  if (merged.has(k) && isRecord(v))
    return new Y.Map(Object.keys(v).map((kk) => [kk, cloneJson(v[kk])] as [string, unknown]))
  return cloneJson(v)
}

/**
 * Writes `v` at `y[k]`. A merged record field already held as a nested Y.Map is diffed key by
 * key (only changed keys are written), so concurrent writes of other keys are kept.
 */
function putField(y: Y.Map<unknown>, k: string, v: unknown, merged: ReadonlySet<string>): void {
  const cur = y.get(k)
  if (merged.has(k) && isRecord(v) && cur instanceof Y.Map) {
    for (const kk of [...cur.keys()]) if (!Object.hasOwn(v, kk)) cur.delete(kk)
    for (const [kk, vv] of Object.entries(v))
      if (!cur.has(kk) || !jsonEqual(plain(cur.get(kk)), vv)) cur.set(kk, cloneJson(vv))
    return
  }
  y.set(k, yValue(k, v, merged))
}

/** Plain JSON of a stored value (nested Y types → JSON). */
function plain(v: unknown): unknown {
  return v instanceof Y.AbstractType ? v.toJSON() : v
}

const issueKey = (i: ValidationIssue) => `${i.code}\u0000${i.path}`

/** Issues of the committed state, by {@link issueKey}. */
interface Baseline {
  errors: Map<string, ValidationIssue>
  warnings: Map<string, ValidationIssue>
}

/**
 * True when a structural change of node `n` (an insert, a delete, or a change of one of the
 * {@link REACHING_FIELDS}) can change issues outside its own neighbourhood (itself, its
 * parents, its children), so incremental validation must not be used: instances, components
 * and slot frames (override paths, props and slot rules reach across the tree), slot children
 * (`at`), theme pins (the effective theme of the subtree), and anything inside a component or
 * an instance.
 */
function crossTree(n: NodeData | undefined, get: (id: string) => NodeData | undefined): boolean {
  if (!n) return false
  if (
    n.type === "instance" ||
    n.component !== undefined ||
    n.slot !== undefined ||
    n.at !== undefined ||
    n.theme !== undefined
  )
    return true
  const seen = new Set<string>()
  let p = n.parent
  while (typeof p === "string" && !seen.has(p)) {
    seen.add(p)
    const a = get(p)
    if (!a) break
    if (a.type === "instance" || a.component !== undefined) return true
    p = a.parent
  }
  return false
}

/**
 * Node fields other nodes' rules read across the tree: tree placement and slot attachment,
 * type (override and prop targets, containers), the component / instance definitions (override
 * paths, props, args, swaps, instance cycles, slot rules). A change of any other field (fills,
 * geometry, name, visibility, …) of a node that is not a main component can only change the
 * issues of its neighbourhood, wherever the node sits: override and prop checks look at a
 * target's type and the patch, never at the target's other values, and the validator checks
 * real nodes only (never an instance's expansion). `theme` reaches the node's subtree
 * (effective theme of the bindings below it).
 */
const REACHING_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "parent",
  "at",
  "component",
  "slot",
  "of",
  "overrides",
  "args",
  "props",
])

/** Fields whose values differ between `old` and `next` (added and removed ones included). */
function changedFields(old: NodeData, next: NodeData): Set<string> {
  const out = new Set<string>()
  for (const k of Object.keys(old))
    if (!Object.hasOwn(next, k) || !jsonEqual(old[k], next[k])) out.add(k)
  for (const k of Object.keys(next)) if (!Object.hasOwn(old, k)) out.add(k)
  return out
}

/**
 * How far the issues a change of one node (`old` → `next`) can move reach: its neighbourhood
 * (`near`), its neighbourhood and its whole subtree (`subtree`: a theme pin changed), or the
 * whole document (`all`, see {@link crossTree} and {@link REACHING_FIELDS}).
 */
function reachOf(
  old: NodeData | undefined,
  next: NodeData | undefined,
  oldGet: (id: string) => NodeData | undefined,
  newGet: (id: string) => NodeData | undefined,
): "near" | "subtree" | "all" {
  if (old && next) {
    const changed = changedFields(old, next)
    let reaching = false
    for (const k of changed)
      if (REACHING_FIELDS.has(k)) {
        reaching = true
        break
      }
    if (!reaching) {
      // A main component's own visuals are what its instances show (the fit lint of an
      // instance's parent reads them; prop declarations live on it).
      if (old.component !== undefined) return "all"
      return changed.has("theme") ? "subtree" : "near"
    }
    // An instance's overrides (not a derived component's) are read by its own checks and by
    // its `at` children (slot / replace content); only swaps and instance-prop args in them
    // (`set.of`, `set.args`) reach other components (instance cycles).
    let overridesOnly = changed.has("overrides")
    for (const k of changed)
      if (k !== "overrides" && (REACHING_FIELDS.has(k) || k === "theme")) overridesOnly = false
    if (
      overridesOnly &&
      old.type === "instance" &&
      old.component === undefined &&
      next.component === undefined &&
      jsonEqual(swapsIn(old.overrides), swapsIn(next.overrides))
    )
      return "subtree"
  }
  if (crossTree(old, oldGet) || crossTree(next, newGet)) return "all"
  if (
    old &&
    next &&
    old.parent !== next.parent &&
    (themedAncestor(old, oldGet) || themedAncestor(next, newGet))
  )
    return "all"
  return "near"
}

/** The `set.of` / `set.args` entries of an instance's overrides, by key (cycle edges). */
function swapsIn(overrides: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!isRecord(overrides)) return out
  for (const [k, ov] of Object.entries(overrides)) {
    if (!isRecord(ov) || !isRecord(ov.set)) continue
    if ("of" in ov.set || "args" in ov.set) out[k] = [ov.set.of ?? null, ov.set.args ?? null]
  }
  return out
}

/** True when an ancestor of `n` (by `get`) pins a theme. */
function themedAncestor(n: NodeData, get: (id: string) => NodeData | undefined): boolean {
  const seen = new Set<string>()
  let p = n.parent
  while (typeof p === "string" && !seen.has(p)) {
    seen.add(p)
    const a = get(p)
    if (!a) break
    if (a.theme !== undefined) return true
    p = a.parent
  }
  return false
}

/** Nodes (and variables) an incremental validation re-checks. */
interface Scope {
  nodes: Set<string>
  /** Variables whose own rules re-run (a header edit), or null (nodes only). */
  variables: Set<string> | null
}

/** Binding targets (`$ref`) anywhere in `v`, in walk order (`meta` skipped). */
function refTargets(v: unknown): string[] {
  const out: string[] = []
  const walk = (x: unknown, depth: number) => {
    if (depth > 64 || x === null || typeof x !== "object") return
    if (Array.isArray(x)) {
      for (const y of x) walk(y, depth + 1)
      return
    }
    const r = x as Record<string, unknown>
    if (typeof r.$ref === "string" && Object.keys(r).length === 1) {
      out.push(r.$ref)
      return
    }
    for (const k in r) if (k !== "meta") walk(r[k], depth + 1)
  }
  walk(v, 0)
  return out
}

/** True when `pointer` is under `/variables/<name>` for a name in `names`. */
function inVariables(pointer: string, names: ReadonlySet<string> | null): boolean {
  if (!names || names.size === 0 || !pointer.startsWith("/variables/")) return false
  const end = pointer.indexOf("/", "/variables/".length)
  const raw = pointer.slice("/variables/".length, end < 0 ? undefined : end)
  return names.has(raw.replace(/~1/g, "/").replace(/~0/g, "~"))
}

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
  /**
   * Sorted child lists per parent and `at` (perf: `children()` is called for every node on
   * every layout / expansion pass). Dropped for the old and new parent of each refreshed node.
   */
  private readonly sortedKids = new Map<string | null, Map<string, readonly string[]>>()

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
  /** Issues of the committed state, kept current incrementally (null = recompute fully). */
  private baseline: Baseline | null = null
  /**
   * Diagnostics: validation runs of op groups and baseline upkeep, whole-document (`full`) or
   * incremental (`scoped`), with the number of nodes the scoped runs covered (perf tests).
   *
   * @internal Test and perf diagnostics only; not part of the {@link DocStore} contract and may
   * change or disappear without notice.
   */
  readonly validationRuns = { full: 0, scoped: 0, scopedNodes: 0 }
  private countRun(scope: Scope | null): void {
    if (scope) {
      this.validationRuns.scoped++
      this.validationRuns.scopedNodes += scope.nodes.size
    } else this.validationRuns.full++
  }
  /** Binding targets (`$ref`) of every node that has any (header-scoped validation). */
  private readonly refsOf = new Map<string, readonly string[]>()
  /** Set when node upkeep (not the header) asked for a full re-validation (see apply). */
  private nodesDirtyAll = false
  /**
   * Nodes whose issues may be stale since the baseline was computed: the nodes changed since
   * (undo/redo, remote updates) and their neighbourhoods.
   */
  private readonly dirty = new Set<string>()
  /** A change since the baseline that needs a full validation (header, components, ...). */
  private dirtyAll = false

  private readonly options: Required<Omit<DocStoreOptions, "validateOptions" | "random">> &
    Pick<DocStoreOptions, "validateOptions" | "random">

  constructor(options: DocStoreOptions = {}) {
    this.options = {
      validation: options.validation ?? "incremental",
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
      this.dirtyAll = true
    }
    this.yHeader.observeDeep(headerChanged)
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
    let byAt = this.sortedKids.get(parent)
    const cached = byAt?.get(want === undefined ? "\u0000" : want)
    // A copy: callers own the returned array.
    if (cached) return cached.slice()
    const list: { id: string; order: string }[] = []
    for (const id of this.byParent.get(parent) ?? []) {
      const n = this.mirror.get(id) as NodeData
      if ((n.at ?? undefined) === want) list.push({ id, order: String(n.order) })
    }
    const ids = list.sort(compareSiblings).map((e) => e.id)
    if (!byAt) {
      byAt = new Map()
      this.sortedKids.set(parent, byAt)
    }
    byAt.set(want === undefined ? "\u0000" : want, ids)
    return ids.slice()
  }

  toDocument(): KimoDocument {
    const doc = cloneJson(new Draft(this.base(), this.draftOptions()).toDocument())
    // Yjs map iteration order depends on how updates arrived (e.g. after an IndexedDB reload),
    // so data-keyed members are emitted in code-unit key order to keep the output deterministic.
    const record = doc as unknown as Record<string, unknown>
    for (const key of ["nodes", "variables", "themes"]) {
      const value = record[key]
      if (value && typeof value === "object")
        record[key] = sortKeys(value as Record<string, unknown>)
    }
    return doc
  }

  toHeader(): Omit<KimoDocument, "nodes"> {
    const doc = cloneJson(
      new Draft(this.base(), this.draftOptions()).toDocument(false),
    ) as unknown as Record<string, unknown>
    for (const key of ["variables", "themes"]) {
      const value = doc[key]
      if (value && typeof value === "object") doc[key] = sortKeys(value as Record<string, unknown>)
    }
    return doc as unknown as Omit<KimoDocument, "nodes">
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
    let scope: Scope | null = null
    if (this.options.validation !== "none" && draft.touched) {
      const base = this.baselineIssues()
      scope = this.options.validation === "incremental" ? this.scopeOf(draft) : null
      this.countRun(scope)
      candidateResult = validate(draft.toDocument(), this.scopedOptions(scope))
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
    const wasAll = this.dirtyAll
    this.nodesDirtyAll = false
    this.transact(options.origin, "ops", () => this.commit(draft))
    const after = this.revision
    // The candidate's issues are the committed state's now: no need to re-check those nodes.
    if (candidateResult) this.absorb(candidateResult, scope)
    // A header edit marks everything dirty (its observer cannot tell what changed); one the
    // scoped run covered (variable values, theme order) leaves the baseline exact.
    if (scope?.variables && !wasAll && !this.nodesDirtyAll) this.dirtyAll = false
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
        if (!jsonEqual(plain(this.yHeader.get(k)), v))
          putField(this.yHeader, k, v, MERGED_HEADER_KEYS)
      }
      // Merged header records exist (empty = absent) so the first concurrent writes merge.
      for (const k of MERGED_HEADER_KEYS) {
        const cur = this.yHeader.get(k)
        if (Object.hasOwn(src, k)) continue
        if (cur instanceof Y.Map) cur.clear()
        else this.yHeader.set(k, new Y.Map())
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
    }
    this.baseline = null
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

  topUndo(origin: LocalOrigin): object | null {
    const stack = this.managers.get(origin)?.undoStack
    return stack?.[stack.length - 1] ?? null
  }

  groupUndo(origin: LocalOrigin): () => void {
    this.assertAlive()
    const m = this.managerFor(origin)
    // The first transaction starts a new stack item; later ones merge into it (Yjs merges
    // while `now - lastChange < captureTimeout`).
    m.stopCapturing()
    m.captureTimeout = Number.POSITIVE_INFINITY
    let open = true
    return () => {
      if (!open) return
      open = false
      m.captureTimeout = 0
      m.stopCapturing()
    }
  }

  discardUndo(origin: LocalOrigin): UndoResult {
    const r = this.replay(origin, "undo")
    if (r.ok || r.stale) this.managers.get(origin)?.redoStack.pop()
    return r
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
        for (const [k, v] of this.yHeader.entries()) {
          if (v instanceof Y.Map && v.size === 0 && MERGED_HEADER_KEYS.has(k)) continue
          setOwn(h, k, plain(v))
        }
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
    for (const [k, v] of draft.header) {
      const cur = this.yHeader.get(k)
      if (v === null) {
        if (MERGED_HEADER_KEYS.has(k) && cur instanceof Y.Map) cur.clear()
        else this.yHeader.delete(k)
      } else putField(this.yHeader, k, v, MERGED_HEADER_KEYS)
    }
    if (draft.variablesTouched) setFlag(this.yFlags, "variables", this.yVars.size > 0)
    if (draft.themesTouched) setFlag(this.yFlags, "themes", this.yThemes.size > 0)
  }

  /** Creates or diff-updates one node map. */
  private writeNode(id: string, n: Readonly<Record<string, unknown>>): void {
    const y = this.yNodes.get(id)
    if (!y) {
      const entries = Object.keys(n).map(
        (k) => [k, yValue(k, n[k], MERGED_NODE_FIELDS)] as [string, unknown],
      )
      // An instance always holds its record fields as (possibly empty) nested maps, so the
      // first overrides written concurrently by two peers merge instead of racing to create
      // the map. An empty nested map reads as an absent field (see `refresh`).
      if (n.type === "instance")
        for (const k of MERGED_NODE_FIELDS) if (!Object.hasOwn(n, k)) entries.push([k, new Y.Map()])
      this.yNodes.set(id, new Y.Map(entries))
      return
    }
    const old = this.mirror.get(id) ?? (y.toJSON() as Record<string, unknown>)
    for (const k of Object.keys(old)) {
      if (Object.hasOwn(n, k)) continue
      const cur = y.get(k)
      if (MERGED_NODE_FIELDS.has(k) && cur instanceof Y.Map) cur.clear()
      else y.delete(k)
    }
    for (const k of Object.keys(n)) {
      if (!Object.hasOwn(old, k) || !jsonEqual(old[k], n[k]))
        putField(y, k, n[k], MERGED_NODE_FIELDS)
    }
  }

  /** Re-reads one node from the Y.Doc into the mirror and the parent index. */
  private refresh(id: string): void {
    const old = this.mirror.get(id)
    if (old) {
      this.byParent.get(parentKey(old))?.delete(id)
      this.sortedKids.delete(parentKey(old))
    }
    const y = this.yNodes.get(id)
    let next: NodeData | undefined
    if (y instanceof Y.Map) {
      // Canonical member order: Yjs iterates map keys in an order that depends on the update
      // history, so the same node would otherwise read differently after a reload.
      const raw = y.toJSON() as Record<string, unknown>
      // Empty nested record maps (see `writeNode`) are absent fields.
      for (const k of MERGED_NODE_FIELDS)
        if (
          isRecord(raw[k]) &&
          Object.keys(raw[k] as object).length === 0 &&
          y.get(k) instanceof Y.Map
        )
          delete raw[k]
      const ordered: Record<string, unknown> = {}
      for (const k of structOrder(Object.keys(raw))) setOwn(ordered, k, raw[k])
      const n = deepFreeze(ordered) as NodeData
      next = n
      this.mirror.set(id, n)
      const refs = refTargets(n)
      if (refs.length > 0) this.refsOf.set(id, refs)
      else this.refsOf.delete(id)
      const key = parentKey(n)
      this.sortedKids.delete(key)
      let set = this.byParent.get(key)
      if (!set) {
        set = new Set()
        this.byParent.set(key, set)
      }
      set.add(id)
    } else {
      this.mirror.delete(id)
      this.refsOf.delete(id)
    }
    this.pendingNodes.add(id)
    this.markDirty(id, old, next)
  }

  /** Records that node `id` changed from `old` to `next` (validation baseline upkeep). */
  private markDirty(id: string, old: NodeData | undefined, next: NodeData | undefined): void {
    if (this.dirtyAll || this.baseline === null) return
    const get = (k: string) => this.mirror.get(k)
    const empty: ReadonlySet<string> = new Set()
    const reach = reachOf(old, next, get, get)
    if (reach === "all") {
      this.dirtyAll = true
      this.nodesDirtyAll = true
      return
    }
    const kids = (p: string) => this.byParent.get(p) ?? empty
    this.neighbourhood(this.dirty, id, old, next, kids)
    if (reach === "subtree") this.subtree(this.dirty, id, kids)
  }

  /**
   * Node ids whose issues an op group can change (see {@link neighbourhood}), or null when it
   * needs a full validation (see {@link crossTree}).
   */
  private scopeOf(draft: Draft): Scope | null {
    if (draft.header.size > 0) return null
    const scope = new Set<string>()
    let variables: Set<string> | null = null
    if (draft.variablesTouched || draft.themesTouched) {
      const h = this.headerScope(draft)
      if (!h) return null
      for (const id of h.nodes) scope.add(id)
      variables = h.variables
    }
    const oldGet = (k: string) => this.mirror.get(k)
    const newGet = (k: string) => draft.get(k)
    const kids = (p: string) => draft.childIds(p)
    for (const [id, n] of draft.nodes) {
      const old = this.mirror.get(id)
      const next = n ?? undefined
      const reach = reachOf(old, next, oldGet, newGet)
      if (reach === "all") return null
      this.neighbourhood(scope, id, old, next, kids)
      if (reach === "subtree") this.subtree(scope, id, kids)
    }
    return { nodes: scope, variables }
  }

  /**
   * What a variables / themes edit can change, when it keeps every variable name, type and
   * alias edge, and every theme axis with the same values (a default-mode switch reorders
   * them): the edited variables' own rules, and the theme lints of the nodes binding them (a
   * reorder: of every bound node). Null otherwise (full validation).
   */
  private headerScope(draft: Draft): { nodes: Set<string>; variables: Set<string> } | null {
    const changed = new Set<string>()
    for (const [name, next] of draft.variables) {
      const old = plain(this.yVars.get(name))
      if (old === undefined || next === null || next === undefined) return null
      if (jsonEqual(old, next)) continue
      if (!isRecord(old) || !isRecord(next) || old.type !== next.type) return null
      const a = refTargets(old.value)
      const b = refTargets(next.value)
      if (a.length !== b.length || a.some((t, i) => t !== b[i])) return null
      changed.add(name)
    }
    let reordered = false
    for (const [axis, next] of draft.themes) {
      const old = plain(this.yThemes.get(axis))
      if (!Array.isArray(old) || !Array.isArray(next)) return null
      if (jsonEqual(old, next)) continue
      const set = new Set(old)
      if (
        old.length !== next.length ||
        set.size !== old.length ||
        new Set(next).size !== next.length ||
        !next.every((v) => typeof v === "string" && set.has(v))
      )
        return null
      reordered = true
    }
    const nodes = new Set<string>()
    if (reordered) {
      // The default theme changed: every binding may now match a different entry.
      for (const id of this.refsOf.keys()) nodes.add(id)
      return { nodes, variables: changed }
    }
    if (changed.size === 0) return { nodes, variables: changed }
    // Bindings resolve through aliases: the edited variables and every alias of them.
    const reach = new Set(changed)
    for (let grew = true; grew; ) {
      grew = false
      for (const name of this.yVars.keys()) {
        if (reach.has(name)) continue
        const v = draft.variables.get(name) ?? plain(this.yVars.get(name))
        if (isRecord(v) && refTargets(v.value).some((t) => reach.has(t))) {
          reach.add(name)
          grew = true
        }
      }
    }
    for (const [id, refs] of this.refsOf) if (refs.some((t) => reach.has(t))) nodes.add(id)
    return { nodes, variables: changed }
  }

  private scopedOptions(scope: Scope | null): ValidateOptions | undefined {
    if (!scope) return this.options.validateOptions
    const o: ValidateOptions = { ...this.options.validateOptions, nodes: scope.nodes }
    if (scope.variables) o.variables = scope.variables
    return o
  }

  /** Adds every descendant of `id` (instance-owned nodes included) to `scope`. */
  private subtree(
    scope: Set<string>,
    id: string,
    childIds: (parent: string) => Iterable<string>,
  ): void {
    const seen = new Set<string>([id])
    const queue = [id]
    while (queue.length > 0) {
      const p = queue.pop() as string
      for (const c of childIds(p)) {
        if (seen.has(c)) continue
        seen.add(c)
        scope.add(c)
        queue.push(c)
      }
    }
  }

  /**
   * Adds the nodes whose issues a change of node `id` from `old` to `next` can affect: itself,
   * its old and new parents (sibling order, parent rules, fit lint), and, when it appears,
   * disappears or changes type, its children (parent existence and container rules).
   */
  private neighbourhood(
    scope: Set<string>,
    id: string,
    old: NodeData | undefined,
    next: NodeData | undefined,
    childIds: (parent: string) => Iterable<string>,
  ): void {
    scope.add(id)
    if (old && typeof old.parent === "string") scope.add(old.parent)
    if (next && typeof next.parent === "string") scope.add(next.parent)
    if (!old || !next || old.type !== next.type) for (const c of childIds(id)) scope.add(c)
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

  /**
   * Issues of the committed state. Recomputed fully when there is none yet or a change needed
   * it; otherwise only the nodes changed since (undo/redo, remote updates) are re-checked.
   */
  private baselineIssues(): Baseline {
    const full =
      this.baseline === null ||
      this.dirtyAll ||
      this.options.validation === "full" ||
      this.dirty.size > Math.max(256, this.mirror.size / 4)
    if (full || this.dirty.size > 0) {
      const doc = new Draft(this.base(), this.draftOptions()).toDocument()
      const scope: Scope | null = full ? null : { nodes: new Set(this.dirty), variables: null }
      this.countRun(scope)
      const r = validate(doc, this.scopedOptions(scope))
      this.absorb(r, scope)
    }
    return this.baseline as Baseline
  }

  /**
   * Makes `r` part of the baseline: the whole of it (`scope` null), or, for an incremental
   * result, in place of the previous issues of the nodes in `scope`. Clears their dirt.
   */
  private absorb(r: ValidationResult, scope: Scope | null): void {
    const into = (prev: Map<string, ValidationIssue> | undefined, list: ValidationIssue[]) => {
      const out = new Map<string, ValidationIssue>()
      if (prev && scope) {
        for (const [k, i] of prev) {
          const id = nodeIdOf(i.path)
          // Document-level lints survive: scoped runs never report them (nor their absence).
          if (
            DOCUMENT_LEVEL_CODES.has(i.code) ||
            (id !== undefined ? !scope.nodes.has(id) : !inVariables(i.path, scope.variables))
          )
            out.set(k, i)
        }
      }
      for (const i of list) out.set(issueKey(i), i)
      return out
    }
    if (scope && this.baseline) {
      this.baseline = {
        errors: into(this.baseline.errors, r.errors),
        warnings: into(this.baseline.warnings, r.warnings),
      }
      for (const id of scope.nodes) this.dirty.delete(id)
    } else {
      this.baseline = { errors: into(undefined, r.errors), warnings: into(undefined, r.warnings) }
      this.dirty.clear()
      this.dirtyAll = false
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

/** Copy of `rec` with keys in code-unit order (`__proto__`-safe via `setOwn`). */
function sortKeys(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(rec).sort()) setOwn(out, k, rec[k])
  return out
}
