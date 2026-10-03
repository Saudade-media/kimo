/**
 * Updater toasts (board 19 `wsHiA` / `aF0vX`): `Toast` (XB33E) instances with the icon
 * `circle-arrow-up`: text-inverse for "Kimo 0.5 is ready · Restart", warning for "Restart after
 * saving 2 files? · Save & restart". Copy from `toastCopy` (platform/contract).
 */
import { Toast } from "@kimo/ui"
import { CircleArrowUp } from "lucide-react"
import { useSyncExternalStore } from "react"
import { toastCopy } from "../platform/contract"
import type { UpdaterController, UpdateToast } from "./controller"
import "./updater.css"

export interface UpdateToastViewProps {
  toast: UpdateToast
  onAction: () => void
  className?: string
}

/** One update toast. */
export function UpdateToastView({ toast, onAction, className }: UpdateToastViewProps) {
  const copy = toastCopy(toast)
  return (
    <Toast
      className={className}
      tone={toast.kind === "update-ready" ? "neutral" : "warning"}
      icon={<CircleArrowUp />}
      actionLabel={copy.action}
      onAction={onAction}
      data-pen={toast.kind === "update-ready" ? "wsHiA" : "aF0vX"}
    >
      {copy.text}
    </Toast>
  )
}

/** Live toast for a controller, bottom-center (board 15 placement). */
export function UpdateToastHost({ controller }: { controller: UpdaterController }) {
  const toast = useSyncExternalStore(controller.subscribe, controller.toast, controller.toast)
  if (!toast) return null
  return (
    <div className="updater-toasts">
      <UpdateToastView toast={toast} onAction={() => void controller.restart()} />
    </div>
  )
}
