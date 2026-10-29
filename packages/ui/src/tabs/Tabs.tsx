import { type ComponentPropsWithRef, type KeyboardEvent, useRef } from "react"
import { cx } from "../internal/util"

/** A 6 px dot after a tab's label (board 48 §5: the Agent tab while an agent works or waits). */
export interface TabDot {
  /** CSS color: `var(--kimo-agent)`, `var(--kimo-warning)`. */
  color: string
  /** What it means, for assistive tech: "Agent working". */
  label: string
}

/** Props for {@link Tab}. Native `<button>` props pass through. */
export interface TabProps extends ComponentPropsWithRef<"button"> {
  /** `Tab/Active`: bg-muted fill, label text-primary 600. */
  active?: boolean
  /** Board 48 §5 Tab · Agent (4dafLeX6R7): row gap 6, center › Label, Dot 6 × 6. */
  dot?: TabDot
}

/**
 * One tab. Mirrors `Tab` (GfneW) / `Tab/Active` (P3e7Mp): radius-pill, padding [5, 12];
 * label sans 12 / 500 text-secondary; active fill bg-muted, label 600 text-primary.
 */
export function Tab({
  active = false,
  dot,
  className,
  children,
  type = "button",
  ...rest
}: TabProps) {
  return (
    <button
      tabIndex={active ? 0 : -1}
      {...rest}
      type={type}
      role="tab"
      aria-selected={active}
      className={cx("kimo-tab", active && "kimo-tab--active", className)}
    >
      <span className="kimo-tab__label">{children}</span>
      {dot && (
        <span
          className="kimo-tab__dot"
          role="img"
          aria-label={dot.label}
          style={{ background: dot.color }}
        />
      )}
    </button>
  )
}

/** One entry of {@link Tabs}. */
export interface TabsItem<V extends string = string> {
  value: V
  label: string
  /** id of the controlled tab panel (sets `aria-controls`). */
  panelId?: string
  /** A dot after the label. */
  dot?: TabDot
}

/** Props for {@link Tabs}. Remaining `<div>` props go to the tablist. */
export interface TabsProps<V extends string = string>
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "children"> {
  items: readonly TabsItem<V>[]
  value: V
  onChange?: (value: V) => void
  /** Accessible name of the tablist. */
  label: string
}

/**
 * Tab strip. Mirrors the board 03 panel "Tabs" frames (Qlofe, f4IxO): horizontal, gap 2,
 * padding [8, 8, 4, 8], alignItems center, children Tab / Tab/Active instances.
 * ←/→ move and activate (automatic activation), Home/End jump.
 */
export function Tabs<V extends string = string>({
  items,
  value,
  onChange,
  label,
  className,
  ...rest
}: TabsProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = items.length
    let next = -1
    if (e.key === "ArrowRight") next = (i + 1) % n
    else if (e.key === "ArrowLeft") next = (i - 1 + n) % n
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = n - 1
    const item = items[next]
    if (!item) return
    e.preventDefault()
    refs.current[next]?.focus()
    if (item.value !== value) onChange?.(item.value)
  }
  return (
    <div {...rest} role="tablist" aria-label={label} className={cx("kimo-tabs", className)}>
      {items.map((item, i) => (
        <Tab
          key={item.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          active={item.value === value}
          aria-controls={item.panelId}
          {...(item.dot ? { dot: item.dot } : {})}
          onClick={() => item.value !== value && onChange?.(item.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {item.label}
        </Tab>
      ))}
    </div>
  )
}
