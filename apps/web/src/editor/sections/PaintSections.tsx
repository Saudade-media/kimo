/**
 * Fill (`LpXDi`) and Stroke (`qQR6J`) sections of board 08. Paint rows are FillRows listed
 * top paint first (a paint list paints last on top); each row opens the popover of its kind
 * (ColorPicker, GradientEditor, ImageFillPopover). Rows reorder by drag or ⌥↑ / ⌥↓.
 */
import type { NodeData, Op } from "@kimo/editor-state"
import {
  FillRow,
  MenuDense,
  MenuItemDense,
  PropRow,
  PropSection,
  percent,
  Segmented,
  Select,
  StrokeSideFields,
} from "@kimo/ui"
import { type MouseEvent, useRef, useState } from "react"
import { Icon } from "../../lib/icons"
import { NumberField, ToggleRow } from "../fields"
import {
  type Sel,
  useAssetUrls,
  useKeepPopoverFocus,
  usePanel,
  useResolver,
} from "../panel-context"
import { ColorPickerPopover, type ColorValue } from "../popovers/ColorPicker"
import { GradientEditorPopover } from "../popovers/GradientEditor"
import { IMAGE_ACCEPT, ImageFillPopover } from "../popovers/ImageFill"
import { MIXED, type Mixed, mapOps, paintColor, paintList, setOps, shared } from "../props"
import type { FileSession } from "../session"
import {
  DEFAULT_DASH,
  dashOf,
  fillValue,
  gradientFrom,
  moveItem,
  NEW_SOLID,
  paintAlpha,
  paintCss,
  paintKind,
  paintRowLabel,
  paintVisible,
  rowsTopFirst,
  type Sides,
  strokeObj,
  strokeSides,
  strokeWidthOf,
  withDash,
  withPaintVisible,
  withSide,
  withSidesMode,
  withSolid,
  withStrokeField,
} from "../style"

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// --- Paint rows ---------------------------------------------------------------------------

interface PaintRowsProps {
  /** Paints in stored order (last = top). */
  paints: readonly unknown[]
  /** Accessible name stem: "Fill" | "Stroke". */
  name: string
  /** Writes the new list (stored order) as one edit or gesture step. */
  write(list: unknown[], label: string): void
  /** Icon `color`: one solid row, no visibility or reorder. */
  colorOnly?: boolean
}

