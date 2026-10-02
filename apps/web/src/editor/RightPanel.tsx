/**
 * Right panel — board 03 "Right Panel" (GCzRl): 280 wide, bg-app, left border, vertical.
 * Children in node order: Tabs (Design / Code / Agent), Selection (bottom border, gap 8,
 * padding [8, 12, 12, 12]: type icon 14 accent-text, name 13/600, spacer, Badge kind), then
 * PropSections Frame, Auto layout, Fill, Corner & stroke, Effects.
 */

import type { NodeData, Op } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import {
  Badge,
  EmptyState,
  IconButton,
  PropRow,
  PropSection,
  Segmented,
  Tabs,
  Toggle,
} from "@kimo/ui"
import { useState } from "react"
import { isFlowChild } from "../canvas/commands"
import { type Bus, useBus, useNodes, useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { ColorRow, type Editor, EnumField, NumberField, useEditor } from "./fields"
import {
  effectLabel,
  effectList,
  effectSwatch,
  effectValue,
  formatPad,
  formatRadius,
  formatSize,
  formatStroke,
  joinHex,
  kindLabel,
  layoutOf,
  MIXED,
  mapOps,
  NEW_FILL,
  NEW_SHADOW,
  nodeName,
  paintColor,
  paintLabel,
  paintList,
  paintOpacity,
  paintSwatch,
  parsePad,
  parseRadius,
  parseSize,
  setOps,
  shared,
  sizeFallback,
  splitHex,
  strokeWithWidth,
  titleCase,
  typeIcon,
  withColor,
  withLayoutField,
} from "./props"
import type { FileSession } from "./session"

type RightTab = "design" | "code" | "agent"
const TABS = [
  { value: "design", label: "Design" },
  { value: "code", label: "Code" },
  { value: "agent", label: "Agent" },
] as const

export function RightPanel({
  session,
  layout,
}: {
  session: FileSession
  /** The canvas's latest layout; sections select only the boxes they show from it. */
  layout: Bus<LayoutResult | null>
}) {
  const [tab, setTab] = useState<RightTab>("design")
  return (
    // Board 05 (EHux2): the panel widens to 360 while the Agent tab is open.
    <aside
      className={tab === "agent" ? "right-panel right-panel--agent" : "right-panel"}
      aria-label="Properties panel"
    >
      <Tabs label="Right panel" items={TABS} value={tab} onChange={setTab} />
      {tab === "design" && <DesignTab session={session} layout={layout} />}
      {tab === "code" && (
        <div className="right-panel__empty">
          <EmptyState
            icon={<Icon name="code-xml" size={18} />}
            title="Code export is coming"
            description="React, HTML and token export arrive in M7."
          />
        </div>
      )}
      {tab === "agent" && (
        <div className="right-panel__empty">
          <EmptyState
            icon={<Icon name="sparkles" size={18} />}
            title="Agent arrives in M6"
            description="Describe a change and Kimo drafts it on the canvas as a reviewable diff."
          />
        </div>
      )}
    </aside>
  )
}

interface Sel {
  id: string
  node: NodeData
}

const HAS_FILL = new Set(["frame", "rect", "ellipse", "polygon", "path", "text"])
const HAS_RADIUS = new Set(["frame", "rect", "polygon", "browser"])
const HAS_STROKE = new Set(["frame", "rect", "ellipse", "polygon", "path", "text", "browser"])

function DesignTab({
  session,
  layout,
}: {
  session: FileSession
  layout: Bus<LayoutResult | null>
}) {
  // Re-renders when the selection or a selected node changes, not on every document edit.
  const selection = useUi(session.ui, (s) => s.selection)
  const sel: readonly Sel[] = useNodes(session.store, selection)
  const editor = useEditor(session, selection.join("\u0000"))

  if (sel.length === 0)
    return (
      <div className="right-panel__empty">
        <EmptyState
          icon={<Icon name="mouse-pointer-2" size={18} />}
          title="Nothing selected"
          description="Select a layer on the canvas or in the layers panel to edit it."
        />
      </div>
    )

  const nodes = sel.map((s) => s.node)
  const first = sel[0] as Sel
  const types = new Set(nodes.map((n) => n.type))
  const all = (set: ReadonlySet<string>) => [...types].every((t) => set.has(t))
  const ids = sel.map((s) => s.id)
  const kind = shared(nodes, kindLabel)

  return (
    <div className="design-tab">
      <div className="selection-header">
        <span className="selection-header__icon">
          <Icon name={sel.length === 1 ? typeIcon(first.node) : "layers"} size={14} />
        </span>
        <span className="selection-header__name" data-testid="selection-name">
          {sel.length === 1 ? nodeName(first.node) : `${sel.length} layers`}
        </span>
        <span className="selection-header__spacer" />
        <Badge>{kind === MIXED ? "Mixed" : kind}</Badge>
      </div>
      <GeometrySection
        sel={sel}
        ids={ids}
        editor={editor}
        layout={layout}
        session={session}
        title={kind === MIXED ? "Layout" : kind}
      />
      {types.size === 1 && types.has("frame") && <AutoLayoutSection sel={sel} editor={editor} />}
      {all(HAS_FILL) && <FillSection sel={sel} ids={ids} editor={editor} />}
      {all(HAS_STROKE) && (
        <CornerStrokeSection sel={sel} ids={ids} editor={editor} radius={all(HAS_RADIUS)} />
      )}
      {!types.has("instance") && <EffectsSection sel={sel} ids={ids} editor={editor} />}
    </div>
  )
}

interface SectionProps {
  sel: readonly Sel[]
  ids: string[]
  editor: Editor
}

// --- Frame (X / Y / W / H) ----------------------------------------------------------------

function GeometrySection({
  sel,
  ids,
  editor,
  layout,
  session,
  title,
}: SectionProps & { layout: Bus<LayoutResult | null>; session: FileSession; title: string }) {
  const nodes = sel.map((s) => s.node)
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
      if (l) return l[key] as number
      const v = s.node[key]
      return typeof v === "number" ? v : 0
    })
  const size = (key: "w" | "h") => {
    const v = shared(nodes, (n) => formatSize(n[key], sizeFallback(n)))
    if (v === MIXED) return MIXED
    const num = Number(v)
    return Number.isFinite(num) && v !== "" ? num : v
  }
  const sizeText = (key: "w" | "h") => (text: string) => {
    const v = parseSize(text)
    return v === null ? null : setOps(ids, key, v)
  }
  /**
   * Arrows / scrubs on Mixed (or Hug/Fill) values: each node moves from its own current value
   * (its stored number, else its laid-out size or position), snapshotted when the gesture starts.
   */
  const relative = (key: "x" | "y" | "w" | "h") => () => {
    const base = sel.map((s) => {
      const v = s.node[key]
      const b = boxes.get(s.id)
      return { id: s.id, v: typeof v === "number" ? v : (b?.[key] ?? 0) }
    })
    const min = key === "w" || key === "h" ? 0 : -Infinity
    return (delta: number) =>
      base.flatMap((b) => setOps([b.id], key, Math.max(min, round(b.v + delta))))
  }
  // Auto-layout children are positioned by their parent: X/Y would be silent no-ops.
  const flow = sel.some((s) => isFlowChild(session.store, s.id))
  return (
    <PropSection title={title}>
      <PropRow>
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
      <PropRow>
        <NumberField
          prefix="W"
          label="Width"
          value={size("w")}
          editor={editor}
          min={0}
          onNumber={(n) => setOps(ids, "w", n)}
          onText={sizeText("w")}
          relative={relative("w")}
        />
        <NumberField
          prefix="H"
          label="Height"
          value={size("h")}
          editor={editor}
          min={0}
          onNumber={(n) => setOps(ids, "h", n)}
          onText={sizeText("h")}
          relative={relative("h")}
        />
      </PropRow>
    </PropSection>
  )
}

