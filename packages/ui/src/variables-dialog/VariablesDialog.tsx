import { Braces, Info, Plus, Search, X } from "lucide-react"
import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
} from "react"
import { Button } from "../button/Button"
import { IconButton } from "../icon-button/IconButton"
import { Input } from "../input/Input"
import { cx, mergeRefs } from "../internal/util"
import { useDismiss, useFocusTrap } from "../popover/usePopover"
import { AxisGroupHeader, ModeColumnHeader } from "../variable-row/VariableRow"

/** Type filter of the toolbar (Type Filter `GHEjw`). */
export type VariableTypeFilter = "all" | "color" | "number" | "string" | "boolean"

const FILTERS: readonly { value: VariableTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "color", label: "Color" },
  { value: "number", label: "Number" },
  { value: "string", label: "String" },
  { value: "boolean", label: "Boolean" },
]

/** One theme axis as table columns (axes in `axisDisplayOrder`, values in axis order). */
export interface VariablesAxis {
  axis: string
  /** 12px header icon; default `layers-2`. */
  icon?: ReactNode
  values: readonly string[]
  /** Column Menu for one value (Make default, Rename, Duplicate, Delete). */
  onValueMenu?: (value: string, anchor: HTMLElement) => void
}

/** Props for {@link VariablesDialog}. Remaining `<div>` props go to the dialog frame. */
export interface VariablesDialogProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "title"> {
  /**
   * Rendered in place (a gallery / docs specimen), not as an open modal: it does not register
   * the global Escape / outside-press dismissal and does not take focus on mount, so several
   * specimens on one page do not steal each other's keys. Default false.
   */
  inline?: boolean
  /** "Marketing site · 14 variables · 2 theme axes · 3 libraries". */
  description: string
  onClose: () => void
  /** Sidebar content: VariablesNavSection / VariablesNavItem / an "Add axis" button. */
  sidebar: ReactNode
  query: string
  onQueryChange: (query: string) => void
  typeFilter: VariableTypeFilter
  onTypeFilterChange: (filter: VariableTypeFilter) => void
  /** "New variable" → New variable Menu anchored to the button. */
  onNewVariable: (anchor: HTMLElement) => void
  axes: readonly VariablesAxis[]
  /** Name column width (216 in the dialog). */
  nameWidth?: number
  /** VariableRows (nameWidth 216) and open VariableEntries blocks, in display order. */
  children: ReactNode
  onExport?: () => void
  onDone?: () => void
}

/**
 * Variables dialog (board 14 `EIkIk`, ⌥⇧⌘V): 1040 × 780, clip, fill bg-app, radius-2xl, shadows
 * 0 2 6 shadow + 0 24 64 shadow-strong, column.
 * Header (DaqRQ: stroke bottom 1 border, row, gap 12, padding [20, 20, 16, 24], center): Titles
 * (column, gap 4, fill: Title sans 20 / 500 letterSpacing -0.3; Desc sans 13 text-secondary) ·
 * Close (IconButton 32, pill, bg-muted, `x`). Body (p7LkYF) row, fill: Sidebar (M1fgkY 184,
 * bg-subtle, stroke right 1 border, column, gap 1, padding [4, 8, 12, 8]) · Main (Q2yzle fill,
 * column): Toolbar (zAPZ1 row, gap 8, padding [12, 16], center: Search Input 220 × 30 · Type
 * Filter · Spacer · Button/Primary "New variable" h 30, padding [0, 12], `plus` 14, label 12) ·
 * Table (sWH4c fill, column, padding [0, 8, 0, 0]: Axis Row h 24 (Pad 216 + AxisGroupHeaders)
 * and Column Row h 32 (stroke bottom; Name Header 216 + ModeColumnHeaders) stay sticky while
 * the rows scroll) · Footer (BVIIs stroke top 1 border, row, gap 8, padding [12, 16], center:
 * `info` 14 · note sans 11 text-tertiary · Spacer · Button/Secondary "Export DTCG" (`braces`
 * 14) h 30 padding [0, 12] · Button/Primary "Done" h 30 padding [0, 14]).
 * `role="dialog"`, focus trapped, Escape closes.
 */
