import { type ComponentPropsWithRef, type ReactNode, useId, useRef } from "react"
import { Button } from "../button/Button"
import { cx, mergeRefs } from "../internal/util"
import { useDismiss, useFocusTrap } from "../popover/usePopover"

/** Board 25 §6 "Confirm width": `sm` quick confirm 400, `md` form 480 (Dialog default), `export` 880. */
export type DialogSize = "sm" | "md" | "export"

/** Pixel width of each {@link DialogSize}. */
export const DIALOG_WIDTH: Readonly<Record<DialogSize, number>> = { sm: 400, md: 480, export: 880 }

/** Props for {@link Dialog}. Remaining `<div>` props go to the dialog frame. */
export interface DialogProps extends Omit<ComponentPropsWithRef<"div">, "title" | "children"> {
  /** 16px lucide icon in the Icon Wrap (`file-clock`, `life-buoy`, `file-up`). */
  icon: ReactNode
  /**
   * Icon Wrap tone: `neutral` (bg-muted / text-primary, the component), `danger`, or `success`
   * (board 20 "Nothing to clean up" nsxuR: success-soft / success).
   */
  tone?: "neutral" | "danger" | "success"
  title: string
  description: ReactNode
  /**
   * The Body slot (z3U95). Instances replace the whole Body frame (recovery: column with a top
   * stroke; migration: column gap 8), so it is rendered as given, without a wrapper.
   */
  children?: ReactNode
  /** Footer > Footnote (POSht), sans 11 text-tertiary: "Kept for 30 days". */
  footnote?: ReactNode
  /** Footnote in font-mono. */
  footnoteMono?: boolean
  /** Footer > Tertiary (gDY4y, Button/Ghost): "Discard all". */
  tertiary?: { label: string; onClick: () => void }
  /**
   * Footer > Cancel (k0VaD, Button/Ghost). Default "Cancel"; null hides it (board 20 nsxuR:
   * a single "Done" button; Escape still cancels).
   */
  cancelLabel?: string | null
  /** Footer > Confirm (qqpfr, Button/Primary). */
  confirmLabel: string
  confirmDisabled?: boolean
  /** Escape, outside press and Cancel. */
  onCancel: () => void
  onConfirm: () => void
  /** Frame width (component 480; instances 600, 640, 672, …). Overrides `size`. */
  width?: number
  /**
   * Board 25 §6 rule "Confirm width" (vy0fg › R2j1Av `dialog.size = 'sm'`): quick confirms
   * (close untitled, discard, delete) are `sm` = 400 px; forms keep the 480 default (`md`).
   */
  size?: DialogSize
  /**
   * Rendered in place (gallery specimen), not as an open modal: no global Escape / outside
   * press registration and no initial focus. Default false.
   */
  inline?: boolean
}

/**
 * M4 dialog. Mirrors `Dialog` (02d bDVhS): column, gap 14, padding 20, width 480, fill
 * bg-overlay, stroke 1 border, radius-xl, shadow 0 16 48 shadow-strong.
 * Head (U83ete, row, gap 12): Icon Wrap (nlNhT) 32 pill bg-muted, icon 16 text-primary · Text
 * (g9Ml9, column, gap 4, fill): Title (j7914) sans 14 / 600, Desc (QTzCg) sans 12
 * text-secondary, line-height 1.45. Body (z3U95) slot. Footer (zI9zf, row, gap 8, center):
 * Footnote · Spacer · Tertiary + Cancel (Button/Ghost h 30, padding [0, 12], label 12) ·
 * Confirm (Button/Primary h 30, padding [0, 14], label 12).
 * `role="dialog"`, focus trapped (starts on Cancel), Escape / outside press = Cancel.
 */
export function Dialog({
  icon,
  tone = "neutral",
  title,
  description,
  children,
  footnote,
  footnoteMono = false,
  tertiary,
  cancelLabel = "Cancel",
  confirmLabel,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  width,
  size,
  inline = false,
  className,
  style,
  onKeyDown,
  ref,
  ...rest
}: DialogProps) {
  const titleId = useId()
  const descId = useId()
  const root = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const trap = useFocusTrap(root, inline ? "none" : cancelLabel === null ? confirm : cancel)
  useDismiss(root, onCancel, undefined, !inline)
  return (
    <div
      role="dialog"
      aria-modal={inline ? undefined : "true"}
      aria-labelledby={titleId}
      aria-describedby={descId}
      {...rest}
      ref={mergeRefs(root, ref)}
      className={cx(
        "kimo-dialog",
        tone === "danger" && "kimo-dialog--danger",
        tone === "success" && "kimo-dialog--success",
        className,
      )}
      style={
        width !== undefined
          ? { width, ...style }
          : size !== undefined
            ? { width: DIALOG_WIDTH[size], ...style }
            : style
      }
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
          return
        }
        trap(e)
      }}
    >
      <div className="kimo-dialog__head">
        <span className="kimo-dialog__icon-wrap" aria-hidden="true">
          {icon}
        </span>
        <div className="kimo-dialog__text">
          <h2 id={titleId} className="kimo-dialog__title">
            {title}
          </h2>
          <p id={descId} className="kimo-dialog__desc">
            {description}
          </p>
        </div>
      </div>
      {children}
      <div className="kimo-dialog__footer">
        {footnote != null && (
          <span
            className={cx("kimo-dialog__footnote", footnoteMono && "kimo-dialog__footnote--mono")}
          >
            {footnote}
          </span>
        )}
        <span className="kimo-dialog__spacer" aria-hidden="true" />
        {tertiary && (
          <Button variant="ghost" className="kimo-dialog__button" onClick={tertiary.onClick}>
            {tertiary.label}
          </Button>
        )}
        {cancelLabel !== null && (
          <Button ref={cancel} variant="ghost" className="kimo-dialog__button" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button
          ref={confirm}
          variant="primary"
          className="kimo-dialog__button kimo-dialog__button--confirm"
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}

/** Fixed full-window scrim centering a modal {@link Dialog} (board 15 confirm scrim). */
export function DialogScrim({ children, className, ...rest }: ComponentPropsWithRef<"div">) {
  return (
    <div {...rest} className={cx("kimo-dialog-scrim", className)}>
      {children}
    </div>
  )
}
