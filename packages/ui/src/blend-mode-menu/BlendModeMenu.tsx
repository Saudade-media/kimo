import { type MessageKey, t } from "@kimo/i18n"
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
export const BLEND_MODE_GROUPS: readonly (readonly {
  value: LayerBlendMode
  label: MessageKey
}[])[] = [
  [
    { value: "normal", label: "ui.blend.normal" },
    { value: "pass-through", label: "ui.blend.passThrough" },
  ],
  [
    { value: "darken", label: "ui.blend.darken" },
    { value: "multiply", label: "ui.blend.multiply" },
    { value: "linear-burn", label: "ui.blend.linearBurn" },
    { value: "color-burn", label: "ui.blend.colorBurn" },
  ],
  [
    { value: "lighten", label: "ui.blend.lighten" },
    { value: "screen", label: "ui.blend.screen" },
    { value: "linear-dodge", label: "ui.blend.linearDodge" },
    { value: "color-dodge", label: "ui.blend.colorDodge" },
  ],
  [
    { value: "overlay", label: "ui.blend.overlay" },
    { value: "soft-light", label: "ui.blend.softLight" },
    { value: "hard-light", label: "ui.blend.hardLight" },
  ],
  [
    { value: "difference", label: "ui.blend.difference" },
    { value: "exclusion", label: "ui.blend.exclusion" },
  ],
  [
    { value: "hue", label: "ui.blend.hue" },
    { value: "saturation", label: "ui.blend.saturation" },
    { value: "color", label: "ui.blend.color" },
    { value: "luminosity", label: "ui.blend.luminosity" },
  ],
]

/** Display label of a mode (`linear-burn` → "Plus darker"). */
export function blendModeLabel(mode: LayerBlendMode): string {
  for (const g of BLEND_MODE_GROUPS) for (const m of g) if (m.value === mode) return t(m.label)
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
      label={t("ui.blend.menuLabel")}
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
              label={t(m.label)}
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
