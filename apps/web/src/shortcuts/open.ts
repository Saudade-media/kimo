/**
 * Board 25 §7 (c): opens the Keyboard shortcuts sheet (WcWPY) from anywhere — ⌘/, the native
 * Help menu (menu.rs HELP_SHORTCUTS), the in-app File › Help submenu. The editor mounts the
 * sheet and subscribes; callers only call {@link openShortcutsSheet}.
 */
type Listener = () => void
const listeners = new Set<Listener>()

export function openShortcutsSheet(): void {
  for (const l of listeners) l()
}

export function onOpenShortcutsSheet(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
