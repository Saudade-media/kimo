/**
 * Left panel — board 03 "Left Panel" (CgPBW): 256 wide, bg-app, right border, vertical.
 * Children in node order: Tabs (Layers / Assets / Variables), Search (padding [4, 8, 8, 8],
 * Input 30 high), Layer Tree (vertical, gap 1, padding [0, 6]), Spacer, Footer
 * (top border, gap 8, padding [10, 12]: files icon, "N pages", spacer, Kbd ⌘P).
 *
 * Board 44 §1: the panel is the floating "Left Card" (VQw3DeBw2I) led by its Card Header;
 * collapsed (§3) only the header shows, as a pill.
 */
import type { DocStore, NodeData, Op } from "@kimo/editor-state"
import {
  AGENT_LAYER_ROW_CLASS,
  DropIndicator,
  EmptyState,
  Input,
  LayerRow,
  LayerRowConflict,
  LayerRowDropTarget,
  LayerRowM3,
  Tabs,
  TooltipContent,
} from "@kimo/ui"
import {
  type KeyboardEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { UiStore } from "../canvas/contract"
import { type EditorConflictSession, useOpenConflictNodes } from "../conflicts"
import { useNode, useTreeRevision, useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { AssetsTab } from "./m3/AssetsTab"
import { type M3Controller, useComponentRev, useLayerTreeRev } from "./m3/controller"
import { ChildMenu } from "./m3/menus"
import { isOverridden, layerKind, replacedName } from "./m3/model"
import { VariablesTab } from "./m3/VariablesTab"
import "../canvas/agent-canvas.css"
import { useDocHeader } from "../lib/header"
import { matches } from "../shortcuts/shortcuts"
import { openRowMenu } from "./clipboard/menu-bus"
import { computeTreeDrop, refuseParent, type TreeDrop, treeDropOps } from "./clipboard/tree-drop"
import { activeRoots, pageLayerCount } from "./pages/model"
import { pageSwitcherBus } from "./pages/PageSwitcher"
import { PagesFooter, PagesStrip, usePageList } from "./pages/PagesStrip"
import { kindLabel, nodeName, typeIcon } from "./props"
import type { FileSession } from "./session"

type LeftTab = "layers" | "assets" | "variables"
const TABS = [
  { value: "layers", label: "Layers" },
  { value: "assets", label: "Assets" },
  { value: "variables", label: "Variables" },
] as const

export function LeftPanel({
  session,
  m3,
  conflicts = null,
  agentNodes = NO_AGENT_NODES,
  promptRun,
  onRunPrompt,
  header = null,
  collapsed = false,
}: {
  session: FileSession
  /** Board 44 Left Card › Card Header (wNJcXZthFH), first child of the card. */
  header?: ReactNode
  /** Board 44 §3: only the header shows, as a pill. */
  collapsed?: boolean
  m3: M3Controller
  /** Board 18: nodes owning an open conflict show LayerRow/Conflict (VpvIr). */
  conflicts?: EditorConflictSession | null
  /** Board 21: rows an uncommitted agent group touched get `LayerRow/Agent` (PwDCI). */
  agentNodes?: ReadonlySet<string>
  /** M6 (board 22): prompt run status for LayerRow/Prompt's trailing icon (app data). */
  promptRun?: (id: string) => PromptRowStatus | undefined
  /** M6: the play button of a LayerRow/Prompt. */
  onRunPrompt?: (id: string) => void
}) {
  const [tab, setTab] = useState<LeftTab>("layers")
  const conflictNodes = useOpenConflictNodes(conflicts)
  const [query, setQuery] = useState("")
  // Board 44 §3: collapsed, the card is its header as a pill (the tab and query stay).
  if (collapsed)
    return (
      <aside
        className="left-panel ws-card ws-card--left ws-card--collapsed"
        aria-label="Layers panel"
      >
        {header}
      </aside>
    )
  return (
    <aside className="left-panel ws-card ws-card--left" aria-label="Layers panel">
      {header}
      <Tabs label="Left panel" items={TABS} value={tab} onChange={setTab} />
      {tab === "layers" && (
        <>
          {/* Board 27 §1 (a) lid8E: the pages strip at the top of the Layers tab. */}
          <PagesStrip session={session} m3={m3} />
          <div className="left-panel__search">
            <Input
              icon={<Icon name="search" size={16} />}
              placeholder="Search layers"
              aria-label="Search layers"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              frameProps={{ className: "left-panel__search-input" }}
            />
          </div>
          <LayerTreeHeader session={session} />
          <LayerTree
            store={session.store}
            ui={session.ui}
            apply={session.apply}
            query={query}
            m3={m3}
            conflictNodes={conflictNodes}
            agentNodes={agentNodes}
            agentRows={{ promptRun, onRunPrompt }}
          />
        </>
      )}
      {tab === "assets" && <AssetsTab session={session} m3={m3} />}
      {tab === "variables" && <VariablesTab session={session} m3={m3} />}
      <div className="left-panel__spacer" />
      {/* Board 27 §1 (d) wsA6U: live page count; click (or ⌘P) opens the switcher. */}
      <PagesFooter session={session} onOpenSwitcher={() => pageSwitcherBus(session).set(true)} />
    </aside>
  )
}

/**
 * Board 27 §1 (a) "Tree Header" (hvwbw): the active page's name (sans text-xs 600 text-tertiary)
 * and its layer count (mono text-xs text-tertiary), above the tree.
 */
function LayerTreeHeader({ session }: { session: FileSession }) {
  const { pages, active } = usePageList(session)
  const shape = useTreeRevision(session.store)
  const count = useMemo(() => {
    void shape
    return pageLayerCount(session.store, activeRoots(session.store, active))
  }, [session.store, active, shape])
  const name = pages.find((p) => p.id === active)?.name ?? pages[0]?.name ?? ""
  return (
    <div className="layer-tree-header" data-testid="layer-tree-header">
      <span className="layer-tree-header__page">{name}</span>
      <span className="layer-tree-header__spacer" />
      <span className="layer-tree-header__count">
        {count} {count === 1 ? "layer" : "layers"}
      </span>
    </div>
  )
}

interface Row {
  id: string
  depth: number
  hasChildren: boolean
  parent: string | null
}

const NO_AGENT_NODES: ReadonlySet<string> = new Set()

/** Board 27 rules F1FPb: a hovered collapsed container opens after 600 ms of "into". */
const AUTO_EXPAND_MS = 600

/** LayerRow height (28) + Layer Tree gap (1): the virtualized row pitch. */
const ROW_PITCH = 29
const ROW_GAP = 1
/** Rows rendered above and below the visible window. */
const OVERSCAN = 8
/** Window used before the tree has measured itself. */
const INITIAL_ROWS = 60

type Mods = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }

/**
 * Layer Tree (lZmOH). Re-renders on tree-shape changes, selection and scroll only: each row
 * subscribes to its own node (`LayerItem`), and only the rows in view are mounted, so a field
 * edit or drag step in a 5k-node document re-renders at most the row of the edited node.
 * Keyboard: roving focus (one row is tabbable); ↑/↓ move and select (⇧ extends), ←/→
 * collapse/expand or go to the parent/first child, Home/End, Enter/Space select, F2 rename,
 * ⇧⌘H hide/show, ⇧⌘L lock/unlock.
 */
function LayerTree({
  store,
  ui,
  apply,
  query,
  m3,
  conflictNodes,
  agentNodes,
  agentRows,
}: {
  store: DocStore
  ui: UiStore
  apply: FileSession["apply"]
  query: string
  m3: M3Controller
  conflictNodes: ReadonlyMap<string, unknown>
  agentNodes: ReadonlySet<string>
  agentRows: AgentRowHooks
}) {
  const shape = useTreeRevision(store)
  // M3: instances mirror their main's full child list through the expanded view (composite ids).
  const compRev = useComponentRev(m3)
  // Row lists change only with structure (not with fills / geometry inside a main).
  const treeRev = useLayerTreeRev(m3)
  // Board 27 §8 Kpf1o: instances with broken overrides (memoized per tree rev + variables).
  const broken = m3.brokenInstances()
  // `selection`: the selection before the right-click (Child Menu "Replace with selection").
  const [menu, setMenu] = useState<{
    id: string
    x: number
    y: number
    selection: readonly string[]
  } | null>(null)
  /** Board 27 §2 (c): a row drag in progress. */
  const [drag, setDrag] = useState<{
    ids: readonly string[]
    drop: TreeDrop | null
    x: number
    y: number
  } | null>(null)
  const selection = useUi(ui, (s) => s.selection)
  const page = useUi(ui, (s) => s.page)
  const pagesHeader = useDocHeader(store).pages
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [view, setView] = useState({ top: 0, height: 0 })
  const tree = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)
  /** Set when keyboard navigation moved focus: the focused row takes DOM focus once mounted. */
  const moveFocus = useRef(false)

  // Roots start open; instances start closed (board 11: instance rows collapsed until opened).
  const isOpen = useCallback(
    (id: string, depth: number) =>
      query.trim() !== "" ||
      expanded.has(id) ||
      (depth === 0 && !collapsed.has(id) && store.getNode(id)?.type !== "instance"),
    [query, expanded, collapsed, store],
  )

  const rows = useMemo(() => {
    void shape
    void treeRev
    const view = m3.view()
    const out: Row[] = []
    const q = query.trim().toLowerCase()
    const memo = new Map<string, boolean>()
    const matches = (id: string): boolean => {
      const hit = memo.get(id)
      if (hit !== undefined) return hit
      const n = view.getNode(id) as NodeData | undefined
      const ok =
        !!n &&
        (nodeName(n).toLowerCase().includes(q) ||
          kindLabel(n).toLowerCase().includes(q) ||
          view.children(id).some(matches))
      memo.set(id, ok)
      return ok
    }
    // Board 27 §1 rule "Layers tree": only the active page's roots (pages are never rows).
    void pagesHeader
    const onPage = new Set(activeRoots(store, page))
    const walk = (parent: string | null, depth: number) => {
      for (const id of view.children(parent)) {
        if (parent === null && !onPage.has(id)) continue
        if (q && !matches(id)) continue
        const kids = view.children(id).length > 0
        out.push({ id, depth, hasChildren: kids, parent })
        if (kids && isOpen(id, depth)) walk(id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [m3, shape, treeRev, query, isOpen, store, page, pagesHeader])

  const index = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows])
  const selected = useMemo(() => new Set(selection), [selection])

  // Reveal the selection: expand every ancestor of a selected node.
  useEffect(() => {
    const add = new Set<string>()
    const view = m3.view()
    for (const id of selection) {
      let p = view.getNode(id)?.parent ?? null
      while (typeof p === "string" && !add.has(p)) {
        add.add(p)
        p = view.getNode(p)?.parent ?? null
      }
    }
    if (add.size === 0) return
    setCollapsed((c) =>
      [...c].some((id) => add.has(id)) ? new Set([...c].filter((id) => !add.has(id))) : c,
    )
    setExpanded((e) => ([...add].every((id) => e.has(id)) ? e : new Set([...e, ...add])))
  }, [selection, m3])

  // Scroll a selection made elsewhere (canvas) into view, without layout reads per row.
  useEffect(() => {
    const first = selection[0]
    const i = first === undefined ? undefined : index.get(first)
    const el = tree.current
    if (i === undefined || !el) return
    const top = i * ROW_PITCH
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_PITCH > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_PITCH - el.clientHeight
  }, [selection, index])

  // Track the scroll window (re-bound when the tree element appears after an empty state).
  const empty = rows.length === 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: `empty` re-binds to the new element
  useEffect(() => {
    const el = tree.current
    if (!el) return
    const update = () =>
      setView((v) =>
        v.top === el.scrollTop && v.height === el.clientHeight
          ? v
          : { top: el.scrollTop, height: el.clientHeight },
      )
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
    }
  }, [empty])

  const focusIndex = focusId === null ? undefined : index.get(focusId)
  const tabbable =
    focusIndex !== undefined
      ? focusId
      : (selection.find((id) => index.has(id)) ?? rows[0]?.id ?? null)

  useEffect(() => {
    if (!moveFocus.current || focusId === null) return
    moveFocus.current = false
    tree.current
      ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(focusId)}"]`)
      ?.focus({ preventScroll: true })
  })

  // Stable callbacks for the memoized rows (they read the latest state through refs).
  const latest = useRef({ rows, index, isOpen, apply, ui })
  latest.current = { rows, index, isOpen, apply, ui }

  const toggle = useCallback((id: string, depth: number) => {
    const open = latest.current.isOpen(id, depth)
    if (depth === 0) {
      setCollapsed((c) => {
        const n = new Set(c)
        if (open) n.add(id)
        else n.delete(id)
        return n
      })
    }
    setExpanded((e) => {
      const n = new Set(e)
      if (open) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const select = useCallback((id: string, e: Mods) => {
    const { rows: list, index: at, ui: u } = latest.current
    const s = u.getState()
    setFocusId(id)
    if (e.metaKey || e.ctrlKey) s.toggleSelection(id)
    else if (e.shiftKey && anchor.current) {
      const a = at.get(anchor.current)
      const b = at.get(id)
      if (a !== undefined && b !== undefined) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        s.select(list.slice(lo, hi + 1).map((r) => r.id))
        return
      }
      s.addToSelection([id])
    } else s.select([id])
    anchor.current = id
  }, [])

  const actions = useMemo<RowActions>(
    () => ({
      toggle,
      select,
      apply: (op, label) => latest.current.apply(op, label),
      hover: (id) => latest.current.ui.getState().setHovered(id),
      menu: (id, x, y) => setMenu({ id, x, y, selection: latest.current.ui.getState().selection }),
      contextSelect: (id) => {
        const u = latest.current.ui.getState()
        if (!u.selection.includes(id))
          select(id, { shiftKey: false, metaKey: false, ctrlKey: false })
      },
    }),
    [toggle, select],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement) return // renaming
    const cur = focusIndex ?? (tabbable ? index.get(tabbable) : undefined)
    if (cur === undefined) return
    const row = rows[cur] as Row
    const go = (i: number, mods: Mods = e) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))]
      if (!r) return
      e.preventDefault()
      moveFocus.current = true
      select(r.id, { ...mods, metaKey: false, ctrlKey: false })
      scrollToIndex(index.get(r.id) ?? 0)
    }
    const mod = e.metaKey || e.ctrlKey
    const key = e.key
    if (matches("toggleHidden", e)) {
      e.preventDefault()
      const n = m3.view().getNode(row.id)
      if (n) apply(visibilityOp(row.id, n.visible === false), "Toggle visibility")
      return
    }
    if (matches("toggleLocked", e)) {
      e.preventDefault()
      const n = store.getNode(row.id)
      if (n) apply(lockOp(row.id, n.locked === true), "Toggle lock")
      return
    }
    if (mod) return
    switch (key) {
      case "ArrowDown":
        return go(cur + 1)
      case "ArrowUp":
        return go(cur - 1)
      case "Home":
        return go(0)
      case "End":
        return go(rows.length - 1)
      case "ArrowRight":
        if (!row.hasChildren) return
        e.preventDefault()
        if (!isOpen(row.id, row.depth)) toggle(row.id, row.depth)
        else go(cur + 1, { shiftKey: false, metaKey: false, ctrlKey: false })
        return
      case "ArrowLeft":
        e.preventDefault()
        if (row.hasChildren && isOpen(row.id, row.depth)) toggle(row.id, row.depth)
        else if (row.parent !== null) {
          const p = index.get(row.parent)
          if (p !== undefined) go(p, { shiftKey: false, metaKey: false, ctrlKey: false })
        }
        return
      case "Enter":
      case " ":
        e.preventDefault()
        select(row.id, e)
        return
    }
  }

  // --- Board 27 §2 (c) h0cqV3: drag rows to reorder / reparent ------------------------------------
  const startRowDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return
    const t = e.target as HTMLElement
    if (t.closest("button, input")) return
    const rowEl = t.closest<HTMLElement>("[data-node-id]")
    const rowId = rowEl?.dataset.nodeId
    const el = tree.current
    if (!rowId || !el) return
    const view = m3.view()
    const sel = latest.current.ui.getState().selection
    const order = latest.current.index
    const picked = sel.includes(rowId) ? sel.filter((id) => order.has(id)) : [rowId]
    // Top-level of the picked rows, in tree order; nothing inside an instance moves.
    const set = new Set(picked)
    const ids = picked
      .filter((id) => {
        let p = store.getNode(id)?.parent ?? null
        while (typeof p === "string") {
          if (set.has(p)) return false
          p = store.getNode(p)?.parent ?? null
        }
        return true
      })
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    if (!ids.length || ids.some((id) => view.isVirtual(id) || !store.hasNode(id))) return
    if (
      ids.some((id) => refuseParent(dropReader(), store.getNode(id)?.parent ?? null, []) !== null)
    )
      return
    const sx = e.clientX
    const sy = e.clientY
    let started = false
    let expandTimer: ReturnType<typeof setTimeout> | null = null
    let expandFor: string | null = null
    let last: TreeDrop | null = null
    const compute = (cx: number, cy: number): TreeDrop | null => {
      const r = el.getBoundingClientRect()
      const y = cy - r.top + el.scrollTop
      const list = latest.current.rows
      const i = Math.max(0, Math.min(list.length - 1, Math.floor(y / ROW_PITCH)))
      const fy = Math.max(0, Math.min(1, (y - i * ROW_PITCH) / (ROW_PITCH - ROW_GAP)))
      const px = (cx - r.left - 6 - 8) / 14
      return computeTreeDrop(list, i, fy, px, ids, dropReader(), (row) =>
        latest.current.isOpen(row.id, row.depth),
      )
    }
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return
      started = true
      last = compute(ev.clientX, ev.clientY)
      setDrag({ ids, drop: last, x: ev.clientX, y: ev.clientY })
      // Into a collapsed container: auto-expand after 600 ms (rules F1FPb).
      const into = last?.kind === "into" ? last.target : null
      if (into !== expandFor) {
        if (expandTimer) clearTimeout(expandTimer)
        expandTimer = null
        expandFor = into
        if (into) {
          const row = latest.current.rows.find((x) => x.id === into)
          if (row && !latest.current.isOpen(row.id, row.depth))
            expandTimer = setTimeout(() => toggle(row.id, row.depth), AUTO_EXPAND_MS)
        }
      }
    }
    const end = (commit: boolean) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("keydown", key, true)
      if (expandTimer) clearTimeout(expandTimer)
      if (!started) return
      // Swallow the click that follows a drag.
      window.addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true })
      setDrag(null)
      if (!commit || !last?.valid) return
      const layout = m3.canvas()?.layout() ?? null
      const ops = treeDropOps(dropReader(), ids, last, {
        worldOf: (id) => layout?.nodes.get(id)?.world ?? null,
        originOf: (p) => {
          if (p === null) return { x: 0, y: 0 }
          const w = layout?.nodes.get(p)?.world
          return w ? { x: w.x, y: w.y } : null
        },
      })
      if (ops.length && latest.current.apply(ops, ids.length > 1 ? "Move layers" : "Move layer"))
        latest.current.ui.getState().select(ids)
    }
    const up = () => end(true)
    const key = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== "Escape" || !started) return
      ev.preventDefault()
      ev.stopPropagation()
      end(false)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("keydown", key, true)
  }
  const dropReader = () => {
    const view = m3.view()
    return {
      getNode: (id: string) => store.getNode(id),
      children: (p: string | null, at?: string | null) => store.children(p, at),
      isVirtual: (id: string) => view.isVirtual(id),
    }
  }

  const scrollToIndex = (i: number) => {
    const el = tree.current
    if (!el) return
    const top = i * ROW_PITCH
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_PITCH > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_PITCH - el.clientHeight
  }

  if (rows.length === 0 && !drag)
    return (
      <div className="left-panel__empty">
        <EmptyState
          icon={<Icon name="layers" size={18} />}
          title={query ? "No matching layers" : "No layers yet"}
          description={
            query
              ? "Try another name or layer type."
              : "Press F to draw a frame, or ask the agent to start a layout."
          }
        />
      </div>
    )

  // Visible window (+ overscan); the focused row stays mounted so focus is never lost.
  const visibleRows = view.height > 0 ? Math.ceil(view.height / ROW_PITCH) : INITIAL_ROWS
  const start = Math.max(0, Math.floor(view.top / ROW_PITCH) - OVERSCAN)
  const end = Math.min(rows.length, start + visibleRows + 2 * OVERSCAN)
  const mounted = rows.slice(start, end)
  if (focusIndex !== undefined && (focusIndex < start || focusIndex >= end))
    mounted.push(rows[focusIndex] as Row)

  return (
    <div
      ref={tree}
      className="layer-tree"
      role="tree"
      aria-label="Layers"
      aria-multiselectable="true"
      onKeyDown={onKeyDown}
      onPointerLeave={() => ui.getState().setHovered(null)}
      onPointerDown={startRowDrag}
      data-dragging={drag ? (drag.drop?.valid === false ? "invalid" : "valid") : undefined}
    >
      {start > 0 && (
        <div className="layer-tree__spacer" style={{ height: start * ROW_PITCH - ROW_GAP }} />
      )}
      {mounted.map((r) => (
        <LayerItem
          key={r.id}
          store={store}
          m3={m3}
          rev={compRev}
          row={r}
          open={r.hasChildren ? isOpen(r.id, r.depth) : undefined}
          selected={selected.has(r.id)}
          tabbable={r.id === tabbable}
          conflict={conflictNodes.has(r.id)}
          dropInto={drag?.drop?.kind === "into" && drag.drop.target === r.id}
          agent={agentNodes.has(r.id)}
          broken={broken.has(r.id)}
          actions={actions}
          agentRows={agentRows}
        />
      ))}
      {end < rows.length && (
        <div
          className="layer-tree__spacer"
          style={{ height: (rows.length - end) * ROW_PITCH - ROW_GAP }}
        />
      )}
      {menu && (
        <ChildMenu
          m3={m3}
          id={menu.id}
          at={menu}
          selection={menu.selection}
          onClose={() => setMenu(null)}
        />
      )}
      {drag?.drop && drag.drop.kind !== "into" && (
        <DropIndicator
          className="layer-tree__drop"
          invalid={!drag.drop.valid}
          data-testid="layer-drop-indicator"
          style={{
            top: drag.drop.slot * ROW_PITCH - ROW_GAP / 2 - 4,
            left: 6 + 8 + 14 * drag.drop.depth - 4,
          }}
        />
      )}
      {drag?.drop && !drag.drop.valid && (
        <TooltipContent
          className="layer-tree__drop-tip"
          data-testid="layer-drop-tooltip"
          style={{ left: drag.x + 12, top: drag.y + 16 }}
        >
          {drag.drop.reason}
        </TooltipContent>
      )}
    </div>
  )
}

