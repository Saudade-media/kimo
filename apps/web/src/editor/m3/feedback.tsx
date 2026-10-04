/**
 * Board 15 feedback: the toast stack (`b6PPwj`: bottom-center, 12 above the floating toolbar,
 * newest at the bottom, at most 3, older ones at opacity 0.5; danger 6 s, warning 4 s, hover
 * pauses) and the confirm dialogs (`i8PfIC` Detach, `ysXyK` slot off, `fmB2B` Unlink).
 */
import { ConfirmDialog, Toast } from "@kimo/ui"
import { useEffect, useRef, useState } from "react"
import { Icon } from "../../lib/icons"
import { type M3Controller, type ToastItem, useBusValue } from "./controller"

const TOAST_ICON: Record<ToastItem["tone"], string> = {
  danger: "circle-x",
  warning: "triangle-alert",
  component: "component",
  success: "circle-check",
}

export function ToastStack({ m3 }: { m3: M3Controller }) {
  const toasts = useBusValue(m3.toasts)
  return (
    <div className="m3-toasts" aria-live="polite">
      {toasts.map((t, i) => (
        <TimedToast
          key={t.id}
          toast={t}
          old={i < toasts.length - 1}
          onDone={() => m3.dismissToast(t.id)}
        />
      ))}
    </div>
  )
}

function TimedToast({ toast, old, onDone }: { toast: ToastItem; old: boolean; onDone(): void }) {
  const [paused, setPaused] = useState(false)
  const left = useRef(toast.duration)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (paused) return
    const start = performance.now()
    const t = setTimeout(() => done.current(), left.current)
    return () => {
      clearTimeout(t)
      left.current -= performance.now() - start
    }
  }, [paused])
  return (
    <Toast
      tone={toast.tone === "component" ? "neutral" : toast.tone}
      className={`m3-toast${old ? " m3-toast--old" : ""}`}
      data-tone={toast.tone}
      icon={<Icon name={toast.icon ?? TOAST_ICON[toast.tone]} size={16} />}
      actionLabel={toast.action?.label}
      onAction={() => {
        toast.action?.run()
        onDone()
      }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      {toast.text}
    </Toast>
  )
}

export function ConfirmHost({ m3 }: { m3: M3Controller }) {
  const state = useBusValue(m3.confirmState)
  if (!state) return null
  const { spec, resolve } = state
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim dismisses on outside press / Escape
    <div
      className="m3-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) resolve(false)
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          resolve(false)
        }
      }}
    >
      <ConfirmDialog
        className="m3-confirm"
        tone={spec.tone}
        icon={<Icon name={spec.icon} size={16} />}
        title={spec.title}
        description={spec.desc}
        impact={spec.items.map((it) => ({
          icon: <Icon name={it.icon} size={14} />,
          tone: it.accent ? ("component" as const) : ("tertiary" as const),
          text: it.text,
        }))}
        confirmLabel={spec.confirm}
        dontAskAgain={!!spec.dontAskKey}
        onConfirm={({ dontAskAgain }) => {
          if (dontAskAgain && spec.dontAskKey) m3.rememberDontAsk(spec.dontAskKey)
          resolve(true)
        }}
        onCancel={() => resolve(false)}
      />
    </div>
  )
}
