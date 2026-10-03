/**
 * Layer (`cmbN4`), Position (`Z72l9N`) and Auto layout (`S3QTvG`) sections of board 08.
 * Section bodies follow the nodes: Body = column gap 8; Row = row gap 8, center, children fill.
 */
import type { NodeData, Op } from "@kimo/editor-state"
import {
  AlignmentGrid,
  BlendModeMenu,
  blendModeLabel,
  DirectionControl,
  type LayerBlendMode,
  PropRow,
  PropSection,
  Select,
  SizeField,
  type SizeMode,
  Toggle,
} from "@kimo/ui"
import { type PointerEvent, useId, useRef, useState } from "react"
import { groupOps, isFlowChild } from "../../canvas/commands"
import { featureOps } from "../../lib/header"
import { useBus } from "../../lib/hooks"
import { Icon } from "../../lib/icons"
import { NumberField, ToggleRow } from "../fields"
import { SectionTitle } from "../m3/overrides"
import { type Sel, usePanel } from "../panel-context"
import {
  formatNumber,
  formatRadius,
  MIXED,
  MIXED_LABEL,
  type Mixed,
  mapOps,
  parseNumber,
  parseRadius,
  parseSize,
  setOps,
  shared,
} from "../props"
import {
  blendOf,
  blendValue,
  padSides,
  padValue,
  sizeModeFields,
  sizeModeOf,
  sizeModes,
} from "../style"

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const round = (n: number) => Math.round(n * 100) / 100

/** Update op with set + unset (empty parts omitted). */
function updateOp(id: string, set: Record<string, unknown>, unset: string[]): Op {
  return { op: "update", id, ...(Object.keys(set).length ? { set } : {}), unset }
}

// --- Layer --------------------------------------------------------------------------------

export function LayerSection({ sel }: { sel: readonly Sel[] }) {
  const { editor } = usePanel()
  const nodes = sel.map((s) => s.node)
  const ids = sel.map((s) => s.id)
  const blend = shared(nodes, blendOf)
  const opacity = shared(nodes, (n) => (typeof n.opacity === "number" ? n.opacity : 1))
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  /** The selection's blends before the menu's live preview (a revert restores each one). */
  const before = useRef<readonly Sel[] | null>(null)
  const preview = (b: LayerBlendMode | null) => {
    if (b === null) {
      // Escape / outside click: restore, and drop the preview gesture's undo step.
      if (editor.active && before.current)
        editor.apply(
          mapOps(before.current, "blend", (n) => n.blend),
          "Preview blend mode",
        )
      before.current = null
      editor.end()
      return
    }
    if (!editor.active) {
      before.current = sel
      editor.begin()
    }
    editor.apply(setOps(ids, "blend", blendValue(b)), "Set blend mode")
  }
  return (
    <PropSection title={<SectionTitle label="Layer" fields={["opacity", "blend", "visible"]} />}>
      <div className="rp-body">
        <PropRow className="rp-row">
          {/* Blend mode (rx2Qn): Select look; opens BlendModeMenu (board 09 EdigD) */}
          <button
            ref={trigger}
            type="button"
            className="rp-select"
            aria-label="Blend mode"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => {
              if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault()
                setOpen(true)
              }
            }}
          >
            <span className="rp-select__value">
              {blend === MIXED ? MIXED_LABEL : blendModeLabel(blend)}
            </span>
            <span className="rp-select__chevron" aria-hidden="true">
              <Icon name="chevron-down" size={14} />
            </span>
          </button>
          {open && (
            <BlendModeMenu
              anchor={trigger.current}
              value={blend === MIXED ? "normal" : blend}
              passThrough={nodes.every((n) => n.type === "frame" || n.type === "group")}
              onPreview={preview}
              onSelect={(b) => {
                // Inside the preview gesture (if any): the commit replaces the preview step.
                editor.apply(setOps(ids, "blend", blendValue(b)), "Set blend mode")
                before.current = null
                editor.end()
              }}
              onClose={() => {
                setOpen(false)
                trigger.current?.focus({ preventScroll: true })
              }}
            />
          )}
          <NumberField
            icon="blend"
            label="Opacity"
            className="rp-field--w96"
            value={opacity === MIXED ? MIXED : `${Math.round(opacity * 100)}%`}
            editor={editor}
            min={0}
            max={100}
            onNumber={(n) => opacityOps(ids, n)}
            onText={(t) => {
              const n = parseNumber(t.replace(/%$/, ""))
              return n === null ? null : opacityOps(ids, n)
            }}
            relative={() => {
              const base = sel.map((s) => ({
                id: s.id,
                v: typeof s.node.opacity === "number" ? s.node.opacity * 100 : 100,
              }))
              return (d) => base.flatMap((b) => opacityOps([b.id], b.v + d))
            }}
          />
        </PropRow>
      </div>
    </PropSection>
  )
}