function PaintRows({ paints, name, write, colorOnly = false }: PaintRowsProps) {
  const { editor } = usePanel()
  const resolve = useResolver()
  const assetUrl = useAssetUrls(
    paints.flatMap((p) =>
      isObj(p) && p.kind === "image" && typeof p.src === "string" ? [p.src] : [],
    ),
  )
  const [open, setOpen] = useState<number | null>(null)
  useKeepPopoverFocus(open)
  const rows = useRef(new Map<number, HTMLDivElement>())
  const drag = useRef<number | null>(null)
  const rowsInOrder = rowsTopFirst(paints)
  const replace = (i: number, next: unknown) => paints.map((p, j) => (j === i ? next : p))
  const openPaint = open !== null ? paints[open] : undefined
  const anchor = open !== null ? rows.current.get(open) : undefined

  return (
    <>
      {rowsInOrder.map(({ item: p, index: i }) => {
        const { label, font } = paintRowLabel(p)
        const kind = paintKind(p)
        const visible = paintVisible(p)
        const who = paints.length > 1 ? `${name} ${paints.length - i}` : name
        return (
          <FillRow
            key={i}
            ref={(el: HTMLDivElement | null) => {
              if (el) rows.current.set(i, el)
              else rows.current.delete(i)
            }}
            name={who.toLowerCase()}
            swatch={paintCss(p, resolve, assetUrl)}
            label={label}
            labelFont={font}
            opacity={percent(paintAlpha(p))}
            visible={visible}
            active={open === i}
            removable
            draggable={!colorOnly && paints.length > 1}
            onDragStart={(e) => {
              drag.current = i
              e.dataTransfer.effectAllowed = "move"
            }}
            onDragOver={(e) => {
              if (drag.current !== null) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              const from = drag.current
              drag.current = null
              if (from === null || from === i) return
              setOpen(null)
              write(moveItem(paints, from, i), `Reorder ${name.toLowerCase()}`)
            }}
            onDragEnd={() => {
              drag.current = null
            }}
            onKeyDown={(e) => {
              if (colorOnly || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return
              e.preventDefault()
              // Up = toward the top paint = a higher stored index.
              const to = e.key === "ArrowUp" ? i + 1 : i - 1
              if (to < 0 || to >= paints.length) return
              setOpen(null)
              write(moveItem(paints, i, to), `Reorder ${name.toLowerCase()}`)
            }}
            onOpen={() => {
              if (kind === "other") return
              setOpen((o) => (o === i ? null : i))
            }}
            onToggleVisible={
              colorOnly
                ? undefined
                : () =>
                    write(
                      replace(i, withPaintVisible(p, !visible)),
                      `${visible ? "Hide" : "Show"} ${name.toLowerCase()}`,
                    )
            }
            onRemove={() => {
              setOpen(null)
              write(
                paints.filter((_, j) => j !== i),
                `Remove ${name.toLowerCase()}`,
              )
            }}
          />
        )
      })}
      {open !== null && anchor && openPaint !== undefined && (
        <PaintPopover
          anchor={anchor}
          paint={openPaint}
          onChange={(next) => write(replace(open, next), `Edit ${name.toLowerCase()}`)}
          onRemove={() => {
            setOpen(null)
            write(
              paints.filter((_, j) => j !== open),
              `Remove ${name.toLowerCase()}`,
            )
          }}
          onClose={() => {
            // A drag still open in the popover (slider, color area, stop) ends here, so the
            // next edit is not taken as a step of it (which would undo the drag's result).
            editor.end()
            setOpen(null)
          }}
        />
      )}
    </>
  )
}

function PaintPopover({
  anchor,
  paint,
  onChange,
  onRemove,
  onClose,
}: {
  anchor: HTMLElement
  paint: unknown
  onChange(next: unknown): void
  onRemove(): void
  onClose(): void
}) {
  const kind = paintKind(paint)
  if (kind === "image" && isObj(paint))
    return (
      <ImageFillPopover
        anchor={anchor}
        paint={paint}
        onChange={onChange}
        onRemove={onRemove}
        onClose={onClose}
      />
    )
  if ((kind === "linear" || kind === "radial" || kind === "angular") && isObj(paint))
    return (
      <GradientEditorPopover anchor={anchor} paint={paint} onChange={onChange} onClose={onClose} />
    )
  const c = paintColor(paint)
  return (
    <ColorPickerPopover
      anchor={anchor}
      value={(c ?? "#000000") as ColorValue}
      onChange={(color) => onChange(withSolid(paint, color))}
      onClose={onClose}
    />
  )
}

/** A Mixed placeholder row (values differ across the selection). */
function MixedRow({ name }: { name: string }) {
  return (
    <FillRow
      name={name.toLowerCase()}
      swatch="var(--kimo-bg-muted)"
      label="Mixed"
      labelFont="sans"
      visible
      removable={false}
    />
  )
}

/** "+" opens a Menu/Dense with the paint kinds (solid, gradient, image). */
function useAddMenu(add: (kind: "solid" | "linear" | "image") => void) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const menu = anchor && (
    <MenuDense
      label="Add paint"
      anchor={anchor}
      autoFocus
      width={168}
      onClose={() => setAnchor(null)}
    >
      {(
        [
          ["solid", "Solid"],
          ["linear", "Gradient"],
          ["image", "Image…"],
        ] as const
      ).map(([k, label]) => (
        <MenuItemDense
          key={k}
          label={label}
          onSelect={() => {
            setAnchor(null)
            add(k)
          }}
        />
      ))}
    </MenuDense>
  )
  return {
    menu,
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      const el = e.currentTarget
      setAnchor((a) => (a ? null : el))
    },
  }
}

/**
 * Opens the file dialog and stores the picked image as an asset. Resolves null when the
 * dialog is cancelled or the file is rejected (unsupported format, too large).
 */
function pickImage(put: (f: File) => Promise<{ src: string }>): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = IMAGE_ACCEPT
    input.addEventListener("cancel", () => resolve(null))
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      put(f).then(
        (i) => resolve(i.src),
        (e) => {
          console.warn("Kimo: image import failed", e)
          resolve(null)
        },
      )
    }
    input.click()
  })
}

/**
 * The selection as it is NOW in the store (after an await): an async edit (file dialog,
 * hashing) must append to the current value, not to the one captured before it started, or a
 * change made meanwhile (another tab, sync) is overwritten. Deleted nodes are dropped.
 */
function current(store: FileSession["store"], ids: readonly string[]): Sel[] {
  const out: Sel[] = []
  for (const id of ids) {
    const node = store.getNode(id)
    if (node) out.push({ id, node })
  }
  return out
}

// --- Fill ---------------------------------------------------------------------------------

