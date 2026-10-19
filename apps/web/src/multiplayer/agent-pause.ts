/**
 * Paused agents (board 41 section 7, ADR 0016 item 16): people are never blocked by an agent's
 * area claim. When a person edits inside a claim (here or on another client), the agent holding
 * it pauses; it resumes on its own once nobody has edited in its area for {@link AGENT_RESUME_MS},
 * or at once with Resume now. Stop ends it: its claims go and the host's `onStop` ends its turn.
 *
 * The human edits come from the document's {@link ClaimRegistry} (`humanEdit(holder)`, recorded
 * by `claimsFor(store)` for every committed person edit inside a local claim). Agent loops wait
 * with {@link AgentPauses.waitUntilResumed} before their next write.
 */
import type { ClaimRegistry, HumanEdit } from "@kimo/editor-state"

/** An agent resumes after this long without edits by people in its area. */
export const AGENT_RESUME_MS = 10_000

/** A paused agent, as the claim outline, tab and docked note show it. */
export interface AgentPauseView {
  holder: string
  label?: string
  /** Node ids people edited inside the claim (capped at 50). */
  ids: readonly string[]
  /** `local`: a person here; `remote`: a change from another client. */
  by: HumanEdit["by"]
  /** When it paused (ms, model clock). */
  pausedAt: number
  /** When it resumes on its own unless people edit there again (ms, model clock). */
  resumesAt: number
}

export interface AgentPauseTimers {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realTimers: AgentPauseTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    ;(handle as { unref?: () => void }).unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface AgentPausesOptions {
  timers?: AgentPauseTimers
  resumeMs?: number
  /** Stop: end the agent's turn (the window's agent controller, or the host's connection). */
  onStop?(holder: string): void
}

interface Paused {
  view: AgentPauseView
  waiters: (() => void)[]
}

export class AgentPauses {
  private readonly timers: AgentPauseTimers
  private readonly resumeMs: number
  private readonly paused = new Map<string, Paused>()
  /**
   * The human edit record last seen per holder (also once resumed by hand). The registry writes a
   * new record for every edit, so a repeat notification of the same edit does not pause again.
   */
  private readonly seen = new Map<string, HumanEdit>()
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly AgentPauseView[] = []
  private timer: unknown = null
  private readonly off: () => void

  constructor(
    private readonly registry: ClaimRegistry,
    private readonly options: AgentPausesOptions = {},
  ) {
    this.timers = options.timers ?? realTimers
    this.resumeMs = options.resumeMs ?? AGENT_RESUME_MS
    this.off = registry.subscribe(() => this.scan())
    this.scan()
  }

  /** Paused agents, oldest first. Stable until something changes (`useSyncExternalStore`). */
  list(): readonly AgentPauseView[] {
    return this.snapshot
  }

  isPaused(holder: string): boolean {
    return this.paused.has(holder)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Resolves when `holder` is not paused (at once when it is not). */
  waitUntilResumed(holder: string): Promise<void> {
    const p = this.paused.get(holder)
    if (!p) return Promise.resolve()
    return new Promise((resolve) => p.waiters.push(resolve))
  }

  /** Resume now: the agent continues (it still re-reads once: the human edit stays recorded). */
  resumeNow(holder: string): void {
    if (this.resume(holder)) this.changed()
  }

  /** Stop: the agent's claims go, and its turn ends through `onStop`. */
  stop(holder: string): void {
    this.resume(holder)
    this.registry.release(holder)
    this.options.onStop?.(holder)
    this.changed()
  }

  destroy(): void {
    this.off()
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
    for (const holder of [...this.paused.keys()]) this.resume(holder)
    this.listeners.clear()
  }

  /** Looks for new human edits inside local claims. */
  private scan(): void {
    const t = this.timers.now()
    let changed = false
    const holders = new Set<string>()
    for (const claim of this.registry.list()) if (claim.local) holders.add(claim.holder)
    for (const holder of holders) {
      const edit = this.registry.humanEdit(holder)
      if (!edit || this.seen.get(holder) === edit) continue
      this.seen.set(holder, edit)
      const label = this.registry.list().find((c) => c.holder === holder && c.label)?.label
      const prior = this.paused.get(holder)
      this.paused.set(holder, {
        view: {
          holder,
          ...(label ? { label } : {}),
          ids: edit.ids,
          by: edit.by,
          pausedAt: prior?.view.pausedAt ?? t,
          resumesAt: t + this.resumeMs,
        },
        waiters: prior?.waiters ?? [],
      })
      changed = true
    }
    // A claim that went (turn end, expiry, release) takes its pause with it.
    for (const holder of [...this.paused.keys()])
      if (!holders.has(holder) && this.resume(holder)) changed = true
    if (changed) this.changed()
  }

  private resume(holder: string): boolean {
    const p = this.paused.get(holder)
    if (!p) return false
    this.paused.delete(holder)
    for (const w of p.waiters) w()
    return true
  }

  private changed(): void {
    this.snapshot = [...this.paused.values()]
      .map((p) => p.view)
      .sort((a, b) => a.pausedAt - b.pausedAt || (a.holder < b.holder ? -1 : 1))
    this.schedule()
    for (const l of [...this.listeners]) l()
  }

  /** One timer at the earliest automatic resume. */
  private schedule(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
    let next = Number.POSITIVE_INFINITY
    for (const p of this.paused.values()) next = Math.min(next, p.view.resumesAt)
    if (!Number.isFinite(next)) return
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = null
        const t = this.timers.now()
        let any = false
        for (const [holder, p] of [...this.paused])
          if (p.view.resumesAt <= t && this.resume(holder)) any = true
        if (any) this.changed()
        else this.schedule()
      },
      Math.max(0, next - this.timers.now()),
    )
  }
}

const PAUSES = new WeakMap<ClaimRegistry, AgentPauses>()

/** The pause tracker of a document's claim registry (created on first use). */
export function pausesFor(registry: ClaimRegistry, options?: AgentPausesOptions): AgentPauses {
  let p = PAUSES.get(registry)
  if (!p) {
    p = new AgentPauses(registry, options)
    PAUSES.set(registry, p)
  }
  return p
}