const round = (n: number) => Math.round(n * 100) / 100

// --- Auto layout --------------------------------------------------------------------------

type Dir = "row" | "column" | "none"
const DIRECTIONS = [
  {
    value: "row",
    label: "Horizontal",
    icon: <Icon name="align-horizontal-justify-start" size={14} />,
  },
  {
    value: "column",
    label: "Vertical",
    icon: <Icon name="align-horizontal-justify-center" size={14} />,
  },
  {
    value: "none",
    label: "No auto layout",
    icon: <Icon name="align-horizontal-justify-end" size={14} />,
  },
] as const
const ALIGN = ["start", "center", "end", "stretch", "baseline"] as const
const JUSTIFY = ["start", "center", "end", "between", "around", "evenly"] as const
const opts = <V extends string>(vs: readonly V[]) =>
  vs.map((value) => ({ value, label: titleCase(value) }))

function AutoLayoutSection({ sel, editor }: Omit<SectionProps, "ids">) {
  const [more, setMore] = useState(false)
  const nodes = sel.map((s) => s.node)
  const dir = shared(nodes, (n) => {
    const l = n.layout as { dir?: unknown } | undefined
    return l && typeof l === "object" ? (l.dir === "column" ? "column" : "row") : "none"
  }) as Dir | typeof MIXED
  const has = dir === "row" || dir === "column" || dir === MIXED
  const field = (key: string, fallback: unknown) =>
    shared(nodes, (n) => (layoutOf(n)[key] === undefined ? fallback : layoutOf(n)[key]))
  const setField = (key: string, value: unknown, label: string) =>
    editor.apply(
      mapOps(sel, "layout", (n) => withLayoutField(n, key, value)),
      label,
    )
  const num = (v: unknown) => (v === MIXED ? MIXED : typeof v === "number" ? v : formatPad(v))
  const wrap = field("wrap", false)

  return (
    <PropSection
      title="Auto layout"
      action={{
        label: more ? "Hide layout options" : "More layout options",
        icon: <Icon name="settings-2" size={14} />,
        onClick: () => setMore((m) => !m),
      }}
    >
      <div className="auto-layout__direction">
        <Segmented<Dir>
          label="Layout direction"
          options={DIRECTIONS}
          value={dir === MIXED ? null : dir}
          onChange={(d) =>
            editor.apply(
              mapOps(sel, "layout", (n) =>
                d === "none" ? undefined : withLayoutField(n, "dir", d),
              ),
              d === "none" ? "Remove auto layout" : "Set layout direction",
            )
          }
        />
        <span className="auto-layout__spacer" />
        <Toggle
          label="Wrap"
          checked={wrap === true}
          disabled={!has}
          onChange={(c) => setField("wrap", c ? true : undefined, "Set wrap")}
        />
        <span className="auto-layout__wrap-label">Wrap</span>
      </div>
      {has && (
        <>
          <PropRow>
            <NumberField
              prefix="Gap"
              label="Gap"
              value={num(field("gap", 0))}
              editor={editor}
              onNumber={(n) => mapOps(sel, "layout", (node) => withLayoutField(node, "gap", n))}
            />
            <NumberField
              prefix="Pad"
              label="Padding"
              value={num(field("pad", 0))}
              editor={editor}
              min={0}
              onNumber={(n) => mapOps(sel, "layout", (node) => withLayoutField(node, "pad", n))}
              onText={(t) => {
                const p = parsePad(t)
                return p === null
                  ? null
                  : mapOps(sel, "layout", (node) => withLayoutField(node, "pad", p))
              }}
            />
          </PropRow>
          <PropRow>
            <EnumField
              prefix="Align"
              label="Align items"
              value={field("align", "start") as (typeof ALIGN)[number]}
              options={opts(ALIGN)}
              onChange={(v) => setField("align", v === "start" ? undefined : v, "Set align")}
            />
            <EnumField
              prefix="Justify"
              label="Justify content"
              value={field("justify", "start") as (typeof JUSTIFY)[number]}
              options={opts(JUSTIFY)}
              onChange={(v) => setField("justify", v === "start" ? undefined : v, "Set justify")}
            />
          </PropRow>
          {more && (
            <PropRow>
              <NumberField
                prefix="Cross"
                label="Cross gap"
                value={num(field("crossGap", 0))}
                editor={editor}
                onNumber={(n) =>
                  mapOps(sel, "layout", (node) => withLayoutField(node, "crossGap", n))
                }
              />
            </PropRow>
          )}
        </>
      )}
    </PropSection>
  )
}

