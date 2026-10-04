/**
 * Board 27 §5 (b) "Polygon & Star · canvas + panel" (ICb89 › Gxw8y): ONE section for polygon
 * nodes with a Polygon | Star switch. Section · Polygon (MTQK3) / Section · Star (wVNjO):
 * vertical, gap 8, padding [12, 12, 16, 12]:
 *   Header (space-between, center): Title (sans 12 normal text-primary: "Polygon" | "Star") ·
 *     Kind (SegmentedText FC6O7: Polygon | Star)
 *   Row 1 (gap 8): Sides | Points (PropField) · Radius (PropField)
 *   Row 2 (gap 8): Ratio (PropField, "38 %") · Spacer — polygon: opacity 0.4, value "—"
 *   Hint (sans 11 / 1.45 text-tertiary, fill width)
 * Rules (g7wdz): Sides/Points 3–60, Radius rounds every corner, Ratio 1–99 % = inner/outer
 * radius (star only). A star is `{ type: "polygon", star: { ratio } }` (ratio 0.38 = default,
 * stored as `star: {}`). The edited count is remembered for the next polygon / star drawn.
 */
import type { Op } from "@kimo/editor-state"
import { PropRow, SegmentedText } from "@kimo/ui"
import { clampRatio, clampSides, STAR_RATIO } from "../../canvas/commands"
import { canvasToolStore } from "../../canvas/tool-state"
import { Bindable } from "../bind"
import { NumberField } from "../fields"
import { type Sel, usePanel } from "../panel-context"
import { MIXED, setOps, shared } from "../props"
import "./polygon.css"

/** Hint copy (ABpsC / JiLWg). */
export const POLYGON_HINT = "Ratio only applies to stars."
export const STAR_HINT = "Ratio = inner ÷ outer radius (1–99 %). Drag the inner handle on canvas."

const starOf = (n: Sel["node"]) =>
  typeof n.star === "object" && n.star !== null ? (n.star as { ratio?: unknown }) : null
const ratioOf = (n: Sel["node"]) => {
  const r = starOf(n)?.ratio
  return typeof r === "number" ? r : STAR_RATIO.default
}
/** Canonical star value: the default ratio is omitted. */
const starValue = (ratio: number) => (ratio === STAR_RATIO.default ? {} : { ratio })

export function PolygonSection({ sel }: { sel: readonly Sel[] }) {
  const { session, editor } = usePanel()
  const nodes = sel.map((s) => s.node)
  const ids = sel.map((s) => s.id)
  const kind = shared(nodes, (n) => (starOf(n) ? "star" : "polygon"))
  const isStar = kind === "star"
  const sides = shared(nodes, (n) => (typeof n.sides === "number" ? n.sides : 3))
  const radius = shared(nodes, (n) => (typeof n.radius === "number" ? n.radius : 0))
  const pct = shared(nodes, (n) => Math.round(ratioOf(n) * 100))
  const tools = canvasToolStore(session.ui)

  const sidesOps = (n: number): Op[] => {
    const v = clampSides(n)
    tools.set(isStar ? { starPoints: v } : { polygonSides: v })
    return setOps(ids, "sides", v)
  }
  const ratioOps = (percent: number): Op[] =>
    setOps(ids, "star", starValue(clampRatio(percent / 100)))

  return (
    <section className="kimo-prop-section rp-polygon" data-pen={isStar ? "wVNjO" : "MTQK3"}>
      <div className="rp-polygon__header">
        <h3 className="rp-polygon__title">{isStar ? "Star" : "Polygon"}</h3>
        <SegmentedText
          className="rp-polygon__kind"
          label="Polygon kind"
          options={[
            { value: "polygon", label: "Polygon" },
            { value: "star", label: "Star" },
          ]}
          value={kind === MIXED ? null : kind}
          onChange={(v) =>
            editor.apply(
              v === "star"
                ? nodes.map((n, i) => ({
                    op: "update" as const,
                    id: ids[i] as string,
                    set: { star: starOf(n) ?? {} },
                  }))
                : setOps(ids, "star", undefined),
              v === "star" ? "Make star" : "Make polygon",
            )
          }
        />
      </div>
      <PropRow className="rp-row">
        <NumberField
          prefix={isStar ? "Points" : "Sides"}
          label={isStar ? "Points" : "Sides"}
          value={sides}
          editor={editor}
          min={3}
          max={60}
          onNumber={sidesOps}
        />
        {/* Board 27 §7: the polygon / star corner radius binds a number variable. */}
        <Bindable
          sel={sel}
          spec={{
            type: "number",
            label: "Corner radius",
            prefix: "Radius",
            get: (n) => n.radius ?? 0,
            put: (s, v) => setOps([s.id], "radius", v === 0 ? undefined : v),
            current: () => (radius === MIXED ? null : radius),
            varBase: "radius",
          }}
        >
          {(bind) => (
            <NumberField
              prefix="Radius"
              label="Corner radius"
              bind={bind}
              value={radius}
              editor={editor}
              min={0}
              onNumber={(n) =>
                setOps(ids, "radius", Math.max(0, n) === 0 ? undefined : Math.max(0, n))
              }
            />
          )}
        </Bindable>
      </PropRow>
      <PropRow className={isStar ? "rp-row" : "rp-row rp-polygon__row--off"}>
        <NumberField
          prefix="Ratio"
          label="Star ratio"
          value={isStar ? (pct === MIXED ? MIXED : `${pct} %`) : "—"}
          editor={editor}
          min={1}
          max={99}
          disabled={!isStar}
          onNumber={ratioOps}
          relative={() => {
            const base = nodes.map((n, i) => ({ id: ids[i] as string, v: ratioOf(n) * 100 }))
            return (delta) =>
              base.flatMap((b) =>
                setOps([b.id], "star", starValue(clampRatio((b.v + delta) / 100))),
              )
          }}
          onText={(t) => {
            const m = /^(-?\d+(?:[.,]\d+)?)\s*%?$/.exec(t.trim())
            return m ? ratioOps(Number((m[1] as string).replace(",", "."))) : null
          }}
        />
        <span className="rp-polygon__spacer" aria-hidden="true" />
      </PropRow>
      <p className="rp-polygon__hint">{isStar ? STAR_HINT : POLYGON_HINT}</p>
    </section>
  )
}
