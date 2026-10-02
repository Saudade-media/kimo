/**
 * Left panel — board 03 "Left Panel" (CgPBW): 256 wide, bg-app, right border, vertical.
 * Children in node order: Tabs (Layers / Assets / Variables), Search (padding [4, 8, 8, 8],
 * Input 30 high), Layer Tree (vertical, gap 1, padding [0, 6]), Spacer, Footer
 * (top border, gap 8, padding [10, 12]: files icon, "N pages", spacer, Kbd ⌘P).
 */
import type { DocStore, Op } from "@kimo/editor-state"
import { EmptyState, Input, Kbd, LayerRow, Tabs } from "@kimo/ui"
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { UiStore } from "../canvas/contract"
import { useNode, useTreeRevision, useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { kindLabel, nodeName, typeIcon } from "./props"
import type { FileSession } from "./session"

type LeftTab = "layers" | "assets" | "variables"
const TABS = [
  { value: "layers", label: "Layers" },
  { value: "assets", label: "Assets" },
  { value: "variables", label: "Variables" },
] as const

export function LeftPanel({ session }: { session: FileSession }) {
  const [tab, setTab] = useState<LeftTab>("layers")
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
          <LayerTree store={session.store} ui={session.ui} apply={session.apply} query={query} />
        </>
      )}
      {tab === "assets" && (
        <div className="left-panel__empty">
          <EmptyState
            icon={<Icon name="image" size={18} />}
            title="No assets yet"
            description="Images you add to this file show up here."
          />
        </div>
      )}
      {tab === "variables" && (
        <div className="left-panel__empty">
          <EmptyState
            icon={<Icon name="variable" size={18} />}
            title="No variables yet"
            description="Colors, sizes and fonts you reuse across the file live here."
          />
        </div>
      )}
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
}: {
  store: DocStore
  ui: UiStore
  apply: FileSession["apply"]
  query: string
}) {
  const shape = useTreeRevision(store)
  const selection = useUi(ui, (s) => s.selection)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [view, setView] = useState({ top: 0, height: 0 })
  const tree = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)
  /** Set when keyboard navigation moved focus: the focused row takes DOM focus once mounted. */
  const moveFocus = useRef(false)

  const isOpen = useCallback(
    (id: string, depth: number) =>
      query.trim() !== "" || expanded.has(id) || (depth === 0 && !collapsed.has(id)),
    [query, expanded, collapsed],
  )

  const rows = useMemo(() => {
    void shape
    const out: Row[] = []
    const q = query.trim().toLowerCase()
    const memo = new Map<string, boolean>()
    const matches = (id: string): boolean => {
      const hit = memo.get(id)
      if (hit !== undefined) return hit
      const n = store.getNode(id)
      const ok =
        !!n &&
        (nodeName(n).toLowerCase().includes(q) ||
          kindLabel(n).toLowerCase().includes(q) ||
          store.children(id).some(matches))
      memo.set(id, ok)
      return ok
    }
    const walk = (parent: string | null, depth: number) => {
      for (const id of store.children(parent)) {
        if (q && !matches(id)) continue
        const kids = store.children(id).length > 0
        out.push({ id, depth, hasChildren: kids, parent })
        if (kids && isOpen(id, depth)) walk(id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [store, shape, query, isOpen])

  const index = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows])
  const selected = useMemo(() => new Set(selection), [selection])

  // Reveal the selection: expand every ancestor of a selected node.
  useEffect(() => {
    const add = new Set<string>()
    for (const id of selection) {
      let p = store.getNode(id)?.parent ?? null
      while (typeof p === "string") {
        add.add(p)
        p = store.getNode(p)?.parent ?? null
      }
    }
    if (add.size === 0) return
    setCollapsed((c) =>
      [...c].some((id) => add.has(id)) ? new Set([...c].filter((id) => !add.has(id))) : c,
    )
    setExpanded((e) => ([...add].every((id) => e.has(id)) ? e : new Set([...e, ...add])))
  }, [selection, store])

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
    if (mod && e.shiftKey && (key === "h" || key === "H")) {
      e.preventDefault()
      const n = store.getNode(row.id)
      if (n) apply(visibilityOp(row.id, n.visible === false), "Toggle visibility")
      return
    }
    if (mod && e.shiftKey && (key === "l" || key === "L")) {
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
          row={r}
          open={r.hasChildren ? isOpen(r.id, r.depth) : undefined}
          selected={selected.has(r.id)}
          tabbable={r.id === tabbable}
          actions={actions}
        />
      ))}
      {end < rows.length && (
        <div
          className="layer-tree__spacer"
          style={{ height: (rows.length - end) * ROW_PITCH - ROW_GAP }}
        />
      )}
    </div>
  )
}

interface RowActions {
  toggle(id: string, depth: number): void
  select(id: string, e: Mods): void
  apply: FileSession["apply"]
  hover(id: string | null): void
}

const visibilityOp = (id: string, hidden: boolean): Op =>
  hidden ? { op: "update", id, unset: ["visible"] } : { op: "update", id, set: { visible: false } }
const lockOp = (id: string, locked: boolean): Op =>
  locked ? { op: "update", id, unset: ["locked"] } : { op: "update", id, set: { locked: true } }

/** One tree row; re-renders when its node, open/selected/tabbable state or depth change. */
const LayerItem = memo(function LayerItem({
  store,
  row,
  open,
  selected,
  tabbable,
  actions,
}: {
  store: DocStore
  row: Row
  open: boolean | undefined
  selected: boolean
  tabbable: boolean
  actions: RowActions
}) {
  const n = useNode(store, row.id)
  if (!n) return null
  const { id, depth } = row
  const special = n.type === "instance" || n.component === true || typeof n.component === "object"
  const hidden = n.visible === false
  const locked = n.locked === true
  return (
    <LayerRow
      data-node-id={id}
      tabIndex={tabbable ? 0 : -1}
      name={nodeName(n)}
      icon={<Icon name={typeIcon(n)} size={14} />}
      depth={depth}
      expanded={open}
      onToggleExpanded={() => actions.toggle(id, depth)}
      selected={selected}
      emphasized={depth === 0}
      accentIcon={special}
      visible={!hidden}
      onToggleVisible={() =>
        actions.apply(visibilityOp(id, hidden), hidden ? "Show layer" : "Hide layer")
      }
      locked={locked}
      onToggleLocked={() =>
        actions.apply(lockOp(id, locked), locked ? "Unlock layer" : "Lock layer")
      }
      onRename={(name) => actions.apply({ op: "update", id, set: { name } }, "Rename layer")}
      onClick={(e) => actions.select(id, e)}
      onPointerEnter={() => actions.hover(id)}
    />
  )
})