// --- Fill ---------------------------------------------------------------------------------

function FillSection({ sel, ids, editor }: SectionProps) {
  const fill = shared(
    sel.map((s) => s.node),
    (n) => n.fill,
  )
  const add = () =>
    editor.apply(
      mapOps(sel, "fill", (n) => [...paintList(n.fill), NEW_FILL]),
      "Add fill",
    )
  return (
    <PropSection
      title="Fill"
      action={{ label: "Add fill", icon: <Icon name="plus" size={14} />, onClick: add }}
    >
      {fill === MIXED ? (
        <ColorRow
          swatch="var(--kimo-bg-muted)"
          value="Mixed"
          label="fill"
          pickerValue={null}
          editor={editor}
        />
      ) : (
        paintList(fill).map((paint, i) => {
          const color = paintColor(paint)
          const hex = typeof color === "string" ? color : null
          const list = paintList(fill)
          const replace = (next: unknown) => {
            const l = [...list]
            l[i] = next
            return Array.isArray(fill) ? l : l[0]
          }
          return (
            <ColorRow
              // biome-ignore lint/suspicious/noArrayIndexKey: paints have no ids; order is identity
              key={i}
              swatch={paintSwatch(paint)}
              value={paintLabel(paint)}
              opacity={paintOpacity(paint)}
              label={`fill ${i + 1}`}
              pickerValue={hex ? splitHex(hex).rgb : null}
              editor={editor}
              onPick={(rgb) =>
                setOps(
                  ids,
                  "fill",
                  replace(withColor(paint, joinHex(rgb, hex ? splitHex(hex).alpha : 1))),
                )
              }
            >
              <IconButton
                size="sm"
                label={`Remove fill ${i + 1}`}
                icon={<Icon name="minus" size={14} />}
                onClick={() => {
                  const l = list.filter((_, j) => j !== i)
                  editor.apply(
                    setOps(
                      ids,
                      "fill",
                      l.length === 0 ? undefined : Array.isArray(fill) ? l : l[0],
                    ),
                    "Remove fill",
                  )
                }}
              />
            </ColorRow>
          )
        })
      )}
    </PropSection>
  )
}

