/**
 * Layer-row decoration (board 18): only the node that owns an open conflict shows the
 * ConflictMarker (`LayerRow/Conflict` VpvIr, `@kimo/ui` `LayerRowConflict`).
 */
import { useSyncExternalStore } from "react"
import type { ConflictRowView } from "../platform/contract"
import type { EditorConflictSession } from "./session"

const EMPTY: ReadonlyMap<string, readonly ConflictRowView[]> = new Map()
const noop = () => () => {}
const empty = () => EMPTY

/** Open conflict rows per node id; empty without a session. Re-renders on conflict changes. */
export function useOpenConflictNodes(
  session: EditorConflictSession | null,
): ReadonlyMap<string, readonly ConflictRowView[]> {
  return useSyncExternalStore(
    session ? session.subscribe : noop,
    session ? session.openByNode : empty,
    session ? session.openByNode : empty,
  )
}
