import {
  ChevronDown,
  ChevronRight,
  Component,
  Diamond,
  Eye,
  EyeOff,
  Replace,
  SquareDashed,
} from "lucide-react"
import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react"
import { cx } from "../internal/util"
import { LAYER_ROW_INDENT, LAYER_ROW_PADDING } from "../layer-row/LayerRow"
import { OverrideDot } from "../override-dot/OverrideDot"

/** Layers-panel row kinds of board 02c "Identity" (tqwgl). */
export type LayerKind = "component" | "instance" | "slot" | "replaced" | "derived"

/** Props for {@link LayerRowM3}. Remaining `<div>` props go to the row. */
export interface LayerRowM3Props
  extends Omit<ComponentPropsWithRef<"div">, "children" | "onSelect"> {
  kind: LayerKind
  name: string
  /** `derived`: base component name, shown as "from <from>" (x5xNG Origin). */
  from?: string
  /** Disclosure; `null`/`undefined` = no children (the 12px slot stays, transparent). */
  expanded?: boolean | null
  onToggle?: () => void
  /** `LayerRow/Component/Selected` (L3PiIW) / `LayerRow/Instance/Selected` (N3AA7R): component-soft. */
  selected?: boolean
  /** Shows the OverrideDot (`Override` slot, hidden by default; on for `replaced`). */
  overridden?: boolean
  /**
   * Board 27 §8 Kpf1o: the instance holds broken overrides — the Override slot shows the
   * warning dot (OverrideDot, Dot fill `warning`) instead of the override dot.
   */
  broken?: boolean
  /** Click on the dot (reset that entry). Without it the dot is decorative. */
  onResetOverride?: () => void
  /** Layer visibility; hidden rows keep the eye-off affordance. Default true. */
  visible?: boolean
  onToggleVisible?: () => void
  /** Nesting depth; indent = 8 + 14 × depth (the M1 LayerRow rule). */
  depth?: number
  onSelect?: (e: { shift: boolean; meta: boolean }) => void
  /** Double-click / F2 rename: Enter or blur commits, Escape cancels. */
  onRename?: (name: string) => void
}

const ICONS = {
  component: Component,
  derived: Component,
  instance: Diamond,
  slot: SquareDashed,
  replaced: Replace,
} as const

/**
 * Layer tree row for components and instances. Mirrors `LayerRow/Component` (ZcfUj),
 * `/Component/Selected` (L3PiIW), `/Instance` (oHsXi), `/Instance/Selected` (N3AA7R),
 * `/Slot` (lAFda), `/Replaced` (Uh0kH), `/Derived` (x5xNG): fill_container × 28, radius-sm,
 * row, gap 6, padding [0, 8], alignItems center; Disclosure 12 text-tertiary · Type Icon 14
 * component · Name sans 12 text-primary (500 for component / derived / selected instance) ·
 * [Slot Tag: padding [0, 4], stroke 1 component, radius-xs; mono 11 component] · Spacer (derived:
 * Origin, fill, justify end, "from …" sans 11 text-tertiary) · Override (OverrideDot) ·
 * Visibility (eye 14 text-tertiary; disabled in the design, so shown only on hover, focus or
 * when the layer is hidden).
 */
export function LayerRowM3({
  kind,
  name,
  from,
  expanded,
  onToggle,
  selected = false,
  overridden = kind === "replaced",
  broken = false,
  onResetOverride,
  visible = true,
  onToggleVisible,
  depth = 0,
  onSelect,
  onRename,
  className,
  style,
  onClick,
  onDoubleClick,
  onKeyDown,
  ...rest
}: LayerRowM3Props) {
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

  const leaf = expanded == null
  const Icon = ICONS[kind]
  const emphasized = kind === "component" || kind === "derived" || (kind === "instance" && selected)
  const tag = kind === "slot" ? "slot" : kind === "replaced" ? "replaced" : null

  return (
    <div
      tabIndex={-1}
      {...rest}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={leaf ? undefined : expanded}
      data-kind={kind}
      data-hidden={!visible || undefined}
      data-broken={broken || undefined}
      className={cx(
        "kimo-layer-row-m3",
        selected && "kimo-layer-row-m3--selected",
        !visible && "kimo-layer-row-m3--hidden",
        className,
      )}
      style={{ paddingLeft: LAYER_ROW_PADDING + LAYER_ROW_INDENT * depth, ...style }}
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        onClick?.(e)
        if (!e.defaultPrevented) onSelect?.({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
      }}
      onDoubleClick={(e) => {
        onDoubleClick?.(e)
        if (!e.defaultPrevented && !(e.target as HTMLElement).closest("button,[role=button]"))
          startRename()
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
        className={cx(
          "kimo-layer-row-m3__disclosure",
          leaf && "kimo-layer-row-m3__disclosure--leaf",
        )}
        aria-label={leaf ? undefined : expanded ? "Collapse" : "Expand"}
        aria-hidden={leaf || undefined}
        disabled={leaf}
        onClick={(e) => {
          e.stopPropagation()
          onToggle?.()
        }}
      >
        {expanded ? <ChevronDown /> : <ChevronRight />}
      </button>
      <span className="kimo-layer-row-m3__icon" aria-hidden="true">
        <Icon />
      </span>
      {renaming ? (
        <input
          ref={input}
          className="kimo-layer-row-m3__input"
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
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className={cx(
            "kimo-layer-row-m3__name",
            emphasized && "kimo-layer-row-m3__name--emphasized",
          )}
        >
          {name}
        </span>
      )}
      {tag && (
        <span className="kimo-layer-row-m3__tag">
          <span className="kimo-layer-row-m3__tag-label">{tag}</span>
        </span>
      )}
      {kind === "derived" ? (
        <span className="kimo-layer-row-m3__origin">
          <span className="kimo-layer-row-m3__from">{`from ${from}`}</span>
        </span>
      ) : (
        <span className="kimo-layer-row-m3__spacer" aria-hidden="true" />
      )}
      {broken ? (
        <OverrideDot
          tone="warning"
          className="kimo-layer-row-m3__broken"
          title="Broken overrides — review in the instance panel"
        />
      ) : (
        overridden && (
          <OverrideDot
            className="kimo-layer-row-m3__override"
            onReset={onResetOverride}
            title={onResetOverride ? undefined : "Overridden"}
          />
        )
      )}
      {onToggleVisible && (
        <button
          type="button"
          tabIndex={-1}
          className={cx(
            "kimo-layer-row-m3__visibility",
            !visible && "kimo-layer-row-m3__visibility--on",
          )}
          aria-label={visible ? "Hide layer" : "Show layer"}
          aria-pressed={!visible}
          onClick={(e) => {
            e.stopPropagation()
            onToggleVisible()
          }}
        >
          {visible ? <Eye /> : <EyeOff />}
        </button>
      )}
    </div>
  )
}
