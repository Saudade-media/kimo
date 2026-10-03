/**
 * App-local pieces of the M3 panels that `@kimo/ui` does not provide as such: IconButton /
 * Button instances at the design's per-instance sizes, the selection-header Kind pill (Badge
 * `jrIWa` with `component-soft`) and the Slot section's suggested row. Every other M3 leaf
 * (LayerRowM3, OverrideDot, AssetTile/Row, InstancePropRow, PropDefRow, ThemePinRow, VarCell,
 * EntryRow, VariableListRow, LibraryRow, StatusPill, ConfirmDialog…) comes from `@kimo/ui`.
 * Styles: `m3.css`.
 */
import type { CSSProperties, DragEvent, ReactNode } from "react"
import { Icon } from "../../lib/icons"

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ")

/** IconButton (`ZMxjt`) at an explicit size with a transparent fill (design instances 20/24/28). */
export function M3IconButton({
  icon,
  label,
  size = 24,
  iconSize = 14,
  className,
  onClick,
  disabled,
  style,
  ...rest
}: {
  icon: string
  label: string
  size?: number
  iconSize?: number
  className?: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  style?: CSSProperties
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      {...rest}
      className={cx("m3-icon-button", className)}
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{ width: size, height: size, ...style }}
      onClick={onClick}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  )
}

/** Button/Secondary (`kv3Fk`) / Ghost (`sqJv4`) / Primary (`W2lra`) at a design size. */
export function M3Button({
  variant = "secondary",
  icon,
  iconSize = 14,
  children,
  className,
  ref,
  ...rest
}: {
  variant?: "secondary" | "ghost" | "primary" | "danger"
  icon?: string
  iconSize?: number
  children?: ReactNode
  ref?: React.Ref<HTMLButtonElement>
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      ref={ref}
      {...rest}
      className={cx("m3-button", `m3-button--${variant}`, className)}
    >
      {icon && (
        <span className="m3-button__icon" style={{ width: iconSize, height: iconSize }}>
          <Icon name={icon} size={iconSize} />
        </span>
      )}
      {children != null && <span className="m3-button__label">{children}</span>}
    </button>
  )
}

/** Selection header Kind pill (Badge `jrIWa` with `component-soft` / derived `bg-muted`). */
export function KindPill({ label, derived }: { label: string; derived?: boolean }) {
  return (
    <span className={cx("m3-kind-pill", derived && "m3-kind-pill--derived")}>
      <span className="m3-kind-pill__label">{label}</span>
    </span>
  )
}

/**
 * Suggested row (board 12 Slot section `VpoFv`): an AssetRow (`h6gLx`) whose Meta is a Remove
 * IconButton 20 (`x` 12) — @kimo/ui AssetRow has no trailing slot, so this one stays local.
 */
export function SuggestedRow({
  name,
  meta,
  selected,
  trailing,
  indent,
  onSelect,
  onDragStart,
  onDragEnd,
  className,
}: {
  name: string
  meta?: string
  selected?: boolean
  /** Replaces Meta (Suggested list: Remove button). */
  trailing?: ReactNode
  /** Left padding override (library rows 26, suggested 8). */
  indent?: number
  onSelect?: () => void
  onDragStart?: (e: DragEvent) => void
  onDragEnd?: (e: DragEvent) => void
  className?: string
}) {
  return (
    <div
      className={cx("m3-asset-row", selected && "m3-asset-row--selected", className)}
      role="option"
      aria-selected={!!selected}
      tabIndex={-1}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect?.()
        }
      }}
      data-asset={name}
      style={indent === undefined ? undefined : { paddingLeft: indent }}
    >
      <span className="m3-asset-row__glyph">
        <Icon name="component" size={14} />
      </span>
      <span className="m3-asset-row__name">{name}</span>
      <span className="m3-asset-row__spacer" />
      {trailing ??
        (selected ? (
          <span className="m3-asset-row__check">
            <Icon name="check" size={14} />
          </span>
        ) : (
          <span className="m3-asset-row__meta">{meta ?? ""}</span>
        ))}
    </div>
  )
}
