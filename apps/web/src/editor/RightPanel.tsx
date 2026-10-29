/**
 * Right panel — board 08 "Editor — Styling (M2)" right panel (`hgQkJ`): 280 wide, bg-app, left
 * stroke 1 border, vertical. Children in node order: Tabs (Design / Code / Agent), Selection
 * (`eZbgB`), then the PropSections Layer (`cmbN4`), Position (`Z72l9N`), Auto layout
 * (`S3QTvG`), Fill (`LpXDi`), Stroke (`qQR6J`), Effects (`Vyrj5`). Text nodes (board 20
 * Gmaho): Layer, Position, Text (RuAZI), Fill, Stroke, Effects — no Auto layout. Icon nodes add the Icon
 * section (board 09 panel fragment `CVMdd`). The Design tab scrolls when taller than the
 * viewport.
 */

import type { NodeData } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import type { IconProvider } from "@kimo/renderer"
import { Badge, EmptyState, PropSection, Tabs } from "@kimo/ui"
import { type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useCropSession } from "../canvas/crop"
import { type CodeExportPreset, CodeTab } from "../code-tab"
import { ConflictsPanel, conflictsTabLabel, type EditorConflictSession } from "../conflicts"
import type { FontSystem } from "../fonts/font-system"
import type { AssetStore } from "../lib/assets"
import { useDocHeader } from "../lib/header"
import { type Bus, createBus, useNodes, useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { useEditor } from "./fields"
import { type M3Controller, useBusValue } from "./m3/controller"
import { layerKind } from "./m3/model"
import { OverrideFieldsContext, overrideFieldsOf } from "./m3/overrides"
import {
  ComponentSection,
  InstanceSection,
  PropertiesSection,
  SlotSection,
  ThemeSection,
} from "./m3/sections"
import { KindPill } from "./m3/ui"
import { PageCard } from "./PageCard"
import { PanelContext, type Sel } from "./panel-context"
import { kindLabel, MIXED, nodeName, shared, typeIcon } from "./props"
import { ViewOnlyContext } from "./view-only"
import "./right-panel.css"
import { EffectsSection } from "./sections/EffectsSection"
import { IconSection } from "./sections/IconSection"
import { ImageCropSection } from "./sections/ImageCropSection"
import { AutoLayoutSection, LayerSection, PositionSection } from "./sections/LayoutSections"
import { FillSection, StrokeSection } from "./sections/PaintSections"
import { PolygonSection } from "./sections/PolygonSection"
import { RichTextScope } from "./sections/RichTextScope"
import { TextSection } from "./sections/TextSection"
import type { FileSession } from "./session"

type RightTab = "design" | "code" | "agent" | "activity" | "conflicts"
const NO_REV = createBus(0)

const TABS = [
  { value: "design", label: "Design" },
  { value: "code", label: "Code" },
  { value: "agent", label: "Agent" },
] as const

interface RightPanelProps {
  session: FileSession
  /** The canvas's latest layout; sections select only the boxes they show from it. */
  layout: Bus<LayoutResult | null>
  /** Asset store of the open file (image fills). */
  assets?: AssetStore | null
  /** Icon glyphs and catalogs (icon picker); null hides the grid. */
  icons?: IconProvider | null
  /** M3 state (expanded view, commands). */
  m3: M3Controller
  /** Board 18: the merge's conflict session; adds the "Conflicts N" tab while non-null. */
  conflicts?: EditorConflictSession | null
  /** Bumped by the external-conflicts toast's "Review": opens the Conflicts tab. */
  review?: Bus<number>
  /** The window's font system (Text section). */
  fonts?: FontSystem | null
  /**
   * Board 21 (rule "Placement"): the agents' Activity panel; adds a 4th tab "Activity" after
   * Agent while non-null (desktop files with an MCP host).
   */
  activity?: ReactNode
  /** Bumped to open the Activity tab (Paused banner "Show ops", Settings "Open activity"). */
  openActivity?: Bus<number>
  /** M6: the Agent tab body (board 22 D0zDSY); null keeps the empty state. */
  agent?: ReactNode
  /** Bumped to open the Agent tab (Home hand-off, placeholder "Review", prompt runs). */
  openAgent?: Bus<number>
  /** The tab shown first (Home hand-off: "agent"). */
  initialTab?: RightTab
  /**
   * Board 25 Code tab: "Open export…" / "Export page…" open the Export dialog with the same
   * selection and framework preselected.
   */
  onOpenExport?: (preset: CodeExportPreset) => void
  /** Board 44 §2: the Page card's Export + (the Export dialog, no preset). */
  onExport?: () => void
  /** Board 44 Right Card › Card Header (LKu07Q787a), first child of the card. */
  header?: ReactNode
  /** Board 44 §3: only the header shows, as a pill. */
  collapsed?: boolean
}

export function RightPanel({
  session,
  layout,
  assets = null,
  icons = null,
  m3,
  conflicts = null,
  review,
  fonts = null,
  activity = null,
  openActivity,
  agent = null,
  openAgent,
  initialTab = "design",
  onOpenExport,
  onExport,
  header = null,
  collapsed = false,
}: RightPanelProps) {
  const [tab, setTab] = useState<RightTab>(initialTab)
  const agentRev = useBusValue(openAgent ?? NO_REV)
  const agentSeen = useRef(agentRev)
  useEffect(() => {
    if (agentRev === agentSeen.current) return
    agentSeen.current = agentRev
    setTab("agent")
  }, [agentRev])
  const activityRev = useBusValue(openActivity ?? NO_REV)
  const activitySeen = useRef(activityRev)
  useEffect(() => {
    if (activityRev === activitySeen.current) return
    activitySeen.current = activityRev
    if (activity) setTab("activity")
  }, [activityRev, activity])
  const hasActivity = activity != null
  useEffect(() => {
    if (!hasActivity) setTab((t) => (t === "activity" ? "design" : t))
  }, [hasActivity])
  const counts = useConflictCounts(conflicts)
  // Open the tab when a document opens with (or a merge brings) open conflicts; drop it once
  // "Mark resolved & save" finished the merge (the session becomes null).
  const opened = useRef<EditorConflictSession | null>(null)
  useEffect(() => {
    if (conflicts && opened.current !== conflicts) {
      opened.current = conflicts
      if (conflicts.counts().open > 0) setTab("conflicts")
    }
    if (!conflicts) {
      opened.current = null
      setTab((t) => (t === "conflicts" ? "design" : t))
    }
  }, [conflicts])
  const reviewRev = useBusValue(review ?? NO_REV)
  const reviewed = useRef(reviewRev)
  useEffect(() => {
    if (reviewRev === reviewed.current) return
    reviewed.current = reviewRev
    if (conflicts) setTab("conflicts")
  }, [reviewRev, conflicts])
  const items = useMemo(() => {
    const base: { value: RightTab; label: string }[] = [...TABS]
    if (hasActivity) base.push({ value: "activity", label: "Activity" })
    if (conflicts && counts)
      base.push({ value: "conflicts", label: conflictsTabLabel(counts.open) })
    return base
  }, [conflicts, counts, hasActivity])
  const nothingSelected = useUi(session.ui, (s) => s.selection.length === 0)
  // Board 44 §3: collapsed, the card is its header as a pill (the tab stays).
  if (collapsed)
    return (
      <aside
        className="right-panel ws-card ws-card--right ws-card--collapsed"
        aria-label="Properties panel"
      >
        {header}
      </aside>
    )
  // Board 44 rule "Floating cards": 280 on every tab (boards 05 / 25 widened Agent and Code to
  // 360); §2: the Design tab with nothing selected shrinks to the Page card (256, hug).
  const page = tab === "design" && nothingSelected
  return (
    <aside
      className={`right-panel ws-card ws-card--right right-panel--${tab}${page ? " ws-card--page" : ""}`}
      aria-label="Properties panel"
    >
      {header}
      <Tabs label="Right panel" items={items} value={tab} onChange={setTab} />
      {tab === "activity" && activity}
      {tab === "conflicts" && conflicts && (
        <ConflictsPanel session={conflicts} getNode={(id) => session.store.getNode(id)} />
      )}
      {tab === "design" && (
        <DesignTab
          session={session}
          layout={layout}
          assets={assets}
          icons={icons}
          m3={m3}
          fonts={fonts}
          onExport={onExport}
        />
      )}
      {tab === "code" && (
        <CodeTab
          session={session}
          m3={m3}
          icons={icons}
          {...(onOpenExport ? { onOpenExport } : {})}
        />
      )}
      {tab === "agent" && agent}
      {tab === "agent" && !agent && (
        // The agent panel mounts once the file's id resolves (a hash of its path): a short wait.
        <div className="right-panel__empty" data-testid="agent-panel-loading" aria-busy="true">
          <EmptyState
            icon={<Icon name="sparkles" size={18} />}
            title="Loading the agent…"
            description="Describe a change and Kimo makes it on the canvas, with undo per turn."
          />
        </div>
      )}
    </aside>
  )
}

/** Open / total conflicts of `session`, kept current (null without a session). */
function useConflictCounts(
  session: EditorConflictSession | null,
): { open: number; total: number } | null {
  const [counts, setCounts] = useState(() => (session ? session.counts() : null))
  useEffect(() => {
    if (!session) {
      setCounts(null)
      return
    }
    const read = () =>
      setCounts((c) => {
        const n = session.counts()
        return c && c.open === n.open && c.total === n.total ? c : n
      })
    read()
    return session.subscribe(read)
  }, [session])
  return counts
}

/** Node types with `fill` / `stroke` (graphics fields) and `radius`. */
const HAS_FILL = new Set(["frame", "rect", "ellipse", "polygon", "path", "text"])
const HAS_STROKE = new Set(["frame", "rect", "ellipse", "polygon", "path", "text", "browser"])

/**
 * View only: the sections go inert in a `display: contents` wrapper. Everyone else gets the
 * sections as the design tab's own children (no wrapper).
 */
function InertSections({ on, children }: { on: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>
  return (
    <div className="design-tab__sections" inert>
      {children}
    </div>
  )
}

function DesignTab({
  session,
  layout,
  assets,
  icons,
  m3,
  fonts,
  onExport,
}: {
  session: FileSession
  layout: Bus<LayoutResult | null>
  assets: AssetStore | null
  icons: IconProvider | null
  m3: M3Controller
  fonts: FontSystem | null
  onExport: (() => void) | undefined
}) {
  // View only (board 41 section 9): the sections read, dimmed to 50 %, and take no input.
  const viewOnly = useContext(ViewOnlyContext)
  // Re-renders when the selection or a selected node changes, not on every document edit.
  const selection = useUi(session.ui, (s) => s.selection)
  const realSel: readonly Sel[] = useNodes(session.store, selection)
  // M3: instances and composite ids (`<instance>/<IdPath>`) read the expanded view (effective
  // values); their edits are routed to overrides (m3/route.ts). Re-read on document changes
  // only while such a node is selected.
  const needsView =
    selection.some((id) => id.includes("/")) || realSel.some((s) => s.node.type === "instance")
  const viewRev = useBusValue(needsView ? m3.rev : NO_REV)
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewRev = the view changed
  const sel: readonly Sel[] = useMemo(() => {
    if (!needsView) return realSel
    const view = m3.view()
    return selection
      .map((id) => ({ id, node: view.getNode(id) as NodeData | undefined }))
      .filter((s): s is Sel => !!s.node)
  }, [needsView, realSel, selection, m3, viewRev])
  const key = selection.join("\u0000")
  const editor = useEditor(session, key)
  const header = useDocHeader(session.store)
  // Board 27 §6 (d): the Image section while the selected layer is in crop mode.
  const crop = useCropSession(session.ui)

  // Board 44 §2: nothing selected, the Design tab is the Page card (page, export, hint).
  if (sel.length === 0) return <PageCard session={session} {...(onExport ? { onExport } : {})} />

  const nodes = sel.map((s) => s.node)
  const first = sel[0] as Sel
  const types = new Set(nodes.map((n) => n.type))
  const all = (set: ReadonlySet<string>) => [...types].every((t) => set.has(t))
  const allText = all(new Set(["text"]))
  const kind = shared(nodes, kindLabel)
  const instance = types.has("instance")
  const view = m3.view()
  const single = sel.length === 1 ? first.id : null
  const m3kind = single ? layerKind(view, single) : null
  const inInstance = single !== null && (view.isVirtual(single) || !!view.origin(single)?.owned)
  const overrides = single && (inInstance || instance) ? overrideFieldsOf(m3, view, single) : null
  const themeFirst =
    single !== null &&
    (first.node.type === "frame" || m3kind === "instance") &&
    typeof first.node.theme === "object" &&
    first.node.theme !== null &&
    Object.keys(first.node.theme).length > 0
      ? single
      : null
  const kindText =
    m3kind === "instance"
      ? "Instance"
      : m3kind === "component"
        ? "Component"
        : m3kind === "derived"
          ? "Derived"
          : m3kind === "slot"
            ? "Slot"
            : null
  const headerIcon =
    m3kind === "instance"
      ? "diamond"
      : m3kind === "component" || m3kind === "derived"
        ? "component"
        : m3kind === "slot"
          ? "square-dashed"
          : null

  return (
    <PanelContext.Provider
      value={{
        session,
        editor,
        header,
        layout,
        assets,
        icons,
        fonts,
        theme: single ? view.theme(single) : undefined,
        m3,
      }}
    >
      {/* Keyed by the selection: popovers, open effect rows and drafts reset with it. */}
      <div className="design-tab" key={key}>
        <div className="selection-header">
          <span
            className={`selection-header__icon${headerIcon ? " selection-header__icon--component" : ""}`}
          >
            <Icon
              name={headerIcon ?? (sel.length === 1 ? typeIcon(first.node) : "layers")}
              size={14}
            />
          </span>
          <span className="selection-header__name" data-testid="selection-name">
            {sel.length === 1 ? nodeName(first.node) : `${sel.length} layers`}
          </span>
          <span className="selection-header__spacer" />
          {kindText ? (
            <KindPill label={kindText} derived={m3kind === "derived"} />
          ) : (
            <Badge>{kind === MIXED ? "Mixed" : kind}</Badge>
          )}
        </div>
        <OverrideFieldsContext.Provider value={overrides}>
          {/* `display: contents` keeps the sections the design tab's own children. */}
          <InertSections on={viewOnly}>
            {crop && single === crop.nodeId && <ImageCropSection crop={crop} />}
            {/* Board 14 (PEcqt): a node with theme pins shows Theme first, under the header. */}
            {themeFirst && <ThemeSection m3={m3} id={themeFirst} />}
            {single && m3kind === "instance" && <InstanceSection m3={m3} id={single} />}
            {single && m3kind === "instance" && !view.isVirtual(single) && (
              <PropertiesSection m3={m3} id={single} />
            )}
            {single && (m3kind === "component" || m3kind === "derived") && (
              <ComponentSection m3={m3} id={single} />
            )}
            {single && !inInstance && first.node.type === "frame" && (
              <SlotSection m3={m3} id={single} />
            )}
            <LayerSection sel={sel} />
            <PositionSection sel={sel} />
            {/* Board 20 (YjE2h): Text after Position (Resizing drives the W/H modes there); auto
              layout is hidden for text nodes. */}
            {allText && (
              // Board 30: while editing (or for a text with runs) the section acts on ranges.
              <RichTextScope sel={sel}>
                {(view, editing) => <TextSection sel={view} fonts={fonts} editing={editing} />}
              </RichTextScope>
            )}
            {!allText && <AutoLayoutSection sel={sel} />}
            {all(new Set(["icon"])) && <IconSection sel={sel} />}
            {/* Board 27 §5 (b): Polygon & Star share one section. */}
            {all(new Set(["polygon"])) && <PolygonSection sel={sel} />}
            {(all(HAS_FILL) ||
              all(new Set(["icon"])) ||
              (instance && all(new Set(["instance"])))) &&
              (allText ? (
                <RichTextScope sel={sel}>{(view) => <FillSection sel={view} />}</RichTextScope>
              ) : (
                <FillSection sel={sel} />
              ))}
            {all(HAS_STROKE) && <StrokeSection sel={sel} />}
            <EffectsSection sel={sel} />
            {single && !themeFirst && (first.node.type === "frame" || m3kind === "instance") && (
              <ThemeSection m3={m3} id={single} />
            )}
          </InertSections>
          {/* Board 47 §1: the selection's Export, the last section; outside the inert wrapper so
            a view link that may export still can. */}
          {onExport && (
            <PropSection
              title="Export"
              action={{ label: "Export…", icon: <Icon name="plus" size={14} />, onClick: onExport }}
            />
          )}
        </OverrideFieldsContext.Provider>
      </div>
    </PanelContext.Provider>
  )
}
