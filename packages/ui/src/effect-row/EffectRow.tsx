import { type MessageKey, t } from "@kimo/i18n"
import { ChevronDown, Droplet, Droplets, Eye, EyeOff, Minus, SlidersHorizontal } from "lucide-react"
import { type ComponentPropsWithRef, useId, useRef, useState } from "react"
import { IconButton } from "../icon-button/IconButton"
import { cx } from "../internal/util"
import { MenuDense, MenuItemDense } from "../menu-dense/MenuDense"

/** Effect kinds as the panel names them. Schema: shadows → `kind: "shadow"` (`inner`), layer
 *  blur → `"blur"`, background blur → `"backdrop-blur"`. */
export type EffectKind = "drop-shadow" | "inner-shadow" | "layer-blur" | "background-blur"

/** Labels in menu order. */
export const EFFECT_KINDS: readonly { value: EffectKind; label: MessageKey }[] = [
  { value: "drop-shadow", label: "ui.effect.dropShadow" },
  { value: "inner-shadow", label: "ui.effect.innerShadow" },
  { value: "layer-blur", label: "ui.effect.layerBlur" },
  { value: "background-blur", label: "ui.effect.backgroundBlur" },
]

/** Props for {@link EffectRow}. Remaining `<div>` props go to the row frame. */
export interface EffectRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  kind: EffectKind
  /** Hidden: Field opacity 0.5, Eye `eye-off` (board 08 `bkMKT`). */
  visible: boolean
  /** Details expanded: Settings fill + stroke accent, icon on-accent (board 08 `lvQHn`). */
  open?: boolean
  /** Remove shown; else opacity 0 with its 24px kept. Default true. */
  removable?: boolean
  onToggleOpen?: () => void
  /** Type + Chevron open a MenuDense of the four kinds. */
  onKindChange?: (k: EffectKind) => void
  onToggleVisible?: () => void
  onRemove?: () => void
}

const ICON: Record<EffectKind, typeof SlidersHorizontal> = {
  "drop-shadow": SlidersHorizontal,
  "inner-shadow": SlidersHorizontal,
  "layer-blur": Droplet,
  "background-blur": Droplets,
}

/**
 * Effect row. Mirrors `EffectRow` (Q6vwp): fill_container, row, gap 2, center.
 * Field (gLR6X): fill × 28, bg-subtle, radius-sm, row, gap 6, padding [0, 8, 0, 4], center →
 * Settings (upS17) 20 × 20, bg-app, radius-xs, stroke 1 border, icon 12 text-secondary
 * (`sliders-horizontal` / `droplet` / `droplets`) · Type (q0Vgql) sans 12 text-primary · Spacer ·
 * Chevron (Gh1AU) `chevron-down` 14 text-tertiary. Then Eye (nYSHl) and Remove (M0titT) as in
 * FillRow.
 */
export function EffectRow({
  kind,
  visible,
  open = false,
  removable = true,
  onToggleOpen,
  onKindChange,
  onToggleVisible,
  onRemove,
  className,
  ...rest
}: EffectRowProps) {
  const id = useId()
  const field = useRef<HTMLDivElement>(null)
  const typeButton = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const label = t(EFFECT_KINDS.find((k) => k.value === kind)?.label ?? "ui.effect.dropShadow")
  const Icon = ICON[kind]

  const closeMenu = () => {
    setMenu(false)
    typeButton.current?.focus({ preventScroll: true })
  }

  return (
    <div
      {...rest}
      className={cx("kimo-effect-row", !visible && "kimo-effect-row--hidden", className)}
    >
      <div ref={field} className="kimo-effect-row__field">
        <button
          type="button"
          className={cx("kimo-effect-row__settings", open && "kimo-effect-row__settings--open")}
          aria-label={t("ui.effect.settings", { name: label })}
          aria-expanded={open}
          onClick={onToggleOpen}
        >
          <Icon aria-hidden="true" />
        </button>
        <button
          ref={typeButton}
          type="button"
          className="kimo-effect-row__type"
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-controls={menu ? `${id}-menu` : undefined}
          onClick={() => setMenu((m) => !m)}
        >
          {label}
        </button>
        <span className="kimo-effect-row__spacer" aria-hidden="true" />
        <span
          className="kimo-effect-row__chevron"
          aria-hidden="true"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setMenu((m) => !m)}
        >
          <ChevronDown />
        </span>
        {menu && (
          <MenuDense
            id={`${id}-menu`}
            label={t("ui.effect.type")}
            anchor={field.current}
            autoFocus
            onClose={closeMenu}
            style={{ width: field.current?.getBoundingClientRect().width }}
          >
            {EFFECT_KINDS.map((k) => (
              <MenuItemDense
                key={k.value}
                label={t(k.label)}
                checked={k.value === kind}
                onSelect={() => {
                  if (k.value !== kind) onKindChange?.(k.value)
                  closeMenu()
                }}
              />
            ))}
          </MenuDense>
        )}
      </div>
      <IconButton
        className="kimo-effect-row__eye"
        label={t(visible ? "ui.effect.hide" : "ui.effect.show", { name: label })}
        icon={visible ? <Eye /> : <EyeOff />}
        size="sm"
        tone="quiet"
        onClick={onToggleVisible}
      />
      <IconButton
        className={cx("kimo-effect-row__remove", !removable && "kimo-effect-row__remove--hidden")}
        label={t("ui.effect.remove", { name: label })}
        icon={<Minus />}
        size="sm"
        tone="quiet"
        tabIndex={removable ? undefined : -1}
        aria-hidden={removable ? undefined : true}
        disabled={!removable}
        onClick={onRemove}
      />
    </div>
  )
}
