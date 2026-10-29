/**
 * Board 44 "Workspace v2" §4 / §5: one window's tabs. Wraps the pure model (`./model`) with what
 * needs the outside world: the hash route (switching navigates), the session manager (each disk
 * tab keeps its file's session open, follows Save as, and goes when its file closes), the close
 * prompt (board 24 (i), shown by the tab's editor), drag out to a new window (desktop) and the
 * Last files record (General › On launch).
 *
 * One controller per window ({@link windowTabs}); the App root attaches the runtime and feeds
 * route changes, the TabStrip renders {@link TabsController.getState}. A room joined from a link
 * (desktop) stays joined while its tab is open and is left when the tab closes (#79).
 */
import type { FileRef, KimoPlatform } from "@kimo/platform"
import { retainDiskFile } from "../editor/session"
import { isUntitledRef } from "../platform/contract"
import { isPenPath } from "../platform/pen"
import type { FileDocumentSession, FileSessionManager } from "../platform/session"
import { lastHomePath, navigate } from "../router"
import {
  activeTab,
  addHomeTab,
  EMPTY_TABS,
  moveTab,
  removeTab,
  restoredTabs,
  retarget,
  stepTab,
  syncRoute,
  type Tab,
  type TabCommand,
  type TabsState,
  type TabTarget,
  tabAt,
  tabPath,
} from "./model"

/** How long drag out waits for the file to close (lease released) before the new window opens. */
const DRAG_OUT_CLOSE_MS = 3000

export interface TabsDeps {
  /** Goes to a route path (`/disk/<ref>`, `/`). */
  navigate(path: string): void
  /** The Home section a Home tab shows (board 37: Home remembers its section). */
  homePath(): string
}

/** The rooms a window joined from links (the multiplayer join model). */
export interface TabRooms {
  /** Leaves the room joined from `link` (or stops its join). */
  leave(link: string): void
}

const diskRef = (t: Tab | null | undefined): FileRef | null =>
  t?.target?.kind === "disk" ? t.target.ref : null

/** Links of the window's room tabs. */
const joinLinks = (s: TabsState): Set<string> =>
  new Set(s.tabs.flatMap((t) => (t.target?.kind === "join" ? [t.target.link] : [])))

export class TabsController {
  private state: TabsState = EMPTY_TABS
  private readonly listeners = new Set<() => void>()
  private seq = 0
  private manager: FileSessionManager | null = null
  private platform: KimoPlatform | null = null
  private rooms: TabRooms | null = null
  private offManager: (() => void) | null = null
  /** Disk tabs hold their file open (tab id → ref + release). */
  private readonly holds = new Map<string, { ref: FileRef; release: () => void }>()
  /** The session each disk tab showed (tab id → session + its state subscription). */
  private readonly seen = new Map<string, { session: FileDocumentSession; off: () => void }>()

  constructor(private readonly deps: TabsDeps) {}

  getState = (): TabsState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private newId = () => `tab-${++this.seq}`

  private set(next: TabsState): void {
    if (next === this.state) return
    const before = joinLinks(this.state)
    this.state = next
    // A room tab that closed (or now shows something else) leaves its room.
    if (this.rooms && before.size) {
      const after = joinLinks(next)
      for (const link of before) if (!after.has(link)) this.rooms.leave(link)
    }
    this.syncHolds()
    for (const l of [...this.listeners]) l()
    // A tab that now shows an open file starts following its session.
    this.reconcile()
  }

  /** The window's runtime (App root). Returns the detach function. */
  attach(manager: FileSessionManager, platform: KimoPlatform): () => void {
    this.offManager?.()
    this.manager = manager
    this.platform = platform
    const off = manager.subscribe(() => this.reconcile())
    this.offManager = off
    this.syncHolds()
    this.reconcile()
    return () => {
      off()
      if (this.offManager === off) this.offManager = null
    }
  }

  /** The window's joined rooms (desktop): a room tab holds its room. Returns the detach function. */
  attachRooms(rooms: TabRooms): () => void {
    this.rooms = rooms
    return () => {
      if (this.rooms === rooms) this.rooms = null
    }
  }

