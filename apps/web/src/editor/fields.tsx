/**
 * Field adapters over `@kimo/ui` controls for the Design tab: numeric fields with keyword /
 * multi-value text input, enum fields, and color swatches backed by a native color picker.
 * Every edit goes through `session.apply` (origin "user"); scrubs and picker drags are grouped
 * into one undo step per gesture.
 */
import type { Op } from "@kimo/editor-state"
import { ColorField, PropField } from "@kimo/ui"
import { type ReactNode, useEffect, useRef } from "react"
import { MIXED, MIXED_LABEL, type Mixed } from "./props"
import type { FileSession, Gesture } from "./session"

/**
 * Applies ops either as a lone edit or as a step of the current gesture. A gesture never
 * outlives what it edits: it ends when `resetKey` (the selection) changes and on unmount, so a
 * scrub whose field disappeared cannot turn later edits into gesture steps.
 */
export function useEditor(session: FileSession, resetKey: string) {
  const gesture = useRef<Gesture | null>(null)
  const end = () => {
    gesture.current?.end()
    gesture.current = null
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the trigger
  useEffect(() => end, [resetKey])
  return {
    apply(ops: readonly Op[], label: string) {
      if (ops.length === 0) return
      if (gesture.current && !gesture.current.done) gesture.current.apply(ops, label)
      else session.apply(ops, label)
    },
    begin() {
      end()
      gesture.current = session.gesture()
    },
    end,
  }
}
export type Editor = ReturnType<typeof useEditor>

export interface NumberFieldProps {
  prefix: string
  label: string
  /** Number, a keyword/compound display string, or MIXED. */
  value: number | string | Mixed
  editor: Editor
  /** Ops for a numeric value (typed, arrow-nudged or scrubbed). */
  onNumber(n: number): readonly Op[]
  /**
   * For a keyword value (Mixed, Hug, Fill): snapshots the selection's current numbers and
   * returns ops shifting each by a delta, so arrows/scrubs step every node from its own
   * value. Without it, arrows and scrubs do nothing on Mixed.
   */
  relative?(): (delta: number) => readonly Op[]
  /**
   * Ops for non-numeric text (`fill`, `hug`, `64 96`, `120+24`); null = invalid, ignored.
   * Without it, only plain numbers are accepted.
   */
  onText?(text: string): readonly Op[] | null
  min?: number
  step?: number
  disabled?: boolean
}

/**
 * A `PropField` that also accepts text: the ui field only parses plain numbers, so Enter/blur
 * are intercepted (capture phase) to route anything else through `onText`.
 */
export function NumberField(p: NumberFieldProps) {
  const display = p.value === MIXED ? MIXED_LABEL : p.value
  const label = `Set ${p.label}`
  /** The scrub's snapshot (relative mode); arrows snapshot per press. */
  const rel = useRef<((delta: number) => readonly Op[]) | null>(null)
  const keyword = typeof display !== "number"
  const onDelta =
    keyword && p.relative
      ? (delta: number) => {
          const shift = rel.current ?? p.relative?.()
          if (shift) p.editor.apply(shift(delta), label)
        }
      : p.value === MIXED
        ? () => {}
        : undefined
  const handleText = (input: HTMLInputElement) => {
    const text = input.value.trim()
    if (!p.onText || text === "" || text === String(display)) return
    if (Number.isFinite(Number(text.replace(",", ".")))) return // PropField commits it
    const ops = p.onText(text)
    if (ops) p.editor.apply(ops, label)
  }
  return (
    <div
      className="field"
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) handleText(e.target)
      }}
      onBlurCapture={(e) => {
        if (e.target instanceof HTMLInputElement) handleText(e.target)
      }}
    >
      <PropField
        prefix={p.prefix}
        inputLabel={p.label}
        value={display}
        step={p.step ?? 1}
        min={p.min}
        disabled={p.disabled}
        onChange={(n) => p.editor.apply(p.onNumber(n), label)}
        onDelta={onDelta}
        onScrubStart={() => {
          rel.current = keyword && p.relative ? p.relative() : null
          p.editor.begin()
        }}
        onScrubEnd={() => {
          rel.current = null
          p.editor.end()
        }}
      />
    </div>
  )
}

export interface EnumFieldProps<V extends string> {
  prefix: string
  label: string
  value: V | Mixed | undefined
  options: readonly { value: V; label: string }[]
  onChange(value: V): void
  disabled?: boolean
}

/**
 * An enum shown as the design's `PropField` ("Align · Center") with a transparent native
 * `<select>` on top, so the field keeps the node's look and gets the platform picker.
 */
export function EnumField<V extends string>(p: EnumFieldProps<V>) {
  const current = p.value === MIXED ? undefined : p.value
  const text =
    p.value === MIXED ? MIXED_LABEL : (p.options.find((o) => o.value === current)?.label ?? "—")
  return (
    <div className="field field--enum">
      <div className="field__face" inert>
        <PropField prefix={p.prefix} value={text} disabled={p.disabled} />
      </div>
      <select
        className="field__select"
        aria-label={p.label}
        value={current ?? ""}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.currentTarget.value as V)}
      >
        {current === undefined && <option value="">{text}</option>}
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export interface ColorRowProps {
  /** Swatch CSS color. */
  swatch: string
  value: string
  opacity?: string
  label: string
  /** `#RRGGBB` for the picker's initial value; null = the swatch is not editable. */
  pickerValue: string | null
  /** Ops for a picked color (`#RRGGBB`). */
  onPick?(rgb: string): readonly Op[]
  editor: Editor
  /**
   * Trailing control (remove button): overlaid on the field's right end and revealed on
   * hover / keyboard focus, so the field keeps the design's full width (fill_container) at rest.
   */
  children?: ReactNode
}

/** A `ColorField` whose swatch opens the native color picker (one undo step per pick). */
export function ColorRow(p: ColorRowProps) {
  const input = useRef<HTMLInputElement>(null)
  const picking = useRef(false)
  const { editor } = p
  const end = useRef(() => {})
  end.current = () => {
    if (picking.current) editor.end()
    picking.current = false
  }

  useEffect(() => {
    const el = input.current
    if (!el) return
    const onChange = () => end.current()
    el.addEventListener("change", onChange)
    return () => {
      el.removeEventListener("change", onChange)
      // The row went away mid-pick (selection changed): close the undo group.
      end.current()
    }
  }, [])

  return (
    <div className="color-row">
      <ColorField
        className="color-row__field"
        color={p.swatch}
        value={p.value}
        opacity={p.opacity}
        swatchLabel={`Edit ${p.label}`}
        onSwatchClick={() => p.pickerValue && input.current?.click()}
      />
      {p.pickerValue && (
        <input
          ref={input}
          className="color-row__picker"
          type="color"
          tabIndex={-1}
          aria-label={`${p.label} color`}
          value={p.pickerValue.slice(0, 7).toLowerCase()}
          onChange={(e) => {
            if (!p.onPick) return
            if (!picking.current) {
              picking.current = true
              editor.begin()
            }
            editor.apply(p.onPick(e.currentTarget.value.toUpperCase()), `Set ${p.label}`)
          }}
          onBlur={() => end.current()}
        />
      )}
      {p.children && <span className="color-row__actions">{p.children}</span>}
    </div>
  )
}
