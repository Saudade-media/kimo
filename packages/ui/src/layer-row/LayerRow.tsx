import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, LockOpen } from "lucide-react"
import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { cx } from "../internal/util"

/** Left padding of a depth-0 row and the extra indent per level (board 03 Layer Tree: 8, 22, 36). */
export const LAYER_ROW_PADDING = 8
export const LAYER_ROW_INDENT = 14

/** Props for {@link LayerRow}. Remaining `<div>` props go to the row. */
export interface LayerRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  name: string
  /** 14 × 14 type icon (lucide `frame`, `type`, `image`, `component`, …). */
  icon: ReactNode
  /** Nesting depth (0 = root). Indent = 8 + 14 × depth. */
  depth?: number
  /** Disclosure state; `undefined` = leaf (the disclosure keeps its 12px slot, transparent). */
  expanded?: boolean
  onToggleExpanded?: () => void
  /** `LayerRow/Selected`: accent-soft fill, accent-text icon/name/affordances, name 500. */
  selected?: boolean
  /** Name weight 500 (top-level frames and components in board 03). */
  emphasized?: boolean
  /** Type icon in accent-text (components and instances in board 03). */
  accentIcon?: boolean
  /** Layer visibility. Hidden rows keep the eye-off affordance visible. Default true. */
  visible?: boolean
  onToggleVisible?: () => void
  /** Layer lock. Locked rows keep the lock affordance visible. Default false. */
  locked?: boolean
  onToggleLocked?: () => void
  /** Enables rename on double-click / F2: Enter or blur commits, Escape cancels. */
  onRename?: (name: string) => void
}

/**
 * Layer tree row. Mirrors `LayerRow` (GXnBT) / `LayerRow/Selected` (dArBD): fill_container × 28,
 * radius-sm, gap 6, padding [0, 8]; disclosure 12 text-tertiary; type icon 14 text-tertiary;
 * name sans 12 text-primary; spacer; visibility eye 14 text-tertiary (shown on hover, focus,
 * selection, or when hidden), preceded by a lock affordance (hover or when locked).
 * Exposes `role="treeitem"`; the host owns the `role="tree"` container and focus.
 */
export function LayerRow({
  name,
  icon,
  depth = 0,
  expanded,
  onToggleExpanded,
  selected = false,
  emphasized = false,
  accentIcon = false,
  visible = true,
  onToggleVisible,
  locked = false,
  onToggleLocked,
  onRename,
  className,
  style,
  onDoubleClick,
  onKeyDown,
  ...rest
}: LayerRowProps) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(name)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) input.current?.select()
  }, [renaming])

  const startRename = () => {
    if (!onRename) return
    setDraft(name)
    setRenaming(true)
  }
  const finishRename = (commit: boolean) => {
    setRenaming(false)
    const next = draft.trim()
    if (commit && next && next !== name) onRename?.(next)
  }

  const leaf = expanded === undefined

  return (
    <div
      tabIndex={-1}
      {...rest}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={leaf ? undefined : expanded}
      data-hidden={!visible || undefined}
      data-locked={locked || undefined}
      className={cx(
        "kimo-layer-row",
        selected && "kimo-layer-row--selected",
        !visible && "kimo-layer-row--hidden",
        className,
      )}
      style={{ paddingLeft: LAYER_ROW_PADDING + LAYER_ROW_INDENT * depth, ...style }}
      onDoubleClick={(e) => {
        onDoubleClick?.(e)
        if (!e.defaultPrevented && !(e.target as HTMLElement).closest("button")) startRename()
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e)
        if (!e.defaultPrevented && e.key === "F2" && !renaming) {
          e.preventDefault()
          startRename()
        }
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        className={cx("kimo-layer-row__disclosure", leaf && "kimo-layer-row__disclosure--leaf")}
        aria-label={leaf ? undefined : expanded ? "Collapse" : "Expand"}
        aria-hidden={leaf || undefined}
        disabled={leaf}
        onClick={(e) => {
          e.stopPropagation()
          onToggleExpanded?.()
        }}
      >
        {expanded === false ? <ChevronRight /> : <ChevronDown />}
      </button>
      <span
        className={cx("kimo-layer-row__icon", accentIcon && "kimo-layer-row__icon--accent")}
        aria-hidden="true"
      >
        {icon}
      </span>
      {renaming ? (
        <input
          ref={input}
          className="kimo-layer-row__input"
          aria-label="Layer name"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => finishRename(true)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter") finishRename(true)
            else if (e.key === "Escape") finishRename(false)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className={cx("kimo-layer-row__name", emphasized && "kimo-layer-row__name--emphasized")}
        >
          {name}
        </span>
      )}
      <span className="kimo-layer-row__spacer" aria-hidden="true" />
      {onToggleLocked && (
        <button
          type="button"
          tabIndex={-1}
          className={cx(
            "kimo-layer-row__affordance",
            "kimo-layer-row__lock",
            locked && "kimo-layer-row__affordance--on",
          )}
          aria-label={locked ? "Unlock layer" : "Lock layer"}
          aria-pressed={locked}
          onClick={(e) => {
            e.stopPropagation()
            onToggleLocked()
          }}
        >
          {locked ? <Lock /> : <LockOpen />}
        </button>
      )}
      <button
        type="button"
        tabIndex={-1}
        className={cx(
          "kimo-layer-row__affordance",
          "kimo-layer-row__visibility",
          !visible && "kimo-layer-row__affordance--on",
        )}
        aria-label={visible ? "Hide layer" : "Show layer"}
        aria-pressed={!visible}
        onClick={(e) => {
          e.stopPropagation()
          onToggleVisible?.()
        }}
      >
        {visible ? <Eye /> : <EyeOff />}
      </button>
    </div>
  )
}