export function VariablesDialog({
  description,
  onClose,
  sidebar,
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  onNewVariable,
  axes,
  nameWidth = 216,
  children,
  onExport,
  onDone,
  className,
  onKeyDown,
  ref,
  inline = false,
  ...rest
}: VariablesDialogProps) {
  const root = useRef<HTMLDivElement>(null)
  const trap = useFocusTrap(root, inline ? "none" : "first")
  // Registers as a surface: Escape and a click on the scrim close; menus opened from it stay on top.
  useDismiss(root, onClose, undefined, !inline)
  const titleId = useId()
  const descId = useId()
  const segs = useRef<(HTMLButtonElement | null)[]>([])

  const onFilterKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0
    if (!d) return
    e.preventDefault()
    const next = (i + d + FILTERS.length) % FILTERS.length
    const f = FILTERS[next]
    if (!f) return
    onTypeFilterChange(f.value)
    segs.current[next]?.focus()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={-1}
      {...rest}
      ref={mergeRefs(root, ref)}
      className={cx("kimo-variables-dialog", className)}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          return
        }
        trap(e)
      }}
    >
      <div className="kimo-variables-dialog__header">
        <div className="kimo-variables-dialog__titles">
          <h2 id={titleId} className="kimo-variables-dialog__title">
            Variables
          </h2>
          <p id={descId} className="kimo-variables-dialog__desc">
            {description}
          </p>
        </div>
        <IconButton
          className="kimo-variables-dialog__close"
          label="Close"
          icon={<X />}
          onClick={onClose}
        />
      </div>
      <div className="kimo-variables-dialog__body">
        <nav className="kimo-variables-dialog__sidebar" aria-label="Variable groups">
          {sidebar}
        </nav>
        <div className="kimo-variables-dialog__main">
          <div className="kimo-variables-dialog__toolbar">
            <Input
              icon={<Search />}
              placeholder="Search variables"
              aria-label="Search variables"
              value={query}
              onChange={(e) => onQueryChange(e.currentTarget.value)}
              frameProps={{ className: "kimo-variables-dialog__search" }}
            />
            <div className="kimo-variables-dialog__filter" role="radiogroup" aria-label="Type">
              {FILTERS.map((f, i) => (
                // biome-ignore lint/a11y/useSemanticElements: APG radio group pattern with buttons.
                <button
                  key={f.value}
                  ref={(el) => {
                    segs.current[i] = el
                  }}
                  type="button"
                  role="radio"
                  aria-checked={typeFilter === f.value}
                  tabIndex={typeFilter === f.value ? 0 : -1}
                  className={cx(
                    "kimo-variables-dialog__seg",
                    typeFilter === f.value && "kimo-variables-dialog__seg--active",
                  )}
                  onClick={() => onTypeFilterChange(f.value)}
                  onKeyDown={(e) => onFilterKey(e, i)}
                >
                  <span className="kimo-variables-dialog__seg-label">{f.label}</span>
                </button>
              ))}
            </div>
            <span className="kimo-variables-dialog__spacer" aria-hidden="true" />
            <Button
              variant="primary"
              className="kimo-variables-dialog__new"
              icon={<Plus />}
              aria-haspopup="menu"
              onClick={(e) => onNewVariable(e.currentTarget)}
            >
              New variable
            </Button>
          </div>
          <div className="kimo-variables-dialog__table">
            <div className="kimo-variables-dialog__axis-row">
              <span className="kimo-variables-dialog__pad" style={{ width: nameWidth }} />
              {axes.map((a) => (
                <AxisGroupHeader key={a.axis} axis={a.axis} count={a.values.length} icon={a.icon} />
              ))}
            </div>
            <div className="kimo-variables-dialog__column-row">
              <div className="kimo-variables-dialog__name-header" style={{ width: nameWidth }}>
                <span className="kimo-variables-dialog__name-label">Name</span>
              </div>
              {axes.flatMap((a) =>
                a.values.map((v, i) => (
                  <ModeColumnHeader
                    key={`${a.axis}=${v}`}
                    value={v}
                    isDefault={i === 0}
                    onMenu={a.onValueMenu ? (anchor) => a.onValueMenu?.(v, anchor) : undefined}
                  />
                )),
              )}
            </div>
            {children}
          </div>
          <div className="kimo-variables-dialog__footer">
            <Info className="kimo-variables-dialog__info" aria-hidden="true" />
            <span className="kimo-variables-dialog__note">
              Last matching entry wins · — means no entry for that axis (falls back)
            </span>
            <span className="kimo-variables-dialog__spacer" aria-hidden="true" />
            <Button
              variant="secondary"
              className="kimo-variables-dialog__export"
              icon={<Braces />}
              onClick={onExport}
            >
              Export DTCG
            </Button>
            <Button
              variant="primary"
              className="kimo-variables-dialog__done"
              onClick={onDone ?? onClose}
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Props for {@link VariablesNavSection}. */
export interface VariablesNavSectionProps extends ComponentPropsWithRef<"div"> {
  title: string
}

