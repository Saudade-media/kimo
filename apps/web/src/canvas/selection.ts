/**
 * Click-selection policy (Figma-like): a click selects the outermost node below the root
 * artboard (direct child of a root frame), or keeps the depth of the current selection when
 * clicking among its siblings / inside a selected node's subtree; ⌘-click selects the deepest
 * hit; double-click enters one level deeper.
 */
import { type DocReader, pathOf } from "./commands"

/** Maps an expanded (synthetic) id to the real node that owns it (its top-level instance). */
export type RealId = (id: string) => string

/** The node a click on `hit` (deepest hit) selects. */
export function pickTarget(
  doc: DocReader,
  hit: string,
  selection: readonly string[],
  deep: boolean,
): string {
  const path = pathOf(doc, hit)
  if (deep || path.length === 1) return hit
  let depth = 1
  const sel = new Set(selection)
  for (const s of selection) {
    const i = path.indexOf(s)
    // Clicking a selected node or inside it keeps that node (so a drag moves it).
    if (i >= 0) {
      depth = Math.max(depth, i)
      continue
    }
    // Clicking a sibling (or a sibling's subtree) of a selected node selects at that depth.
    const sp = pathOf(doc, s)
    const k = sp.length - 1
    if (k >= 1 && k < path.length && sp[k - 1] === path[k - 1] && !sel.has(path[k] as string))
      depth = Math.max(depth, k)
  }
  return path[Math.min(depth, path.length - 1)] as string
}

/** Double-click: the next level below `current` on the path to `hit` (or `hit` itself). */
export function enterTarget(doc: DocReader, hit: string, current: string | undefined): string {
  const path = pathOf(doc, hit)
  if (!current) return hit
  const i = path.indexOf(current)
  return i >= 0 && i + 1 < path.length ? (path[i + 1] as string) : hit
}

/**
 * Multi-click drilling: one click of a rapid sequence after the first. `path` is the path to the
 * leaf under the first click (fixed for the sequence), `level` the index selected so far. Moves
 * exactly one level deeper; at the leaf it stays (`atLeaf`: a text leaf then enters edit).
 */
export function drillStep(
  path: readonly string[],
  level: number,
): { level: number; id: string; atLeaf: boolean } {
  const last = path.length - 1
  const next = Math.min(level + 1, last)
  return { level: next, id: path[next] as string, atLeaf: level >= last }
}
