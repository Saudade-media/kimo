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

/**
 * Board 36 "Agent on canvas" (desing.pen XDVdg): the section an edit belongs to is the direct
 * child of the top-level frame that holds it. A layer inside an instance (`<instance>/<path>`
 * view id) resolves through the instance's real ancestors. A top-level layer is its own section
 * (an edit to the page frame itself, or a top-level frame with no children).
 */
function sectionOf(id: string, parentOf: (id: string) => string | null | undefined): string {
  let cur = id.split("/")[0] as string
  for (let guard = 0; guard < 256; guard++) {
    const p = parentOf(cur) ?? null
    if (p === null) return cur
    if ((parentOf(p) ?? null) === null) return cur
    cur = p
  }
  return cur
}

/**
 * The section an agent works in: the pointed layer's (the last layer its latest landed edit
 * added) when it lies in the work area's sections, else the first work-area layer's. Null when
 * no id resolves (`exists` filters ids that are not laid out).
 */
export function pickSection(
  area: readonly string[],
  pointer: string | undefined,
  parentOf: (id: string) => string | null | undefined,
  exists: (id: string) => boolean = () => true,
): string | null {
  const sections: string[] = []
  for (const id of area) {
    const s = sectionOf(id, parentOf)
    if (exists(s) && !sections.includes(s)) sections.push(s)
  }
  if (pointer) {
    const s = sectionOf(pointer, parentOf)
    if (exists(s) && (sections.length === 0 || sections.includes(s))) return s
  }
  return sections[0] ?? null
}

/** Board 36 › Glide: 600 ms, ease-in-out cubic, world space (no drift while panning). */
export const CURSOR_GLIDE_MS = 600

/** Ease-in-out cubic. */
const glideEase = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
}

/** Board 36 › Cursor: the pointer tip sits at (3, 3) inside the cursor box. */
export const CURSOR_TIP = 3

/** Board 36 › Section flash: one 3 px agent-soft ring per landed edit, 1.2 s. */
export const SECTION_FLASH_MS = 1200

/** Board 36 › Cursor: pills of agents in one section stack 22 + 4 px apart, lead on top. */
export const CURSOR_STACK = 26

type Pt = { x: number; y: number }

/** A world-space glide: from → to over {@link CURSOR_GLIDE_MS}. */
export interface Glide {
  from: Pt
  to: Pt
  at: number
}

/** The glide's world point at `t`. */
export function glideAt(g: Glide, t: number): Pt {
  const k = glideEase((t - g.at) / CURSOR_GLIDE_MS)
  return { x: g.from.x + (g.to.x - g.from.x) * k, y: g.from.y + (g.to.y - g.from.y) * k }
}

/**
 * Re-targets a glide: unchanged when `to` holds, else a fresh glide from where the cursor is now
 * (or a jump with reduced motion). The first target is reached at once.
 */
export function retarget(g: Glide | undefined, to: Pt, t: number, reduced: boolean): Glide {
  if (!g) return { from: to, to, at: t - CURSOR_GLIDE_MS }
  if (Math.abs(g.to.x - to.x) < 0.5 && Math.abs(g.to.y - to.y) < 0.5) return g
  return { from: reduced ? to : glideAt(g, t), to, at: t }
}

/** Center of a box. */
export const centerOf = (b: AreaBox): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
