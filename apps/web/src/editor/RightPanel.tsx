/**
 * Right panel — board 08 "Editor — Styling (M2)" right panel (`hgQkJ`): 280 wide, bg-app, left
 * stroke 1 border, vertical. Children in node order: Tabs (Design / Code / Agent), Selection
 * (`eZbgB`), then the PropSections Layer (`cmbN4`), Position (`Z72l9N`), Auto layout
 * (`S3QTvG`), Fill (`LpXDi`), Stroke (`qQR6J`), Effects (`Vyrj5`). Icon nodes add the Icon
 * section (board 09 panel fragment `CVMdd`). The Design tab scrolls when taller than the
 * viewport.
 */

import type { LayoutResult } from "@kimo/layout"
import type { IconProvider } from "@kimo/renderer"
import { Badge, EmptyState, Tabs } from "@kimo/ui"
import { useState } from "react"
import type { AssetStore } from "../lib/assets"
import { useDocHeader } from "../lib/header"
import { type Bus, useNodes, useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { useEditor } from "./fields"
import { PanelContext, type Sel } from "./panel-context"
import { kindLabel, MIXED, nodeName, shared, typeIcon } from "./props"
import "./right-panel.css"
import { EffectsSection } from "./sections/EffectsSection"
import { IconSection } from "./sections/IconSection"
import { AutoLayoutSection, LayerSection, PositionSection } from "./sections/LayoutSections"
import { FillSection, StrokeSection } from "./sections/PaintSections"
import type { FileSession } from "./session"

type RightTab = "design" | "code" | "agent"
const TABS = [
  { value: "design", label: "Design" },
  { value: "code", label: "Code" },
  { value: "agent", label: "Agent" },
] as const

export interface RightPanelProps {
  session: FileSession
  /** The canvas's latest layout; sections select only the boxes they show from it. */
  layout: Bus<LayoutResult | null>
  /** Asset store of the open file (image fills). */
  assets?: AssetStore | null
  /** Icon glyphs and catalogs (icon picker); null hides the grid. */
  icons?: IconProvider | null
}

export function RightPanel({ session, layout, assets = null, icons = null }: RightPanelProps) {
  const [tab, setTab] = useState<RightTab>("design")
  return (
    // Board 05 (EHux2): the panel widens to 360 while the Agent tab is open.
    <aside
      className={tab === "agent" ? "right-panel right-panel--agent" : "right-panel"}
      aria-label="Properties panel"
    >
      <Tabs label="Right panel" items={TABS} value={tab} onChange={setTab} />
      {tab === "design" && (
        <DesignTab session={session} layout={layout} assets={assets} icons={icons} />
      )}
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

/** Node types with `fill` / `stroke` (graphics fields) and `radius`. */
export const HAS_FILL = new Set(["frame", "rect", "ellipse", "polygon", "path", "text"])
export const HAS_STROKE = new Set([
  "frame",
  "rect",
  "ellipse",
  "polygon",
  "path",
  "text",
  "browser",
])

function DesignTab({
  session,
  layout,
  assets,
  icons,
}: {
  session: FileSession
  layout: Bus<LayoutResult | null>
  assets: AssetStore | null
  icons: IconProvider | null
}) {
  // Re-renders when the selection or a selected node changes, not on every document edit.
  const selection = useUi(session.ui, (s) => s.selection)
  const sel: readonly Sel[] = useNodes(session.store, selection)
  const key = selection.join("\u0000")
  const editor = useEditor(session, key)
  const header = useDocHeader(session.store)

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
  const kind = shared(nodes, kindLabel)
  const instance = types.has("instance")

  return (
    <PanelContext.Provider value={{ session, editor, header, layout, assets, icons }}>
      {/* Keyed by the selection: popovers, open effect rows and drafts reset with it. */}
      <div className="design-tab" key={key}>
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
        {!instance && <LayerSection sel={sel} />}
        <PositionSection sel={sel} />
        <AutoLayoutSection sel={sel} />
        {all(new Set(["icon"])) && <IconSection sel={sel} />}
        {(all(HAS_FILL) || all(new Set(["icon"]))) && <FillSection sel={sel} />}
        {all(HAS_STROKE) && <StrokeSection sel={sel} />}
        {!instance && <EffectsSection sel={sel} />}
      </div>
    </PanelContext.Provider>
  )
}
