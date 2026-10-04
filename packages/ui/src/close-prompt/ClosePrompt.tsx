import { FileQuestionMark } from "lucide-react"
import { type ComponentPropsWithRef, useId, useRef } from "react"
import { Button } from "../button/Button"
import { cx, mergeRefs } from "../internal/util"
import { useFocusTrap } from "../popover/usePopover"

/** Props for {@link ClosePrompt}. Remaining `<div>` props go to the dialog frame. */
export interface ClosePromptProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  /** "Untitled 3". */
  fileName: string
  /** Top-level frames in the document ("its 12 frames are gone for good"). */
  frames: number
  /** Save… (primary): opens the save panel. */
  onSave: () => void
  /** Don't save: discards the never-saved document. */
  onDiscard: () => void
  /** Cancel and Escape: keeps the window open. */
  onCancel: () => void
  /** Rendered in place (gallery / specimen): no initial focus. */
  inline?: boolean
}

/** "its 12 frames" / "its 1 frame" / "its contents" (no frames). */
export function closePromptLoss(frames: number): string {
  if (frames <= 0) return "its contents are"
  return `its ${frames} frame${frames === 1 ? " is" : "s are"}`
}

/**
 * Board 24 (i) "Untitled file · close prompt" (a3Y0Fb › Dialog · Close untitled n7Xrg): column,
 * gap 14, padding 20, bg-overlay, stroke 1 border, radius-xl, shadow 0 16 48 shadow-strong.
 *   Head (cjNpC) row, gap 12: Icon Wrap (J3qcm) 32 pill bg-muted › `file-question-mark` 16
 *     text-secondary · Text (wllgi) column, gap 4, fill: Title (K3Szup) sans 13 / 600
 *     text-primary; Desc (J0qBj) sans 12 text-secondary, lineHeight 1.45.
 *   Footer (Pr0X1) row, gap 8, center: Don't save (VYQpB, Button/Ghost h 28 [0, 10], label 12
 *     danger, left-aligned so Enter never hits it) · Spacer · Cancel (JCqPk, Button/Ghost) ·
 *     Save… (nUfbg, Button/Primary). Escape = Cancel; focus starts on Save….
 */
export function ClosePrompt({
  fileName,
  frames,
  onSave,
  onDiscard,
  onCancel,
  inline = false,
  className,
  onKeyDown,
  ref,
  ...rest
}: ClosePromptProps) {
  const titleId = useId()
  const descId = useId()
  const root = useRef<HTMLDivElement>(null)
  const save = useRef<HTMLButtonElement>(null)
  const trap = useFocusTrap(root, inline ? "none" : save)
  return (
    <div
      role="alertdialog"
      aria-modal={inline ? undefined : "true"}
      aria-labelledby={titleId}
      aria-describedby={descId}
      {...rest}
      ref={mergeRefs(root, ref)}
      className={cx("kimo-close-prompt", className)}
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
      <div className="kimo-close-prompt__head">
        <span className="kimo-close-prompt__icon-wrap" aria-hidden="true">
          <FileQuestionMark />
        </span>
        <div className="kimo-close-prompt__text">
          <h2 id={titleId} className="kimo-close-prompt__title">
            {`Save “${fileName}” before closing?`}
          </h2>
          <p id={descId} className="kimo-close-prompt__desc">
            {`This file has never been saved. If you don't save, ${closePromptLoss(frames)} gone for good.`}
          </p>
        </div>
      </div>
      <div className="kimo-close-prompt__footer">
        <Button
          variant="ghost"
          size="sm"
          className="kimo-close-prompt__button kimo-close-prompt__discard"
          onClick={onDiscard}
        >
          Don't save
        </Button>
        <span className="kimo-close-prompt__spacer" aria-hidden="true" />
        <Button variant="ghost" size="sm" className="kimo-close-prompt__button" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          ref={save}
          variant="primary"
          size="sm"
          className="kimo-close-prompt__button"
          onClick={onSave}
        >
          Save…
        </Button>
      </div>
    </div>
  )
}
