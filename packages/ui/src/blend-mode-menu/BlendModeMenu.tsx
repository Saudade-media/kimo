import { Fragment, useRef } from "react"
import { MenuDense, MenuDivider, MenuItemDense } from "../menu-dense/MenuDense"
import type { PlacementOptions } from "../popover/position"
import type { PopoverAnchor } from "../popover/usePopover"

/** Layer blend modes (`.kimo` `LAYER_BLEND_MODES`: paint modes plus `pass-through`). */
export type LayerBlendMode =
  | "normal"
  | "pass-through"
  | "darken"
  | "multiply"
  | "linear-burn"
  | "color-burn"
  | "lighten"
  | "screen"
  | "linear-dodge"
  | "color-dodge"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"

/** Menu groups in board 09 order (`YFOTX`), separated by dividers. */
export const BLEND_MODE_GROUPS: readonly (readonly { value: LayerBlendMode; label: string }[])[] = [
  [
    { value: "normal", label: "Normal" },
    { value: "pass-through", label: "Pass through" },
  ],
  [
    { value: "darken", label: "Darken" },
    { value: "multiply", label: "Multiply" },
    { value: "linear-burn", label: "Plus darker" },
    { value: "color-burn", label: "Color burn" },
  ],
  [
    { value: "lighten", label: "Lighten" },
    { value: "screen", label: "Screen" },
    { value: "linear-dodge", label: "Plus lighter" },
    { value: "color-dodge", label: "Color dodge" },
  ],
  [
    { value: "overlay", label: "Overlay" },
    { value: "soft-light", label: "Soft light" },
    { value: "hard-light", label: "Hard light" },
  ],
  [
    { value: "difference", label: "Difference" },
    { value: "exclusion", label: "Exclusion" },
  ],
  [
    { value: "hue", label: "Hue" },
    { value: "saturation", label: "Saturation" },
    { value: "color", label: "Color" },
    { value: "luminosity", label: "Luminosity" },
  ],
]

/** Display label of a mode (`linear-burn` → "Plus darker"). */
export function blendModeLabel(mode: LayerBlendMode): string {
  for (const g of BLEND_MODE_GROUPS) for (const m of g) if (m.value === mode) return m.label
  return mode
}

/** Props for {@link BlendModeMenu}. */
export interface BlendModeMenuProps {
  value: LayerBlendMode
  /** Offer "Pass through" (frames and groups only). Default false. */
  passThrough?: boolean
  /** Highlight previews live (no undo entry); `null` = revert to `value` (Escape / close). */
  onPreview?: (mode: LayerBlendMode | null) => void
  /** Commit (one undo step). */
  onSelect?: (mode: LayerBlendMode) => void
  onClose?: () => void
  anchor?: PopoverAnchor
  placement?: PlacementOptions
  /** Focus the checked item on open. Default true. */
  autoFocus?: boolean
  /** Menu width (board 09 layer menu 208; board 27 paint row menu kNrNc 128). Default 208. */
  width?: number
}

/**
 * Blend mode menu (board 09 `EdigD` › `YFOTX`): `MenuDense` width 208, groups separated by
 * `MenuDivider`, current mode checked. Hover/arrow highlight calls `onPreview`, Escape or an
 * outside click reverts (`onPreview(null)`) and closes, selecting commits.
 */
export function BlendModeMenu({
  value,
  passThrough = false,
  onPreview,
  onSelect,
  onClose,
  anchor,
  placement,
  autoFocus = true,
  width = 208,
}: BlendModeMenuProps) {
  const committed = useRef(false)
  const groups = BLEND_MODE_GROUPS.map((g) =>
    g.filter((m) => passThrough || m.value !== "pass-through"),
  )
  const close = () => {
    if (!committed.current) onPreview?.(null)
    onClose?.()
  }
  return (
    <MenuDense
      label="Blend mode"
      width={width}
      anchor={anchor}
      placement={placement}
      autoFocus={autoFocus}
      onClose={close}
    >
      {groups.map((g, gi) => (
        <Fragment key={g[0]?.value ?? gi}>
          {gi > 0 && <MenuDivider />}
          {g.map((m) => (
            <MenuItemDense
              key={m.value}
              label={m.label}
              checked={m.value === value}
              onHighlight={() => onPreview?.(m.value)}
              onSelect={() => {
                committed.current = true
                onSelect?.(m.value)
                onClose?.()
              }}
            />
          ))}
        </Fragment>
      ))}
    </MenuDense>
  )
}
