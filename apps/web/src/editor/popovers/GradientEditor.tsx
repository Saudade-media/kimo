/**
 * Gradient editor popover (board 09 `o13Uf` › `b2Y0pD`): the `@kimo/ui` GradientEditor over a
 * gradient paint. Stop drags and color drags are one undo step each; stops bound to a variable
 * keep their binding until their color is edited.
 */
import { GradientEditor, type GradientKind } from "@kimo/ui"
import { useState } from "react"
import { gestureProps } from "../fields"
import { panelPlacement, usePanel } from "../panel-context"
import {
  flipGradient,
  mergeStops,
  rotateGradient,
  sortedStops,
  stopsOf,
  withGradientKind,
  withStops,
} from "../style"
import { hexOf } from "./ColorPicker"

export function GradientEditorPopover({
  anchor,
  paint,
  onChange,
  onClose,
}: {
  anchor: HTMLElement
  paint: Record<string, unknown>
  onChange(next: unknown): void
  onClose(): void
}) {
  const { editor, header } = usePanel()
  const stored = stopsOf(paint)
  const shown = stored.map((s) => ({ color: hexOf(header, s.color) ?? "#999999", at: s.at }))
  // Board 09 opens with the middle stop selected.
  const [selected, setSelected] = useState(() => {
    const ordered = sortedStops(paint)
    return ordered[Math.floor(ordered.length / 2)]?.index ?? 0
  })
  const kind = (
    paint.kind === "radial" || paint.kind === "angular" ? paint.kind : "linear"
  ) as GradientKind
  return (
    <GradientEditor
      anchor={anchor}
      placement={panelPlacement(anchor)}
      kind={kind}
      onKindChange={(k) => onChange(withGradientKind(paint, k))}
      stops={shown}
      selected={Math.max(0, Math.min(selected, shown.length - 1))}
      onSelect={setSelected}
      onStopsChange={(next, sel, sources) => {
        setSelected(sel)
        onChange(withStops(paint, mergeStops(stored, shown, next, sources)))
      }}
      // `rotate-cw` turns clockwise; the spec's rotation is counter-clockwise.
      onRotate={() => onChange(rotateGradient(paint, -90))}
      onReverse={() => onChange(flipGradient(paint))}
      {...gestureProps(editor)}
      onClose={onClose}
    />
  )
}
