import { FlipHorizontal2, Minus, Plus, RotateCw } from "lucide-react"
import { hexDigits, parseHex, parsePercent, percent, toHex } from "../color/color"
import { hsvaToRgba, useHsva } from "../color/useHsva"
import { ColorArea } from "../color-area/ColorArea"
import { ColorField } from "../color-field/ColorField"
import { type GradientStop, GradientStopBar } from "../gradient-stop-bar/GradientStopBar"
import { IconButton } from "../icon-button/IconButton"
import { Popover } from "../popover/Popover"
import type { PlacementOptions } from "../popover/position"
import type { PopoverAnchor } from "../popover/usePopover"
import { PropTextField } from "../prop-field/PropTextField"
import { Segmented } from "../segmented/Segmented"
import { HueSlider } from "../slider/Slider"

export type GradientKind = "linear" | "radial" | "angular"

const KINDS = [
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
  { value: "angular", label: "Angular" },
] as const

/** Color of a gradient at `at` (linear RGBA interpolation between the surrounding stops). */
export function colorAt(stops: readonly GradientStop[], at: number): string {
  const sorted = [...stops].sort((a, b) => a.at - b.at)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (!first || !last) return "#000000"
  if (at <= first.at) return first.color
  if (at >= last.at) return last.color
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as GradientStop
    const b = sorted[i] as GradientStop
    if (at <= b.at) {
      const t = b.at === a.at ? 0 : (at - a.at) / (b.at - a.at)
      const ca = parseHex(a.color) ?? { r: 0, g: 0, b: 0, a: 1 }
      const cb = parseHex(b.color) ?? { r: 0, g: 0, b: 0, a: 1 }
      const mix = (x: number, y: number) => x + (y - x) * t
      return toHex({
        r: mix(ca.r, cb.r),
        g: mix(ca.g, cb.g),
        b: mix(ca.b, cb.b),
        a: mix(ca.a, cb.a),
      })
    }
  }
  return last.color
}

/** Props for {@link GradientEditor}. Stop colors are hex (`#RRGGBB` / `#RRGGBBAA`). */
export interface GradientEditorProps {
  kind: GradientKind
  onKindChange?: (kind: GradientKind) => void
  stops: readonly GradientStop[]
  /** Selected stop index (edited by the area and hue slider). */
  selected: number
  onSelect?: (i: number) => void
  /**
   * Every stop edit (move, add, remove, color). `selected` is the stop to select after it;
   * `sources[i]` is the index in `stops` that output stop `i` came from (null for a new stop),
   * so hosts can carry per-stop data (a variable binding) across adds and removes.
   */
  onStopsChange?: (stops: GradientStop[], selected: number, sources: (number | null)[]) => void
  /** Rotate 90° (the host turns the gradient transform). */
  onRotate?: () => void
  /** Reverse the stops (`flip-horizontal-2`). Default: mirrors the stop positions. */
  onReverse?: () => void
  onChangeStart?: () => void
  onChangeEnd?: () => void
  onClose?: () => void
  anchor?: PopoverAnchor
  placement?: PlacementOptions
}

/**
 * Gradient editor popover (board 09 `o13Uf` › `b2Y0pD`): Popover 248 "Gradient". Body:
 * Type Row (gap 4: Segmented fill Linear · Radial · Angular; IconButton 24 `rotate-cw`;
 * IconButton 24 `flip-horizontal-2`) · GradientStopBar · Stops (vertical gap 6: header "Stops"
 * sans 11 / 500 text-tertiary + Add stop 20 `plus`; rows gap 4: ColorField (selected: bg-hover +
 * stroke selection) · Position 52 · Remove 24 `minus`) · Divider · ColorArea + HueSlider of the
 * selected stop.
 */
