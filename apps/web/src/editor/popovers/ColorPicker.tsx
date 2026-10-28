/**
 * Color picker popover (board 09 Custom `E1jsd` › `jNAqx`, Variables `MoN4J` › `nim6l`): the
 * `@kimo/ui` ColorPicker fed with the document's colors and color variables. Drags (area,
 * sliders) are one undo step each (`onChangeStart`/`onChangeEnd` → the editor's gesture);
 * picking a variable binds `{ $ref }`.
 */
import type { DocStore } from "@kimo/editor-state"
import { ColorPicker, type ColorVariableGroup, parseHex, toHex } from "@kimo/ui"
import { useMemo, useState } from "react"
import { colorVariables, type DocHeader, modeAxis } from "../../lib/header"
import { gestureProps } from "../fields"
import { panelPlacement, usePanel } from "../panel-context"
import { paintList } from "../props"

export type ColorValue = string | { $ref: string }

const isRef = (v: unknown): v is { $ref: string } =>
  typeof v === "object" && v !== null && typeof (v as { $ref?: unknown }).$ref === "string"

/** The 8 most used solid colors of the document (Document colors quick picks). */
function documentColors(store: DocStore, limit = 8): string[] {
  const count = new Map<string, number>()
  const add = (c: unknown) => {
    if (typeof c !== "string") return
    const p = parseHex(c)
    if (!p) return
    const k = toHex({ ...p, a: 1 })
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  const visit = (paint: unknown) => {
    if (typeof paint === "string") add(paint)
    else if (paint && typeof paint === "object") {
      const p = paint as Record<string, unknown>
      if (p.kind === "solid") add(p.color)
      if (Array.isArray(p.stops)) for (const s of p.stops) add((s as { color?: unknown }).color)
    }
  }
  for (const id of store.nodeIds()) {
    const n = store.getNode(id)
    if (!n) continue
    for (const p of paintList(n.fill)) visit(p)
    const stroke = n.stroke as { paint?: unknown } | undefined
    if (stroke && typeof stroke === "object") for (const p of paintList(stroke.paint)) visit(p)
    add(n.color)
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([c]) => c)
}

/** Color variables grouped by path (`brand/sand` → group `brand`, row `sand`). */
function variableGroups(header: DocHeader): ColorVariableGroup[] {
  const groups = new Map<string, ColorVariableGroup["variables"][number][]>()
  for (const v of colorVariables(header)) {
    const list = groups.get(v.group) ?? []
    list.push({
      id: v.name,
      name: v.label,
      color: v.color ?? "transparent",
      modeColors: v.modes.map((m) => m ?? "transparent"),
    })
    groups.set(v.group, list)
  }
  return [...groups.entries()].map(([name, variables]) => ({
    name: name || "Variables",
    variables,
  }))
}

/** Hex of a color value (bindings resolve under the default theme; non-hex → null). */
export function hexOf(header: DocHeader, v: unknown): string | null {
  if (typeof v === "string") return parseHex(v) ? v : null
  if (!isRef(v)) return null
  const c = colorVariables(header).find((x) => x.name === v.$ref)?.color
  return c && parseHex(c) ? c : null
}

export function ColorPickerPopover({
  anchor,
  value,
  onChange,
  onClose,
}: {
  anchor: HTMLElement
  /** Current color: hex or a binding. */
  value: ColorValue
  /** Writes a color (hex or `{ $ref }`) through the editor (one step, or a gesture step). */
  onChange(color: ColorValue): void
  onClose(): void
}) {
  const { session, editor, header } = usePanel()
  // Quick picks are read once per opening (a full document scan).
  const [docColors] = useState(() => documentColors(session.store))
  const variables = useMemo(() => variableGroups(header), [header])
  const modes = modeAxis(header)?.values ?? []
  return (
    <ColorPicker
      anchor={anchor}
      placement={panelPlacement(anchor)}
      color={hexOf(header, value) ?? "#000000"}
      onChange={(hex) => onChange(hex)}
      {...gestureProps(editor)}
      documentColors={docColors}
      variables={variables}
      modes={modes}
      boundVariable={isRef(value) ? value.$ref : undefined}
      onBindVariable={(id) => onChange({ $ref: id })}
      onClose={onClose}
    />
  )
}
