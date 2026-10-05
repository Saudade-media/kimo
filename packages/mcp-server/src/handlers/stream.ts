/**
 * The streamed-edit engine (ADR 0013 §4.7): provisional apply of `kimo_apply_ops` while the
 * model writes the call, then commit (one undo step, the normal result) or rollback.
 *
 *   partial JSON ─► PartialJsonObject ─► docId / ops[i] as each closes
 *        │ per op: schema → scope → level/grants/destructive (no prompt: an op that needs
 *        │ approval holds the stream) → batch limit → compile with the call's @keys so far
 *        ▼
 *   store.apply (caller's origin, inside store.groupUndo) … one transaction per batch
 *        ▼
 *   the call arrives: same docId, its ops start with the applied ones, baseRevision = the
 *   revision the stream started at, every layer the stream added still exists → apply the rest
 *   in the group, end the group (one undo step) → normal result. Anything else → discardUndo
 *   (rollback) and the call runs the normal way, which reports what went wrong.
 *
 * One stream per (store, origin) applies at a time: a second call streamed by the same agent
 * waits until the first is committed or rolled back, so two groups never merge. Another edit
 * of the same origin (a normal call, an undo) rolls the open stream back first.
 */
import type { Libraries } from "@kimo/core-schema"
import type { DocStore, LocalOrigin, NormalizedOp, Op, Revision } from "@kimo/editor-state"
import type { RevisionToken } from "../envelope"
import type { WireOp } from "../ops"
import { type PartialEvent, PartialJsonObject } from "../partial-json"
import { toolByName } from "../registry"
import {
  authorize,
  type DispatchOptions,
  type HandlerOutput,
  type HostDocument,
  type ToolContext,
} from "../runtime"
import { type ScriptDeps, ScriptStream } from "../script/stream"
import type { ApplyStream, StreamProgress, StreamState } from "../stream"
import type { ToolDef } from "../tools/define"
import { STREAM_MAX_NEW_LAYERS } from "../tools/write"
import { type CompileState, compileWireOps, pointerTarget, touchedIds } from "./compile"

/** What a landed group looks like to the result builder (one `store.apply`, or a stream's). */
export interface LandedGroup {
  before: Revision
  revision: Revision
  ops: NormalizedOp[]
  inverse: NormalizedOp[]
  created: string[]
  deleted: string[]
  warnings: { code: string; message: string; path?: string }[]
}

export interface LandedMeta {
  wireCount: number
  created: { key: string; id: string }[]
  notes: { code: string; message: string; nodeId?: string }[]
}

/** What the engine needs from the handler set. */
export interface StreamDeps {
  libs(docId: string): Libraries
  /** Features the compiled ops write that the header lacks (a `setHeader` op), else null. */
  featureOp(store: DocStore, ops: readonly Op[]): Op | null
  /** Builds the normal kimo_apply_ops success envelope for a landed group. */
  landed(
    ctx: ToolContext,
    d: HostDocument,
    input: Record<string, unknown>,
    group: LandedGroup,
    meta: LandedMeta,
  ): Promise<HandlerOutput>
  /** kimo_script streams (absent: only kimo_apply_ops streams). */
  script?: ScriptDeps
}

export interface OpenStreamOptions {
  callId: string
  /** The caller's context (origin, policy, allowances, host): the call will use the same. */
  ctx: ToolContext
  dispatch: Pick<DispatchOptions, "validate" | "targets">
  /** The streamed tool: kimo_apply_ops (default) or kimo_script. */
  tool?: string
}

/** Max ops waiting for a later op (an `@key` defined further on, a store check that needs more). */
const MAX_WAITING = 64

/** Max new layers of a streamed call (raised from the non-streamed limit). */
export const STREAM_LIMIT = STREAM_MAX_NEW_LAYERS

interface Batch {
  wire: number
  ops: NormalizedOp[]
  inverse: NormalizedOp[]
  created: string[]
  deleted: string[]
  warnings: LandedGroup["warnings"]
  keys: { key: string; id: string }[]
  notes: LandedMeta["notes"]
}