/** Opacity from a percent (clamped; 100 = default, removed). */
function opacityOps(ids: readonly string[], percent: number): Op[] {
  const v = Math.round(Math.min(100, Math.max(0, percent))) / 100
  return setOps(ids, "opacity", v === 1 ? undefined : v)
}

// --- Position -----------------------------------------------------------------------------

const HAS_RADIUS = new Set(["frame", "rect", "polygon", "browser"])
const HAS_SIZE = (n: NodeData) => n.type !== "group" && n.type !== "instance"
const HAS_ROTATION = (n: NodeData) => n.type !== "instance"

export function PositionSection({ sel }: { sel: readonly Sel[] }) {
  const { session, editor, layout } = usePanel()
  const nodes = sel.map((s) => s.node)
  const ids = sel.map((s) => s.id)
  // The selected nodes' laid-out local boxes, as a string so unrelated layout passes (other
  // nodes, drag steps elsewhere) do not re-render the panel.
  const boxKey = useBus(layout, (l) =>
    ids
      .map((id) => {
        const b = l?.nodes.get(id)?.local
        return b ? `${round(b.x)},${round(b.y)},${round(b.w)},${round(b.h)}` : ""
      })
      .join(";"),
  )
  const boxes = new Map(
    ids.map((id, i) => {
      const part = boxKey.split(";")[i] ?? ""
      const [x = 0, y = 0, w = 0, h = 0] = part ? part.split(",").map(Number) : []
      return [id, part ? { x, y, w, h } : null] as const
    }),
  )
  const pos = (key: "x" | "y") =>
    shared(sel, (s) => {
      const l = boxes.get(s.id)
      if (l) return l[key]
      const v = s.node[key]
      return typeof v === "number" ? v : 0
    })
  const laid = (s: Sel, key: "w" | "h") => {
    const b = boxes.get(s.id)
    if (b) return b[key]
    const v = s.node[key]
    return typeof v === "number" ? v : 0
  }
  /**
   * Arrows / scrubs on Mixed values: each node moves from its own current value (its stored
   * number, else its laid-out position), snapshotted when the gesture starts.
   */
  const relative = (key: "x" | "y") => () => {
    const base = sel.map((s) => {
      const v = s.node[key]
      const b = boxes.get(s.id)
      return { id: s.id, v: typeof v === "number" ? v : (b?.[key] ?? 0) }
    })
    return (delta: number) => base.flatMap((b) => setOps([b.id], key, round(b.v + delta)))
  }
  // Auto-layout children are positioned by their parent: X/Y would be silent no-ops.
  const flow = sel.some((s) => isFlowChild(session.store, s.id))
  const parentLayout = (n: NodeData) => {
    const p = typeof n.parent === "string" ? session.store.getNode(n.parent) : undefined
    return !!p && p.type !== "instance" && isObj(p.layout)
  }
  const inLayout = nodes.every(parentLayout)
  const sized = nodes.every(HAS_SIZE)
  const modes = (["fixed", "fit", "fill"] as const).filter((m) =>
    nodes.every((n) => sizeModes(n, parentLayout(n)).includes(m)),
  )

  const rotatable = nodes.every(HAS_ROTATION)
  const rotation = shared(nodes, (n) => (typeof n.rotation === "number" ? n.rotation : 0))
  const rotationOps = (deg: number) => {
    const r = round(((((deg + 180) % 360) + 360) % 360) - 180)
    return setOps(ids, "rotation", r === 0 ? undefined : r)
  }
  const hasRadius = nodes.every((n) => HAS_RADIUS.has(n.type))
  const r = shared(nodes, (n) => n.radius)
  const rValue = r === MIXED ? MIXED : typeof r === "number" ? r : formatRadius(r)
  const absolute = shared(nodes, (n) => n.position === "absolute")

  return (
    <PropSection
      title={
        <SectionTitle
          label="Position"
          fields={["x", "y", "w", "h", "rotation", "position", "flipX", "flipY"]}
        />
      }
    >
      <div className="rp-body">
        <PropRow className="rp-row">
          <NumberField
            prefix="X"
            label="X"
            value={pos("x")}
            editor={editor}
            disabled={flow}
            onNumber={(n) => setOps(ids, "x", n)}
            relative={relative("x")}
          />
          <NumberField
            prefix="Y"
            label="Y"
            value={pos("y")}
            editor={editor}
            disabled={flow}
            onNumber={(n) => setOps(ids, "y", n)}
            relative={relative("y")}
          />
        </PropRow>
        <PropRow className="rp-row">
          <SizeControl axis="w" sel={sel} laid={laid} modes={modes} disabled={!sized} />
          <SizeControl axis="h" sel={sel} laid={laid} modes={modes} disabled={!sized} />
        </PropRow>
        {(rotatable || hasRadius) && (
          <PropRow className="rp-row">
            {rotatable && (
              <NumberField
                icon="rotate-cw"
                label="Rotation"
                value={rotation === MIXED ? MIXED : `${formatNumber(rotation)}°`}
                editor={editor}
                onNumber={rotationOps}
                onText={(t) => {
                  const n = parseNumber(t.replace(/°$/, ""))
                  return n === null ? null : rotationOps(n)
                }}
                relative={() => {
                  const base = sel.map((s) => ({
                    id: s.id,
                    v: typeof s.node.rotation === "number" ? s.node.rotation : 0,
                  }))
                  return (d) =>
                    base.flatMap((b) => {
                      const v = round(((((b.v + d + 180) % 360) + 360) % 360) - 180)
                      return setOps([b.id], "rotation", v === 0 ? undefined : v)
                    })
                }}
              />
            )}
            {hasRadius && (
              <NumberField
                icon="square-dashed"
                label="Corner radius"
                value={rValue}
                editor={editor}
                min={0}
                onNumber={(n) => setOps(ids, "radius", n === 0 ? undefined : n)}
                onText={(t) => {
                  const v = parseRadius(t)
                  return v === null ? null : setOps(ids, "radius", v)
                }}
              />
            )}
          </PropRow>
        )}
        {inLayout && (
          <ToggleRow
            label="Absolute position"
            checked={absolute}
            onChange={(on) =>
              editor.apply(
                sel.map((s) => {
                  if (!on) return updateOp(s.id, {}, ["position"])
                  // Keep the node where the layout put it.
                  const b = boxes.get(s.id)
                  return updateOp(
                    s.id,
                    { position: "absolute", ...(b ? { x: b.x, y: b.y } : {}) },
                    [],
                  )
                }),
                on ? "Set absolute position" : "Set auto position",
              )
            }
          />
        )}
      </div>
    </PropSection>
  )
}

