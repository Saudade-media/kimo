/**
 * Where an agent is working on the canvas (board 31 "Agent cursor"): the area of the layers the
 * current step reads or edits, or the layers its last landed edit created / changed. Shared by the
 * built-in agent (agent panel → `CanvasAgentCursor.nodeIds`) and MCP clients (agents layer).
 */

/** World-space box. */
export interface AreaBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The work area of `ids`: drops a top-level frame (no parent) when a layer inside it is also in
 * the set, so an edit that grows a page frame at 0:0 and inserts a section inside it points at
 * the section, not at the page frame's corner. Nested ancestors stay (a card and the badge
 * inserted into it are both the area). Order is kept; duplicates go.
 */
export function workAreaIds(
  ids: readonly string[],
  parentOf: (id: string) => string | null | undefined,
): string[] {
  const set = new Set(ids)
  const covering = new Set<string>()
  for (const id of set) {
    let p = parentOf(id) ?? null
    for (let guard = 0; p && guard < 256; guard++) {
      const up = parentOf(p) ?? null
      if (up === null && set.has(p)) covering.add(p)
      p = up
    }
  }
  return [...set].filter((id) => !covering.has(id))
}

/** Union of the boxes that exist (null when none does). */
export function unionBox(boxes: readonly (AreaBox | null | undefined)[]): AreaBox | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes) {
    if (!b) continue
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Cursor glide between areas (world space, so it never trails the canvas while panning). */
export const CURSOR_GLIDE_MS = 280

/** Ease-out cubic. */
export const glideEase = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3