const isInsert = (o: unknown) => (o as { op?: unknown })?.op === "insert"

function sameRevision(a: RevisionToken | Revision, b: Revision): boolean {
  return a.epoch === b.epoch && a.seq === b.seq
}

/** Deep JSON equality, key order ignored (the final input may be re-serialized). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => jsonEqual(v, bb[i]))
  }
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

/** "Adding <name>…": the layer name, else a text's content, else its type. */
function layerName(op: unknown): string | undefined {
  const node = (op as { node?: Record<string, unknown> })?.node
  if (!node || typeof node !== "object") return undefined
  if (typeof node.name === "string" && node.name.trim()) return node.name.trim().slice(0, 60)
  if (typeof node.content === "string" && node.content.trim())
    return node.content.trim().replace(/\s+/g, " ").slice(0, 40)
  return typeof node.type === "string" ? node.type : undefined
}

export class StreamEngine {
  /** The stream applying on a (store, origin), by store. */
  private readonly active = new WeakMap<DocStore, Map<string, Stream>>()
  /** Streams waiting for the (store, origin) slot. */
  private readonly waiting = new Set<Stream>()
  readonly def: ToolDef

  constructor(readonly deps: StreamDeps) {
    this.def = toolByName("kimo_apply_ops") as ToolDef
  }

  open(o: OpenStreamOptions): ApplyStream {
    const s = new Stream(this, o)
    if (o.tool === "kimo_script" && this.deps.script)
      return new ScriptStream(s, o.ctx, this.deps.script)
    return s
  }

  /** Tools whose calls stream. */
  streams(tool: string): boolean {
    return tool === "kimo_apply_ops" || (tool === "kimo_script" && !!this.deps.script)
  }

  /** @internal Takes the (store, origin) slot; false when another stream holds it. */
  acquire(store: DocStore, origin: string, s: Stream): boolean {
    let m = this.active.get(store)
    if (!m) {
      m = new Map()
      this.active.set(store, m)
    }
    const cur = m.get(origin)
    if (cur && cur !== s) {
      this.waiting.add(s)
      return false
    }
    m.set(origin, s)
    this.waiting.delete(s)
    return true
  }

  /** @internal Frees the slot and wakes streams waiting for it. */
  release(store: DocStore, origin: string, s: Stream): void {
    const m = this.active.get(store)
    if (m?.get(origin) === s) m.delete(origin)
    this.waiting.delete(s)
    for (const w of [...this.waiting]) w.wake()
  }

  /**
   * Another edit of `origin` is about to land on `store` (a normal call, an undo): the open
   * stream is rolled back first so two groups never merge (its call then runs normally).
   */
  interrupt(store: DocStore, origin: string, except?: ApplyStream): void {
    const s = this.active.get(store)?.get(origin)
    const own = except instanceof ScriptStream ? except.inner : except
    if (s && s !== own) s.rollback("Another edit of this agent landed first.")
  }

  /**
   * The call arrived (from the `kimo_apply_ops` handler): commits the stream's group with the
   * call's remaining ops and returns the normal envelope, or rolls back and returns null (the
   * handler then runs the normal path).
   */
  async finalize(
    stream: ApplyStream,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<HandlerOutput | null> {
    await stream.settled()
    const s = stream instanceof ScriptStream ? stream.inner : stream
    if (!(s instanceof Stream)) return null
    return s.commit(input, ctx)
  }
}

class Stream implements ApplyStream {
  readonly callId: string
  private readonly parser = new PartialJsonObject("ops")
  private readonly listeners = new Set<(p: StreamProgress) => void>()
  private docId: string | undefined
  private base: RevisionToken | undefined
  private readonly received: unknown[] = []
  private readonly appliedWire: unknown[] = []
  private readonly batches: Batch[] = []
  private keyState: CompileState | undefined
  private state: StreamState = "open"
  private reason: string | undefined
  private chain: Promise<void> = Promise.resolve()
  private doc: HostDocument | undefined
  private origin: LocalOrigin
  private endGroup: (() => void) | null = null
  private topBefore: object | null = null
  private startRevision: Revision | undefined
  private slot = false
  /** The whole input arrived (parsed here or by the caller). */
  private ended = false
  private get inputDone(): boolean {
    return this.ended || this.parser.done
  }
  private last: { pointer?: string; name?: string; changed: string[] } = { changed: [] }
  closed = false

