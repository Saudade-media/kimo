import { type MessageKey, t } from "@kimo/i18n"
import { ArrowDown, ArrowRight } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { Segmented } from "../segmented/Segmented"

/** Props for {@link DirectionControl}. Remaining `<div>` props go to the frame. */
export interface DirectionControlProps
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "children"> {
  value: "row" | "column"
  onChange?: (v: "row" | "column") => void
  /** Accessible name of the radio group. Default `"Direction"`. */
  label?: string
}

const OPTIONS: readonly { value: "row" | "column"; label: MessageKey; icon: ReactNode }[] = [
  { value: "row", label: "ui.direction.horizontal", icon: <ArrowRight /> },
  { value: "column", label: "ui.direction.vertical", icon: <ArrowDown /> },
] as const

/**
 * Auto-layout direction. `DirectionControl` (J6Reo) has exactly the `Segmented` (hx0Wg) node
 * spec (bg-muted, pill, gap 2, padding 2; items 32 × 24 pill; selected bg-app + shadow 0 1 2
 * shadow, icon text-primary; else icon text-tertiary), so it is that component with
 * Horizontal (xyvmk, `arrow-right` 14) and Vertical (RzC9v, `arrow-down` 14).
 */
export function DirectionControl({ value, onChange, label, ...rest }: DirectionControlProps) {
  const options = OPTIONS.map((o) => ({ ...o, label: t(o.label) }))
  return (
    <Segmented
      {...rest}
      label={label ?? t("ui.direction.label")}
      options={options}
      value={value}
      onChange={(v) => onChange?.(v)}
    />
  )
}
