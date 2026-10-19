import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  GitBranch,
  Loader,
  Lock,
  LockKeyhole,
  type LucideIcon,
} from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** The seven designed states (02d "SaveStatus · 7 states"). */
export type SaveStatusKind =
  | "saved"
  | "saving"
  | "unsaved"
  | "paused"
  | "read-only"
  | "locked"
  | "failed"

/** Icon per state, by the exact lucide name on the board. */
const ICON: Record<SaveStatusKind, LucideIcon> = {
  saved: CircleCheck, // circle-check
  saving: Loader, // loader
  unsaved: CircleDot, // circle-dot
  paused: GitBranch, // git-branch
  "read-only": Lock, // lock
  locked: LockKeyhole, // lock-keyhole
  failed: CircleAlert, // circle-alert
}

/** Default labels (the app passes `saveStatusLabel` for the dynamic ones). */
export const SAVE_STATUS_LABEL: Record<SaveStatusKind, string> = {
  saved: "Saved to disk",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  paused: "Autosave paused · rebase",
  "read-only": "Read-only",
  locked: "Locked by another app",
  failed: "Save failed",
}

/** Props for {@link SaveStatus}. Remaining `<button>` props go to the pill. */
export interface SaveStatusProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  kind: SaveStatusKind
  /** Pill label; defaults to {@link SAVE_STATUS_LABEL}. */
  label?: string
  /**
   * Replaces the state's icon (an SVG, sized 14 by the pill). Board 41 sync status reuses the
   * pill looks with its own icons: `refresh-cw` on Paused, `wifi-off` and `eye` on ReadOnly.
   */
  icon?: ReactNode
}

/**
 * Topbar save-status pill. Mirrors `SaveStatus` (EdNXU) and its six variants (hbDxo, O8d1r,
 * LvZiH, ChFsm, Nn6l8, qPGUY): row, gap 6, padding [0, 10, 0, 8], height 24, alignItems
 * center, radius-pill; Icon 14 · Label sans 12 / 500.
 * saved/saving: no fill, text-tertiary · unsaved/read-only: bg-muted, text-secondary ·
 * paused/locked: warning-soft, warning · failed: danger-soft, danger.
 * A `<button>` so it can open the lease details (Locked) or show its tooltip on focus.
 */
export function SaveStatus({
  kind,
  label,
  icon,
  className,
  type = "button",
  ...rest
}: SaveStatusProps) {
  const Icon = ICON[kind]
  return (
    <button
      {...rest}
      type={type}
      data-status={kind}
      className={cx("kimo-save-status", `kimo-save-status--${kind}`, className)}
    >
      {icon !== undefined ? (
        <span className="kimo-save-status__icon" aria-hidden="true">
          {icon}
        </span>
      ) : (
        <Icon className="kimo-save-status__icon" aria-hidden="true" />
      )}
      <span className="kimo-save-status__label">{label ?? SAVE_STATUS_LABEL[kind]}</span>
    </button>
  )
}
