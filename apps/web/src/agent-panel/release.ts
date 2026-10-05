/**
 * Releasing stale agent flags (ADR 0014 §9, board 22 "Placeholder flag"). A `placeholder` flag
 * is runtime state: it only means something while a live turn or MCP connection owns it. The
 * editor window releases every flag nobody owns
 * - when a file opens (a turn can't survive a restart or reload, so nothing in a freshly
 *   opened file is being built),
 * - when an MCP client disconnects,
 * - when the window closes or the editor unmounts mid-turn.
 * The flag is cleared as one edit and, when the document had no undo history yet, that edit is
 * not left on the undo stack (undo would bring the stale flag back).
 */
import { releasePlaceholderOps, stalePlaceholderIds } from "@kimo/ai-agent"
import type { DocStore, Op } from "@kimo/editor-state"

interface ReleaseTarget {
  store: DocStore
  apply(ops: Op | readonly Op[], label?: string): boolean
}

/** Which owners still count as live: the owner origin, or undefined for a bare `true`. */
export type LiveOwner = (owner: string | undefined) => boolean

/** Frames in `store` that carry a flag no live owner holds. */
export function stalePlaceholdersIn(store: DocStore, isLive: LiveOwner): string[] {
  const ids = store.nodeIds()
  return stalePlaceholderIds(
    ids.map((id) => [id, store.getNode(id) as { placeholder?: unknown } | undefined] as const),
    isLive,
  )
}

/** Clears every stale flag of the document. Returns the released frame ids. */
export function releaseStalePlaceholders(
  target: ReleaseTarget,
  isLive: LiveOwner,
  label = "Release agent flag",
): string[] {
  const { store } = target
  if (store.readOnly) return []
  const ids = stalePlaceholdersIn(store, isLive)
  if (ids.length === 0) return []
  const pristine = store.topUndo("user") === null
  if (!target.apply(releasePlaceholderOps(ids) as unknown as Op[], label)) return []
  if (pristine) store.clearHistory("user")
  return ids
}