/** Fields to write one axis as a fixed size on each node. */
function fixedOps(
  sel: readonly Sel[],
  axis: "w" | "h",
  size: (s: Sel) => number,
  laid: (s: Sel, key: "w" | "h") => number,
): Op[] {
  return sel.map((s) => {
    const f = sizeModeFields(s.node, axis, "fixed", size(s), laid(s, axis === "w" ? "h" : "w"))
    return updateOp(s.id, f.set, f.unset)
  })
}

/**
 * W / H (SizeField G6R6IX) plus the M1 field behaviours the ui field leaves to the host:
 * scrubbing the prefix (one undo step per drag, Shift ×10) and ↑/↓ on a Mixed value, both
 * stepping every node from its own size.
 */
function SizeControl({
  axis,
  sel,
  laid,
  modes,
  disabled,
}: {
  axis: "w" | "h"
  sel: readonly Sel[]
  laid: (s: Sel, key: "w" | "h") => number
  modes: SizeMode[]
  disabled: boolean
}) {
  const { editor } = usePanel()
  const nodes = sel.map((s) => s.node)
  const label = axis === "w" ? "width" : "height"
  // A fixed number shows as stored (no wait for the next layout pass); Hug/Fill show the
  // laid-out size.
  const shown = (s: Sel) => {
    const v = s.node[axis]
    return typeof v === "number" && sizeModeOf(s.node, axis) === "fixed" ? v : laid(s, axis)
  }
  const v = shared(sel, (s) => round(shown(s)))
  const mode = shared(nodes, (n) => sizeModeOf(n, axis))
  const scrub = useRef<{
    x: number
    pointer: number
    base: Map<string, number>
    last: number
  } | null>(null)
  const shift = (base: ReadonlyMap<string, number>, delta: number) =>
    fixedOps(sel, axis, (s) => Math.max(0, round((base.get(s.id) ?? 0) + delta)), laid)
  const snapshot = () => new Map(sel.map((s) => [s.id, shown(s)] as const))
  const setMode = (m: SizeMode) =>
    editor.apply(
      sel.map((s) => {
        const f = sizeModeFields(s.node, axis, m, laid(s, axis), laid(s, axis === "w" ? "h" : "w"))
        return updateOp(s.id, f.set, f.unset)
      }),
      "Set sizing",
    )
  const endScrub = (e: PointerEvent) => {
    const sc = scrub.current
    if (!sc || sc.pointer !== e.pointerId) return
    scrub.current = null
    editor.end()
  }
  return (
    <div
      className="rp-field"
      onPointerDownCapture={(e) => {
        const t = e.target as HTMLElement
        if (disabled || e.button !== 0 || !t.closest(".kimo-size-field__prefix")) return
        e.preventDefault()
        e.stopPropagation()
        t.setPointerCapture(e.pointerId)
        scrub.current = { x: e.clientX, pointer: e.pointerId, base: snapshot(), last: 0 }
        editor.begin()
      }}
      onPointerMove={(e) => {
        const sc = scrub.current
        if (!sc || sc.pointer !== e.pointerId) return
        const delta = Math.round(e.clientX - sc.x) * (e.shiftKey ? 10 : 1)
        if (delta === sc.last) return
        sc.last = delta
        editor.apply(shift(sc.base, delta), `Set ${label}`)
      }}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onLostPointerCapture={endScrub}
      onKeyDownCapture={(e) => {
        if (v !== MIXED || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return
        if (!(e.target instanceof HTMLInputElement)) return
        // Mixed: step each node from its own size (the ui field only steps numbers).
        e.preventDefault()
        e.stopPropagation()
        const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)
        editor.apply(shift(snapshot(), d), `Set ${label}`)
      }}
    >
      <SizeField
        prefix={axis === "w" ? "W" : "H"}
        inputLabel={axis === "w" ? "Width" : "Height"}
        value={v === MIXED ? MIXED_LABEL : formatNumber(v)}
        mode={mode === MIXED ? sizeModeOf(nodes[0] as NodeData, axis) : mode}
        modes={modes}
        disabled={disabled}
        onModeChange={setMode}
        onValueCommit={(text) => {
          const p = parseSize(text)
          if (p === null) return
          if (typeof p === "number")
            editor.apply(
              fixedOps(sel, axis, () => p, laid),
              `Set ${label}`,
            )
          else if (modes.includes(p.mode)) setMode(p.mode)
        }}
      />
    </div>
  )
}