interface RowActions {
  toggle(id: string, depth: number): void
  select(id: string, e: Mods): void
  apply: FileSession["apply"]
  hover(id: string | null): void
  menu(id: string, x: number, y: number): void
  /** Right-click: selects the row unless it is already part of the selection. */
  contextSelect(id: string): void
}

const visibilityOp = (id: string, hidden: boolean): Op =>
  hidden ? { op: "update", id, unset: ["visible"] } : { op: "update", id, set: { visible: false } }
const lockOp = (id: string, locked: boolean): Op =>
  locked ? { op: "update", id, unset: ["locked"] } : { op: "update", id, set: { locked: true } }

/** One tree row; re-renders when its node, open/selected/tabbable state or depth change. */
const LayerItem = memo(function LayerItem({
  store,
  m3,
  rev,
  row,
  open,
  selected,
  tabbable,
  conflict,
  dropInto = false,
  agent,
  broken = false,
  actions,
  agentRows,
}: {
  store: DocStore
  m3: M3Controller
  /** Component revision (virtual rows read the view). */
  rev: number
  row: Row
  open: boolean | undefined
  selected: boolean
  tabbable: boolean
  /** Owns an open merge conflict (board 18 "Layers" rule). */
  conflict: boolean
  /** Board 27 §2 (c): the drag's "into" target (LayerRow/DropTarget). */
  dropInto?: boolean
  /** Touched by an uncommitted agent group (board 21 LayerRow/Agent). */
  agent: boolean
  /** Board 27 §8 Kpf1o: an instance holding broken overrides (warning dot). */
  broken?: boolean
  actions: RowActions
  agentRows: AgentRowHooks
}) {
  const real = useNode(store, row.id)
  void rev
  const view = m3.view()
  const n = (real ? (view.getNode(row.id) ?? real) : view.getNode(row.id)) as NodeData | undefined
  if (!n) return null
  const { id, depth } = row
  const agentClass = agent ? AGENT_LAYER_ROW_CLASS : undefined
  const hidden = n.visible === false
  const locked = n.locked === true
  const kind = layerKind(view, id)
  const inInstance = view.isVirtual(id) || !!view.origin(id)?.owned
  const onContextMenu = (e: React.MouseEvent) => {
    if (!inInstance && n.type !== "instance") {
      // Board 27 §2 (g1jiG): layer rows open the canvas context menu (same commands, order).
      e.preventDefault()
      actions.contextSelect(id)
      openRowMenu(store, e.clientX, e.clientY)
      return
    }
    e.preventDefault()
    // Menu first: it keeps the selection from before this row is selected.
    actions.menu(id, e.clientX, e.clientY)
    actions.select(id, { shiftKey: false, metaKey: false, ctrlKey: false })
  }
  if (dropInto)
    return (
      <LayerRowDropTarget
        data-node-id={id}
        name={nodeName(n)}
        icon={<Icon name={typeIcon(n)} size={14} />}
        depth={depth}
        expanded={open ?? false}
      />
    )
  if (conflict)
    return (
      <LayerRowConflict
        className={agentClass}
        data-node-id={id}
        tabIndex={tabbable ? 0 : -1}
        name={nodeName(n)}
        icon={<Icon name={typeIcon(n)} size={14} />}
        depth={depth}
        expanded={open}
        onToggleExpanded={() => actions.toggle(id, depth)}
        selected={selected}
        emphasized={depth === 0}
        onClick={(e) => actions.select(id, e)}
        onContextMenu={onContextMenu}
        onPointerEnter={() => actions.hover(id)}
      />
    )
  if (kind) {
    const derivedFrom =
      kind === "derived"
        ? view.origin(id)?.instance?.of || String(real?.of ?? n.of ?? "")
        : undefined
    return (
      <LayerRowM3
        className={agentClass}
        kind={kind}
        name={
          kind === "replaced"
            ? (replacedName(view, m3.doc(), m3.libraries(), id) ?? nodeName(n))
            : nodeName(n)
        }
        title={kind === "replaced" ? `Replaced by ${nodeName(n)}` : undefined}
        from={
          derivedFrom
            ? nodeName((view.getNode(derivedFrom) ?? { type: derivedFrom }) as NodeData)
            : ""
        }
        depth={depth}
        expanded={open ?? null}
        selected={selected}
        overridden={
          kind !== "instance" &&
          kind !== "component" &&
          kind !== "derived" &&
          isOverridden(view, id)
        }
        broken={kind === "instance" && broken}
        visible={!hidden}
        onToggle={() => actions.toggle(id, depth)}
        onSelect={(e) => actions.select(id, { shiftKey: e.shift, metaKey: e.meta, ctrlKey: false })}
        onToggleVisible={() =>
          actions.apply(visibilityOp(id, hidden), hidden ? "Show layer" : "Hide layer")
        }
        onRename={(name) => actions.apply({ op: "update", id, set: { name } }, "Rename layer")}
        onContextMenu={onContextMenu}
        data-node-id={id}
        tabIndex={tabbable ? 0 : -1}
        onPointerEnter={() => actions.hover(id)}
      />
    )
  }
  // M6 (board 22): LayerRow/Note (Td29N), LayerRow/Prompt (zKI13), LayerRow/Placeholder (lZZ9q).
  const placeholder =
    n.type === "frame" && n.placeholder !== undefined && n.placeholder !== false && !inInstance
  if (!inInstance && (n.type === "note" || n.type === "prompt" || placeholder)) {
    const kind = n.type === "note" ? "note" : n.type === "prompt" ? "prompt" : "placeholder"
    return (
      <AgentLayerRow
        kind={kind}
        className={agentClass}
        id={id}
        name={nodeName(n)}
        depth={depth}
        expanded={kind === "placeholder" ? open : undefined}
        onToggle={() => actions.toggle(id, depth)}
        selected={selected}
        tabbable={tabbable}
        hidden={hidden}
        run={kind === "prompt" ? (agentRows.promptRun?.(id) ?? "idle") : undefined}
        onRun={kind === "prompt" ? agentRows.onRunPrompt : undefined}
        onToggleVisible={() =>
          actions.apply(visibilityOp(id, hidden), hidden ? "Show layer" : "Hide layer")
        }
        onSelect={(e) => actions.select(id, e)}
        onHover={() => actions.hover(id)}
        onContextMenu={onContextMenu}
        onRename={(name) => actions.apply({ op: "update", id, set: { name } }, "Rename layer")}
      />
    )
  }
  const dot = inInstance && isOverridden(view, id)
  return (
    <LayerRow
      className={agentClass}
      data-node-id={id}
      data-overridden={dot || undefined}
      tabIndex={tabbable ? 0 : -1}
      name={nodeName(n)}
      icon={<Icon name={typeIcon(n)} size={14} />}
      depth={depth}
      expanded={open}
      onToggleExpanded={() => actions.toggle(id, depth)}
      selected={selected}
      emphasized={depth === 0}
      visible={!hidden}
      onToggleVisible={() =>
        actions.apply(visibilityOp(id, hidden), hidden ? "Show layer" : "Hide layer")
      }
      locked={locked}
      onToggleLocked={
        inInstance
          ? undefined
          : () => actions.apply(lockOp(id, locked), locked ? "Unlock layer" : "Lock layer")
      }
      onRename={(name) => actions.apply({ op: "update", id, set: { name } }, "Rename layer")}
      onClick={(e) => actions.select(id, e)}
      onContextMenu={onContextMenu}
      onPointerEnter={() => actions.hover(id)}
    />
  )
})