  constructor(
    private readonly engine: StreamEngine,
    private readonly o: OpenStreamOptions,
  ) {
    this.callId = o.callId
    this.origin = o.ctx.origin as LocalOrigin
  }

  // --- Input -----------------------------------------------------------------------------------

  feed(chunk: string): void {
    for (const e of this.parser.push(chunk)) this.event(e)
    if (this.parser.failed) this.hold("The streamed input is not a JSON object.")
  }

  event(e: PartialEvent): void {
    if (this.closed) return
    if (e.kind === "field") {
      if (e.key === "docId" && typeof e.value === "string") this.docId = e.value
      else if (e.key === "baseRevision" && e.value && typeof e.value === "object")
        this.base = e.value as RevisionToken
      else if (e.key === "dryRun" && e.value === true) this.hold("A dry run is never streamed.")
      else if (e.key === "retryId") this.hold("A retry is never streamed.")
    } else if (e.kind === "item") this.received[e.index] = e.value
    else {
      if (e.kind === "end") this.ended = true
      return
    }
    this.schedule()
  }

  // --- Progress --------------------------------------------------------------------------------

  progress(): StreamProgress {
    const p: StreamProgress = {
      callId: this.callId,
      state: this.state,
      received: this.received.length,
      applied: this.appliedWire.length,
      inserted: this.appliedWire.filter(isInsert).length,
      changed: this.last.changed,
    }
    if (this.last.pointer) p.pointer = this.last.pointer
    if (this.last.name) p.name = this.last.name
    if (this.reason) p.reason = this.reason
    return p
  }