// --- Corner & stroke ----------------------------------------------------------------------

function CornerStrokeSection({ sel, ids, editor, radius }: SectionProps & { radius: boolean }) {
  const nodes = sel.map((s) => s.node)
  const r = shared(nodes, (n) => n.radius)
  const stroke = shared(nodes, (n) => n.stroke)
  const rValue = r === MIXED ? MIXED : typeof r === "number" ? r : formatRadius(r)
  const sValue =
    stroke === MIXED
      ? MIXED
      : Number.isFinite(Number(formatStroke(stroke)))
        ? Number(formatStroke(stroke))
        : formatStroke(stroke)
  const strokePaint =
    stroke !== MIXED && stroke && typeof stroke === "object"
      ? (stroke as { paint?: unknown }).paint
      : undefined
  const strokeHex =
    typeof paintColor(strokePaint) === "string" ? (paintColor(strokePaint) as string) : null
  const addStroke = () =>
    editor.apply(
      mapOps(sel, "stroke", (n) => n.stroke ?? { paint: "#0A0A0A", width: 1 }),
      "Add stroke",
    )
  return (
    <PropSection
      title="Corner & stroke"
      action={{ label: "Add stroke", icon: <Icon name="plus" size={14} />, onClick: addStroke }}
    >
      <PropRow>
        {radius && (
          <NumberField
            prefix="R"
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
        <NumberField
          prefix="S"
          label="Stroke width"
          value={sValue}
          editor={editor}
          min={0}
          onNumber={(n) => mapOps(sel, "stroke", (node) => strokeWithWidth(node.stroke, n))}
          onText={(t) => (t === "—" || t === "-" ? mapOps(sel, "stroke", () => undefined) : null)}
        />
      </PropRow>
      {stroke !== MIXED && stroke !== undefined && (
        <ColorRow
          swatch={paintSwatch(strokePaint)}
          value={paintLabel(strokePaint)}
          opacity={paintOpacity(strokePaint)}
          label="stroke"
          pickerValue={strokeHex ? splitHex(strokeHex).rgb : null}
          editor={editor}
          onPick={(rgb) =>
            mapOps(sel, "stroke", (n) => ({
              ...(n.stroke as object),
              paint: withColor(
                strokePaint,
                joinHex(rgb, strokeHex ? splitHex(strokeHex).alpha : 1),
              ),
            }))
          }
        >
          <IconButton
            size="sm"
            label="Remove stroke"
            icon={<Icon name="minus" size={14} />}
            onClick={() => editor.apply(setOps(ids, "stroke", undefined), "Remove stroke")}
          />
        </ColorRow>
      )}
    </PropSection>
  )
}

// --- Effects ------------------------------------------------------------------------------

function EffectsSection({ sel, ids, editor }: SectionProps) {
  const effects = shared(
    sel.map((s) => s.node),
    (n) => n.effects,
  )
  const add = () =>
    editor.apply(
      mapOps(sel, "effects", (n) => [...effectList(n.effects), NEW_SHADOW]),
      "Add effect",
    )
  const list = effects === MIXED ? [] : effectList(effects)
  return (
    <PropSection
      title="Effects"
      action={{ label: "Add effect", icon: <Icon name="plus" size={14} />, onClick: add }}
    >
      {effects === MIXED && (
        <ColorRow
          swatch="var(--kimo-bg-muted)"
          value="Mixed"
          label="effects"
          pickerValue={null}
          editor={editor}
        />
      )}
      {list.map((effect, i) => {
        const color = (effect as { color?: unknown }).color
        const hex = typeof color === "string" ? color : null
        const replace = (next: unknown): Op[] => {
          const l = [...list]
          l[i] = next
          return setOps(ids, "effects", l)
        }
        return (
          <ColorRow
            // biome-ignore lint/suspicious/noArrayIndexKey: effects have no ids; order is identity
            key={i}
            swatch={effectSwatch(effect)}
            value={effectLabel(effect)}
            opacity={effectValue(effect)}
            label={`effect ${i + 1}`}
            pickerValue={hex ? splitHex(hex).rgb : null}
            editor={editor}
            onPick={(rgb) =>
              replace({ ...(effect as object), color: joinHex(rgb, hex ? splitHex(hex).alpha : 1) })
            }
          >
            <IconButton
              size="sm"
              label={`Remove effect ${i + 1}`}
              icon={<Icon name="minus" size={14} />}
              onClick={() => {
                const l = list.filter((_, j) => j !== i)
                editor.apply(setOps(ids, "effects", l.length ? l : undefined), "Remove effect")
              }}
            />
          </ColorRow>
        )
      })}
    </PropSection>
  )
}
