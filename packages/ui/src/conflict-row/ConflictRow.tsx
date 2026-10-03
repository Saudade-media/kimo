import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  RotateCcw,
} from "lucide-react"
import type { ComponentPropsWithRef, MouseEvent } from "react"
import { Button } from "../button/Button"
import { ConflictChoice } from "../conflict-choice/ConflictChoice"
import { cx } from "../internal/util"

/** One side shown by a {@link ConflictRow}. */
export interface ConflictRowSide {
  value: string
  caption: string
  swatch?: string | null
}

/** The merge base of a conflict (board 20 `ConflictRow/Base/Open` d4P5H, Base HEuRD). */
export interface ConflictBase {
  /** "#FFF7EE", "8", "Legal · 600×24", "absent". */
  value: string
  swatch?: string | null
  /** Short commit of the merge base ("4e1a9c2"); omitted when unknown. */
  commit?: string | null
}

/** Props for {@link ConflictRow}. Remaining `<div>` props go to the row. */
export interface ConflictRowProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "onChange"> {
  /** Property label (mono): "fill", "content", "gap", "node", "parent", "$brand · light". */
  property: string
  /** Right-hand hint: "both changed", "deleted vs edited", "moved twice"; resolved: "kept ours". */
  hint: string
  ours: ConflictRowSide
  theirs: ConflictRowSide
  /** `ConflictRow/Resolved` (hZKbc): success check, and the applied side drawn selected. */
  resolved?: boolean
  /** The side the body holds when resolved ("ours" / "theirs"); anything else selects none. */
  applied?: string | null
  /** Picks a side (one undo step in the editor). */
  onChoose?: (side: "ours" | "theirs") => void
  /**
   * The merge base. When set, the head shows the "base ›" toggle (`ConflictRow/Base` b3xOtr);
   * {@link baseOpen} draws the mono base line under the head (`ConflictRow/Base/Open` d4P5H).
   */
  base?: ConflictBase | null
  baseOpen?: boolean
  onToggleBase?: () => void
}

/** "base ›" pill (Base Toggle g8H4tU / open ZmwPH). */
function BaseToggle({ open, onClick }: { open: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      className={cx(
        "kimo-conflict-row__base-toggle",
        open && "kimo-conflict-row__base-toggle--open",
      )}
      aria-expanded={open}
      aria-label={open ? "Hide base" : "Show base"}
      onClick={onClick}
    >
      <span className="kimo-conflict-row__base-toggle-label">base</span>
      {open ? (
        <ChevronDown className="kimo-conflict-row__base-toggle-chevron" aria-hidden="true" />
      ) : (
        <ChevronRight className="kimo-conflict-row__base-toggle-chevron" aria-hidden="true" />
      )}
    </button>
  )
}

/** Props for {@link ConflictBaseLine}. */
export interface ConflictBaseLineProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  base: ConflictBase
  /** `"row"`: under a ConflictRow head (padding-left 20, HEuRD); `"resolved"`: in an expanded
   * resolved row (padding-left 4, bdpQx). */
  inset?: "row" | "resolved"
}

/**
 * The mono base line: h 20, row, gap 6, center: "base" mono 11 text-tertiary · Swatch 12
 * (radius-2xs, 1px chip-edge; colors only) · Value mono 11 text-secondary · Spacer · Commit
 * mono 11 text-tertiary.
 */
export function ConflictBaseLine({
  base,
  inset = "row",
  className,
  ...rest
}: ConflictBaseLineProps) {
  return (
    <div
      {...rest}
      className={cx(
        "kimo-conflict-base",
        inset === "resolved" && "kimo-conflict-base--resolved",
        className,
      )}
    >
      <span className="kimo-conflict-base__label">base</span>
      {base.swatch != null && (
        <span
          className="kimo-conflict-base__swatch"
          aria-hidden="true"
          style={{ background: base.swatch }}
        />
      )}
      <span className="kimo-conflict-base__value">{base.value}</span>
      <span className="kimo-conflict-base__spacer" aria-hidden="true" />
      {base.commit && <span className="kimo-conflict-base__commit">{base.commit}</span>}
    </div>
  )
}

/**
 * A stored merge conflict. Mirrors `ConflictRow` (uP9RN) / `ConflictRow/Resolved` (hZKbc) on
 * 02d: fill_container, bottom border 1, vertical, gap 6, padding [10, 12]; Head (gap 6, center):
 * Status 14 (lucide circle-alert danger; resolved circle-check success), Property mono 11 / 500
 * text-primary, spacer, Hint sans 11 text-tertiary; then the Ours and Theirs ConflictChoices.
 * Board 20 adds the Base Toggle at the end of the head and, open, turns Head into a column
 * (gap 6) of Head Row + the base line.
 */
