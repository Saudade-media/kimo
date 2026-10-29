/**
 * Board 44 "Workspace v2" §4 / §5 (rules bXS44fLYOq): the tab model, pure. One tab per open file
 * in open order; the Home tab is pinned first and is not a list entry (`active: null` is Home);
 * ⌘T and + add a Home-in-a-tab (`target: null`) that turns into the file picked there.
 *
 * The hash route stays the source of truth for what the window shows: {@link syncRoute} folds a
 * route change into the tabs (focus the file's tab, turn a new tab into the file, or add a tab).
 */
import { joinPath } from "../join/link"
import { matches } from "../shortcuts/shortcuts"

/**
 * What a tab shows: a `.kimo` on disk (`#/disk/<ref>`), a browser library file (`#/file/:id`) or,
 * on desktop, a room joined from a link (`#/join/<link>`; the link holds the room key, so it is
 * never saved).
 */
export type TabTarget =
  | { kind: "disk"; ref: string }
  | { kind: "file"; id: string }
  | { kind: "join"; link: string }

export interface Tab {
  /** Stable for the tab's life (React key, drag state). */
  id: string
  /** null: a new tab showing Home (⌘T / +) until a file is picked there. */
  target: TabTarget | null
}

export interface TabsState {
  tabs: readonly Tab[]
  /** The focused tab's id; null = the pinned Home tab. */
  active: string | null
}

export const EMPTY_TABS: TabsState = { tabs: [], active: null }

/** Identity of a target (two tabs never share one). */
export function targetKey(t: TabTarget): string {
  if (t.kind === "join") return `join:${t.link}`
  return t.kind === "disk" ? `disk:${t.ref}` : `file:${t.id}`
}

export function sameTarget(a: TabTarget | null, b: TabTarget | null): boolean {
  return !!a && !!b && targetKey(a) === targetKey(b)
}

/** The route path a tab shows (`home` is the Home section path for new tabs). */
export function tabPath(t: TabTarget | null, home: string): string {
  if (!t) return home
  if (t.kind === "join") return joinPath(t.link)
  return t.kind === "disk" ? `/disk/${encodeURIComponent(t.ref)}` : `/file/${t.id}`
}

export function activeTab(s: TabsState): Tab | null {
  return s.tabs.find((t) => t.id === s.active) ?? null
}

/**
 * Board 44 §5 "Tabs" / "Home tab": the window now shows `target` (null: a Home route). An open
 * file focuses its tab; a new tab (Home in a tab) that is active becomes the file; otherwise the
 * file gets a new tab at the end. A Home route keeps an active new tab, else focuses Home.
 */
export function syncRoute(s: TabsState, target: TabTarget | null, newId: () => string): TabsState {
  const current = activeTab(s)
  if (!target) {
    if (current && current.target === null) return s
    return s.active === null ? s : { ...s, active: null }
  }
  const open = s.tabs.find((t) => sameTarget(t.target, target))
  if (open) return open.id === s.active ? s : { ...s, active: open.id }
  if (current && current.target === null)
    return {
      tabs: s.tabs.map((t) => (t.id === current.id ? { ...t, target } : t)),
      active: current.id,
    }
  const id = newId()
  return { tabs: [...s.tabs, { id, target }], active: id }
}

/** ⌘T / +: Home in a new tab, at the end, focused. */
export function addHomeTab(s: TabsState, id: string): TabsState {
  return { tabs: [...s.tabs, { id, target: null }], active: id }
}

/**
 * Removes tab `id`. Closing the focused tab focuses its right neighbour, else its left one, else
 * Home (the pinned tab never closes).
 */
export function removeTab(s: TabsState, id: string): TabsState {
  const i = s.tabs.findIndex((t) => t.id === id)
  if (i < 0) return s
  const tabs = s.tabs.filter((t) => t.id !== id)
  if (s.active !== id) return { tabs, active: s.active }
  const next = tabs[i] ?? tabs[i - 1] ?? null
  return { tabs, active: next ? next.id : null }
}

/** Drag to reorder: tab `id` moves to index `to` (clamped) of the file tabs. */
export function moveTab(s: TabsState, id: string, to: number): TabsState {
  const from = s.tabs.findIndex((t) => t.id === id)
  if (from < 0) return s
  const clamped = Math.max(0, Math.min(s.tabs.length - 1, to))
  if (clamped === from) return s
  const tabs = [...s.tabs]
  const [tab] = tabs.splice(from, 1)
  if (tab) tabs.splice(clamped, 0, tab)
  return { ...s, tabs }
}

