/**
 * SVG import options (board 19 `mevh8`, "SVG import options · on drop / paste"): `Popover/Wide`
 * (u0aiz, 296) titled "Import <file>". Body (Gk1mf): column, gap 12, padding 12:
 *   Import As (E3zTd): row, bg-muted, radius-pill, gap 2, padding 2; two 26-tall pill options,
 *     gap 6, centered: active (As Vector rF2bf) bg-app + shadow 0 1 2 shadow, icon 14
 *     text-primary, label sans 12 / 500 text-primary; inactive icon text-tertiary, label sans 12
 *     text-secondary.
 *   Desc (W0Dapp): sans 11 text-secondary, lineHeight 1.45.
 *   Options (HejPp, ldWT8, z9D7g): row, space-between, center; Label sans 12 text-primary +
 *     Toggle (on / on / off).
 *   Board 27 §6 (e) r6nLx "Outline strokes enabled" (lxXp0 > Option · Outline strokes vMlWH):
 *     column, gap 2: Row (EiX2l, space-between, center: Label + Toggle) · Sub (G3tQz, sans 11
 *     text-tertiary, lineHeight 1.45, fill). Enabled when the parse found ≥ 1 stroked path (the
 *     count is in the sub line); otherwise disabled with "No strokes in this file".
 *   Actions (VM4GH): row, gap 6, padding [4, 0, 0, 0], justify end: Cancel (Button/Ghost h 28,
 *     [0, 10], 12) · Import (Button/Primary h 28, [0, 12], 12).
 */
import { Button, Popover, Toggle } from "@kimo/ui"
import { ImageIcon, PenTool } from "lucide-react"
import { useId, useState } from "react"
import { DEFAULT_SVG_OPTIONS, type SvgImportOptions } from "./convert"
import "./svg-import.css"

export type SvgImportMode = "vector" | "image"

export interface SvgImportChoice {
  mode: SvgImportMode
  options: SvgImportOptions
}

interface SvgImportPopoverProps {
  fileName: string
  /** "Editable paths in a frame. 14 paths · 3 groups · …" (describeStats). */
  vectorDescription: string
  /** Image option description (the asset path it will create). */
  imageDescription: string
  initial?: SvgImportChoice
  /** Outline strokes needs the canvas' outliner; false disables that toggle. */
  canOutline?: boolean
  /** Stroked paths found by the parse (`SvgStats.stroked`): 0 disables Outline strokes. */
  strokedPaths?: number
  onImport: (choice: SvgImportChoice) => void
  onCancel: () => void
  anchor?: HTMLElement | { x: number; y: number; width: number; height: number } | null
  inline?: boolean
}

export function SvgImportPopover({
  fileName,
  vectorDescription,
  imageDescription,
  initial,
  canOutline = true,
  strokedPaths = 0,
  onImport,
  onCancel,
  anchor,
  inline = false,
}: SvgImportPopoverProps) {
  const [mode, setMode] = useState<SvgImportMode>(initial?.mode ?? "vector")
  const [options, setOptions] = useState<SvgImportOptions>(initial?.options ?? DEFAULT_SVG_OPTIONS)
  const id = useId()
  const row = (k: keyof SvgImportOptions, label: string, disabled: boolean, sub?: string) => (
    <div className="svg-import__option" key={sub === undefined ? k : undefined}>
      <span id={`${id}-${k}`} className="svg-import__option-label">
        {label}
      </span>
      <Toggle
        checked={options[k] && !disabled}
        disabled={disabled}
        aria-labelledby={`${id}-${k}`}
        {...(sub !== undefined ? { "aria-describedby": `${id}-${k}-sub` } : {})}
        onChange={(v) => setOptions((o) => ({ ...o, [k]: v }))}
      />
    </div>
  )
  const toggle = (k: keyof SvgImportOptions, label: string) => row(k, label, false)
  const outlineOff = !canOutline || strokedPaths < 1
  const outlineSub = outlineStrokesSub(strokedPaths)
  return (
    <Popover
      wide
      title={`Import ${fileName}`}
      className="svg-import"
      initialFocus={inline ? "none" : "first"}
      onClose={onCancel}
      {...(anchor ? { anchor: anchor as HTMLElement } : {})}
      data-pen="mevh8"
    >
      <div className="svg-import__as" role="radiogroup" aria-label="Import as">
        {(
          [
            ["vector", "Vector paths", PenTool],
            ["image", "Image", ImageIcon],
          ] as const
        ).map(([m, label, Icon]) => (
          // biome-ignore lint/a11y/useSemanticElements: a pill segmented control (E3zTd), not native radios
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={`svg-import__as-option${mode === m ? " svg-import__as-option--active" : ""}`}
            onClick={() => setMode(m)}
          >
            <Icon className="svg-import__as-icon" aria-hidden="true" />
            <span className="svg-import__as-label">{label}</span>
          </button>
        ))}
      </div>
      <p className="svg-import__desc">{mode === "vector" ? vectorDescription : imageDescription}</p>
      {mode === "vector" && [
        toggle("keepGroups", "Keep groups as frames"),
        toggle("matchVariables", "Match fills to variables"),
        <div className="svg-import__option-group" key="outlineStrokes">
          {row("outlineStrokes", "Outline strokes", outlineOff, outlineSub)}
          <p id={`${id}-outlineStrokes-sub`} className="svg-import__option-sub">
            {outlineSub}
          </p>
        </div>,
      ]}
      <div className="svg-import__actions">
        <Button variant="ghost" size="sm" className="svg-import__cancel" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="svg-import__import"
          onClick={() => onImport({ mode, options })}
        >
          Import
        </Button>
      </div>
    </Popover>
  )
}

/**
 * Sub line of Outline strokes (G3tQz): "6 stroked paths become filled shapes, so they scale
 * without changing weight. Dashes are kept as segments.", or "No strokes in this file".
 */
function outlineStrokesSub(stroked: number): string {
  if (stroked < 1) return "No strokes in this file"
  return stroked === 1
    ? "1 stroked path becomes a filled shape, so it scales without changing weight. Dashes are kept as segments."
    : `${stroked} stroked paths become filled shapes, so they scale without changing weight. Dashes are kept as segments.`
}
