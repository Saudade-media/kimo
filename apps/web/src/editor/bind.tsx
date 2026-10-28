/**
 * Board 27 §7 (H7PYY) bindable property fields: the glue between a Design-tab field and the
 * `@kimo/ui` binding pieces.
 *
 * - Unbound: the host field renders as `PropField/Bindable` (LFrgQ): hover / focus shows the
 *   20 px 'variable' button at its right edge (`slot.trailing`, `slot.className`); ⌥-click on
 *   the field's prefix opens the picker directly (rule cKfGF).
 * - Bound (every selected node bound to the same variable): `PropField/Bound` (egdNP) — type
 *   glyph + mono name chip, resolved value trailing (hidden < 140 px), chip = reopen picker,
 *   hover Detach (rule HC0Yq).
 * - Picker (rule wDOBf): `VariablePicker` 320 under the field, type-filtered, "This file" then
 *   each import alias; footer "Create variable from <value>" · Detach.
 * - Detach (rule RAez2): writes each node's currently resolved value as a literal, one undo
 *   step. Bound values resolve per node theme (rule qKGyA).
 */
import { defaultTheme, type KimoDocument, type Libraries, type Theme } from "@kimo/core-schema"
import type { NodeData, Op } from "@kimo/editor-state"
import { BindButton, PropFieldBound, VariablePicker } from "@kimo/ui"
import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  type BindType,
  newVariable,
  newVariableName,
  pickerGroups,
  refName,
  resolveRef,
  sharedRef,
  valueText,
} from "./bindings"
import { type Sel, usePanel } from "./panel-context"

/** How one field reads and writes its (possibly bound) value. */
export interface BindSpec {
  type: BindType
  /** Field name: picker title "Bind <label>", accessible names, undo labels. */
  label: string
  /** Bound chip prefix (`Gap`, `R`, `↔`, `Op`); omit for rows without one. */
  prefix?: ReactNode
  /** The stored value of the field on a node (a literal or a `{ $ref }` binding). */
  get(node: NodeData): unknown
  /** Ops writing `value` (a binding or a literal of the field's type) to one node. */
  put(s: Sel, value: unknown): Op[]
  /** Trailing / picker text of a resolved literal (default: the number / string as-is). */
  format?(v: number | string | boolean): string
  /** The selection's shared literal for "Create variable from <value>" (null: hidden). */
  current?(): number | string | boolean | null
  /** Base of a created variable's name (`gap` → `gap/16`). Default: the label. */
  varBase?: string
}

/** What an unbound host field adds to its frame (PropField/Bindable LFrgQ). */
export interface BindSlot {
  /** Frame class: `kimo-prop-field--bindable` (hover / focus look + button visibility). */
  className: string
  /** The Bind Button, last inside the frame. */
  trailing: ReactNode
}

const NO_LIBS: Libraries = {}
const noop = () => () => {}
const empty = () => NO_LIBS

/** Libraries of the file (re-renders when one loads) and a per-node theme reader. */
function useBindingEnv() {
  const { header, m3, theme } = usePanel()
  const libs = useSyncExternalStore(
    m3 ? m3.libs.subscribe : noop,
    m3 ? () => m3.libraries() : empty,
  )
  const base = useMemo(() => defaultTheme(header as unknown as KimoDocument, libs), [header, libs])
  const themeOf = useCallback(
    (id: string): Theme => {
      try {
        return m3 ? m3.view().theme(id) : (theme ?? base)
      } catch {
        return theme ?? base
      }
    },
    [m3, theme, base],
  )
  return { header, libraries: libs, themeOf, base }
}

const PREFIX_SELECTOR =
  ".kimo-prop-field__prefix, .kimo-size-field__prefix, .rp-bind-label, .rp-toggle-row__label"

/**
 * One bindable field. `children(slot)` renders the regular (unbound) field; the slot carries the
 * Bind Button and the bindable frame class. Bound selections render `PropFieldBound` instead.
 */
