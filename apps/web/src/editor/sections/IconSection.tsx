/**
 * Icon section for icon nodes (board 09 panel fragment `CVMdd`): Icon Field (opens the icon
 * picker) and a Row of Size · Stroke (lucide/feather `strokeWidth`) or Weight (material,
 * phosphor `weight`).
 */
import { IconGlyphSvg, PropRow, PropSection } from "@kimo/ui"
import { useRef, useState } from "react"
import { NumberField } from "../fields"
import { type Sel, useKeepPopoverFocus, usePanel } from "../panel-context"
import { IconPickerPopover } from "../popovers/IconPicker"
import { MIXED, setOps, shared } from "../props"
import {
  iconLibrary,
  iconStrokeOf,
  iconWeightOf,
  isStrokeLibrary,
  LIBRARY_LABEL,
  numText,
} from "../style"

export function IconSection({ sel }: { sel: readonly Sel[] }) {
  const { editor, icons } = usePanel()
  const nodes = sel.map((s) => s.node)
  const ids = sel.map((s) => s.id)
  const set = shared(nodes, (n) => String(n.set))
  const name = shared(nodes, (n) =>
    typeof n.icon === "string" ? n.icon : `$${String((n.icon as { $ref?: unknown })?.$ref)}`,
  )
  const library = set === MIXED ? null : iconLibrary(set)
  const strokeLib = library !== null && isStrokeLibrary(library)
  const size = shared(nodes, (n) =>
    typeof n.w === "number" && n.w === n.h
      ? n.w
      : typeof n.w === "number"
        ? `${n.w}×${String(n.h)}`
        : "—",
  )
  const stroke = shared(nodes, (n) => numText(iconStrokeOf(n)))
  const weight = shared(nodes, (n) => numText(iconWeightOf(n)))
  const weightNumber = shared(nodes, (n) => {
    const w = iconWeightOf(n)
    return typeof w === "number" ? w : 400
  })
  const glyphWeight = weightNumber === MIXED ? 400 : weightNumber
  const field = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  useKeepPopoverFocus(open)

  return (
    <PropSection title="Icon">
      <div className="rp-body">
        {/* Icon Field (RrRtL): h 28, padding [0, 8], gap 8, radius-sm */}
        <button
          ref={field}
          type="button"
          className={open ? "rp-icon-field rp-icon-field--open" : "rp-icon-field"}
          aria-label={`Icon: ${name === MIXED ? "Mixed" : name}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="rp-icon-field__glyph">
            {icons && set !== MIXED && name !== MIXED && (
              <IconGlyphSvg
                provider={icons}
                set={set}
                name={name}
                weight={library === "material" || library === "phosphor" ? glyphWeight : undefined}
              />
            )}
          </span>
          <span className="rp-icon-field__name">{name === MIXED ? "Mixed" : name}</span>
          <span className="rp-spacer" />
          <span className="rp-icon-field__library">
            {library ? LIBRARY_LABEL[library] : "Mixed"}
          </span>
        </button>
        <PropRow className="rp-row">
          <NumberField
            prefix="Size"
            label="Icon size"
            value={size}
            editor={editor}
            min={1}
            onNumber={(n) => [
              ...setOps(ids, "w", Math.max(1, n)),
              ...setOps(ids, "h", Math.max(1, n)),
            ]}
          />
          {strokeLib ? (
            <NumberField
              prefix="Stroke"
              label="Icon stroke"
              value={stroke === MIXED ? MIXED : Number(stroke) || stroke}
              editor={editor}
              min={0.25}
              step={0.25}
              onNumber={(n) => setOps(ids, "strokeWidth", n === 2 ? undefined : Math.max(0.25, n))}
            />
          ) : (
            <NumberField
              prefix="Weight"
              label="Icon weight"
              value={weight === MIXED ? MIXED : Number(weight) || weight}
              editor={editor}
              min={100}
              max={700}
              step={100}
              onNumber={(n) => setOps(ids, "weight", weightValue(n))}
            />
          )}
        </PropRow>
      </div>
      {open && field.current && icons && (
        <IconPickerPopover
          anchor={field.current}
          provider={icons}
          set={set === MIXED ? "lucide" : set}
          name={name === MIXED ? "" : name}
          weight={glyphWeight}
          onPick={(s, n) =>
            editor.apply([...setOps(ids, "set", s), ...setOps(ids, "icon", n)], "Set icon")
          }
          onWeight={(w) => {
            if (library === "material" || library === "phosphor")
              editor.apply(setOps(ids, "weight", weightValue(w)), "Set icon weight")
          }}
          onClose={() => {
            editor.end()
            setOpen(false)
          }}
        />
      )}
    </PropSection>
  )
}

/** Weight 100–700 (400 = the sets' regular weight, stored only when different). */
const weightValue = (n: number) => {
  const w = Math.round(Math.min(700, Math.max(100, n)))
  return w === 400 ? undefined : w
}
