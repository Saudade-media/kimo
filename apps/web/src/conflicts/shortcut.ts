/** ⌘' / Ctrl+' "Next conflict" (board 18; contract NEXT_CONFLICT_SHORTCUT = "Mod+'"). */
import { useEffect } from "react"
import { matches } from "../shortcuts/shortcuts"
import type { EditorConflictSession } from "./session"

/**
 * True for Mod+' or ⇧Mod+' (SHORTCUTS "nextConflict" / "previousConflict"; ⇧ goes to the
 * previous conflict). Matches `code` too, so keyboard layouts agree.
 */
export function isNextConflictKey(
  e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "key" | "code"> & {
    shiftKey?: boolean
  },
): boolean {
  // Explicit fields: a DOM KeyboardEvent's props are prototype getters, which a spread drops.
  const k = {
    key: e.key,
    code: e.code,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey ?? false,
  }
  return matches("nextConflict", k) || matches("previousConflict", k)
}

/** Runs one Next / Previous conflict step: selects the node, reveals it, focuses its row. */
function stepConflict(session: EditorConflictSession, backwards = false): string | null {
  const id = backwards ? session.previous() : session.next()
  if (id) session.focus(id)
  return id
}

/** Installs the ⌘' shortcut on `window` while `session` is non-null. */
export function useNextConflictShortcut(session: EditorConflictSession | null): void {
  useEffect(() => {
    if (!session) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isNextConflictKey(e)) return
      e.preventDefault()
      stepConflict(session, matches("previousConflict", e))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [session])
}
