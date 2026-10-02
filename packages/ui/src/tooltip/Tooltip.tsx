import {
  type ComponentPropsWithRef,
  cloneElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { cx } from "../internal/util"

/** Props for {@link TooltipContent}. Remaining `<div>` props go to the frame. */
export interface TooltipContentProps extends ComponentPropsWithRef<"div"> {
  /** Shortcut shown in the key chip (`F`, `⌘K`). */
  shortcut?: string
}

/**
 * The tooltip bubble. Mirrors `Tooltip` (xbtkW): fill text-primary, radius-sm, shadow 0 4 12
 * shadow, gap 8, padding [5, 6, 5, 8], alignItems center; label sans 12 / 500 text-inverse;
 * Key chip fill #FFFFFF26, radius 3, padding [0, 4], keys mono 11 text-inverse.
 */
export function TooltipContent({ shortcut, className, children, ...rest }: TooltipContentProps) {
  return (
    <div role="tooltip" {...rest} className={cx("kimo-tooltip", className)}>
      <span className="kimo-tooltip__label">{children}</span>
      {shortcut != null && (
        <span className="kimo-tooltip__key">
          <span className="kimo-tooltip__keys">{shortcut}</span>
        </span>
      )}
    </div>
  )
}

/** Props for {@link Tooltip}. */
export interface TooltipProps {
  label: ReactNode
  shortcut?: string
  /** The trigger: a single element that accepts `aria-describedby`. */
  children: ReactElement<{ "aria-describedby"?: string; [prop: string]: unknown }>
  /** Side of the trigger. Default `"bottom"`. */
  side?: "top" | "bottom" | "left" | "right"
  /** Hover delay in ms (focus shows immediately). Default 500. */
  delay?: number
}

/**
 * Hover/focus tooltip around a trigger. Shows after `delay` on pointer hover, immediately on
 * keyboard focus; hides on leave, blur, or Escape. Positioned 6px off the trigger.
 */
export function Tooltip({ label, shortcut, children, side = "bottom", delay = 500 }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clear = () => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
    },
    [],
  )
  const hide = () => {
    clear()
    setOpen(false)
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: delegates hover/focus of the trigger child.
    <span
      className="kimo-tooltip-anchor"
      onPointerEnter={() => {
        clear()
        timer.current = setTimeout(() => setOpen(true), delay)
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(":focus-visible")) setOpen(true)
      }}
      onBlur={hide}
      onKeyDown={(e) => e.key === "Escape" && hide()}
    >
      {cloneElement(children, { "aria-describedby": open ? id : undefined })}
      {open && (
        <TooltipContent
          id={id}
          shortcut={shortcut}
          className={`kimo-tooltip--floating kimo-tooltip--${side}`}
        >
          {label}
        </TooltipContent>
      )}
    </span>
  )
}