export function Bindable({
  sel,
  spec,
  className,
  defaultOpen,
  onPickerClose,
  children,
}: {
  sel: readonly Sel[]
  spec: BindSpec
  /** Wrapper class (row layout: `rp-field`, `rp-field--w96`, …). */
  className?: string
  /** Open the picker on mount (a "Bind … to variable" request from the layer menu). */
  defaultOpen?: boolean
  /** The picker closed (bound, detached or dismissed). */
  onPickerClose?: () => void
  children: (slot: BindSlot) => ReactNode
}) {
  const { editor } = usePanel()
  const { header, libraries, themeOf } = useBindingEnv()
  const [open, setOpenState] = useState(defaultOpen ?? false)
  const setOpen = (next: boolean | ((o: boolean) => boolean)) =>
    setOpenState((o) => {
      const v = typeof next === "function" ? next(o) : next
      if (o && !v) queueMicrotask(() => onPickerClose?.())
      return v
    })
  const root = useRef<HTMLDivElement>(null)
  const alt = useRef<{ x: number; y: number; id: number } | null>(null)
  const values = sel.map((s) => spec.get(s.node))
  const ref = sharedRef(values)
  const format = (v: number | string | boolean) => (spec.format ? spec.format(v) : String(v))
  const first = sel[0]
  const resolved =
    ref !== null && first ? resolveRef(header, libraries, ref, spec.type, themeOf(first.id)) : null

  const write = (value: (s: Sel) => unknown, label: string, extra: Op[] = []) => {
    const ops = [...extra]
    for (const s of sel) {
      const v = value(s)
      if (v !== undefined) ops.push(...spec.put(s, v))
    }
    editor.apply(ops, label)
  }
  const bind = (target: string) => {
    write(() => ({ $ref: target }), `Bind ${spec.label.toLowerCase()}`)
    setOpen(false)
  }
  const detach = () => {
    write((s) => {
      const r = resolveRef(header, libraries, String(ref), spec.type, themeOf(s.id))
      return r.value ?? undefined
    }, `Detach ${spec.label.toLowerCase()}`)
    setOpen(false)
  }
  const literal = ref === null ? (spec.current?.() ?? null) : (resolved?.value ?? null)
  const create = () => {
    if (literal === null) return
    const name = newVariableName(header, spec.varBase ?? spec.label, literal)
    write(() => ({ $ref: name }), `Create variable ${name}`, [
      {
        op: "setVariables",
        set: { [name]: newVariable(spec.type, literal) as never },
      },
    ])
    setOpen(false)
  }

  const picker = open && (
    <VariablePicker
      anchor={root.current}
      title={`Bind ${spec.label}`}
      type={spec.type}
      groups={pickerGroups(header, libraries, spec.type, first ? themeOf(first.id) : {})}
      selected={ref ?? undefined}
      onSelect={bind}
      createLabel={
        literal === null ? undefined : `Create variable from ${valueText(spec.type, literal)}`
      }
      onCreate={create}
      onDetach={ref !== null ? detach : undefined}
      onClose={() => setOpen(false)}
    />
  )

  if (ref !== null) {
    return (
      <div ref={root} className={className ? `rp-bind ${className}` : "rp-bind"}>
        <PropFieldBound
          prefix={spec.prefix}
          type={spec.type}
          label={spec.label}
          name={refName(ref)}
          resolved={resolved?.value != null ? format(resolved.value) : undefined}
          missing={resolved?.missing ?? false}
          active={open}
          onOpen={() => setOpen((o) => !o)}
          onDetach={resolved?.value != null ? detach : undefined}
        />
        {picker}
      </div>
    )
  }

  // ⌥-click on the prefix / label opens the picker (no drag: an ⌥-drag stays a fine scrub).
  const onDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement
    alt.current =
      e.altKey && e.button === 0 && t.closest(PREFIX_SELECTOR)
        ? { x: e.clientX, y: e.clientY, id: e.pointerId }
        : null
  }
  const onUp = (e: PointerEvent) => {
    const a = alt.current
    alt.current = null
    if (!a || a.id !== e.pointerId) return
    if (Math.abs(e.clientX - a.x) < 3 && Math.abs(e.clientY - a.y) < 3) setOpen(true)
  }
  return (
    <div
      ref={root}
      className={className ? `rp-bind ${className}` : "rp-bind"}
      data-bind-open={open || undefined}
      onPointerDownCapture={onDown}
      onPointerUpCapture={onUp}
    >
      {children({
        className: "kimo-prop-field--bindable",
        trailing: (
          <BindButton
            label={`Bind ${spec.label.toLowerCase()} to a variable`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setOpen((o) => !o)}
          />
        ),
      })}
      {picker}
    </div>
  )
}

/**
 * A boolean / full-width bound row (board 27 §7 c `kRMBZ` "Visible"): row, gap 8, center →
 * Label sans 11 text-tertiary · the field (fill).
 */
export function BindRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rp-bind-row">
      <span className="rp-bind-label">{label}</span>
      {children}
    </div>
  )
}

/** A static (non-editable) bindable value field: the unbound look of a boolean binding row. */
export function StaticField({ value, bind }: { value: string; bind: BindSlot }) {
  return (
    <div className={`rp-field kimo-prop-field ${bind.className}`}>
      <span className="kimo-prop-field__value rp-static-value">{value}</span>
      {bind.trailing}
    </div>
  )
}

// --- "Bind … to variable" requests (layer context menu → Design tab) ----------------------------

/** Fields without a panel control of their own: their bound row shows only on request. */
type BindRequestField = "visible" | "content"

let request: BindRequestField | null = null
const requestListeners = new Set<() => void>()

/** Asks the Design tab to show `field`'s row and open its picker. */
export function requestBind(field: BindRequestField | null): void {
  request = field
  for (const l of [...requestListeners]) l()
}

/** The pending request for `field` (true) and a function that clears it. */
export function useBindRequest(field: BindRequestField): [boolean, () => void] {
  const pending = useSyncExternalStore(
    (cb) => {
      requestListeners.add(cb)
      return () => requestListeners.delete(cb)
    },
    () => request === field,
  )
  return [pending, () => requestBind(null)]
}
