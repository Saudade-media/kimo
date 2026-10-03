import { type ComponentPropsWithRef, type ReactNode, useId, useRef } from "react"
import { Button } from "../button/Button"
import { cx, mergeRefs } from "../internal/util"
import { useDismiss, useFocusTrap } from "../popover/usePopover"

/** One impact line (icon 14 + text xs text-secondary). */
export interface ConfirmImpact {
  icon: ReactNode
  /** Icon color: `component` (violet identity) or `tertiary` (default). */
  tone?: "component" | "tertiary"
  text: ReactNode
}

/** Props for {@link ConfirmDialog}. Remaining `<div>` props go to the dialog frame. */
export interface ConfirmDialogProps
  extends Omit<ComponentPropsWithRef<"div">, "title" | "children"> {
  /**
   * Rendered in place (a gallery / docs specimen), not as an open modal: it does not register
   * the global Escape / outside-press dismissal and does not take focus on mount, so several
   * specimens on one page do not steal each other's keys. Default false.
   */
  inline?: boolean
  /** `component`: component-soft wrap + component icon, accent Confirm (Detach). `danger`:
   * danger-soft wrap + danger icon, danger Confirm with a #FFFFFF label (slot off, unlink). */
  tone: "component" | "danger"
  /** 16px head icon (`unlink`, `square-dashed`). */
  icon: ReactNode
  title: string
  description: ReactNode
  impact?: readonly ConfirmImpact[]
  confirmLabel: string
  cancelLabel?: string
  onConfirm: (opts: { dontAskAgain: boolean }) => void
  onCancel: () => void
  /** Shows the "Don't ask again" checkbox (Detach, `VP63n`). */
  dontAskAgain?: boolean
  onDontAskAgainChange?: (value: boolean) => void
  /** Checkbox state when controlled by the host. */
  dontAskAgainChecked?: boolean
}

/**
 * Confirmation dialog (board 15 Confirms: Detach `i8PfIC`, Remove Slot `ysXyK`, Unlink
 * `fmB2B`). Column, gap 14, padding 20, fill bg-overlay, stroke 1 border, radius-xl, shadow 0
 * 16 48 shadow-strong. Head (row, gap 12): Icon Wrap 32 pill (16px icon) · Text (column, gap
 * 4, fill: Title sans 14 / 600 text-primary, Desc sans 12 text-secondary, line-height 1.45).
 * Impact (column, gap 6, padding [10, 12], bg-subtle, radius-md): items row, gap 8, center (icon
 * 14 + text sans 11 text-secondary). Footer (row, gap 8, center): [Checkbox 14 radius 4, stroke
 * 1.5 border-strong + "Don't ask again" sans 11 text-secondary] · Spacer · Cancel (Button/Ghost
 * h 30, padding [0, 12], label 12) · Confirm (Button/Primary h 30, padding [0, 14], label 12).
 * `role="alertdialog"`; focus starts on Cancel, Escape cancels, Enter on Confirm confirms.
 */
export function ConfirmDialog({
  tone,
  icon,
  title,
  description,
  impact = [],
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  dontAskAgain = false,
  onDontAskAgainChange,
  dontAskAgainChecked,
  className,
  onKeyDown,
  ref,
  inline = false,
  ...rest
}: ConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const checkId = useId()
  const cancel = useRef<HTMLButtonElement>(null)
  const check = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const trap = useFocusTrap(root, inline ? "none" : cancel)
  // Registers as a surface: Escape and an outside click cancel, nested surfaces stay on top.
  useDismiss(root, onCancel, undefined, !inline)
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      {...rest}
      ref={mergeRefs(root, ref)}
      className={cx("kimo-confirm-dialog", `kimo-confirm-dialog--${tone}`, className)}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (!e.defaultPrevented && e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
          return
        }
        if (!e.defaultPrevented) trap(e)
      }}
    >
      <div className="kimo-confirm-dialog__head">
        <span className="kimo-confirm-dialog__icon-wrap" aria-hidden="true">
          {icon}
        </span>
        <div className="kimo-confirm-dialog__text">
          <h2 id={titleId} className="kimo-confirm-dialog__title">
            {title}
          </h2>
          <p id={descId} className="kimo-confirm-dialog__desc">
            {description}
          </p>
        </div>
      </div>
      {impact.length > 0 && (
        <ul className="kimo-confirm-dialog__impact">
          {impact.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list in display order
            <li key={i} className="kimo-confirm-dialog__item">
              <span
                className={cx(
                  "kimo-confirm-dialog__item-icon",
                  item.tone === "component" && "kimo-confirm-dialog__item-icon--component",
                )}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <span className="kimo-confirm-dialog__item-text">{item.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="kimo-confirm-dialog__footer">
        {dontAskAgain && (
          <>
            <input
              ref={check}
              id={checkId}
              type="checkbox"
              className="kimo-confirm-dialog__checkbox"
              checked={dontAskAgainChecked}
              onChange={(e) => onDontAskAgainChange?.(e.currentTarget.checked)}
            />
            <label htmlFor={checkId} className="kimo-confirm-dialog__check-label">
              Don't ask again
            </label>
          </>
        )}
        <span className="kimo-confirm-dialog__spacer" aria-hidden="true" />
        <Button
          ref={cancel}
          variant="ghost"
          className="kimo-confirm-dialog__cancel"
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
        <Button
          variant="primary"
          className="kimo-confirm-dialog__confirm"
          onClick={() => onConfirm({ dontAskAgain: check.current?.checked ?? false })}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