  onProgress(listener: (p: StreamProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const p = this.progress()
    for (const l of [...this.listeners]) {
      try {
        l(p)
      } catch {
        // A listener never breaks the stream.
      }
    }
  }

  settled(): Promise<void> {
    return this.chain
  }

  /** @internal The slot freed up: try again. */
  wake(): void {
    this.schedule()
  }

  private schedule(): void {
    if (this.state !== "open") return
    this.chain = this.chain.then(() => this.pump()).catch((e) => this.hold(String(e)))
  }

  private hold(reason: string): void {
    if (this.state !== "open") return
    this.state = "held"
    this.reason = reason
    this.emit()
  }

  // --- Provisional apply -------------------------------------------------------------------------

  private async pump(): Promise<void> {
    if (this.state !== "open" || this.closed || !this.docId) return
    const ctx = this.o.ctx
    if (!this.doc) {
      const r = ctx.host.get(this.docId)
      if (!r.ok) return this.hold(r.error.message)
      this.doc = r.value
    }
    const d = this.doc
    if (d.store.readOnly) return this.hold("The document is read-only.")
    if (!this.slot) {
      if (!this.engine.acquire(d.store, this.origin, this)) return
      this.slot = true
    }
    // A stale baseRevision: the call will fail with REVISION_CONFLICT; apply nothing.
    if (this.base && !sameRevision(this.base, this.startRevision ?? d.store.revision))
      return this.hold("baseRevision is not the document's revision.")
    const from = this.appliedWire.length
    const pending: unknown[] = []
    for (let i = from; i < this.received.length && this.received[i] !== undefined; i++)
      pending.push(this.received[i])
    if (!pending.length) return

    // Per op: schema, then the authorization rules of the whole call. The first op that fails
    // or needs approval ends the provisional part (the call itself validates and asks).
    const def = this.engine.def
    let ok = 0
    let insertsSoFar = this.appliedWire.filter(isInsert).length
    for (const op of pending) {
      const errors = this.o.dispatch.validate(def, { docId: this.docId, ops: [op] })
      if (errors.length) {
        if (!ok) return this.hold(errors[0]?.message ?? "Invalid op.")
        break
      }
      if (isInsert(op) && ++insertsSoFar > STREAM_LIMIT) {
        if (!ok) return this.hold(`More than ${STREAM_LIMIT} new layers.`)
        break
      }
      ok++
    }
    const ready = pending.slice(0, ok)
    const targets = await this.o.dispatch.targets(
      def,
      { docId: this.docId, ops: [...this.appliedWire, ...ready] },
      ctx,
    )
    const auth = authorize(def, { docId: this.docId, ops: ready }, ctx, targets)
    if (auth.kind !== "allow")
      return this.hold(
        auth.kind === "deny" ? auth.error.message : "An op needs approval: the call asks for it.",
      )
    if (this.state !== "open" || this.closed) return
    this.applyReady(d, ready, from, pending.length)
  }

  /** Compiles and applies `ready` (ops[from…]); waits for later ops when they need them. */
  private applyReady(d: HostDocument, ready: unknown[], from: number, waiting: number): void {
    const store = d.store
    let part = ready
    let compiled = this.compile(store, part, from)
    if (!compiled.ok && compiled.unresolved) {
      // A reference to a key a later op defines: apply what comes before it, wait for the rest.
      const at = Number(/^ops\[(\d+)\]/.exec(compiled.errors[0]?.path ?? "")?.[1] ?? from) - from
      if (at <= 0) {
        if (waiting > MAX_WAITING) this.hold(compiled.errors[0]?.message ?? "Unresolved @key.")
        return
      }
      part = ready.slice(0, at)
      compiled = this.compile(store, part, from)
    }
    if (!compiled.ok) {
      if (waiting > MAX_WAITING || this.inputDone)
        this.hold(compiled.errors[0]?.message ?? "An op failed.")
      return
    }
    const ops = compiled.ops as unknown as Op[]
    const feature = this.engine.deps.featureOp(store, ops)
    if (feature) ops.push(feature)
    if (!this.endGroup) {
      this.topBefore = store.topUndo(this.origin)
      this.startRevision = store.revision
      this.endGroup = store.groupUndo(this.origin)
    }
    const r = store.apply(ops, { origin: this.origin, label: "Streaming edit" })
    if (!r.ok) {
      // May need later ops (a store check over the finished subtree): wait, within bounds.
      if (waiting > MAX_WAITING || this.inputDone)
        this.hold(r.errors[0]?.message ?? "An op failed.")
      return
    }
    this.keyState = compiled.state
    this.appliedWire.push(...part)
    this.batches.push({
      wire: part.length,
      ops: r.ops,
      inverse: r.inverse,
      created: r.created,
      deleted: r.deleted,
      warnings: r.warnings,
      keys: compiled.created,
      notes: compiled.notes,
    })
    const pointer = pointerTarget(r.ops) ?? this.last.pointer
    const name = layerName([...part].reverse().find(isInsert)) ?? this.last.name
    this.last = {
      ...(pointer ? { pointer } : {}),
      ...(name ? { name } : {}),
      changed: touchedIds(r.ops),
    }
    this.emit()
    // More arrived while this batch compiled (or the rest waited on it).
    if (this.received.length > this.appliedWire.length) this.schedule()
  }

  private compile(store: DocStore, part: unknown[], offset: number) {
    return compileWireOps(store, part as WireOp[], {
      libraries: this.engine.deps.libs(this.docId as string),
      offset,
      ...(this.keyState ? { state: this.keyState } : {}),
    })
  }

  // --- Commit / rollback -------------------------------------------------------------------------

  /** @internal See {@link StreamEngine.finalize}. */
  async commit(input: Record<string, unknown>, ctx: ToolContext): Promise<HandlerOutput | null> {
    const d = this.doc
    if (this.closed || !d || !this.endGroup || !this.appliedWire.length || !this.startRevision) {
      this.rollback("Nothing was applied while streaming.")
      return null
    }
    const why = this.mismatch(input, d)
    if (why) {
      this.rollback(why)
      return null
    }
    const wire = input.ops as unknown[]
    const rest = wire.slice(this.appliedWire.length)
    const store = d.store
    if (rest.length) {
      if (wire.filter(isInsert).length > STREAM_LIMIT) {
        this.rollback("The call is over the streamed batch limit.")
        return null
      }
      const compiled = this.compile(store, rest, this.appliedWire.length)
      if (!compiled.ok) {
        this.rollback(compiled.errors[0]?.message ?? "An op failed.")
        return null
      }
      const ops = compiled.ops as unknown as Op[]
      const feature = this.engine.deps.featureOp(store, ops)
      if (feature) ops.push(feature)
      const r = store.apply(ops, { origin: this.origin, label: "Streaming edit" })
      if (!r.ok) {
        this.rollback(r.errors[0]?.message ?? "An op failed.")
        return null
      }
      this.appliedWire.push(...rest)
      this.batches.push({
        wire: rest.length,
        ops: r.ops,
        inverse: r.inverse,
        created: r.created,
        deleted: r.deleted,
        warnings: r.warnings,
        keys: compiled.created,
        notes: compiled.notes,
      })
    }
    // One undo step from here on.
    this.endGroup()
    this.endGroup = null
    this.state = "committed"
    this.closed = true
    this.release()
    const group: LandedGroup = {
      before: this.startRevision,
      revision: store.revision,
      ops: this.batches.flatMap((b) => b.ops),
      inverse: [...this.batches].reverse().flatMap((b) => b.inverse),
      created: this.batches.flatMap((b) => b.created),
      deleted: this.batches.flatMap((b) => b.deleted),
      warnings: this.batches.flatMap((b) => b.warnings),
    }
    this.emit()
    return this.engine.deps.landed(ctx, d, input, group, {
      wireCount: wire.length,
      created: this.batches.flatMap((b) => b.keys),
      notes: this.batches.flatMap((b) => b.notes),
    })
  }

  /** Why the call cannot commit this stream (null when it can). */
  private mismatch(input: Record<string, unknown>, d: HostDocument): string | null {
    if (input.docId !== this.docId) return "The call targets another document."
    if (input.dryRun === true) return "The call is a dry run."
    if (input.retryId !== undefined) return "The call is a retry."
    if (d.store.readOnly) return "The document became read-only."
    const wire = input.ops
    if (!Array.isArray(wire) || wire.length < this.appliedWire.length)
      return "The call has fewer ops than were streamed."
    for (let i = 0; i < this.appliedWire.length; i++)
      if (!jsonEqual(wire[i], this.appliedWire[i])) return `ops[${i}] differs from the streamed op.`
    const base = input.baseRevision as RevisionToken | undefined
    if (base && !sameRevision(base, this.startRevision as Revision))
      return "baseRevision is not the revision the stream started at."
    // The user may have deleted a parent of what the stream added: let the call report it.
    for (const b of this.batches)
      for (const id of b.created) if (!d.store.hasNode(id)) return `Layer ${id} was deleted.`
    return null
  }

  /** @internal Undoes the provisional group (no redo entry). */
  rollback(reason: string): void {
    if (this.state === "committed" || this.state === "rolled-back") return
    const store = this.doc?.store
    if (store && this.endGroup) {
      this.endGroup()
      this.endGroup = null
      if (store.topUndo(this.origin) !== this.topBefore) store.discardUndo(this.origin)
    }
    this.state = "rolled-back"
    this.reason = reason
    this.closed = true
    this.release()
    this.emit()
  }

  private release(): void {
    if (this.slot && this.doc) this.engine.release(this.doc.store, this.origin, this)
    this.slot = false
  }

  close(reason = "The call never arrived."): void {
    if (this.state === "committed") {
      this.closed = true
      return
    }
    this.rollback(reason)
  }
}