/** Save as / `.pen` conversion: the tab showing `from` now shows `to` (a duplicate tab goes). */
export function retarget(s: TabsState, from: TabTarget, to: TabTarget): TabsState {
  const tab = s.tabs.find((t) => sameTarget(t.target, from))
  if (!tab || sameTarget(from, to)) return s
  const dup = s.tabs.find((t) => t.id !== tab.id && sameTarget(t.target, to))
  const tabs = s.tabs
    .filter((t) => t !== dup)
    .map((t) => (t.id === tab.id ? { ...t, target: to } : t))
  return { tabs, active: dup && s.active === dup.id ? tab.id : s.active }
}

/** Positions for ⌘1…⌘9 and next / previous: the pinned Home tab, then the file tabs. */
function positions(s: TabsState): (string | null)[] {
  return [null, ...s.tabs.map((t) => t.id)]
}

/** The tab ⌘⇧] (`+1`) or ⌘⇧[ (`-1`) focuses, wrapping around. */
export function stepTab(s: TabsState, dir: 1 | -1): string | null {
  const list = positions(s)
  const i = Math.max(0, list.indexOf(s.active))
  return list[(i + dir + list.length) % list.length] ?? null
}

/** ⌘1…⌘8 by position (⌘1 is Home), ⌘9 the last tab; undefined past the end. */
export function tabAt(s: TabsState, n: number): string | null | undefined {
  const list = positions(s)
  if (n === 9) return list[list.length - 1] ?? null
  if (n < 1 || n > 8 || n > list.length) return undefined
  return list[n - 1] ?? null
}

/** A keyboard command of the tab strip (board 44 §5 "Switch" / "Close" / "Home tab"). */
export type TabCommand =
  | { kind: "new" }
  | { kind: "close" }
  | { kind: "step"; dir: 1 | -1 }
  | { kind: "goto"; n: number }

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">

/**
 * Board 44 §5: ⌘T new tab, ⌘W close, ⌘⇧] / ⌘⇧[ next / previous, ⌘1…⌘8 by position, ⌘9 the
 * last tab. Matched through the shortcut table (board 25 "Single source"); "⌘" is Ctrl off macOS.
 */
export function tabCommandFor(e: KeyLike): TabCommand | null {
  if (matches("newTab", e)) return { kind: "new" }
  if (matches("closeTab", e)) return { kind: "close" }
  if (matches("nextTab", e)) return { kind: "step", dir: 1 }
  if (matches("previousTab", e)) return { kind: "step", dir: -1 }
  if (matches("lastTab", e)) return { kind: "goto", n: 9 }
  if (matches("goToTab", e)) return { kind: "goto", n: Number(e.code.slice(5)) }
  return null
}

/** What restore keeps (board 44 §5 "Restore"): files on disk in order, and the focused one. */
export interface SavedTabs {
  tabs: string[]
  active: string | null
}

/** The window's tabs as remembered for the next launch (new tabs and untitled files drop). */
export function savedTabs(s: TabsState, keep: (ref: string) => boolean): SavedTabs {
  const refs: string[] = []
  for (const t of s.tabs)
    if (t.target?.kind === "disk" && keep(t.target.ref)) refs.push(t.target.ref)
  const a = activeTab(s)?.target
  return { tabs: refs, active: a?.kind === "disk" && refs.includes(a.ref) ? a.ref : null }
}

/** Tabs for `saved` refs (deduplicated, in order); Home focused until the route says otherwise. */
export function restoredTabs(saved: readonly string[], newId: () => string): TabsState {
  const seen = new Set<string>()
  const tabs: Tab[] = []
  for (const ref of saved) {
    if (seen.has(ref)) continue
    seen.add(ref)
    tabs.push({ id: newId(), target: { kind: "disk", ref } })
  }
  return { tabs, active: null }
}

/**
 * Drag (board 44 §4 C): the index the dragged tab takes for pointer `x`, given the other tabs'
 * horizontal midpoints in order.
 */
export function dropIndex(x: number, midpoints: readonly number[]): number {
  let i = 0
  while (i < midpoints.length && x > (midpoints[i] ?? 0)) i++
  return i
}
