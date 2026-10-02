import { Check, Pipette, Search, X } from "lucide-react"
import { type ReactNode, useId, useMemo, useState } from "react"
import {
  COLOR_FORMATS,
  type ColorFormat,
  editColor,
  formatColor,
  hexDigits,
  parseColor,
  parsePercent,
  percent,
  toHex,
} from "../color/color"
import { hsvaToRgba, useHsva } from "../color/useHsva"
import { ColorArea } from "../color-area/ColorArea"
import { IconButton } from "../icon-button/IconButton"
import { Input } from "../input/Input"
import { cx } from "../internal/util"
import { Popover } from "../popover/Popover"
import type { PlacementOptions } from "../popover/position"
import type { PopoverAnchor } from "../popover/usePopover"
import { PropTextField } from "../prop-field/PropTextField"
import { Select } from "../select/Select"
import { AlphaSlider, HueSlider } from "../slider/Slider"
import { SwatchTile } from "../swatch-tile/SwatchTile"
import { Tab } from "../tabs/Tabs"

/** One document color variable of the Variables tab. */
export interface ColorVariable {
  /** Reference written on pick (`{ $ref }`), e.g. `brand/sand`. */
  id: string
  /** Row label (`sand`). */
  name: string
  /** Resolved color in the current mode (the 18px swatch). */
  color: string
  /** One color per theme mode, in `modes` order (the Mode chips). */
  modeColors?: readonly string[]
}

/** A variable group (header `brand · 3`). */
export interface ColorVariableGroup {
  name: string
  variables: readonly ColorVariable[]
}

export type ColorPickerTab = "custom" | "variables"

/** Props for {@link ColorPicker}. */
export interface ColorPickerProps {
  /** Current color, `#RRGGBB` or `#RRGGBBAA`. */
  color: string
  /** Every edit (drag samples included), as uppercase hex. */
  onChange?: (hex: string) => void
  /** Gesture bracketing: one undo step per drag / commit. */
  onChangeStart?: () => void
  onChangeEnd?: () => void
  /** Controlled tab; default internal, starting at `"custom"` (or `"variables"` when bound). */
  tab?: ColorPickerTab
  onTabChange?: (tab: ColorPickerTab) => void
  /** Value format; default internal `"hex"`. */
  format?: ColorFormat
  onFormatChange?: (format: ColorFormat) => void
  /** Quick picks (Document colors); hex strings. */
  documentColors?: readonly string[]
  /** Variables tab content. */
  variables?: readonly ColorVariableGroup[]
  /** Theme modes of the variables (footer "light · dark"). */
  modes?: readonly string[]
  /** Id of the bound variable (checked row). */
  boundVariable?: string
  onBindVariable?: (id: string) => void
  /** Eyedropper button; default: shown when `window.EyeDropper` exists. */
  eyedropper?: boolean
  onClose?: () => void
  anchor?: PopoverAnchor
  placement?: PlacementOptions
}

interface EyeDropperCtor {
  new (): { open(): Promise<{ sRGBHex: string }> }
}
const eyeDropperCtor = (): EyeDropperCtor | undefined =>
  typeof window !== "undefined"
    ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
    : undefined

/**
 * Color picker popover (board 09 `E1jsd` › `jNAqx` Custom, `MoN4J` › `nim6l` Variables), built
 * from `Popover` 248. Header Leading = Tabs (gap 2; Custom state padding-left −6) with
 * Tab/Active + Tab; actions = Eyedropper `pipette` + Close `x` (24, transparent, 14
 * text-secondary). Custom body: ColorArea · Sliders (column gap 10: Hue, Alpha) · Value Row (gap
 * 6: Format Select 68 · Hex field `#` · Opacity 60) · Divider · Document colors (gap 8; label
 * sans 11 / 500 text-tertiary; Swatches gap 6). Variables body: Search · List · Footer.
 */