export function FillSection({ sel }: { sel: readonly Sel[] }) {
  const { editor, assets, session } = usePanel()
  const nodes = sel.map((s) => s.node)
  const ids = sel.map((s) => s.id)
  const icon = nodes.every((n) => n.type === "icon")
  const fill = shared(nodes, (n) => n.fill)
  const list = fill === MIXED ? [] : paintList(fill)
  const wasArray = fill !== MIXED && Array.isArray(fill)
  const write = (next: unknown[], label: string) =>
    editor.apply(setOps(ids, "fill", fillValue(next, wasArray || next.length > 1)), label)
  const add = useAddMenu(async (kind) => {
    const base = fill === MIXED ? [] : list
    let paint: unknown = NEW_SOLID
    if (kind === "linear") paint = gradientFrom(base[base.length - 1] ?? "#0A0A0A")
    if (kind === "image") {
      if (!assets) return
      const src = await pickImage((f) => assets.put(f))
      if (!src) return
      paint = { kind: "image", src }
      // Re-read after the await: append to each node's current fill.
      editor.apply(
        mapOps(current(session.store, ids), "fill", (n) => {
          const now = paintList(n.fill)
          return fillValue([...now, paint], Array.isArray(n.fill) || now.length > 0)
        }),
        "Add fill",
      )
      return
    }
    editor.apply(setOps(ids, "fill", fillValue([...base, paint], base.length > 0)), "Add fill")
  })

  if (icon) {
    // Icon nodes: one solid color (`color`; absent = #000000).
    const color = shared(nodes, (n) => n.color ?? "#000000")
    return (
      <PropSection title="Fill">
        <div className="rp-body">
          {color === MIXED ? (
            <MixedRow name="Fill" />
          ) : (
            <PaintRows
              paints={[color]}
              name="Fill"
              colorOnly
              write={(list, label) =>
                editor.apply(setOps(ids, "color", list.length ? list[0] : undefined), label)
              }
            />
          )}
        </div>
      </PropSection>
    )
  }

  return (
    <PropSection
      title="Fill"
      action={{ label: "Add fill", icon: <Icon name="plus" size={14} />, onClick: add.onClick }}
    >
      {(fill === MIXED || list.length > 0) && (
        <div className="rp-body">
          {fill === MIXED ? (
            <MixedRow name="Fill" />
          ) : (
            <PaintRows paints={list} name="Fill" write={write} />
          )}
        </div>
      )}
      {add.menu}
    </PropSection>
  )
}

// --- Stroke -------------------------------------------------------------------------------

type Align = "inside" | "center" | "outside"
type Cap = "butt" | "round" | "square"
type Join = "miter" | "round" | "bevel"

const ALIGN_OPTIONS = [
  { value: "inside", label: "Inside" },
  { value: "center", label: "Center" },
  { value: "outside", label: "Outside" },
] as const
const CAPS = [
  { value: "butt", label: "Butt" },
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
] as const
const JOINS = [
  { value: "miter", label: "Miter" },
  { value: "round", label: "Round" },
  { value: "bevel", label: "Bevel" },
] as const