export function ConflictRow({
  property,
  hint,
  ours,
  theirs,
  resolved = false,
  applied = null,
  onChoose,
  base = null,
  baseOpen = false,
  onToggleBase,
  className,
  ...rest
}: ConflictRowProps) {
  const headRow = (
    <>
      <span className="kimo-conflict-row__status" aria-hidden="true">
        {resolved ? <CircleCheck /> : <CircleAlert />}
      </span>
      <span className="kimo-conflict-row__property">{property}</span>
      <span className="kimo-conflict-row__spacer" aria-hidden="true" />
      <span className="kimo-conflict-row__hint">{hint}</span>
      {base && <BaseToggle open={baseOpen} {...(onToggleBase ? { onClick: onToggleBase } : {})} />}
    </>
  )
  return (
    <div
      {...rest}
      className={cx("kimo-conflict-row", resolved && "kimo-conflict-row--resolved", className)}
    >
      {base && baseOpen ? (
        <div className="kimo-conflict-row__head kimo-conflict-row__head--open">
          <div className="kimo-conflict-row__head-row">{headRow}</div>
          <ConflictBaseLine base={base} />
        </div>
      ) : (
        <div className="kimo-conflict-row__head">{headRow}</div>
      )}
      <div className="kimo-conflict-row__choices" role="radiogroup" aria-label={property}>
        <ConflictChoice
          value={ours.value}
          side={ours.caption}
          swatch={ours.swatch ?? null}
          selected={resolved && applied === "ours"}
          onClick={() => onChoose?.("ours")}
          data-side="ours"
        />
        <ConflictChoice
          value={theirs.value}
          side={theirs.caption}
          swatch={theirs.swatch ?? null}
          selected={resolved && applied === "theirs"}
          onClick={() => onChoose?.("theirs")}
          data-side="theirs"
        />
      </div>
    </div>
  )
}

/** Props for {@link ResolvedRow}. */
export interface ResolvedRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** Node / group label: "Button / Primary", "CTA Row". */
  node: string
  /** Property: "label", "gap". */
  property: string
  /** "kept ours · 12", "took theirs", "took theirs · deleted". */
  choice: string
  /** `ResolvedRow/Expanded` (OPe5M). */
  expanded?: boolean
  /** Toggles the row (one expanded at a time is the host's rule). */
  onToggleExpanded?: (e: MouseEvent<HTMLButtonElement>) => void
  /** Expanded detail: both sides (the applied one selected), base and Reopen. */
  ours?: ConflictRowSide
  theirs?: ConflictRowSide
  applied?: string | null
  base?: ConflictBase | null
  onChoose?: (side: "ours" | "theirs") => void
  onReopen?: () => void
}

/**
 * A resolved conflict in the Resolved list. Mirrors `ResolvedRow` (GawEa): fill × 28, row, gap
 * 6, padding [0, 12], center: Status circle-check 14 success · Node sans 11 text-primary ·
 * Property mono 11 text-tertiary · Spacer · Choice sans 11 text-tertiary. Expanded
 * (`ResolvedRow/Expanded` OPe5M): column, gap 6, padding [0, 0, 10, 0], fill bg-subtle: the same
 * Row plus a chevron-up 12, then Detail (column, gap 6, padding [0, 12]): Ours / Theirs
 * ConflictChoices, the base line (bdpQx) and Actions (gap 6, center): Reopen (Button/Ghost h 26,
 * padding [0, 10], rotate-ccw 12, label 11) · Hint "or pick the other side".
 */
export function ResolvedRow({
  node,
  property,
  choice,
  expanded = false,
  onToggleExpanded,
  ours,
  theirs,
  applied = null,
  base = null,
  onChoose,
  onReopen,
  className,
  ...rest
}: ResolvedRowProps) {
  const row = (
    <button
      type="button"
      className="kimo-resolved-row__row"
      aria-expanded={expanded}
      onClick={onToggleExpanded}
    >
      <span className="kimo-resolved-row__status" aria-hidden="true">
        <CircleCheck />
      </span>
      <span className="kimo-resolved-row__node">{node}</span>
      <span className="kimo-resolved-row__property">{property}</span>
      <span className="kimo-resolved-row__spacer" aria-hidden="true" />
      <span className="kimo-resolved-row__choice">{choice}</span>
      {expanded && <ChevronUp className="kimo-resolved-row__chevron" aria-hidden="true" />}
    </button>
  )
  if (!expanded)
    return (
      <div {...rest} className={cx("kimo-resolved-row", className)}>
        {row}
      </div>
    )
  return (
    <div {...rest} className={cx("kimo-resolved-row kimo-resolved-row--expanded", className)}>
      {row}
      <div className="kimo-resolved-row__detail">
        <div className="kimo-resolved-row__choices" role="radiogroup" aria-label={property}>
          {ours && (
            <ConflictChoice
              value={ours.value}
              side={ours.caption}
              swatch={ours.swatch ?? null}
              selected={applied === "ours"}
              onClick={() => onChoose?.("ours")}
              data-side="ours"
            />
          )}
          {theirs && (
            <ConflictChoice
              value={theirs.value}
              side={theirs.caption}
              swatch={theirs.swatch ?? null}
              selected={applied === "theirs"}
              onClick={() => onChoose?.("theirs")}
              data-side="theirs"
            />
          )}
        </div>
        {base && <ConflictBaseLine base={base} inset="resolved" />}
        <div className="kimo-resolved-row__actions">
          <Button
            variant="ghost"
            className="kimo-resolved-row__reopen"
            icon={<RotateCcw />}
            onClick={onReopen}
          >
            Reopen
          </Button>
          <span className="kimo-resolved-row__hint">or pick the other side</span>
        </div>
      </div>
    </div>
  )
}
