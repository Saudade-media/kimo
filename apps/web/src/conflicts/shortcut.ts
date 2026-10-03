/** ⌘' / Ctrl+' "Next conflict" (board 18; contract NEXT_CONFLICT_SHORTCUT = "Mod+'"). */
import { useEffect } from "react"
import type { EditorConflictSession } from "./session"

/** True for Mod+' (⇧ goes to the previous conflict). Uses `code` so keyboard layouts agree. */
export function isNextConflictKey(
  e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "key" | "code">,
): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && (e.code === "Quote" || e.key === "'")
}

/** Runs one Next / Previous conflict step: selects the node, reveals it, focuses its row. */
export function stepConflict(session: EditorConflictSession, backwards = false): string | null {
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
      stepConflict(session, e.shiftKey)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [session])
}
