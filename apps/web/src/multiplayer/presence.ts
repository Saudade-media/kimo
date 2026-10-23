/**
 * Presence identity rules of board 41 (pure, shared by the share layer and the view model):
 *
 * - People get one of six presence colors, `presence-clay`, `pine`, `ochre`, `plum`, `slate`,
 *   `graphite` (the `--kimo-presence-*` tokens), in join order; the seventh person reuses clay.
 *   They are never a meaning color (selection, warning, agent and persona hues).
 * - Each client publishes its own color token in `PresenceState.user.color`, picked against the
 *   people who joined before it (lower relay peer ids), so every client reads the same color for
 *   a person. A later joiner yields when two picked the same color at once.
 * - A person without a display name (Settings › Multiplayer) shows as "Guest N", numbered in join
 *   order per file.
 */

/** The six presence color tokens, in assignment order. */
export const PRESENCE_COLORS = [
  "presence-clay",
  "presence-pine",
  "presence-ochre",
  "presence-plum",
  "presence-slate",
  "presence-graphite",
] as const

export type PresenceColor = (typeof PRESENCE_COLORS)[number]

export function isPresenceColor(value: unknown): value is PresenceColor {
  return typeof value === "string" && (PRESENCE_COLORS as readonly string[]).includes(value)
}

/** The color token for the `index`-th person to join (0-based); wraps after six. */
export function presenceColorAt(index: number): PresenceColor {
  const n = PRESENCE_COLORS.length
  return PRESENCE_COLORS[((Math.floor(index) % n) + n) % n] as PresenceColor
}

/**
 * The color this client should publish: its current one when no earlier joiner (a lower peer id)
 * uses it, else the first color no earlier joiner uses, else the next one in join order.
 *
 * @param earlier colors of the people who joined before this client (lower peer ids)
 */
export function pickPresenceColor(
  current: string | null | undefined,
  earlier: readonly string[],
): PresenceColor {
  const taken = new Set(earlier.filter(isPresenceColor))
  if (isPresenceColor(current) && !taken.has(current)) return current
  const free = PRESENCE_COLORS.find((c) => !taken.has(c))
  return free ?? presenceColorAt(earlier.length)
}

/** The label a person shows with: their display name, or "Guest N". */
export function personLabel(name: string | null | undefined, guestNumber: number): string {
  const trimmed = (name ?? "").trim()
  return trimmed !== "" ? trimmed : `Guest ${guestNumber}`
}

/**
 * Stable per-file numbering for people without a name ("Guest 1", "Guest 2", ...) and color
 * fallbacks, in the order people were first seen; people first seen together are ordered by
 * peer id (the relay hands those out in connection order). Numbers are never reused within a
 * file while the model lives, so a guest who reconnects keeps theirs.
 */
export class JoinOrder {
  private readonly order = new Map<string, number>()
  private readonly guests = new Map<string, number>()

  /** Notes people (`id` = presence user id) in peer id order; returns true when someone was new. */
  see(people: readonly { id: string; peer: number; named: boolean }[]): boolean {
    let changed = false
    for (const p of [...people].sort((a, b) => a.peer - b.peer)) {
      if (!this.order.has(p.id)) {
        this.order.set(p.id, this.order.size)
        changed = true
      }
      if (!p.named && !this.guests.has(p.id)) {
        this.guests.set(p.id, this.guests.size + 1)
        changed = true
      }
    }
    return changed
  }

  /** 0-based join index of a person, or -1 when never seen. */
  index(id: string): number {
    return this.order.get(id) ?? -1
  }

  /** The Guest number of an unnamed person (1-based), or 0 when they never showed unnamed. */
  guest(id: string): number {
    return this.guests.get(id) ?? 0
  }
}
