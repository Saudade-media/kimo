/**
 * The `DocStore` interface: the seam between the document engine and everything else
 * (UI, agent, MCP, sync providers, apps/server). Teardown 9.1 dependency rule and ADR 0003:
 * consumers use this interface, never Yjs types, so the CRDT can be swapped.
 */
import type { KimoDocument, ValidateOptions, ValidationIssue } from "@kimo/core-schema"
import type { NodeData, NormalizedOp, Op } from "./ops"
import type { LocalOrigin, Origin, RemoteOrigin } from "./origin"
import type { TreeRepair } from "./repair"

/**
 * Optimistic-concurrency token (teardown 11.1). `epoch` is minted whenever the document is
 * loaded; `seq` counts committed changes within the epoch. Compare with {@link sameRevision}.
 */
export interface Revision {
  readonly epoch: string
  readonly seq: number
}

/** True when two revisions are the same token. */
export function sameRevision(a: Revision, b: Revision): boolean {
  return a.epoch === b.epoch && a.seq === b.seq
}

/** Error codes returned by the op layer (subset of teardown 11.2). */
export type OpErrorCode =
  | "READ_ONLY"
  | "REVISION_CONFLICT"
  | "INVALID_OP"
  | "INVALID_ID"
  | "NODE_NOT_FOUND"
  | "NODE_EXISTS"
  | "CYCLE"
  | "SCHEMA_VIOLATION"

/** One reason an op group was rejected. */
export interface OpError {
  code: OpErrorCode
  message: string
  /** Path of the offending op in the input (`ops[2]`, `ops[0].ops[1]`). */
  path?: string
  nodeId?: string
  /** For `SCHEMA_VIOLATION`: the core-schema validation issue. */
  issue?: ValidationIssue
}

/** Options for {@link DocStore.apply}. */
export interface ApplyOptions {
  /** Who is editing. Determines the undo stack. */
  origin: LocalOrigin
  /** Human label for history ("Align left", agent step name, …). */
  label?: string
  /** Fail with `REVISION_CONFLICT` unless the store is exactly at this revision. */
  baseRevision?: Revision
  /** Validate and normalize without committing. */
  dryRun?: boolean
}

/** Successful {@link DocStore.apply}. */
export interface ApplySuccess {
  ok: true
  /** Revision before the commit. */
  before: Revision
  /** Revision after the commit (equal to `before` for a dry run or an empty group). */
  revision: Revision
  /** Normalized forward ops, in application order. */
  ops: NormalizedOp[]
  /** Informational inverse ops: applying them against `revision` undoes this group. */
  inverse: NormalizedOp[]
  /** Ids of inserted nodes, in op order. */
  created: string[]
  /** Ids of deleted nodes (whole subtrees), in deletion order. */
  deleted: string[]
  /** Validation warnings (lints) introduced by this group. */
  warnings: ValidationIssue[]
  dryRun: boolean
}

/** Failed {@link DocStore.apply}: nothing was committed. */
export interface ApplyFailure {
  ok: false
  errors: OpError[]
  /** Current revision (unchanged). */
  revision: Revision
}

/** Result of {@link DocStore.apply}. */
export type ApplyResult = ApplySuccess | ApplyFailure

/** Result of an undo or redo. */
export interface UndoResult {
  /** True when an op group was undone/redone and changed the document. */
  ok: boolean
  /**
   * True when the top op group was consumed but had no effect any more (everything it touched
   * was since changed or deleted by other origins): guarded replay, "stale history".
   */
  stale: boolean
  revision: Revision
  /** Repairs applied after the replay (cycles/orphans it re-created), if any. */
  repairs: TreeRepair[]
}

/** How a change reached the store. */
export type ChangeCause = "ops" | "undo" | "redo" | "update" | "load" | "repair"

/** Emitted once per committed transaction. */
export interface StoreChange {
  /** Origin of the change (the undone/redone origin for undo/redo). */
  origin: Origin
  cause: ChangeCause
  revision: Revision
  /** Node ids whose data changed (added, updated or removed). */
  nodes: ReadonlySet<string>
  /** True when header members, variables or themes changed. */
  header: boolean
}

/** One entry of the op log (teardown 9.3: forward + informational inverse). */
export type OpLogEntry =
  | {
      kind: "ops"
      origin: LocalOrigin
      label?: string
      revision: Revision
      time: number
      ops: NormalizedOp[]
      inverse: NormalizedOp[]
    }
  | { kind: "undo" | "redo"; origin: LocalOrigin; revision: Revision; time: number }
  | { kind: "repair"; revision: Revision; time: number; repairs: TreeRepair[] }
  | { kind: "load"; origin: Origin; revision: Revision; time: number }

/** Options for {@link DocStore.loadDocument}. */
export interface LoadOptions {
  /** Origin recorded for the load. Default `"file"`. */
  origin?: "file" | RemoteOrigin | "system"
  /** Validate first and throw {@link DocumentInvalidError} on errors. Default true. */
  validate?: boolean
  /** Mint a new epoch and clear undo history. Default true. */
  newEpoch?: boolean
}

/** Read-only state of a store. */
export interface ReadOnlyState {
  reason: string
}

/** The document store. Implemented by `YjsDocStore`; sync providers only use this interface. */
export interface DocStore {
  /** Current revision. */
  readonly revision: Revision
  /** Non-null when edits are refused (`READ_ONLY`). */
  readonly readOnly: ReadOnlyState | null