  /** Lets go of every file and the manager (a window going away disposes its sessions too). */
  dispose(): void {
    this.offManager?.()
    this.offManager = null
    for (const h of this.holds.values()) h.release()
    this.holds.clear()
    for (const s of this.seen.values()) s.off()
    this.seen.clear()
    this.manager = null
  }

  /** Board 44 §5 "Restore": the tabs of the last session (Home in front until a route says). */
  seed(refs: readonly FileRef[]): void {
    const r = restoredTabs(refs, this.newId)
    this.set({ tabs: [...r.tabs, ...this.state.tabs], active: this.state.active })
  }

  /** The route now shows `target` (null: a Home route). */
  route(target: TabTarget | null): void {
    // A `.pen` opens as the `.kimo` it converts to (DiskEditor replaces the route): same tab.
    const current = activeTab(this.state)
    const cur = diskRef(current)
    if (
      target?.kind === "disk" &&
      cur &&
      isPenPath(cur) &&
      !this.state.tabs.some((t) => t.target?.kind === "disk" && t.target.ref === target.ref) &&
      this.manager?.get(cur)?.ref === target.ref
    ) {
      this.set(retarget(this.state, { kind: "disk", ref: cur }, target))
      return
    }
    this.set(syncRoute(this.state, target, this.newId))
  }

  /** Focuses tab `id` (null: the pinned Home tab) and shows it. */
  activate(id: string | null): void {
    const tab = id === null ? null : this.state.tabs.find((t) => t.id === id)
    if (id !== null && !tab) return
    if (this.state.active !== id) this.set({ ...this.state, active: id })
    this.deps.navigate(tabPath(tab?.target ?? null, this.deps.homePath()))
  }

  /** ⌘T / +: Home in a new tab. */
  newTab(): void {
    this.set(addHomeTab(this.state, this.newId()))
    this.deps.navigate(this.deps.homePath())
  }

  /** Drag to reorder. */
  move(id: string, to: number): void {
    this.set(moveTab(this.state, id, to))
  }

  /**
   * Board 44 §5 "Close": closes tab `id`. A never-saved document with edits asks first (board 24
   * (i) Save… / Don't save / Cancel, shown by its editor, so the tab comes to the front); Cancel
   * keeps the tab. Files that autosave just close. Resolves true when the tab went.
   */
  async close(id: string): Promise<boolean> {
    const tab = this.state.tabs.find((t) => t.id === id)
    if (!tab) return false
    const ref = diskRef(tab)
    const session = ref ? this.manager?.get(ref) : undefined
    if (session?.needsClosePrompt) {
      if (this.state.active !== id) this.activate(id)
      if (!(await session.confirmClose())) return false
    }
    this.drop(id)
    return true
  }

  /** ⌘W: the focused tab; on the pinned Home tab (which never closes) the window closes. */
  async closeActive(): Promise<void> {
    const id = this.state.active
    if (id !== null) {
      await this.close(id)
      return
    }
    if (this.platform && this.platform.kind !== "browser") await this.platform.window.close()
  }

  /** Board 44 §5 "Switch" and "Home tab": a keyboard or menu command. */
  run(cmd: TabCommand): void {
    switch (cmd.kind) {
      case "new":
        this.newTab()
        return
      case "close":
        void this.closeActive()
        return
      case "step":
        this.activate(stepTab(this.state, cmd.dir))
        return
      case "goto": {
        const id = tabAt(this.state, cmd.n)
        if (id !== undefined) this.activate(id)
        return
      }
    }
  }

  /** Board 44 §4 C: can tab `id` open in a new window (desktop, a saved file on disk)? */
  canDragOut(id: string): boolean {
    const ref = diskRef(this.state.tabs.find((t) => t.id === id))
    return !!ref && !isUntitledRef(ref) && !!this.platform?.window.openFileInNewWindow
  }

