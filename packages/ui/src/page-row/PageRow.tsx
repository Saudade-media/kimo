import { Check, Ellipsis } from "lucide-react"
import { type ComponentPropsWithRef, type KeyboardEvent, useEffect, useRef, useState } from "react"
import { cx } from "../internal/util"

/** Props for {@link PageRow}. Remaining `<div>` props go to the row. */
export interface PageRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  name: string
  /** `PageRow/Current` (JMKMB): check shown, name 500, bg-hover. */
  current?: boolean
  /** Optional mono layer count (Count, hidden in the component). */
  count?: number | string
  /** Inline rename ("PageRow · Renaming" LmnKt): controlled by the host. */
  renaming?: boolean
  /** Enter / blur commit (an empty or unchanged name reverts: `onRename` is not called). */
  onRename?: (name: string) => void
  /** Escape, or a commit that reverts. */
  onRenameEnd?: () => void
  /** The ⋯ shown on hover (page menu). */
  onMenu?: (anchor: HTMLElement) => void
}

/**
 * Pages strip row. Mirrors `PageRow` (w38uQ) / `PageRow/Current` (JMKMB): fill_container × 28,
 * radius-sm, gap 6, padding [0, 8], alignItems center: Check Slot (14 × 14, centered; lucide
 * `check` 14 text-primary, current only) · Name sans text-sm text-primary (current 500) ·
 * Spacer · Count (mono text-xs text-tertiary, optional). Current: bg-hover.
 * Renaming (LmnKt): padding [0, 4, 0, 8]; the name becomes the Rename Input (fill_container × 24,
 * padding [0, 6], bg-app, 1.5 $selection stroke, radius-xs, value sans text-sm).
 */
export function PageRow({
  name,
  current = false,
  count,
  renaming = false,
  onRename,
  onRenameEnd,
  onMenu,
  className,
  ...rest
}: PageRowProps) {
  const [draft, setDraft] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    if (!renaming) return
    done.current = false
    setDraft(name)
    requestAnimationFrame(() => input.current?.select())
  }, [renaming, name])
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    const next = draft.trim()
    if (commit && next && next !== name) onRename?.(next)
    onRenameEnd?.()
  }
  return (
    <div
      role="option"
      aria-selected={current}
      tabIndex={-1}
      {...rest}
      className={cx(
        "kimo-page-row",
        current && "kimo-page-row--current",
        renaming && "kimo-page-row--renaming",
        className,
      )}
    >
      <span className="kimo-page-row__check" aria-hidden="true">
        {current && !renaming && <Check />}
      </span>
      {renaming ? (
        <span className="kimo-page-row__rename">
          <input
            ref={input}
            className="kimo-page-row__input"
            aria-label="Page name"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              e.stopPropagation()
              if (e.key === "Enter") finish(true)
              else if (e.key === "Escape") finish(false)
            }}
          />
        </span>
      ) : (
        <span className="kimo-page-row__name">{name}</span>
      )}
      {!renaming && <span className="kimo-page-row__spacer" aria-hidden="true" />}
      {!renaming && count !== undefined && <span className="kimo-page-row__count">{count}</span>}
      {!renaming && onMenu && (
        <button
          type="button"
          tabIndex={-1}
          className="kimo-page-row__menu"
          aria-label={`Page menu: ${name}`}
          onClick={(e) => {
            e.stopPropagation()
            onMenu(e.currentTarget)
          }}
        >
          <Ellipsis />
        </button>
      )}
    </div>
  )
}