// --- M6: agent node rows (board 22 cf2sC n22Gv, DzQcZ MVnAW) -----------------------------------

/** Run status shown by LayerRow/Prompt's trailing slot. */
export type PromptRowStatus = "idle" | "running" | "failed"

interface AgentRowHooks {
  promptRun?: (id: string) => PromptRowStatus | undefined
  onRunPrompt?: (id: string) => void
}

/**
 * LayerRow variants built on the LayerRow base (GXnBT: 28 high, gap 6, padding [0, 8]):
 * - Note (Td29N): no disclosure, sticky-note `note-text`, eye (hover) as usual;
 * - Prompt (zKI13): no disclosure, sparkles `agent`; trailing play `text-tertiary` (idle, runs
 *   the prompt) · loader-circle `agent` (running) · circle-alert `danger` (failed);
 * - Placeholder (lZZ9q): disclosure kept, loader-circle `agent`, name `agent`, lock `agent`
 *   instead of the eye (never locked for people: rows stay selectable).
 */
function AgentLayerRow({
  kind,
  className,
  id,
  name,
  depth,
  expanded,
  onToggle,
  selected,
  tabbable,
  hidden,
  run,
  onRun,
  onToggleVisible,
  onSelect,
  onHover,
  onContextMenu,
  onRename,
}: {
  kind: "note" | "prompt" | "placeholder"
  className?: string
  id: string
  name: string
  depth: number
  expanded: boolean | undefined
  onToggle(): void
  selected: boolean
  tabbable: boolean
  hidden: boolean
  run?: PromptRowStatus
  onRun?: (id: string) => void
  onToggleVisible(): void
  onSelect(e: Mods): void
  onHover(): void
  /** Board 27 §2: the layer row context menu (the canvas menu's commands). */
  onContextMenu(e: React.MouseEvent): void
  onRename(name: string): void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(name)
  const icon = kind === "note" ? "sticky-note" : kind === "prompt" ? "sparkles" : "loader-circle"
  const leaf = expanded === undefined
  const finish = (commit: boolean) => {
    setRenaming(false)
    const next = draft.trim()
    if (commit && next && next !== name) onRename(next)
  }
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={leaf ? undefined : expanded}
      tabIndex={tabbable ? 0 : -1}
      data-node-id={id}
      data-agent-row={kind}
      data-hidden={hidden || undefined}
      className={[
        "kimo-layer-row",
        "agent-layer-row",
        `agent-layer-row--${kind}`,
        selected && "kimo-layer-row--selected",
        hidden && "kimo-layer-row--hidden",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ paddingLeft: 8 + 14 * depth }}
      onClick={(e) => onSelect(e)}
      onContextMenu={onContextMenu}
      onPointerEnter={onHover}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return
        setDraft(name)
        setRenaming(true)
      }}
      onKeyDown={(e) => {
        if (matches("renameLayer", e) && !renaming) {
          e.preventDefault()
          setDraft(name)
          setRenaming(true)
        }
      }}
    >
      {kind === "placeholder" && (
        <button
          type="button"
          tabIndex={-1}
          className={`kimo-layer-row__disclosure${leaf ? " kimo-layer-row__disclosure--leaf" : ""}`}
          aria-label={leaf ? undefined : expanded ? "Collapse" : "Expand"}
          aria-hidden={leaf || undefined}
          disabled={leaf}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          <Icon name={expanded === false ? "chevron-right" : "chevron-down"} size={12} />
        </button>
      )}
      <span
        className={`kimo-layer-row__icon kimo-layer-row__icon--${kind === "note" ? "note" : "agent"}`}
        aria-hidden="true"
      >
        <Icon name={icon} size={14} />
      </span>
      {renaming ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: rename starts on an explicit double-click / F2
          autoFocus
          className="kimo-layer-row__input"
          aria-label="Layer name"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter") finish(true)
            else if (e.key === "Escape") finish(false)
          }}
        />
      ) : (
        <span className="kimo-layer-row__name">{name}</span>
      )}
      <span className="kimo-layer-row__spacer" aria-hidden="true" />
      {kind === "placeholder" ? (
        <span
          className="agent-layer-row__trail agent-layer-row__trail--lock"
          title="An agent is building this frame (you can still edit it)"
        >
          <Icon name="lock" size={14} />
        </span>
      ) : kind === "prompt" ? (
        run === "running" ? (
          <span className="agent-layer-row__trail agent-layer-row__trail--running" title="Running">
            <Icon name="loader-circle" size={14} />
          </span>
        ) : run === "failed" ? (
          <button
            type="button"
            tabIndex={-1}
            className="agent-layer-row__trail agent-layer-row__trail--failed"
            aria-label="Run failed · retry"
            disabled={!onRun}
            onClick={(e) => {
              e.stopPropagation()
              onRun?.(id)
            }}
          >
            <Icon name="circle-alert" size={14} />
          </button>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            className="agent-layer-row__trail agent-layer-row__trail--play"
            aria-label="Run prompt"
            disabled={!onRun}
            onClick={(e) => {
              e.stopPropagation()
              onRun?.(id)
            }}
          >
            <Icon name="play" size={14} />
          </button>
        )
      ) : (
        <button
          type="button"
          tabIndex={-1}
          className={`kimo-layer-row__affordance kimo-layer-row__visibility${hidden ? " kimo-layer-row__affordance--on" : ""}`}
          aria-label={hidden ? "Show layer" : "Hide layer"}
          aria-pressed={hidden}
          onClick={(e) => {
            e.stopPropagation()
            onToggleVisible()
          }}
        >
          <Icon name={hidden ? "eye-off" : "eye"} size={14} />
        </button>
      )}
    </div>
  )
}
