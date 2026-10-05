/**
 * Streamed kimo_script (ADR 0013 addendum 7): the partial tool input `{docId, code, …}` is
 * scanned as it arrives; each complete top-level statement of `code` runs in a script session
 * and the wire ops it produced go to an ordinary kimo_apply_ops {@link ApplyStream} (validation,
 * scopes, approvals hold, batch limit, one provisional undo group). The call itself reruns the
 * whole script from scratch with the same world and carried globals; being deterministic it
 * yields the same ops, so the apply stream's prefix check commits them (or rolls back and the
 * call runs the normal way).
 */
import type { PartialEvent } from "../partial-json"
import type { HostDocument, ToolContext } from "../runtime"
import type { ApplyStream, StreamProgress } from "../stream"
import type { RunnerSession, ScriptRunner } from "./runner"
import type { Carry, WorldData } from "./session"

/** What a script stream needs from the handler set. */
export interface ScriptDeps {
  runner(): ScriptRunner
  /** The snapshot Get reads (the document now, with layout boxes). */
  world(d: HostDocument): Promise<WorldData>
  /** The caller's carried globals. */
  carry(origin: string): Carry
}

/** Incremental scanner of a top-level JSON object's string fields, decoded as they grow. */
export class TopLevelStrings {
  private depth = 0
  private inStr = false
  private esc = ""
  private key: string | null = null
  private cur = ""
  private expectingKey = false
  private valueKey: string | null = null
  failed = false
  readonly values = new Map<string, { text: string; done: boolean }>()

  push(chunk: string): void {
    for (const ch of chunk) if (!this.failed) this.char(ch)
  }

  private char(ch: string): void {
    if (this.inStr) {
      if (this.esc) {
        this.esc += ch
        if (this.esc[1] === "u" && this.esc.length < 6) return
        let decoded: string
        try {
          decoded = JSON.parse(`"${this.esc}"`) as string
        } catch {
          this.failed = true
          return
        }
        this.esc = ""
        this.add(decoded)
        return
      }
      if (ch === "\\") {
        this.esc = "\\"
        return
      }
      if (ch === '"') {
        this.inStr = false
        if (this.depth === 1 && this.expectingKey) {
          this.key = this.cur
          this.expectingKey = false
        } else if (this.depth === 1 && this.valueKey !== null) {
          const v = this.values.get(this.valueKey)
          if (v) v.done = true
          this.valueKey = null
        }
        return
      }
      this.add(ch)
      return
    }
    if (this.depth === 0 && ch !== "{" && !/\s/.test(ch)) {
      this.failed = true
      return
    }
    if (ch === '"') {
      this.inStr = true
      if (this.depth === 1 && this.expectingKey) this.cur = ""
      else if (this.depth === 1 && this.key !== null) {
        this.valueKey = this.key
        this.values.set(this.key, { text: "", done: false })
        this.key = null
      }
      return
    }
    if (ch === "{" || ch === "[") {
      this.depth++
      if (this.depth === 1) this.expectingKey = true
    } else if (ch === "}" || ch === "]") this.depth--
    else if (ch === "," && this.depth === 1) {
      this.expectingKey = true
      this.key = null
    }
  }

  private add(s: string): void {
    if (this.depth === 1 && this.expectingKey) this.cur += s
    else if (this.depth === 1 && this.valueKey !== null) {
      const v = this.values.get(this.valueKey)
      if (v) v.text += s
    }
  }
}

/** What the call reuses from its stream: the same world and carried globals. */
export interface ScriptStreamState {
  docId: string
  world: WorldData
  carry: Carry
}

/** Max code held back waiting for a statement to complete (a runaway single statement). */
const MAX_PENDING_CODE = 200_000

/**
 * A kimo_script call being written. Runs complete statements as they arrive and forwards their
 * ops to `inner` (the kimo_apply_ops stream that applies, holds, commits or rolls back).
 */
