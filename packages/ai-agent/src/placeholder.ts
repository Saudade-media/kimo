/**
 * Placeholder flag lifecycle (board 22 "Placeholder flag", format §5.3, ADR 0014 §9).
 *
 * - The agent sets `placeholder: {by: <origin>, since}` on a frame it creates and will fill.
 * - Every placeholder a turn owns is cleared when the turn ends (done, stopped, error).
 * - A placeholder whose `by` origin is not running anymore is an *orphan* ("Interrupted").
 * - Placeholders never lock nodes for people.
 */
import type { WireOp } from "@kimo/mcp-server"

export interface PlaceholderValue {
  by?: string
  since?: string
}

/** The value the agent writes. */
export function placeholderFor(origin: string, now: Date = new Date()): PlaceholderValue {
  return { by: origin, since: now.toISOString() }
}

/** Origin that owns a node's placeholder (`true` has no owner). */
export function placeholderOwner(value: unknown): string | undefined {
  return value && typeof value === "object"
    ? ((value as PlaceholderValue).by ?? undefined)
    : undefined
}

/** Orphan check: the owner is an agent/MCP origin that is no longer live. */
export function isOrphanPlaceholder(value: unknown, liveOrigins: ReadonlySet<string>): boolean {
  if (value === undefined || value === null || value === false) return false
  const by = placeholderOwner(value)
  return by === undefined ? false : !liveOrigins.has(by)
}

/** Canvas tag copy: "<agent> · building <name>" or "Interrupted". */
export function placeholderTag(
  value: unknown,
  ctx: { name: string; agentLabel: string; liveOrigins: ReadonlySet<string> },
): { text: string; state: "building" | "interrupted" } {
  return isOrphanPlaceholder(value, ctx.liveOrigins)
    ? { text: "Interrupted", state: "interrupted" }
    : { text: `${ctx.agentLabel} · building ${ctx.name}`, state: "building" }
}

interface Owned {
  docId: string
  /** Node id, or `@key` until the call result maps it. */
  ref: string
}

/**
 * Tracks placeholders the turn set (from its own `kimo_apply_ops` calls) and produces the
 * clearing call at turn end. The loop feeds every apply call and its envelope.
 */
export class PlaceholderTracker {
  private owned = new Map<string, Owned>()

  constructor(readonly origin: string) {}

  /** Called after a successful kimo_apply_ops (not dry run). */
  observe(input: Record<string, unknown>, created: { key: string; id: string }[] = []): void {
    const docId = typeof input.docId === "string" ? input.docId : ""
    const ops = Array.isArray(input.ops) ? (input.ops as WireOp[]) : []
    const keyToId = new Map(created.map((c) => [c.key, c.id]))
    for (const op of ops) {
      if (op.op === "insert") {
        const node = op.node as Record<string, unknown>
        if (node.placeholder !== undefined && node.placeholder !== false) {
          const id = op.key ? keyToId.get(op.key) : undefined
          if (id) this.owned.set(`${docId}/${id}`, { docId, ref: id })
        }
      } else if (op.op === "update") {
        const set = (op.set ?? {}) as Record<string, unknown>
        if (set.placeholder !== undefined && set.placeholder !== false && !op.id.startsWith("@"))
          this.owned.set(`${docId}/${op.id}`, { docId, ref: op.id })
        if (op.unset?.includes("placeholder") || set.placeholder === false)
          this.owned.delete(`${docId}/${op.id}`)
      } else if (op.op === "delete") this.owned.delete(`${docId}/${op.id}`)
    }
  }

  get size(): number {
    return this.owned.size
  }

  /** One `kimo_apply_ops` input per document that clears every owned placeholder. */
  clearingCalls(): { docId: string; ops: WireOp[]; label: string }[] {
    const byDoc = new Map<string, string[]>()
    for (const o of this.owned.values()) byDoc.set(o.docId, [...(byDoc.get(o.docId) ?? []), o.ref])
    return [...byDoc.entries()].map(([docId, ids]) => ({
      docId,
      ops: ids.map((id) => ({ op: "update", id, unset: ["placeholder"] }) as WireOp),
      label: "Clear placeholders",
    }))
  }

  reset(): void {
    this.owned.clear()
  }
}
