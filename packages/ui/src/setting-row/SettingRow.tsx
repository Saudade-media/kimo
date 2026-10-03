import { type ComponentPropsWithRef, type ReactNode, useId } from "react"
import { cx } from "../internal/util"

/** Ids a control uses to name and describe itself from the row. */
export interface SettingRowIds {
  labelId: string
  descriptionId: string
}

/** Props for {@link SettingRow}. Remaining `<div>` props go to the row. */
export interface SettingRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  label: string
  description?: ReactNode
  /** The Control frame's content (Toggle, Select, value text + Button). A function receives the
   * label / description ids for `aria-labelledby` / `aria-describedby`. */
  control?: ReactNode | ((ids: SettingRowIds) => ReactNode)
  /** Last row of a pane: the instance overrides the bottom stroke to `#00000000`. */
  last?: boolean
  /** Unavailable (board 19 "Google Fonts" while No third-party fetch is on): opacity 0.45. */
  dimmed?: boolean
}

/**
 * One setting. Mirrors `SettingRow` (MuoTX) on 02d: row, gap 16, padding [12, 0], center,
 * fill_container, bottom stroke 1 border. Text (PRXt4) vertical gap 2 fill: Label (NcrOC) sans
 * 12 / 500 text-primary, Desc (LMxOY) sans 11 text-secondary lineHeight 1.45 fixed-width ·
 * Control (J4s83) row, justify end, center (instances: gap 8). Changes apply immediately.
 */
export function SettingRow({
  label,
  description,
  control,
  last = false,
  dimmed = false,
  className,
  ...rest
}: SettingRowProps) {
  const id = useId()
  const ids: SettingRowIds = { labelId: `${id}-label`, descriptionId: `${id}-desc` }
  return (
    <div
      {...rest}
      className={cx(
        "kimo-setting-row",
        last && "kimo-setting-row--last",
        dimmed && "kimo-setting-row--dimmed",
        className,
      )}
    >
      <div className="kimo-setting-row__text">
        <span id={ids.labelId} className="kimo-setting-row__label">
          {label}
        </span>
        {description != null && (
          <span id={ids.descriptionId} className="kimo-setting-row__desc">
            {description}
          </span>
        )}
      </div>
      {control != null && (
        <div className="kimo-setting-row__control">
          {typeof control === "function" ? control(ids) : control}
        </div>
      )}
    </div>
  )
}