/** Sidebar section title (`uGSO4`): fill, padding [12, 8, 4, 8]; sans 11 / 600 text-tertiary. */
export function VariablesNavSection({ title, className, ...rest }: VariablesNavSectionProps) {
  return (
    <div {...rest} className={cx("kimo-variables-nav-section", className)}>
      <span className="kimo-variables-nav-section__title">{title}</span>
    </div>
  )
}

/** Props for {@link VariablesNavItem}. Native `<button>` props pass through. */
export interface VariablesNavItemProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** 14px icon: `layers` (All), `folder` (group), `sun-moon` / `rows-3` (axis), `lock` (library). */
  icon: ReactNode
  label: string
  count?: string | number
  /** Group / axis / library names are mono 11; "All" is sans 12. Default true. */
  mono?: boolean
  /** Current filter (`btGbF`): fill accent-soft. */
  selected?: boolean
  /** Hovered group look (`uuVsY`): icon text-primary, label 500. */
  emphasized?: boolean
  /** Missing library (`Urjz1`): label text-tertiary, count danger. */
  missing?: boolean
}

/**
 * Sidebar row (`btGbF` …): fill × 28, radius-sm, row, gap 8, padding [0, 8], center. Icon 14
 * text-tertiary · Label (mono 11 / sans 12) text-primary · Spacer · Count mono 11 text-tertiary.
 */
export function VariablesNavItem({
  icon,
  label,
  count,
  mono = true,
  selected = false,
  emphasized = false,
  missing = false,
  className,
  type = "button",
  ...rest
}: VariablesNavItemProps) {
  return (
    <button
      aria-current={selected || undefined}
      {...rest}
      type={type}
      className={cx(
        "kimo-variables-nav-item",
        selected && "kimo-variables-nav-item--selected",
        emphasized && "kimo-variables-nav-item--emphasized",
        missing && "kimo-variables-nav-item--missing",
        className,
      )}
    >
      <span className="kimo-variables-nav-item__icon" aria-hidden="true">
        {icon}
      </span>
      <span
        className={cx(
          "kimo-variables-nav-item__label",
          mono && "kimo-variables-nav-item__label--mono",
        )}
      >
        {label}
      </span>
      <span className="kimo-variables-nav-item__spacer" aria-hidden="true" />
      {count !== undefined && <span className="kimo-variables-nav-item__count">{count}</span>}
    </button>
  )
}

/** Sidebar "Add axis" (`G0u7wN`): Button/Ghost h 28, padding [0, 8], `plus` 14, label 12. */
export function VariablesNavAddButton({
  children = "Add axis",
  className,
  ...rest
}: Omit<ComponentPropsWithRef<"button">, "type">) {
  return (
    <Button
      {...rest}
      variant="ghost"
      icon={<Plus />}
      className={cx("kimo-variables-nav-add", className)}
    >
      {children}
    </Button>
  )
}