export function GradientEditor({
  kind,
  onKindChange,
  stops,
  selected,
  onSelect,
  onStopsChange,
  onRotate,
  onReverse,
  onChangeStart,
  onChangeEnd,
  onClose,
  anchor,
  placement,
}: GradientEditorProps) {
  const current = stops[selected] ?? stops[0]
  const replace = (i: number, patch: Partial<GradientStop>, select = selected) => {
    const next = stops.map((s, j) => (j === i ? { ...s, ...patch } : { ...s }))
    onStopsChange?.(next, select, identity())
  }
  const step = (fn: () => void) => {
    onChangeStart?.()
    fn()
    onChangeEnd?.()
  }
  const identity = () => stops.map((_, j) => j)
  const add = (at: number) => {
    const next = [...stops.map((s) => ({ ...s })), { color: colorAt(stops, at), at }]
    onStopsChange?.(next, next.length - 1, [...identity(), null])
  }
  const remove = (i: number) => {
    if (stops.length <= 2) return
    const next = stops.filter((_, j) => j !== i).map((s) => ({ ...s }))
    onStopsChange?.(
      next,
      Math.min(
        selected === i ? Math.max(0, i - 1) : selected > i ? selected - 1 : selected,
        next.length - 1,
      ),
      identity().filter((j) => j !== i),
    )
  }
  const [hsva, setHsva] = useHsva(current?.color ?? "#000000", (hex) =>
    replace(selected, { color: hex }),
  )
  const opaque = toHex({ ...hsvaToRgba(hsva), a: 1 })
  // Rows in position order (board 09 lists 0% · 55% · 100%), keeping document indices.
  const order = stops.map((s, i) => ({ s, i })).sort((a, b) => a.s.at - b.s.at || a.i - b.i)
  const addBetween = () => {
    const pos = order.findIndex((o) => o.i === selected)
    const a = order[pos]?.s.at ?? 0
    const b = order[pos + 1]?.s.at ?? order[pos - 1]?.s.at ?? 1
    step(() => add(Number(((a + b) / 2).toFixed(4))))
  }

  return (
    <Popover
      title="Gradient"
      onClose={onClose}
      anchor={anchor}
      placement={placement}
      className="kimo-gradient-editor"
    >
      <div className="kimo-gradient-editor__type-row">
        <Segmented
          fill
          label="Gradient type"
          options={KINDS}
          value={kind}
          onChange={(k) => onKindChange?.(k)}
        />
        <IconButton
          label="Rotate 90°"
          icon={<RotateCw />}
          size="sm"
          tone="ghost"
          onClick={onRotate}
        />
        <IconButton
          label="Reverse stops"
          icon={<FlipHorizontal2 />}
          size="sm"
          tone="ghost"
          onClick={() => {
            if (onReverse) onReverse()
            else
              step(() =>
                onStopsChange?.(
                  stops.map((s) => ({ ...s, at: Number((1 - s.at).toFixed(4)) })),
                  selected,
                  identity(),
                ),
              )
          }}
        />
      </div>
      <GradientStopBar
        stops={stops}
        selected={selected}
        onSelect={onSelect}
        onMove={(i, at) => replace(i, { at }, i)}
        onAdd={(at) => step(() => add(at))}
        onRemove={(i) => step(() => remove(i))}
        onChangeStart={onChangeStart}
        onChangeEnd={onChangeEnd}
      />
      <div className="kimo-gradient-editor__stops">
        <div className="kimo-gradient-editor__stops-header">
          <span className="kimo-gradient-editor__caption">Stops</span>
          <span className="kimo-gradient-editor__spacer" />
          <IconButton
            className="kimo-gradient-editor__add"
            label="Add stop"
            icon={<Plus />}
            size="sm"
            tone="ghost"
            onClick={addBetween}
          />
        </div>
        {order.map(({ s, i }) => {
          const c = parseHex(s.color) ?? { r: 0, g: 0, b: 0, a: 1 }
          return (
            <div key={i} className="kimo-gradient-editor__stop">
              <ColorField
                className="kimo-gradient-editor__stop-color"
                color={s.color}
                value={hexDigits(c)}
                opacity={percent(c.a)}
                highlight={i === selected ? "selected" : undefined}
                swatchLabel={`Select stop ${i + 1}`}
                swatchProps={{ "aria-pressed": i === selected }}
                onSwatchClick={() => onSelect?.(i)}
                onClick={() => onSelect?.(i)}
              />
              <PropTextField
                className="kimo-gradient-editor__position"
                inputLabel={`Stop ${i + 1} position`}
                value={percent(s.at)}
                onCommit={(text) => {
                  const at = parsePercent(text)
                  if (at === null) return false
                  step(() => replace(i, { at }, i))
                  return true
                }}
              />
              <IconButton
                label={`Remove stop ${i + 1}`}
                icon={<Minus />}
                size="sm"
                tone="ghost"
                disabled={stops.length <= 2}
                onClick={() => step(() => remove(i))}
              />
            </div>
          )
        })}
      </div>
      <div className="kimo-gradient-editor__divider" />
      <ColorArea
        hue={hsva.h}
        saturation={hsva.s}
        value={hsva.v}
        color={opaque}
        aria-label={`Stop ${selected + 1} saturation and brightness`}
        onChange={({ saturation, value }) => setHsva({ ...hsva, s: saturation, v: value })}
        onChangeStart={onChangeStart}
        onChangeEnd={onChangeEnd}
      />
      <HueSlider
        className="kimo-gradient-editor__hue"
        hue={hsva.h}
        color={opaque}
        aria-label={`Stop ${selected + 1} hue`}
        onChange={(h) => setHsva({ ...hsva, h })}
        onChangeStart={onChangeStart}
        onChangeEnd={onChangeEnd}
      />
    </Popover>
  )
}
