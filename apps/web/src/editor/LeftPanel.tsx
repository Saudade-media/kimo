/**
 * Left panel — board 03 "Left Panel" (CgPBW): 256 wide, bg-app, right border, vertical.
 * Children in node order: Tabs (Layers / Assets / Variables), Search (padding [4, 8, 8, 8],
 * Input 30 high), Layer Tree (vertical, gap 1, padding [0, 6]), Spacer, Footer
 * (top border, gap 8, padding [10, 12]: files icon, "N pages", spacer, Kbd ⌘P).
 */
import type { DocStore, NodeData, Op } from "@kimo/editor-state"
import {
  AGENT_LAYER_ROW_CLASS,
  EmptyState,
  Input,
  Kbd,
  LayerRow,
  LayerRowConflict,
  LayerRowM3,
  Tabs,
} from "@kimo/ui"
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { matches } from "../shortcuts/shortcuts"
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
}: {
  session: FileSession
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
  return (
    <aside className="left-panel" aria-label="Layers panel">
      <Tabs label="Left panel" items={TABS} value={tab} onChange={setTab} />
      {tab === "layers" && (
        <>
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
      <div className="left-panel__footer">
        <span className="left-panel__footer-icon">
          <Icon name="files" size={14} />
        </span>
        <span className="left-panel__footer-label">1 page</span>
        <span className="left-panel__footer-spacer" />
        <Kbd>⌘P</Kbd>
      </div>
    </aside>
  )
}

interface Row {
  id: string
  depth: number
  hasChildren: boolean
  parent: string | null
}

const NO_AGENT_NODES: ReadonlySet<string> = new Set()

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
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const selection = useUi(ui, (s) => s.selection)
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
    const walk = (parent: string | null, depth: number) => {
      for (const id of view.children(parent)) {
        if (q && !matches(id)) continue
        const kids = view.children(id).length > 0
        out.push({ id, depth, hasChildren: kids, parent })
        if (kids && isOpen(id, depth)) walk(id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [m3, shape, treeRev, query, isOpen])

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
      menu: (id, x, y) => setMenu({ id, x, y }),
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

  const scrollToIndex = (i: number) => {
    const el = tree.current
    if (!el) return
    const top = i * ROW_PITCH
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_PITCH > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_PITCH - el.clientHeight
  }

  if (rows.length === 0)
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
          agent={agentNodes.has(r.id)}
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
      {menu && <ChildMenu m3={m3} id={menu.id} at={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

interface RowActions {
  toggle(id: string, depth: number): void
  select(id: string, e: Mods): void
  apply: FileSession["apply"]
  hover(id: string | null): void
  menu(id: string, x: number, y: number): void
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
  agent,
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
  /** Touched by an uncommitted agent group (board 21 LayerRow/Agent). */
  agent: boolean
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
    if (!inInstance && n.type !== "instance") return
    e.preventDefault()
    actions.select(id, { shiftKey: false, metaKey: false, ctrlKey: false })
    actions.menu(id, e.clientX, e.clientY)
  }
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