  // --- Reading ----------------------------------------------------------------------------
  /** Node data by id (frozen; do not mutate). */
  getNode(id: string): NodeData | undefined
  hasNode(id: string): boolean
  /** All node ids (unordered). */
  nodeIds(): string[]
  /** Number of nodes. */
  readonly size: number
  /**
   * Child ids in sibling order (`order`, then id). `at` selects an instance-owned group;
   * omitted/null selects the regular children.
   */
  children(parent: string | null, at?: string | null): string[]
  /** The whole document as plain data (fresh objects). */
  toDocument(): KimoDocument
  /**
   * The root members without `nodes` (variables, themes, imports, meta…) as plain data: a
   * cheap read for header consumers (no copy of the node table).
   */
  toHeader(): Omit<KimoDocument, "nodes">

  // --- Writing ----------------------------------------------------------------------------
  /** Validates and applies an op group atomically (one transaction with `origin`). */
  apply(ops: Op | readonly Op[], options: ApplyOptions): ApplyResult
  /** Replaces the whole content (diffing node by node) — file open / hot reload. */
  loadDocument(doc: KimoDocument, options?: LoadOptions): void
  /** Marks the store read-only (or writable again with null). */
  setReadOnly(reason: string | null): void
  /** Detects and repairs parent cycles and orphans (normally automatic after merges). */
  repair(): TreeRepair[]

  // --- History ----------------------------------------------------------------------------
  undo(origin: LocalOrigin): UndoResult
  redo(origin: LocalOrigin): UndoResult
  canUndo(origin: LocalOrigin): boolean
  canRedo(origin: LocalOrigin): boolean
  /**
   * An opaque handle of the entry on top of `origin`'s undo stack (null when empty). It is
   * stable while the entry stays on the stack, so a continuous gesture can check that the
   * entry it pushed is still the top one before collapsing it with `undo`.
   */
  topUndo(origin: LocalOrigin): object | null
  /** The same handle for the top of `origin`'s redo stack (null when empty). */
  topRedo(origin: LocalOrigin): object | null
  /**
   * Merges every op group `origin` applies from now on into ONE undo step, until the returned
   * function runs (idempotent). A streamed agent edit lands as many transactions while the model
   * writes it and is undone as one. The step starts fresh (never merges into the step before).
   */
  groupUndo(origin: LocalOrigin): () => void
  /**
   * Undoes `origin`'s top undo step and forgets it (nothing to redo): rolls back a provisional
   * edit. No-op result (`ok: false`) when the stack is empty.
   */
  discardUndo(origin: LocalOrigin): UndoResult
  /** Clears one origin's undo/redo stacks, or every origin's. */
  clearHistory(origin?: LocalOrigin): void
  /** The op log, oldest first (bounded). */
  log(): readonly OpLogEntry[]

  // --- Events -----------------------------------------------------------------------------
  /** Subscribes to committed changes. Returns an unsubscribe function. */
  onChange(listener: (change: StoreChange) => void): () => void

  // --- Sync seam (binary CRDT updates; opaque to consumers) --------------------------------
  /** Encodes the state vector (what this replica has seen). */
  encodeStateVector(): Uint8Array
  /** Encodes everything not covered by `stateVector` (all state when omitted). */
  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array
  /** Applies a binary update from a peer or persistence layer. Repairs cycles afterwards. */
  applyUpdate(update: Uint8Array, origin?: RemoteOrigin): void
  /**
   * Subscribes to binary updates produced by any transaction. `origin` is the transaction's
   * origin (for undo/redo, the undone origin) so providers can skip echoes of their own updates.
   */
  onUpdate(listener: (update: Uint8Array, origin: Origin) => void): () => void

  /**
   * Whether cycle and orphan repair runs automatically after merges (default true). The network
   * provider turns it off on every replica but the elected repairer (multiplayer spec §15.8).
   */
  readonly autoRepair: boolean
  setAutoRepair(enabled: boolean): void

  /** Releases resources (undo managers, observers). The store is unusable afterwards. */
  destroy(): void
}

/** Options shared by store implementations. */
export interface DocStoreOptions {
  /** Options passed to core-schema `validate` for every op group (libraries, asset files). */
  validateOptions?: ValidateOptions
  /**
   * How each op group is validated before it commits:
   * - `"incremental"` (default): only the nodes the group can affect (the touched nodes, their
   *   parents and children) are checked against the rest of the document; groups that involve
   *   components, instances, slots, theme pins, variables or themes are checked in full. Same
   *   accept/reject decisions as `"full"`, at a cost independent of document size.
   * - `"full"`: the whole candidate document per op group (O(document) per edit).
   * - `"none"`: no validation.
   * Loading a document (`loadDocument`) always validates it in full.
   */
  validation?: "incremental" | "full" | "none"
  /** Max op-log entries kept in memory. Default 1000. */
  logLimit?: number
  /** Clock for move timestamps (cycle repair) and the log. Default `Date.now`. */
  now?: () => number
  /** Random source for order-key jitter. */
  random?: () => number
  /** Order-key jitter digits (0 = deterministic). Default 3. */
  jitter?: number
  /** Repair cycles/orphans automatically after remote updates and undo/redo. Default true. */
  autoRepair?: boolean
}

/** Thrown by {@link DocStore.loadDocument} for invalid documents. */
export class DocumentInvalidError extends Error {
  override readonly name = "DocumentInvalidError"
  constructor(readonly issues: ValidationIssue[]) {
    super(
      `Document is invalid (${issues.length} error(s)): ${issues
        .slice(0, 3)
        .map((i) => `${i.code} at ${i.path || "/"}`)
        .join("; ")}`,
    )
  }
}

// --- M3 (ADR 0011) -----------------------------------------------------------------------------
// The M3 command API lives in ./ops (commands compile to the ops above); re-exported here so
// the package entry (`export * from "./types"`) exposes it.
export {
  applyCommand,
  type CommandContext,
  type CommandResult,
  type ComponentCommand,
  type LibraryCommand,
  type M3Command,
  planCommand,
  type VariableCommand,
} from "./ops"