export function StrokeSection({ sel }: { sel: readonly Sel[] }) {
  const { editor, assets, session } = usePanel()
  const nodes = sel.map((s) => s.node)
  const has = nodes.every((n) => strokeObj(n.stroke) !== null)
  const strokeOps = (next: (n: NodeData) => unknown): Op[] => mapOps(sel, "stroke", next)
  const field = <T,>(pick: (s: Record<string, unknown>) => T): T | Mixed =>
    shared(nodes, (n) => pick(strokeObj(n.stroke) ?? {}))

  const add = useAddMenu(async (kind) => {
    let paint: unknown = "#0A0A0A"
    if (kind === "linear") paint = gradientFrom("#0A0A0A")
    let targets: readonly Sel[] = sel
    if (kind === "image") {
      if (!assets) return
      const src = await pickImage((f) => assets.put(f))
      if (!src) return
      paint = { kind: "image", src }
      // Re-read after the await: append to each node's current stroke.
      targets = current(
        session.store,
        sel.map((s) => s.id),
      )
    }
    editor.apply(
      mapOps(targets, "stroke", (n) => {
        const s = strokeObj(n.stroke)
        if (!s) return { paint }
        const list = paintList(s.paint)
        return { ...s, paint: fillValue([...list, paint], true) }
      }),
      "Add stroke",
    )
  })

  if (!has) {
    const some = nodes.some((n) => strokeObj(n.stroke) !== null)
    return (
      <PropSection
        title="Stroke"
        action={{ label: "Add stroke", icon: <Icon name="plus" size={14} />, onClick: add.onClick }}
      >
        {some && (
          <div className="rp-body">
            <MixedRow name="Stroke" />
          </div>
        )}
        {add.menu}
      </PropSection>
    )
  }

  const paint = field((s) => s.paint)
  const paints = paint === MIXED ? [] : paintList(paint)
  // Individual sides show their widest side (board 08: sides 1/0/1/0 → Weight 1).
  const width = field((s) => {
    const sd = strokeSides(s)
    return sd ? Math.max(sd.t, sd.r, sd.b, sd.l) : strokeWidthOf(s)
  })
  const sides = field((s) => strokeSides(s))
  const individual = sides === MIXED ? MIXED : sides !== null
  const dash = field((s) => dashOf(s))
  const align = field((s) => (s.align as Align | undefined) ?? "inside")
  const cap = field((s) => (s.cap as Cap | undefined) ?? "butt")
  const join = field((s) => (s.join as Join | undefined) ?? "miter")
  const set = (key: string, value: unknown, label: string) =>
    editor.apply(
      strokeOps((n) => withStrokeField(n.stroke, key, value)),
      label,
    )
  const weightValue =
    width === MIXED
      ? MIXED
      : typeof width === "number"
        ? width
        : width && typeof width === "object"
          ? `$${width.$ref}`
          : MIXED

  return (
    <PropSection
      title="Stroke"
      action={{ label: "Add stroke", icon: <Icon name="plus" size={14} />, onClick: add.onClick }}
    >
      <div className="rp-body">
        {paint === MIXED ? (
          <MixedRow name="Stroke" />
        ) : (
          <PaintRows
            paints={paints}
            name="Stroke"
            write={(list, label) =>
              editor.apply(
                strokeOps((n) =>
                  list.length === 0
                    ? undefined
                    : {
                        ...(strokeObj(n.stroke) ?? {}),
                        paint: fillValue(list, Array.isArray(paint)),
                      },
                ),
                label,
              )
            }
          />
        )}
        {/* Row (s0FLr): Weight 96 (icon `menu`) · Align Select fill */}
        <PropRow className="rp-row">
          <NumberField
            icon="menu"
            label="Stroke weight"
            className="rp-field--w96"
            value={weightValue}
            editor={editor}
            min={0}
            onNumber={(n) =>
              strokeOps((node) => {
                const s = strokeSides(node.stroke)
                if (s) return withStrokeField(node.stroke, "width", { t: n, r: n, b: n, l: n })
                return withStrokeField(node.stroke, "width", Math.max(0, n))
              })
            }
          />
          <Select<Align>
            dense
            label="Stroke align"
            className="rp-select-fill"
            options={ALIGN_OPTIONS}
            value={align === MIXED ? null : align}
            placeholder="Mixed"
            onChange={(v) => set("align", v, "Set stroke align")}
          />
        </PropRow>
        <ToggleRow
          label="Individual sides"
          checked={individual}
          onChange={(on) =>
            editor.apply(
              strokeOps((n) => withSidesMode(n.stroke, on)),
              on ? "Individual stroke sides" : "Uniform stroke",
            )
          }
        />
        {individual === true && sides !== MIXED && sides && (
          <StrokeSideFields
            onScrubStart={() => editor.begin()}
            onScrubEnd={() => editor.end()}
            value={sides}
            onChange={(side: keyof Sides, v: number) =>
              editor.apply(
                strokeOps((n) => withSide(n.stroke, side, v)),
                "Set stroke side",
              )
            }
          />
        )}
        <ToggleRow
          label="Dashed"
          checked={dash === MIXED ? MIXED : dash !== null}
          onChange={(on) =>
            editor.apply(
              strokeOps((n) => withDash(n.stroke, on ? (dashOf(n.stroke) ?? DEFAULT_DASH) : null)),
              on ? "Dashed stroke" : "Solid stroke",
            )
          }
        />
        {dash !== MIXED && dash !== null && (
          <PropRow className="rp-row">
            <NumberField
              prefix="Dash"
              label="Dash length"
              value={dash[0]}
              editor={editor}
              min={0}
              onNumber={(n) =>
                strokeOps((node) =>
                  withDash(node.stroke, [n, (dashOf(node.stroke) ?? DEFAULT_DASH)[1]]),
                )
              }
            />
            <NumberField
              prefix="Gap"
              label="Dash gap"
              value={dash[1]}
              editor={editor}
              min={0}
              onNumber={(n) =>
                strokeOps((node) =>
                  withDash(node.stroke, [(dashOf(node.stroke) ?? DEFAULT_DASH)[0], n]),
                )
              }
            />
          </PropRow>
        )}
        {/* Cap Row (mZczZ): label 36 · Segmented fill */}
        <div className="rp-labeled-row">
          <span className="rp-labeled-row__label">Cap</span>
          <Segmented<Cap>
            fill
            label="Stroke cap"
            options={CAPS}
            value={cap === MIXED ? null : cap}
            onChange={(v) => set("cap", v, "Set stroke cap")}
          />
        </div>
        {/* Join Row (BonkB) */}
        <div className="rp-labeled-row">
          <span className="rp-labeled-row__label">Join</span>
          <Segmented<Join>
            fill
            label="Stroke join"
            options={JOINS}
            value={join === MIXED ? null : join}
            onChange={(v) => set("join", v, "Set stroke join")}
          />
        </div>
      </div>
      {add.menu}
    </PropSection>
  )
}
