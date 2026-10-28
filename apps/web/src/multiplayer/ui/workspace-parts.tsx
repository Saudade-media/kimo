/**
 * Board 46 leaf pieces shared by the Share popover, Settings › Workspace, Home and the app host:
 * the workspace store hooks, the member Avatar (FVhW0, initials from the email), the toast sink
 * outside an editor, and the 28-tall popover buttons (label text-sm, icon 14).
 */
import { Avatar, Button, Toast } from "@kimo/ui"
import {
  type ComponentProps,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { M3Context } from "../../editor/m3/controller"
import { Icon } from "../../lib/icons"
import { useOptionalRuntime } from "../../platform/runtime"
import { initialsOf, personName } from "../cloud/workspace-view"
import type { WorkspaceStore, WorkspacesState } from "../cloud/workspaces"
import "./workspace.css"

// --- Store ---------------------------------------------------------------------------------------

const NO_SUB = () => () => {}
const NO_STATE = () => null

/** The window's workspace store (null when Kimo Cloud is hidden). */
export function useWorkspaceStore(): WorkspaceStore | null {
  return useOptionalRuntime()?.workspaces ?? null
}

/** The workspace store's state, or null without one. */
export function useWorkspacesState(store: WorkspaceStore | null): WorkspacesState | null {
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUB,
    store ? store.getState : NO_STATE,
    store ? store.getState : NO_STATE,
  )
}

// --- Avatar --------------------------------------------------------------------------------------

/** Avatar (FVhW0) of a member: the component's own fill, initials from the email. */
export function MemberAvatar({ email, className }: { email: string; className?: string }) {
  return (
    <Avatar
      name={personName(email)}
      initials={initialsOf(email)}
      {...(className ? { className } : {})}
    />
  )
}

// --- Buttons -------------------------------------------------------------------------------------

/**
 * Button instances of board 46 (h 28, padding [0, 12], gap 6, label text-sm / 500, icon 14).
 * `wide`: Request edit access (fill width, h 32, padding [0, 14], centred).
 */
export function WsButton({
  icon,
  wide,
  danger,
  className,
  children,
  ...rest
}: Omit<ComponentProps<typeof Button>, "icon"> & {
  icon?: string
  wide?: boolean
  danger?: boolean
}) {
  return (
    <Button
      {...rest}
      className={`ws-button${wide ? " ws-button--wide" : ""}${danger ? " ws-button--danger" : ""}${className ? ` ${className}` : ""}`}
      {...(icon ? { icon: <Icon name={icon} size={14} /> } : {})}
    >
      {children}
    </Button>
  )
}

// --- Toasts outside an editor ------------------------------------------------------------------

export interface WsToast {
  tone: "success" | "danger" | "component"
  text: string
  /** Lucide icon over the tone's (board 46 toasts keep the check). */
  icon?: string
}

interface ToastEntry extends WsToast {
  id: number
}

let toasts: ToastEntry[] = []
let toastSeq = 0
const toastListeners = new Set<() => void>()
const emitToasts = () => {
  for (const l of [...toastListeners]) l()
}

function pushToast(t: WsToast) {
  toastSeq += 1
  toasts = [...toasts.slice(-2), { ...t, id: toastSeq }]
  emitToasts()
}

function dropToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emitToasts()
}

/**
 * Toast (XB33E) for workspace actions: the editor's stack inside an editor, else this window's
 * {@link WsToastStack} (Home, Settings).
 */
export function useWsToast(): (t: WsToast) => void {
  const m3 = useContext(M3Context)
  return useCallback(
    (t: WsToast) => {
      if (m3) m3.toast({ tone: t.tone, text: t.text, ...(t.icon ? { icon: t.icon } : {}) })
      else pushToast(t)
    },
    [m3],
  )
}

const TOAST_MS = { success: 4000, component: 4000, danger: 6000 } as const

/** The window's toast stack outside an editor (bottom centre, newest last). */
export function WsToastStack() {
  const list = useSyncExternalStore(
    (l) => {
      toastListeners.add(l)
      return () => toastListeners.delete(l)
    },
    () => toasts,
    () => toasts,
  )
  if (!list.length) return null
  return (
    <div className="ws-toasts" aria-live="polite">
      {list.map((t) => (
        <TimedWsToast key={t.id} toast={t} />
      ))}
    </div>
  )
}

function TimedWsToast({ toast }: { toast: ToastEntry }) {
  const [paused, setPaused] = useState(false)
  const left = useRef<number>(TOAST_MS[toast.tone])
  useEffect(() => {
    if (paused) return
    const start = performance.now()
    const t = setTimeout(() => dropToast(toast.id), left.current)
    return () => {
      clearTimeout(t)
      left.current -= performance.now() - start
    }
  }, [paused, toast.id])
  return (
    <Toast
      tone={toast.tone === "component" ? "neutral" : toast.tone}
      className="ws-toast"
      data-tone={toast.tone}
      {...(toast.icon ? { icon: <Icon name={toast.icon} size={16} /> } : {})}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      {toast.text}
    </Toast>
  )
}

// --- Workspace names after leaving ---------------------------------------------------------------

const NAMES_KEY = "kimo.cloud.workspaceNames"

/**
 * Remembers each workspace's name on this device, so a copy left after a removal (5D) can still
 * say "You're no longer in Studio" once the workspace is gone from the account.
 */
export function rememberWorkspaceNames(list: readonly { id: string; name: string }[]) {
  if (!list.length) return
  try {
    const kept = JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}") as Record<string, string>
    let changed = false
    for (const w of list)
      if (kept[w.id] !== w.name) {
        kept[w.id] = w.name
        changed = true
      }
    if (changed) localStorage.setItem(NAMES_KEY, JSON.stringify(kept))
  } catch {
    // Private mode: names are known only while the account lists them.
  }
}

/** A workspace's name: the account's list, else what this device remembered. */
export function workspaceNameOf(state: WorkspacesState, id: string): string | null {
  const listed = state.workspaces.find((w) => w.id === id)?.name
  if (listed) return listed
  try {
    const kept = JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}") as Record<string, string>
    return typeof kept[id] === "string" ? kept[id] : null
  } catch {
    return null
  }
}

/** True when `room` is a file of one of this account's workspaces (board 46 banners own it). */
export function useIsWorkspaceRoom(room: string | null): boolean {
  const state = useWorkspacesState(useWorkspaceStore())
  if (!room || !state) return false
  return (
    !!state.open[room] ||
    Object.values(state.files).some((l) => l.files.some((f) => f.room === room))
  )
}