export class ScriptStream implements ApplyStream {
  readonly callId: string
  readonly tool = "kimo_script"
  private readonly scan = new TopLevelStrings()
  private session: RunnerSession | null = null
  private opening = false
  private executed = 0
  private lines = 1
  private forwarded = 0
  private stopped = false
  private docSent = false
  private chain: Promise<void> = Promise.resolve()
  private state: ScriptStreamState | null = null
  /** Why statements stopped running before the code ended (diagnostics). */
  reason: string | undefined

  constructor(
    readonly inner: ApplyStream,
    private readonly ctx: ToolContext,
    private readonly deps: ScriptDeps,
  ) {
    this.callId = inner.callId
  }

  /** The world and carry the streamed statements used (null before the docId arrived). */
  scriptState(): ScriptStreamState | null {
    return this.state
  }

  feed(chunk: string): void {
    if (this.inner.closed) return
    this.scan.push(chunk)
    if (this.scan.failed) {
      this.stop("The streamed input is not a JSON object.")
      return
    }
    this.chain = this.chain.then(() => this.pump()).catch((e) => this.stop(String(e)))
  }

  /** Parsed events are a kimo_apply_ops shape; a script streams raw input ({@link feed}). */
  event(_e: PartialEvent): void {}

  private stop(reason: string): void {
    if (this.stopped) return
    this.stopped = true
    this.reason ??= reason
    this.session?.dispose()
    this.session = null
  }

  private async pump(): Promise<void> {
    if (this.stopped || this.inner.closed || this.opening) return
    if (this.scan.values.has("retryId")) return this.stop("A retry is never streamed.")
    const doc = this.scan.values.get("docId")
    if (!doc?.done) return
    if (!this.session) {
      const r = this.ctx.host.get(doc.text)
      if (!r.ok) return this.stop(r.error.message)
      this.opening = true
      try {
        const world = await this.deps.world(r.value)
        const carry = this.deps.carry(String(this.ctx.origin))
        this.state = { docId: doc.text, world, carry }
        const page = this.scan.values.get("page")
        this.session = await this.deps
          .runner()
          .open(world, carry, undefined, page?.done ? page.text : undefined)
      } finally {
        this.opening = false
      }
      if (this.stopped || this.inner.closed) {
        this.session?.dispose()
        this.session = null
        return
      }
    }
    if (!this.docSent) {
      this.inner.event({ kind: "field", key: "docId", value: doc.text })
      this.docSent = true
    }
    const code = this.scan.values.get("code")
    if (!code) return
    const rest = code.text.slice(this.executed)
    // acorn loads on first use (kept out of the editor's startup bundle).
    const end = code.done ? rest.length : (await import("./statements")).completePrefix(rest)
    if (end > 0) {
      const part = rest.slice(0, end)
      const out = await this.session.run(part, this.lines)
      this.executed += end
      this.lines += part.split("\n").length - 1
      for (const op of out.ops)
        this.inner.event({ kind: "item", index: this.forwarded++, value: op })
      if (!out.result.ok) return this.end(out.result.message)
    } else if (rest.length > MAX_PENDING_CODE) return this.end("A statement is too long to stream.")
    if (code.done) this.end()
  }

  private end(reason?: string): void {
    this.inner.event({ kind: "end" })
    if (reason) this.stop(reason)
    else {
      this.stopped = true
      this.session?.dispose()
      this.session = null
    }
  }

  progress(): StreamProgress {
    const p = this.inner.progress()
    return this.reason && !p.reason ? { ...p, reason: this.reason } : p
  }
  onProgress(l: (p: StreamProgress) => void): () => void {
    return this.inner.onProgress(l)
  }
  async settled(): Promise<void> {
    // Statements may still be arriving through feed(): wait until the chain is idle.
    let c: Promise<void>
    do {
      c = this.chain
      await c
    } while (c !== this.chain)
    await this.inner.settled()
  }
  close(reason?: string): void {
    this.stop(reason ?? "Closed.")
    this.inner.close(reason)
  }
  get closed(): boolean {
    return this.inner.closed
  }
}
