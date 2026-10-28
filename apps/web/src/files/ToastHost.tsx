/**
 * Session toasts, bottom-center over the canvas (board 15 placement: centered, 84 px above the
 * canvas bottom, stacked with gap 8). Copy from `toastCopy`; icons from board 17 "Changes on
 * disk": reloaded `refresh-cw` text-inverse (EiIbZ), merged `git-merge` success (adbEw),
 * conflicts `git-merge` warning on Toast/Warning (k6EAH5).
 */
import { Toast } from "@kimo/ui"
import { CircleCheck, GitMerge, RefreshCw } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect } from "react"
import { type Toast as SessionToast, toastCopy } from "../platform/contract"
import type { FileDocumentSession } from "../platform/session"
import { useSessionState } from "./hooks"

const VIEW: Record<
  SessionToast["kind"],
  { tone: "success" | "warning" | "neutral"; icon: ReactNode }
> = {
  "external-reloaded": { tone: "neutral", icon: <RefreshCw /> },
  "external-merged": { tone: "success", icon: <GitMerge /> },
  "external-conflicts": { tone: "warning", icon: <GitMerge /> },
  "merge-saved": { tone: "success", icon: <CircleCheck /> },
  "update-ready": { tone: "success", icon: <CircleCheck /> },
  "update-save-first": { tone: "warning", icon: <CircleCheck /> },
}

export interface SessionToastViewProps {
  toast: SessionToast
  onAction?: () => void
}

/** One session toast (stateless). */
function SessionToastView({ toast, onAction }: SessionToastViewProps) {
  const copy = toastCopy(toast)
  const view = VIEW[toast.kind]
  return (
    <Toast
      tone={view.tone}
      icon={view.icon}
      actionLabel={copy.action}
      data-toast={toast.kind}
      {...(onAction ? { onAction } : {})}
    >
      {copy.text}
    </Toast>
  )
}

export interface ToastHostProps {
  session: FileDocumentSession
  /** "Review" on the conflicts toast (→ board 18 Conflicts tab). */
  onReview?: () => void
  /** Auto-dismiss after this many ms (0 = never). Default 8000. */
  autoDismissMs?: number
}

/** Mount inside the canvas container (position: relative). */
export function ToastHost({ session, onReview, autoDismissMs = 8000 }: ToastHostProps) {
  const { toasts } = useSessionState(session)
  useEffect(() => {
    if (!autoDismissMs || toasts.length === 0) return
    const t = setTimeout(() => session.dismissToast(0), autoDismissMs)
    return () => clearTimeout(t)
  }, [session, toasts, autoDismissMs])
  if (toasts.length === 0) return null
  return (
    <div className="kimo-files-toasts" aria-live="polite">
      {toasts.map((t, i) => (
        <SessionToastView
          key={`${t.kind}-${"undo" in t ? t.undo.id : i}`}
          toast={t}
          onAction={() => {
            if ("undo" in t) void session.undoExternal(t.undo)
            else if (t.kind === "external-conflicts") {
              onReview?.()
              session.dismissToast(i)
            } else session.dismissToast(i)
          }}
        />
      ))}
    </div>
  )
}