  /**
   * Board 44 §4 C / §5 "Drag": tab `id` released below the strip opens in a new window. The tab
   * leaves this window first and its file closes (flushed, lease released), so the new window
   * owns it.
   */
  async dragOut(id: string): Promise<boolean> {
    const open = this.platform?.window.openFileInNewWindow
    const ref = diskRef(this.state.tabs.find((t) => t.id === id))
    if (!open || !ref || isUntitledRef(ref)) return false
    const session = this.manager?.get(ref)
    this.drop(id)
    if (session && this.manager) await closed(this.manager, session, DRAG_OUT_CLOSE_MS)
    await open(ref).catch((e: unknown) => console.warn("Kimo: could not open a window", e))
    return true
  }

  /** Removes tab `id` and lets go of its file; shows the tab that takes its place. */
  private drop(id: string): void {
    const wasActive = this.state.active === id
    const next = removeTab(this.state, id)
    this.set(next)
    if (wasActive) {
      const tab = activeTab(next)
      this.deps.navigate(tabPath(tab?.target ?? null, this.deps.homePath()))
    }
  }

  /** Each disk tab holds its file; tabs that went (or now show another file) let go. */
  private syncHolds(): void {
    const manager = this.manager
    if (!manager) return
    const live = new Set<string>()
    for (const tab of this.state.tabs) {
      const ref = diskRef(tab)
      if (!ref) continue
      live.add(tab.id)
      const h = this.holds.get(tab.id)
      if (h?.ref === ref) continue
      h?.release()
      this.holds.set(tab.id, { ref, release: retainDiskFile(manager, ref) })
    }
    for (const [id, h] of this.holds)
      if (!live.has(id)) {
        h.release()
        this.holds.delete(id)
      }
    for (const [id, s] of this.seen)
      if (!live.has(id)) {
        s.off()
        this.seen.delete(id)
      }
  }

  /**
   * Sessions opened, closed or moved: a tab follows its session to a new ref (Save as, an
   * untitled file's first save) and goes when the session closed (an untitled file closed from
   * File › Back to files). A session asking to close brings its tab to the front.
   */
  private reconcile(): void {
    const manager = this.manager
    if (!manager) return
    const open = new Set(manager.sessions())
    let state = this.state
    /** The front tab's file moved (Save as, a rename from Home or another window). */
    let frontMoved = false
    for (const tab of state.tabs) {
      const ref = diskRef(tab)
      if (!ref) continue
      const known = this.seen.get(tab.id)
      if (known && !open.has(known.session)) {
        known.off()
        this.seen.delete(tab.id)
        state = removeTab(state, tab.id)
        continue
      }
      if (known && known.session.ref !== ref) {
        state = retarget(state, { kind: "disk", ref }, { kind: "disk", ref: known.session.ref })
        if (tab.id === state.active) frontMoved = true
        continue
      }
      const s = manager.get(ref)
      if (s && known?.session !== s) {
        known?.off()
        const tabId = tab.id
        const off = s.subscribe((st) => {
          if (st.closePrompt && this.state.active !== tabId) this.activate(tabId)
        })
        this.seen.set(tabId, { session: s, off })
      }
    }
    if (state !== this.state) {
      const wasActive = this.state.active
      this.set(state)
      if (wasActive !== state.active || frontMoved) {
        const tab = activeTab(state)
        this.deps.navigate(tabPath(tab?.target ?? null, this.deps.homePath()))
      }
    }
  }
}

/** Resolves once `session` left the manager (closed), or after `ms`. */
function closed(manager: FileSessionManager, session: FileDocumentSession, ms: number) {
  return new Promise<void>((resolve) => {
    if (!manager.sessions().includes(session)) return resolve()
    let off = () => {}
    const timer = setTimeout(() => {
      off()
      resolve()
    }, ms)
    off = manager.subscribe(() => {
      if (manager.sessions().includes(session)) return
      clearTimeout(timer)
      off()
      resolve()
    })
  })
}

let instance: TabsController | null = null

/** This window's tabs (one per window: every window has its own JS context). */
export function windowTabs(): TabsController {
  instance ??= new TabsController({ navigate, homePath: lastHomePath })
  return instance
}