// --- Auto layout --------------------------------------------------------------------------

type Justify = "start" | "center" | "end" | "between" | "around" | "evenly"
type Align3 = "start" | "center" | "end"
type Distribution = "packed" | "between" | "around" | "evenly"

const DISTRIBUTION: readonly { value: Distribution; label: string }[] = [
  { value: "packed", label: "Packed" },
  { value: "between", label: "Space between" },
  { value: "around", label: "Space around" },
  { value: "evenly", label: "Space evenly" },
]

const layoutObj = (n: NodeData): Record<string, unknown> | null =>
  isObj(n.layout) ? (n.layout as Record<string, unknown>) : null

/** A layout with fields changed; values equal to the spec defaults are removed. */
function withLayout(n: NodeData, patch: Record<string, unknown>): Record<string, unknown> {
  const l: Record<string, unknown> = { dir: "row", ...(layoutObj(n) ?? {}), ...patch }
  const defaults: Record<string, unknown> = {
    gap: 0,
    crossGap: 0,
    pad: 0,
    justify: "start",
    align: "start",
    wrap: false,
    includeStroke: false,
  }
  for (const k of Object.keys(l)) if (l[k] === undefined || l[k] === defaults[k]) delete l[k]
  return l
}

export function AutoLayoutSection({ sel }: { sel: readonly Sel[] }) {
  const { session, editor, layout } = usePanel()
  const wrapLabel = useId()
  const nodes = sel.map((s) => s.node)
  const frames = nodes.every((n) => n.type === "frame")
  const withLayoutAll = frames && nodes.every((n) => layoutObj(n) !== null)

  if (!withLayoutAll) {
    const mixed = frames && nodes.some((n) => layoutObj(n) !== null)
    // PropSection/Empty (z1rMhb): header only; `plus` adds auto layout (frames) or wraps the
    // selection in a new auto-layout frame (other layers).
    const add = () => {
      if (frames) {
        editor.apply(
          mapOps(sel, "layout", (n) => layoutObj(n) ?? { dir: "row" }),
          "Add auto layout",
        )
        return
      }
      const l = layout.get()
      if (!l) return
      const ops = groupOps(
        session.store,
        l,
        sel.map((s) => s.id),
      )
      if (!ops) return
      const insert = ops[0] as Extract<Op, { op: "insert" }>
      const node = { ...(insert.node as Record<string, unknown>) }
      delete node.w
      delete node.h
      node.layout = { dir: "row" }
      ops[0] = { ...insert, node: node as typeof insert.node }
      // Children flow in the new layout: their x/y are computed.
      const next = ops.map((o) =>
        o.op === "update" && o.set
          ? { ...o, set: omit(o.set, ["x", "y"]), unset: [...(o.unset ?? []), "x", "y"] }
          : o,
      )
      const created = insert.id
      if (session.apply(next, "Add auto layout") && created) session.ui.getState().select([created])
    }
    return (
      <PropSection
        title={<SectionTitle label="Auto layout" fields={["layout"]} />}
        action={{
          label: mixed ? "Add auto layout to all" : "Add auto layout",
          icon: <Icon name="plus" size={14} />,
          onClick: add,
        }}
      />
    )
  }

  const field = <T,>(pick: (l: Record<string, unknown>) => T) =>
    shared(nodes, (n) => pick(layoutObj(n) ?? {}))
  const set = (patch: Record<string, unknown>, label: string) => {
    const ops = mapOps(sel, "layout", (n) => withLayout(n, patch))
    // `wrap` / `crossGap` are gated by feature layout/wrap (spec §13): declare it in the same
    // edit, or the store rejects the change.
    const wraps = sel.some((s) => {
      const l = withLayout(s.node, patch)
      return l.wrap !== undefined || l.crossGap !== undefined
    })
    editor.apply(wraps ? [...featureOps(session.store, ["layout/wrap"]), ...ops] : ops, label)
  }
  const dir = field((l) => (l.dir === "column" ? "column" : "row")) as "row" | "column" | Mixed
  const wrap = field((l) => l.wrap === true)
  const justify = field((l) => (typeof l.justify === "string" ? l.justify : "start")) as
    | Justify
    | Mixed
  const align = field((l) => (typeof l.align === "string" ? l.align : "start")) as string | Mixed
  const gap = field((l) => l.gap ?? 0)
  const pads = shared(nodes, (n) => padSides(layoutObj(n)?.pad))
  const individual = field((l) => Array.isArray(l.pad) && l.pad.length === 4)
  const distribution: Distribution | Mixed =
    justify === MIXED
      ? MIXED
      : justify === "between" || justify === "around" || justify === "evenly"
        ? justify
        : "packed"
  const gridJustify = justify === MIXED ? "start" : justify
  const gridAlign: Align3 = align === "center" || align === "end" ? (align as Align3) : "start"

  const padOps = (
    next: (s: [number, number, number, number]) => [number, number, number, number],
  ) =>
    mapOps(sel, "layout", (n) => {
      const sides = next(padSides(layoutObj(n)?.pad))
      const pad = layoutObj(n)?.pad
      const ind = Array.isArray(pad) && pad.length === 4
      return withLayout(n, { pad: padValue(sides, ind) })
    })
  const num = (v: unknown) =>
    v === MIXED ? MIXED : typeof v === "number" ? v : isObj(v) ? `$${String(v.$ref)}` : 0

  return (
    <PropSection
      title={<SectionTitle label="Auto layout" fields={["layout"]} />}
      action={{
        label: "Remove auto layout",
        icon: <Icon name="minus" size={14} />,
        onClick: () =>
          editor.apply(
            setOps(
              sel.map((s) => s.id),
              "layout",
              undefined,
            ),
            "Remove auto layout",
          ),
      }}
    >
      <div className="rp-body">
        {/* Direction Row (e3GOh): h 28, gap 8, center */}
        <div className="rp-direction-row">
          <DirectionControl
            value={dir === MIXED ? "row" : dir}
            onChange={(d) => set({ dir: d }, "Set layout direction")}
          />
          <span className="rp-spacer" />
          <span className="rp-label" id={wrapLabel}>
            Wrap
          </span>
          <Toggle
            aria-labelledby={wrapLabel}
            checked={wrap === true}
            onChange={(c) => set({ wrap: c ? true : undefined }, "Set wrap")}
          />
        </div>
        {/* Align Row (XBXjF): gap 8 (top-aligned): AlignmentGrid · Spacing Column */}
        <div className="rp-align-row">
          <AlignmentGrid
            className="rp-align-row__grid"
            dir={dir === MIXED ? "row" : dir}
            justify={gridJustify}
            align={gridAlign}
            onChange={(v) =>
              set(
                distribution === "packed" || distribution === MIXED
                  ? { justify: v.justify, align: v.align }
                  : { align: v.align },
                "Set alignment",
              )
            }
          />
          <div className="rp-align-row__spacing">
            <NumberField
              prefix="Gap"
              label="Gap"
              value={num(gap)}
              editor={editor}
              onNumber={(n) => mapOps(sel, "layout", (node) => withLayout(node, { gap: n }))}
            />
            <Select<Distribution>
              dense
              label="Distribution"
              className="rp-select-fill"
              options={DISTRIBUTION}
              value={distribution === MIXED ? null : distribution}
              placeholder={MIXED_LABEL}
              onChange={(d) =>
                set(
                  {
                    justify:
                      d === "packed"
                        ? justify === "center" || justify === "end"
                          ? justify
                          : "start"
                        : d,
                  },
                  "Set distribution",
                )
              }
            />
          </div>
        </div>
        {individual !== true && (
          /* Padding Row (VZ2dy): Pad H (arrow-left-right) · Pad V (arrow-up-down) */
          <PropRow className="rp-row">
            <NumberField
              icon="arrow-left-right"
              label="Horizontal padding"
              value={
                pads === MIXED || individual === MIXED
                  ? MIXED
                  : pads[1] === pads[3]
                    ? pads[1]
                    : MIXED
              }
              editor={editor}
              min={0}
              onNumber={(n) => padOps(([t, , b]) => [t, n, b, n])}
            />
            <NumberField
              icon="arrow-up-down"
              label="Vertical padding"
              value={
                pads === MIXED || individual === MIXED
                  ? MIXED
                  : pads[0] === pads[2]
                    ? pads[0]
                    : MIXED
              }
              editor={editor}
              min={0}
              onNumber={(n) => padOps(([, r, , l]) => [n, r, n, l])}
            />
          </PropRow>
        )}
        <ToggleRow
          label="Individual padding"
          checked={individual}
          onChange={(on) =>
            editor.apply(
              mapOps(sel, "layout", (n) => {
                const [t, r, b, l] = padSides(layoutObj(n)?.pad)
                return withLayout(n, {
                  pad: on
                    ? [t, r, b, l]
                    : padValue(
                        [Math.max(t, b), Math.max(r, l), Math.max(t, b), Math.max(r, l)],
                        false,
                      ),
                })
              }),
              on ? "Individual padding" : "Uniform padding",
            )
          }
        />
        {individual === true && (
          <div className="rp-sides">
            {(["t", "r", "b", "l"] as const).map((side, i) => (
              <NumberField
                key={side}
                prefix={side.toUpperCase()}
                label={`Padding ${["top", "right", "bottom", "left"][i]}`}
                value={pads === MIXED ? MIXED : (pads[i] as number)}
                editor={editor}
                min={0}
                onNumber={(n) =>
                  padOps((s) => {
                    const next = [...s] as [number, number, number, number]
                    next[i] = n
                    return next
                  })
                }
              />
            ))}
          </div>
        )}
      </div>
    </PropSection>
  )
}

function omit(o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out = { ...o }
  for (const k of keys) delete out[k]
  return out
}