export function ColorPicker({
  color,
  onChange,
  onChangeStart,
  onChangeEnd,
  tab: tabProp,
  onTabChange,
  format: formatProp,
  onFormatChange,
  documentColors = [],
  variables = [],
  modes = [],
  boundVariable,
  onBindVariable,
  eyedropper,
  onClose,
  anchor,
  placement,
}: ColorPickerProps) {
  const id = useId()
  const [tabState, setTabState] = useState<ColorPickerTab>(boundVariable ? "variables" : "custom")
  const tab = tabProp ?? tabState
  const setTab = (t: ColorPickerTab) => {
    setTabState(t)
    onTabChange?.(t)
  }
  const [formatState, setFormatState] = useState<ColorFormat>("hex")
  const format = formatProp ?? formatState
  const [hsva, setHsva] = useHsva(color, onChange)
  const rgba = hsvaToRgba(hsva)
  const opaque = toHex({ ...rgba, a: 1 })
  const Dropper = eyeDropperCtor()
  const showDropper = (eyedropper ?? Dropper !== undefined) && Dropper !== undefined

  /** One discrete edit = one undo step. */
  const commit = (fn: () => void) => {
    onChangeStart?.()
    fn()
    onChangeEnd?.()
  }

  const pickFromScreen = async () => {
    if (!Dropper) return
    try {
      const { sRGBHex } = await new Dropper().open()
      const c = parseColor(sRGBHex, "hex", hsva.a)
      if (c) commit(() => onChange?.(toHex(c)))
    } catch {
      // Cancelled by the user.
    }
  }

  const tabs = (
    <div
      role="tablist"
      aria-label="Color source"
      className={cx(
        "kimo-color-picker__tabs",
        tab === "custom" && "kimo-color-picker__tabs--inset",
      )}
    >
      <Tab
        active={tab === "custom"}
        aria-controls={`${id}-custom`}
        onClick={() => setTab("custom")}
        onKeyDown={(e) => e.key === "ArrowRight" && setTab("variables")}
      >
        Custom
      </Tab>
      <Tab
        active={tab === "variables"}
        aria-controls={`${id}-variables`}
        onClick={() => setTab("variables")}
        onKeyDown={(e) => e.key === "ArrowLeft" && setTab("custom")}
      >
        Variables
      </Tab>
    </div>
  )

  const actions = (
    <div className="kimo-popover__actions">
      {tab === "custom" && showDropper && (
        <IconButton
          label="Pick color from screen"
          icon={<Pipette />}
          size="sm"
          tone="ghost"
          onClick={pickFromScreen}
        />
      )}
      <IconButton label="Close" icon={<X />} size="sm" tone="ghost" onClick={onClose} />
    </div>
  )

  return (
    <Popover
      label="Color"
      headerLeading={tabs}
      actions={actions}
      onClose={onClose}
      anchor={anchor}
      placement={placement}
      className="kimo-color-picker"
      bodyProps={{ id: `${id}-${tab}`, role: "tabpanel" }}
    >
      {tab === "custom" ? (
        <>
          <ColorArea
            hue={hsva.h}
            saturation={hsva.s}
            value={hsva.v}
            color={opaque}
            onChange={({ saturation, value }) => setHsva({ ...hsva, s: saturation, v: value })}
            onChangeStart={onChangeStart}
            onChangeEnd={onChangeEnd}
          />
          <div className="kimo-color-picker__sliders">
            <HueSlider
              hue={hsva.h}
              color={opaque}
              onChange={(h) => setHsva({ ...hsva, h })}
              onChangeStart={onChangeStart}
              onChangeEnd={onChangeEnd}
            />
            <AlphaSlider
              alpha={hsva.a}
              color={opaque}
              onChange={(a) => setHsva({ ...hsva, a })}
              onChangeStart={onChangeStart}
              onChangeEnd={onChangeEnd}
            />
          </div>
          <div className="kimo-color-picker__value-row">
            <Select
              dense
              menuWidth={188}
              label="Color format"
              className="kimo-color-picker__format"
              options={COLOR_FORMATS.map((f) => ({
                value: f.value,
                label: f.label,
                mono: true,
                meta: f.value === "hex" ? `#${hexDigits(rgba)}` : formatColor(rgba, f.value),
              }))}
              value={format}
              onChange={(f) => {
                setFormatState(f)
                onFormatChange?.(f)
              }}
            />
            <PropTextField
              className="kimo-color-picker__hex"
              prefix={format === "hex" ? "#" : undefined}
              inputLabel={`${COLOR_FORMATS.find((f) => f.value === format)?.label ?? ""} value`}
              value={formatColor(rgba, format)}
              onCommit={(text) => {
                const c = editColor(rgba, format, text, hsva.a)
                if (!c) return false
                if (toHex(c) !== toHex({ ...rgba, a: hsva.a })) commit(() => onChange?.(toHex(c)))
                return true
              }}
            />
            <PropTextField
              className="kimo-color-picker__opacity"
              inputLabel="Opacity"
              value={percent(hsva.a)}
              onCommit={(text) => {
                const a = parsePercent(text)
                if (a === null) return false
                commit(() => setHsva({ ...hsva, a }))
                return true
              }}
            />
          </div>
          {documentColors.length > 0 && (
            <>
              <div className="kimo-color-picker__divider" />
              <div className="kimo-color-picker__document">
                <div className="kimo-color-picker__document-header">
                  <span className="kimo-color-picker__caption">Document colors</span>
                </div>
                <div className="kimo-color-picker__swatches">
                  {documentColors.map((c) => (
                    <SwatchTile
                      key={c}
                      color={c}
                      aria-label={c}
                      selected={c.toUpperCase() === toHex(rgba).toUpperCase()}
                      onClick={() => {
                        const p = parseColor(c, "hex", 1)
                        if (p) commit(() => onChange?.(toHex(p)))
                      }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <VariablesPanel
          groups={variables}
          modes={modes}
          bound={boundVariable}
          onPick={(v) => commit(() => onBindVariable?.(v))}
        />
      )}
    </Popover>
  )
}

function VariablesPanel({
  groups,
  modes,
  bound,
  onPick,
}: {
  groups: readonly ColorVariableGroup[]
  modes: readonly string[]
  bound?: string
  onPick: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          variables: g.variables.filter(
            (v) => q === "" || v.name.toLowerCase().includes(q) || v.id.toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.variables.length > 0),
    [groups, q],
  )
  const all = filtered.flatMap((g) => g.variables)
  const tabStop = all.some((v) => v.id === bound) ? bound : all[0]?.id
  const rows: ReactNode[] = []
  filtered.forEach((g, gi) => {
    rows.push(
      <div
        key={`g:${g.name}`}
        className={cx("kimo-color-picker__group", gi > 0 && "kimo-color-picker__group--next")}
        role="presentation"
      >
        <span className="kimo-color-picker__group-label">{g.name}</span>
        <span className="kimo-color-picker__spacer" />
        <span className="kimo-color-picker__group-label">{g.variables.length}</span>
      </div>,
    )
    for (const v of g.variables) {
      const selected = v.id === bound
      rows.push(
        <div
          key={v.id}
          role="option"
          aria-selected={selected}
          tabIndex={v.id === tabStop ? 0 : -1}
          className={cx(
            "kimo-color-picker__variable",
            selected && "kimo-color-picker__variable--selected",
          )}
          onClick={() => onPick(v.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onPick(v.id)
            } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault()
              // Across groups: every option of the list, in order.
              const list =
                e.currentTarget.closest<HTMLElement>('[role="listbox"]') ??
                e.currentTarget.parentElement
              const opts = [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
              const i = opts.indexOf(e.currentTarget)
              const n = opts.length
              const to =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? n - 1
                    : (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n
              opts[to]?.focus()
            }
          }}
        >
          <SwatchTile
            color={v.color}
            size={18}
            aria-label={v.name}
            tabIndex={-1}
            aria-hidden="true"
          />
          <span className="kimo-color-picker__variable-name">{v.name}</span>
          <span className="kimo-color-picker__spacer" />
          {v.modeColors && v.modeColors.length > 0 && (
            <span className="kimo-color-picker__modes" aria-hidden="true">
              {v.modeColors.map((c, i) => (
                <span
                  key={modes[i] ?? `mode-${c}`}
                  className="kimo-color-picker__mode-chip"
                  style={{ backgroundColor: c }}
                />
              ))}
            </span>
          )}
          <span
            className={cx("kimo-color-picker__check", selected && "kimo-color-picker__check--on")}
            aria-hidden="true"
          >
            <Check />
          </span>
        </div>,
      )
    }
  })
  return (
    <>
      <Input
        dense
        icon={<Search />}
        placeholder="Search variables"
        aria-label="Search variables"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <div role="listbox" aria-label="Color variables" className="kimo-color-picker__list">
        {rows}
      </div>
      {modes.length > 0 && (
        <div className="kimo-color-picker__footer">
          <span className="kimo-color-picker__footer-label">Modes</span>
          <span className="kimo-color-picker__spacer" />
          <span className="kimo-color-picker__footer-modes">{modes.join(" · ")}</span>
        </div>
      )}
    </>
  )
}
