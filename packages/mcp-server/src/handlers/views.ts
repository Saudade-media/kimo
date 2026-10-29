/**
 * What each editor window shows (#78 target resolution): one record per window label, from the
 * window's reports, with times the host stamps. The desktop document host feeds it from
 * `HOST_EVENTS.windowState`; the core host maps refs to docIds (`DocumentHost.views`).
 *
 * - `selectionAt`: a person selection change while the tab is shown (a selection a tab brings
 *   back when it mounts keeps its old time, so it never looks newer than it is);
 * - `viewAt`: a pan, zoom or page change;
 * - `attentionAt`: a mount, a change to `active: true`, or a window focus gain.
 */
import type { WindowView } from "../runtime"

/** What a window reports about its editor tab. `ref` null: a file the host does not serve. */
export interface ViewReport {
  ref: string | null
  kind: WindowView["kind"]
  active: boolean
  focused: boolean
  selection: readonly string[]
  selectionBy: "person" | "agent"
  page: string | null
  view: WindowView["view"]
}

/** A window record keyed by ref (the core host turns `ref` into a docId). */
export type BackendView = Omit<WindowView, "docId"> & { ref: string | null }

/** A person selection settles this long before "I'll select it in Kimo" takes it. */
export const SELECTION_SETTLE_MS = 500

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])
const sameRect = (a: WindowView["view"], b: WindowView["view"]) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)

export class WindowViews {
  private readonly records = new Map<string, BackendView>()
  private readonly listeners = new Set<(window: string, record: BackendView) => void>()

  constructor(private readonly now: () => number = Date.now) {}

  /** A window's report: the host stamps what changed. */
  report(window: string, r: ViewReport): void {
    const prev = this.records.get(window)
    // A late unmount of a tab the window already left: its new tab's record stays.
    if (!r.active && prev && (prev.ref !== r.ref || prev.kind !== r.kind)) return
    const t = this.now()
    const same = prev !== undefined && prev.ref === r.ref && prev.kind === r.kind
    const mounted = !same || (r.active && !prev.active)
    const selection = [...r.selection]
    let selectionAt = 0
    if (same && sameIds(prev.selection, selection)) selectionAt = prev.selectionAt
    else if (same && !mounted && r.selectionBy === "person") selectionAt = t
    else if (same) selectionAt = prev.selectionAt
    const next: BackendView = {
      window,
      ref: r.ref,
      kind: r.kind,
      active: r.active,
      focused: r.focused,
      selection,
      selectionBy: r.selectionBy,
      page: r.page,
      view: r.view,
      selectionAt,
      viewAt: same && sameRect(prev.view, r.view) && prev.page === r.page ? prev.viewAt : t,
      attentionAt:
        r.active && (mounted || (r.focused && !prev?.focused)) ? t : (prev?.attentionAt ?? 0),
    }
    this.records.set(window, next)
    for (const l of [...this.listeners]) l(window, next)
  }

  /** The window released `ref` (or closed: no ref): its record goes. */
  release(window: string, ref?: string): void {
    const r = this.records.get(window)
    if (r && (ref === undefined || r.ref === ref)) this.records.delete(window)
  }

  list(): BackendView[] {
    return [...this.records.values()]
  }

  /** The newest person selection among the tabs showing `ref` (kimo_get_state `selection`). */
  selection(ref: string): string[] {
    let best: BackendView | undefined
    for (const r of this.records.values())
      if (r.active && r.ref === ref && r.selectionBy === "person" && r.selection.length)
        if (!best || r.selectionAt > best.selectionAt) best = r
    return best ? [...best.selection] : []
  }

  /**
   * The next person selection (non-empty, in a file `served` accepts, in `ref` when given) once
   * it settled for {@link SELECTION_SETTLE_MS}. Null after `ms` or when `signal` aborts.
   */
  waitForSelection(
    ref: string | null,
    ms: number,
    signal: AbortSignal,
    served: (ref: string) => boolean,
  ): Promise<{ ref: string; ids: string[] } | null> {
    if (signal.aborted) return Promise.resolve(null)
    const start = this.now()
    return new Promise((resolve) => {
      let settle: ReturnType<typeof setTimeout> | undefined
      let pending: { window: string; ref: string; ids: string[] } | null = null
      const finish = (v: { ref: string; ids: string[] } | null) => {
        clearTimeout(settle)
        clearTimeout(limit)
        this.listeners.delete(listener)
        signal.removeEventListener("abort", onAbort)
        resolve(v)
      }
      const listener = (window: string, r: BackendView) => {
        const ok =
          r.active &&
          r.ref !== null &&
          r.selectionBy === "person" &&
          r.selection.length > 0 &&
          // Only a selection made after the question counts.
          r.selectionAt >= start &&
          (ref === null || r.ref === ref) &&
          served(r.ref)
        if (!ok) {
          // That window's pending pick was cleared or moved away: wait for the next one.
          if (pending?.window === window) {
            clearTimeout(settle)
            pending = null
          }
          return
        }
        if (
          pending?.window === window &&
          pending.ref === r.ref &&
          sameIds(pending.ids, r.selection)
        )
          return
        pending = { window, ref: r.ref as string, ids: [...r.selection] }
        clearTimeout(settle)
        settle = setTimeout(() => {
          if (pending) finish({ ref: pending.ref, ids: pending.ids })
        }, SELECTION_SETTLE_MS)
      }
      const onAbort = () => finish(null)
      const limit = setTimeout(() => finish(null), ms)
      this.listeners.add(listener)
      signal.addEventListener("abort", onAbort, { once: true })
    })
  }
}
