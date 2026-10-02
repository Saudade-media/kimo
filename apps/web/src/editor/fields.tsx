/**
 * Field adapters over `@kimo/ui` controls for the Design tab: numeric fields with keyword /
 * unit / multi-value text input and toggle rows. Every edit goes through
 * `session.apply` (origin "user"); scrubs, drags and live previews are grouped into one undo
 * step per gesture.
 */
import type { Op } from "@kimo/editor-state"
import { PropField, Toggle } from "@kimo/ui"
import { useEffect, useId, useRef } from "react"
import { Icon } from "../lib/icons"
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
    /**
     * Applies `ops` (one undo step), or replaces the current gesture's previous step. Ops must
     * be absolute (the target state), since a gesture step reverts the previous one first.
     */
    apply(ops: readonly Op[], label: string) {
      if (ops.length === 0) return
      if (gesture.current && !gesture.current.done) gesture.current.apply(ops, label)
      else session.apply(ops, label)
    },
    /** Starts a gesture: every `apply` until `end` collapses into one undo step. */
    begin() {
      end()
      gesture.current = session.gesture()
    },
    end,
    /** True while a gesture is open. */
    get active() {
      return gesture.current !== null && !gesture.current.done
    },
  }
}
export type Editor = ReturnType<typeof useEditor>

/**
 * Gesture bracketing for `@kimo/ui` controls with `onChangeStart` / `onChangeEnd` (sliders,
 * color area, stop bar, popovers): every change between them is one undo step.
 */
export function gestureProps(editor: Editor) {
  return {
    onChangeStart: () => editor.begin(),
    onChangeEnd: () => editor.end(),
  }
}

export interface NumberFieldProps {
  /** Text prefix (`X`, `Gap`), or use `icon`. */
  prefix?: string
  /** Lucide icon prefix (12, text-tertiary), e.g. `rotate-cw`. */
  icon?: string
  label: string
  /** Number, a keyword/compound display string (`Hug`, `100%`, `0°`), or MIXED. */
  value: number | string | Mixed
  editor: Editor
  /** Ops for a numeric value (typed, arrow-nudged or scrubbed). */
  onNumber(n: number): readonly Op[]
  /**
   * For a keyword value (Mixed, Hug, `100%`): snapshots the selection's current numbers and
   * returns ops shifting each by a delta, so arrows/scrubs step every node from its own value.
   */
  relative?(): (delta: number) => readonly Op[]
  /** Ops for non-numeric text (`fill`, `64 96`, `45°`, `80%`); null = invalid, ignored. */
  onText?(text: string): readonly Op[] | null
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
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
      className={p.className ? `rp-field ${p.className}` : "rp-field"}
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) handleText(e.target)
      }}
      onBlurCapture={(e) => {
        if (e.target instanceof HTMLInputElement) handleText(e.target)
      }}
    >
      <PropField
        // Icon prefixes (blend, rotate-cw, …): the design's PropField Prefix slot holds a 12px
        // lucide icon (`kimo-prop-field__prefix--icon`).
        prefix={p.icon ? <Icon name={p.icon} size={12} /> : (p.prefix ?? "")}
        inputLabel={p.label}
        value={display}
        step={p.step ?? 1}
        min={p.min}
        max={p.max}
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

/** ToggleRow (board 08 `goYoe`/`LYzIZ`/`Ax1CJ`/`PMh7z`): h 28, gap 8: label · Spacer · Toggle. */
export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean | Mixed
  onChange(on: boolean): void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="rp-toggle-row">
      <span className="rp-toggle-row__label" id={id}>
        {label}
      </span>
      <span className="rp-spacer" />
      <Toggle
        aria-labelledby={id}
        checked={checked === true}
        disabled={disabled}
        onChange={(c) => onChange(checked === MIXED ? true : c)}
      />
    </div>
  )
}
