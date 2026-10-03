/**
 * Effects section (board 08 `Vyrj5`): EffectRow per effect (list order); the open row is
 * followed by its details (`eq3UU`, column gap 8): shadows Row X · Y, Row Blur · Spread and
 * the shadow ColorField; blurs a single Blur field.
 */
import { ColorField, type EffectKind, EffectRow, PropRow, PropSection } from "@kimo/ui"
import { Fragment, useRef, useState } from "react"
import { Icon } from "../../lib/icons"
import { NumberField } from "../fields"
import { SectionTitle } from "../m3/overrides"
import { type Sel, useKeepPopoverFocus, usePanel, useResolver } from "../panel-context"
import { ColorPickerPopover, type ColorValue } from "../popovers/ColorPicker"
import { effectList, MIXED, setOps, shared, splitHex } from "../props"
import {
  effectKind,
  effectNumber,
  effectVisible,
  NEW_EFFECT,
  withEffectField,
  withEffectKind,
  withEffectVisible,
} from "../style"

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isRef = (v: unknown): v is { $ref: string } => isObj(v) && typeof v.$ref === "string"

export function EffectsSection({ sel }: { sel: readonly Sel[] }) {
  const { editor } = usePanel()
  const resolve = useResolver()
  const ids = sel.map((s) => s.id)
  const effects = shared(
    sel.map((s) => s.node),
    (n) => n.effects,
  )
  const list = effects === MIXED ? [] : effectList(effects)
  const [open, setOpen] = useState<number | null>(null)
  const [picker, setPicker] = useState(false)
  useKeepPopoverFocus(picker)
  const colorField = useRef<HTMLDivElement>(null)
  const write = (next: unknown[], label: string) =>
    editor.apply(setOps(ids, "effects", next.length ? next : undefined), label)
  const replace = (i: number, e: unknown) => list.map((x, j) => (j === i ? e : x))
  const add = () => {
    const base = effects === MIXED ? [] : list
    write([...base, NEW_EFFECT], "Add effect")
    setOpen(base.length)
  }
  const num = (e: unknown, key: string) => {
    const v = effectNumber(e, key)
    return typeof v === "number" ? v : `$${v.$ref}`
  }
  const field = (
    i: number,
    e: unknown,
    key: string,
    prefix: string,
    label: string,
    min?: number,
  ) => (
    <NumberField
      prefix={prefix}
      label={label}
      value={num(e, key)}
      editor={editor}
      min={min}
      onNumber={(n) =>
        setOps(
          ids,
          "effects",
          replace(i, withEffectField(e, key, min !== undefined ? Math.max(min, n) : n)),
        )
      }
    />
  )

  return (
    <PropSection
      title={<SectionTitle label="Effects" fields={["effects"]} />}
      action={{ label: "Add effect", icon: <Icon name="plus" size={14} />, onClick: add }}
    >
      {(effects === MIXED || isRef(effects) || list.length > 0) && (
        <div className="rp-body">
          {(effects === MIXED || isRef(effects)) && (
            <ColorField
              color="var(--kimo-bg-muted)"
              value={isRef(effects) ? effects.$ref : "Mixed"}
              valueFont="sans"
            />
          )}
          {list.map((e, i) => {
            const kind = effectKind(e)
            const shadow = kind === "drop-shadow" || kind === "inner-shadow"
            const visible = effectVisible(e)
            const color = isObj(e) ? e.color : undefined
            const hex = typeof color === "string" ? splitHex(color) : null
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: effects have no ids; order is identity
              <Fragment key={i}>
                <EffectRow
                  kind={kind}
                  visible={visible}
                  open={open === i}
                  removable
                  onToggleOpen={() => {
                    setPicker(false)
                    setOpen((o) => (o === i ? null : i))
                  }}
                  onKindChange={(k: EffectKind) =>
                    write(replace(i, withEffectKind(e, k)), "Set effect type")
                  }
                  onToggleVisible={() =>
                    write(
                      replace(i, withEffectVisible(e, !visible)),
                      visible ? "Hide effect" : "Show effect",
                    )
                  }
                  onRemove={() => {
                    setOpen(null)
                    setPicker(false)
                    write(
                      list.filter((_, j) => j !== i),
                      "Remove effect",
                    )
                  }}
                />
                {open === i && (
                  /* Drop shadow details (eq3UU): column, gap 8 */
                  <div className="rp-effect-details">
                    {shadow ? (
                      <>
                        <PropRow className="rp-row">
                          {field(i, e, "x", "X", "Shadow X")}
                          {field(i, e, "y", "Y", "Shadow Y")}
                        </PropRow>
                        <PropRow className="rp-row">
                          {field(i, e, "blur", "Blur", "Shadow blur", 0)}
                          {field(i, e, "spread", "Spread", "Shadow spread")}
                        </PropRow>
                        <ColorField
                          ref={colorField}
                          color={
                            hex
                              ? (color as string)
                              : isRef(color)
                                ? (resolve(color.$ref) ?? "#000000")
                                : "#000000"
                          }
                          value={hex ? hex.rgb.slice(1) : isRef(color) ? color.$ref : "—"}
                          valueFont={hex ? "mono" : "sans"}
                          opacity={hex ? `${Math.round(hex.alpha * 100)}%` : "100%"}
                          highlight={picker ? "active" : undefined}
                          swatchLabel="Edit shadow color"
                          onSwatchClick={(ev) => {
                            ev.stopPropagation()
                            setPicker((p) => !p)
                          }}
                          onClick={() => setPicker((p) => !p)}
                        />
                        {picker && colorField.current && (
                          <ColorPickerPopover
                            anchor={colorField.current}
                            value={(hex || isRef(color) ? color : "#000000") as ColorValue}
                            onChange={(c) =>
                              write(replace(i, withEffectField(e, "color", c)), "Set shadow color")
                            }
                            onClose={() => {
                              editor.end()
                              setPicker(false)
                            }}
                          />
                        )}
                      </>
                    ) : (
                      <PropRow className="rp-row">
                        {field(i, e, "radius", "Blur", "Blur radius", 0)}
                      </PropRow>
                    )}
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      )}
    </PropSection>
  )
}
