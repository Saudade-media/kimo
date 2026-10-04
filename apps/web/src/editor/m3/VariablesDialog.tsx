/**
 * Variables dialog (board 14 `EIkIk`, ⌥⇧⌘V): 1040 × 780 over a scrim (#0A0A0A4D). Header
 * (padding [20, 20, 16, 24]: title xl 500, desc base, Close 32) · Body: Sidebar 184 (Groups /
 * Theme axes / Libraries) + Main (Toolbar: Search 220 × 30, Type Filter, New variable · Table:
 * Axis Row 24, Column Row 32, VariableRows, open Entries · Footer: info note, Export DTCG, Done).
 * Every edit is one M3 command (one undo step).
 */
import { axisDisplayOrder, isRef, type KimoDocument, type Variable } from "@kimo/core-schema"
import {
  AxisGroupHeader,
  ColorPicker,
  EntryRow,
  Input,
  MenuDense,
  MenuDivider,
  ModeColumnHeader,
  Popover,
  type PopoverAnchor,
  TypeGlyph,
  useFocusTrap,
  VarCell,
  type VarCellValue,
} from "@kimo/ui"
import { Fragment, useMemo, useRef, useState } from "react"
import { downloadBlob } from "../../lib/files"
import { useDocHeader } from "../../lib/header"
import { Icon } from "../../lib/icons"
import type { FileSession } from "../session"
import { type M3Controller, useBusValue, useLibraries } from "./controller"
import { M3MenuItem } from "./menus"
import { M3Button, M3IconButton } from "./ui"
import {
  type Cell,
  cellOf,
  colorText,
  cssColor,
  defaultValue,
  type Entry,
  entriesOf,
  entryStates,
  exportDtcg,
  freeName,
  groupOf,
  inSpaceOf,
  isPlain,
  outsideSrgb,
  parseValue,
  previewTheme,
  resolveUnder,
  toHexApprox,
  type VarType,
  valueText,
} from "./variables"

type Rec = Record<string, unknown>
type Vars = Record<string, { type: string; value: unknown; group?: string; description?: string }>

const TYPE_ICON: Record<string, string> = {
  color: "palette",
  number: "hash",
  string: "type",
  boolean: "toggle-left",
}
const FILTERS = ["all", "color", "number", "string", "boolean"] as const
type Filter = (typeof FILTERS)[number]
const NAME_W = 216

type Pop =
  | { kind: "new"; anchor: HTMLElement }
  | { kind: "row"; anchor: HTMLElement; name: string }
  | { kind: "column"; anchor: HTMLElement; axis: string; value: string }
  | { kind: "details"; anchor: PopoverAnchor; name: string }
  | {
      kind: "alias"
      anchor: HTMLElement
      name: string
      axis: string | null
      value: string | null
      entry: number | null
    }
  | {
      kind: "color"
      anchor: HTMLElement
      name: string
      axis: string | null
      value: string | null
      entry: number | null
    }
  | {
      kind: "text"
      anchor: HTMLElement
      name: string
      axis: string | null
      value: string | null
      entry: number | null
    }
  | { kind: "axis"; anchor: HTMLElement; axis: string | null }
  | { kind: "rename-value"; anchor: HTMLElement; axis: string; value: string }
  | { kind: "entry"; anchor: HTMLElement; name: string; entry: number }

export function VariablesDialog({
  session,
  m3,
  onClose,
}: {
  session: FileSession
  m3: M3Controller
  onClose(): void
}) {
  const header = useDocHeader(session.store)
  const libsList = useLibraries(m3)
  const preview = useBusValue(m3.previewTheme)
  const doc = header as unknown as KimoDocument
  const libs = m3.libraries()
  const vars = (header.variables ?? {}) as Vars
  const themes = (header.themes ?? {}) as Record<string, string[]>
  const axes = axisDisplayOrder(doc)
  const theme = previewTheme(doc, libs, preview)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [group, setGroup] = useState<string | null>(null)
  const [library, setLibrary] = useState<string | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [pop, setPop] = useState<Pop | null>(null)
  const [pendingGroup, setPendingGroup] = useState<string | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  // Modal: focus starts on the dialog, Tab stays inside it, and focus returns to the opener
  // when it closes (the trap restores it on unmount).
  const trap = useFocusTrap(dialog, "root")

  const source: Vars = library ? ((libs[library]?.variables ?? {}) as Vars) : vars
  const readOnly = library !== null
  const names = Object.keys(source)
    .filter((n) => filter === "all" || source[n]?.type === filter)
    .filter((n) => group === null || groupOf(source[n]) === group)
    .filter((n) => !query.trim() || n.toLowerCase().includes(query.trim().toLowerCase()))
    .sort()
  const groups = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of Object.values(vars)) {
      const g = groupOf(v)
      if (g) m.set(g, (m.get(g) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [vars])
  const columns = axes.flatMap((a) => (themes[a] ?? []).map((v) => ({ axis: a, value: v })))
  /** Arrow keys between the grid's cells (rows: name header + value cells). */
  const gridKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const grid = e.currentTarget
    const cellSel = '[role="gridcell"], [role="rowheader"]'
    const active = document.activeElement as HTMLElement | null
    const cell = active?.closest<HTMLElement>(cellSel)
    if (!cell || !grid.contains(cell)) return
    if (e.key === "Escape" && !pop) {
      e.stopPropagation()
      grid.focus()
      return
    }
    const rows = [...grid.querySelectorAll<HTMLElement>('[role="row"]')].filter((r) =>
      r.querySelector(cellSel),
    )
    const row = cell.closest<HTMLElement>('[role="row"]')
    const r = row ? rows.indexOf(row) : -1
    const cellsOf = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(cellSel)]
    const c = row ? cellsOf(row).indexOf(cell) : -1
    let target: HTMLElement | undefined
    if (e.key === "ArrowRight" && row) target = cellsOf(row)[c + 1]
    else if (e.key === "ArrowLeft" && row) target = cellsOf(row)[c - 1]
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = rows[r + (e.key === "ArrowDown" ? 1 : -1)]
      if (next) {
        const cells = cellsOf(next)
        target = cells[Math.min(c, cells.length - 1)]
      }
    } else if (e.key === "Home" && row) target = cellsOf(row)[0]
    else if (e.key === "End" && row) target = cellsOf(row).at(-1)
    if (!target) return
    e.preventDefault()
    target.focus()
  }
  const run = m3.run.bind(m3)

  const createVariable = (type: VarType) => {
    const base = `${pendingGroup ?? group ?? type}/${type === "color" ? "color" : type}`
    const name = freeName(base, Object.keys(vars))
    const variable: Rec = { type, value: defaultValue(type) }
    if (pendingGroup ?? group) variable.group = (pendingGroup ?? group) as string
    const r = run(
      { cmd: "createVariable", name, variable: variable as unknown as Variable },
      "New variable",
    )
    setPendingGroup(null)
    if (r.ok && dialog.current)
      setPop({
        kind: "details",
        anchor: dialog.current.querySelector(".m3-vd__new") as HTMLElement,
        name,
      })
  }

  const editCell = (
    e: HTMLElement,
    name: string,
    axis: string | null,
    value: string | null,
    cell: Cell | null,
  ) => {
    if (readOnly) return
    const v = vars[name]
    if (!v) return
    const entry = cell?.kind === "value" ? cell.entry : null
    const current = cell?.kind === "value" ? cell.value : axis === null ? v.value : undefined
    if (isRef(current)) setPop({ kind: "alias", anchor: e, name, axis, value, entry })
    else if (v.type === "color") setPop({ kind: "color", anchor: e, name, axis, value, entry })
    else setPop({ kind: "text", anchor: e, name, axis, value, entry })
  }

  /** Writes a cell: the grid cell (`setCell`), an entry (`setVariableValue`) or the plain value. */
  const writeCell = (
    name: string,
    axis: string | null,
    value: string | null,
    entry: number | null,
    next: unknown,
  ) => {
    const v = vars[name]
    if (!v) return
    if (entry !== null && axis === null) {
      const list = entriesOf(v.value).map((e, i) => (i === entry ? { ...e, value: next } : e))
      run({ cmd: "setVariableValue", name, value: list }, "Edit entry")
    } else if (axis !== null && value !== null)
      run({ cmd: "setCell", name, axis, value, cell: next }, "Edit variable")
    else run({ cmd: "updateVariable", name, patch: { value: next } }, "Edit variable")
  }

  const renderCell = (
    name: string,
    v: Vars[string],
    cell: Cell,
    axis: string | null,
    value: string | null,
  ) => {
    if (cell.kind === "empty")
      return (
        <GridCell
          key={`${axis}:${value}`}
          kind="empty"
          axisValue={value ?? undefined}
          onClick={readOnly ? undefined : (el) => editCell(el, name, axis, value, cell)}
        />
      )
    return valueCell(name, v.type, cell.value, cell.multi, axis, value, cell)
  }

  const valueCell = (
    name: string,
    type: string,
    val: unknown,
    multi: boolean,
    axis: string | null,
    value: string | null,
    cell: Cell | null,
    entryIndex: number | null = null,
  ) => {
    const key = `${axis}:${value}:${entryIndex}`
    const click = readOnly
      ? undefined
      : (el: HTMLElement) =>
          entryIndex !== null
            ? setPop(
                isRef(val)
                  ? { kind: "alias", anchor: el, name, axis: null, value: null, entry: entryIndex }
                  : type === "color"
                    ? {
                        kind: "color",
                        anchor: el,
                        name,
                        axis: null,
                        value: null,
                        entry: entryIndex,
                      }
                    : {
                        kind: "text",
                        anchor: el,
                        name,
                        axis: null,
                        value: null,
                        entry: entryIndex,
                      },
              )
            : editCell(el, name, axis, value, cell)
    if (isRef(val))
      return (
        <GridCell
          key={key}
          kind="alias"
          alias={val.$ref}
          multi={multi}
          axisValue={value ?? undefined}
          onAlias={() => {
            const el = dialog.current?.querySelector<HTMLElement>(
              `[data-var="${CSS.escape(name)}"] [data-axis-value="${CSS.escape(value ?? "")}"]`,
            )
            if (el && click) click(el)
          }}
          onClick={click}
        />
      )
    switch (type) {
      case "color":
        return (
          <GridCell
            key={key}
            kind="color"
            swatch={cssColor(val) ?? undefined}
            text={colorText(val)}
            gamut={outsideSrgb(val)}
            multi={multi}
            axisValue={value ?? undefined}
            onClick={click}
          />
        )
      case "boolean":
        return (
          <GridCell
            key={key}
            kind="boolean"
            checked={val === true}
            multi={multi}
            axisValue={value ?? undefined}
            onToggle={(c) =>
              entryIndex !== null
                ? writeCell(name, null, null, entryIndex, c)
                : writeCell(name, axis, value, cell?.kind === "value" ? cell.entry : null, c)
            }
          />
        )
      case "number":
        return (
          <GridCell
            key={key}
            kind="number"
            text={valueText(type, val)}
            multi={multi}
            axisValue={value ?? undefined}
            onClick={click}
          />
        )
      default:
        return (
          <GridCell
            key={key}
            kind="string"
            text={valueText(type, val)}
            multi={multi}
            axisValue={value ?? undefined}
            onClick={click}
          />
        )
    }
  }

  const dragEntry = useRef<{ name: string; from: number } | null>(null)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim dismisses on outside press / Escape
    <div
      className="m3-scrim"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pop) {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div
        ref={dialog}
        className="m3-vd"
        role="dialog"
        aria-modal="true"
        aria-labelledby="m3-vd-title"
        tabIndex={-1}
        data-testid="variables-dialog"
        onKeyDown={trap}
      >
        <div className="m3-vd__header">
          <div className="m3-vd__titles">
            <h2 className="m3-vd__title" id="m3-vd-title">
              Variables
            </h2>
            <p className="m3-vd__desc">
              {`${header.meta?.name ?? "This file"} · ${Object.keys(vars).length} variables · ${axes.length} theme axes · ${libsList.length} libraries`}
            </p>
          </div>
          <M3IconButton
            icon="x"
            label="Close"
            size={32}
            iconSize={16}
            className="m3-vd__close"
            onClick={onClose}
          />
        </div>
        <div className="m3-vd__body">
          <nav className="m3-vd__sidebar" aria-label="Variable groups">
            <div className="m3-vd__section">Groups</div>
            <SideNav
              icon="layers"
              label="All"
              count={Object.keys(vars).length}
              active={group === null && library === null}
              onClick={() => {
                setGroup(null)
                setLibrary(null)
              }}
            />
            {groups.map(([g, n]) => (
              <SideNav
                key={g}
                icon="folder"
                label={g}
                mono
                count={n}
                active={group === g && library === null}
                onClick={() => {
                  setGroup(g)
                  setLibrary(null)
                }}
              />
            ))}
            <div className="m3-vd__section">Theme axes</div>
            {axes.map((a) => (
              <SideNav
                key={a}
                icon={a === "mode" ? "sun-moon" : "rows-3"}
                label={a}
                mono
                count={themes[a]?.length ?? 0}
                onClick={(el) => setPop({ kind: "axis", anchor: el, axis: a })}
              />
            ))}
            <M3Button
              variant="ghost"
              icon="plus"
              className="m3-vd__add-axis"
              onClick={(e) => setPop({ kind: "axis", anchor: e.currentTarget, axis: null })}
            >
              Add axis
            </M3Button>
            {libsList.length > 0 && <div className="m3-vd__section">Libraries</div>}
            {libsList.map((l) => (
              <SideNav
                key={l.alias}
                icon="lock"
                label={l.alias}
                mono
                count={
                  l.status === "missing" && !l.doc
                    ? "missing"
                    : Object.keys(l.doc?.variables ?? {}).length
                }
                missing={l.status === "missing"}
                active={library === l.alias}
                onClick={() => {
                  setLibrary(l.alias)
                  setGroup(null)
                }}
              />
            ))}
          </nav>
          <div className="m3-vd__main">
            <div className="m3-vd__toolbar">
              <Input
                icon={<Icon name="search" size={16} />}
                placeholder="Search variables"
                aria-label="Search variables"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                frameProps={{ className: "m3-vd__search" }}
              />
              <div className="m3-type-filter">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filter === f}
                    className={`m3-type-filter__seg${filter === f ? " m3-type-filter__seg--on" : ""}`}
                    onClick={() => setFilter(f)}
                  >
                    {f === "all" ? "All" : f[0]?.toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <span className="m3-vd__spacer" />
              <M3Button
                variant="primary"
                icon="plus"
                className="m3-vd__new"
                disabled={readOnly}
                onClick={(e) => setPop({ kind: "new", anchor: e.currentTarget })}
              >
                New variable
              </M3Button>
            </div>
            {/* A grid (one Tab stop): arrows move between cells, Enter / F2 edits, Escape
                returns to the grid. */}
            {/* biome-ignore lint/a11y/useSemanticElements: a CSS grid of sticky flex rows; a <table> cannot keep that layout */}
            <div
              className="m3-vd__table"
              role="grid"
              aria-label="Variables by theme"
              aria-rowcount={names.length + 1}
              aria-colcount={columns.length + 1}
              tabIndex={0}
              onFocus={(e) => {
                if (e.target !== e.currentTarget) return
                const first = e.currentTarget.querySelector<HTMLElement>(
                  '[role="gridcell"], [role="rowheader"]',
                )
                first?.focus()
              }}
              onKeyDown={gridKeys}
            >
              <div className="m3-vd__axis-row" role="presentation">
                <span className="m3-vd__pad" style={{ width: NAME_W }} />
                {axes.map((a) => (
                  <AxisGroupHeader
                    key={a}
                    axis={a}
                    count={themes[a]?.length ?? 0}
                    icon={a === "mode" ? undefined : <Icon name="rows-3" size={12} />}
                  />
                ))}
              </div>
              {/* biome-ignore lint/a11y/useSemanticElements: a CSS grid of sticky flex rows; a <table> cannot keep that layout */}
              {/* biome-ignore lint/a11y/useFocusableInteractive: rows are not focus stops; cells are */}
              <div className="m3-vd__column-row" role="row" aria-rowindex={1}>
                {/* biome-ignore lint/a11y/useSemanticElements: a CSS grid of sticky flex rows; a <table> cannot keep that layout */}
                {/* biome-ignore lint/a11y/useFocusableInteractive: headers are not focus stops */}
                <span className="m3-vd__name-header" role="columnheader" style={{ width: NAME_W }}>
                  Name
                </span>
                {columns.map((c) => (
                  <ModeColumnHeader
                    key={`${c.axis}:${c.value}`}
                    value={c.value}
                    isDefault={themes[c.axis]?.[0] === c.value}
                    onMenu={
                      readOnly
                        ? undefined
                        : (el) =>
                            setPop({ kind: "column", anchor: el, axis: c.axis, value: c.value })
                    }
                    data-column={c.value}
                    role="columnheader"
                  />
                ))}
              </div>
              {names.length === 0 && <div className="m3-vd__none">No variables match.</div>}
              {names.map((name) => {
                const v = source[name]
                if (!v) return null
                const isOpen = open.has(name)
                const r = resolveUnder(
                  library ? (libs[library] as KimoDocument) : doc,
                  name,
                  theme,
                  libs,
                )
                const lint = r.ok && !r.matched
                const entries = entriesOf(v.value)
                const states = entryStates(entries, theme)
                return (
                  <Fragment key={name}>
                    {/* biome-ignore lint/a11y/useSemanticElements: a CSS grid of sticky flex rows; a <table> cannot keep that layout */}
                    {/* biome-ignore lint/a11y/useFocusableInteractive: rows are not focus stops; cells are */}
                    <div
                      className={`m3-var-row${isOpen ? " m3-var-row--open" : ""}`}
                      data-var={name}
                      role="row"
                      aria-rowindex={names.indexOf(name) + 2}
                    >
                      {/* biome-ignore lint/a11y/useSemanticElements: a CSS grid of sticky flex rows; a <table> cannot keep that layout */}
                      <span
                        className="m3-var-row__name-cell"
                        role="rowheader"
                        tabIndex={-1}
                        style={{ width: NAME_W }}
                      >
                        <button
                          type="button"
                          tabIndex={-1}
                          className={`m3-var-row__disclosure${isOpen ? "" : " m3-var-row__disclosure--closed"}`}
                          aria-label={isOpen ? "Hide entries" : "Show entries"}
                          aria-expanded={isOpen}
                          aria-controls={`m3-entries-${name}`}
                          onClick={() =>
                            setOpen((o) => {
                              const n = new Set(o)
                              if (n.has(name)) n.delete(name)
                              else n.add(name)
                              return n
                            })
                          }
                        >
                          <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={12} />
                        </button>
                        <TypeGlyph type={glyphOf(v.type)} />
                        <span className="m3-var-row__name" title={v.description}>
                          {name}
                        </span>
                        {lint && (
                          <span
                            className="m3-var-row__lint"
                            title="THEME_NO_MATCH: no entry matches the previewed theme"
                          >
                            <Icon name="triangle-alert" size={12} />
                          </span>
                        )}
                      </span>
                      <span className="m3-var-row__values">
                        {isPlain(v.value) ? (
                          <>
                            {valueCell(name, v.type, v.value, false, null, null, null)}
                            <span className="m3-all-themes">all themes</span>
                          </>
                        ) : (
                          columns.map((c) =>
                            renderCell(name, v, cellOf(v.value, c.axis, c.value), c.axis, c.value),
                          )
                        )}
                      </span>
                      <span className="m3-var-row__spacer" />
                      {!readOnly && (
                        <M3IconButton
                          icon="ellipsis"
                          size={24}
                          label={`${name} menu`}
                          className="m3-var-row__menu"
                          onClick={(e) => setPop({ kind: "row", anchor: e.currentTarget, name })}
                        />
                      )}
                    </div>
                    {isOpen && (
                      <div className="m3-entries" data-entries={name} id={`m3-entries-${name}`}>
                        <div className="m3-entries__header">
                          <span className="m3-entries__title">Entries</span>
                          <span className="m3-entries__count">
                            {entries.length} · in list order · last matching entry wins
                          </span>
                          <span className="m3-entries__spacer" />
                          <span className="m3-entries__preview">
                            preview:{" "}
                            {axes
                              .map((a) => theme[a])
                              .filter(Boolean)
                              .join(" · ")}{" "}
                            → {r.ok ? valueText(v.type, r.value) : "—"}
                          </span>
                        </div>
                        {entries.map((en, i) => (
                          <EntryRow
                            // biome-ignore lint/suspicious/noArrayIndexKey: entries are positional
                            key={i}
                            index={i}
                            when={en.when && Object.keys(en.when).length ? en.when : null}
                            state={states[i]}
                            value={valueCell(name, v.type, en.value, false, null, null, null, i)}
                            onMenu={
                              readOnly
                                ? undefined
                                : (el) => setPop({ kind: "entry", anchor: el, name, entry: i })
                            }
                            dragHandleProps={
                              readOnly
                                ? undefined
                                : {
                                    draggable: true,
                                    onDragStart: (e: React.DragEvent<HTMLSpanElement>) => {
                                      dragEntry.current = { name, from: i }
                                      e.dataTransfer.effectAllowed = "move"
                                    },
                                  }
                            }
                            data-entry={i}
                            onDragOver={(e) => {
                              if (dragEntry.current?.name === name) e.preventDefault()
                            }}
                            onDrop={(e) => {
                              e.preventDefault()
                              const d = dragEntry.current
                              dragEntry.current = null
                              if (!d || d.name !== name || d.from === i) return
                              const list = [...entries]
                              const [moved] = list.splice(d.from, 1)
                              list.splice(i, 0, moved as Entry)
                              run({ cmd: "setVariableValue", name, value: list }, "Reorder entries")
                            }}
                          />
                        ))}
                        {!readOnly && (
                          <div className="m3-entries__footer">
                            <M3Button
                              variant="ghost"
                              icon="plus"
                              iconSize={12}
                              className="m3-entries__add"
                              disabled={axes.length === 0}
                              onClick={() => {
                                const a = axes[0] as string
                                const first = themes[a]?.[0] as string
                                run(
                                  {
                                    cmd: "setVariableValue",
                                    name,
                                    value: [
                                      ...(isPlain(v.value) ? [{ value: v.value }] : entries),
                                      {
                                        value: r.ok ? r.value : defaultValue(v.type as VarType),
                                        when: { [a]: first },
                                      },
                                    ],
                                  },
                                  "Add entry",
                                )
                              }}
                            >
                              Add entry
                            </M3Button>
                            <M3Button
                              variant="ghost"
                              icon="plus"
                              iconSize={12}
                              className="m3-entries__add"
                              disabled={
                                isPlain(v.value) ||
                                entries.some((e) => !e.when || !Object.keys(e.when).length)
                              }
                              onClick={() =>
                                run(
                                  {
                                    cmd: "setVariableValue",
                                    name,
                                    value: [
                                      { value: r.ok ? r.value : defaultValue(v.type as VarType) },
                                      ...entries,
                                    ],
                                  },
                                  "Add fallback",
                                )
                              }
                            >
                              Add fallback
                            </M3Button>
                          </div>
                        )}
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </div>
            <div className="m3-vd__footer">
              <span className="m3-vd__footer-icon">
                <Icon name="info" size={14} />
              </span>
              <span className="m3-vd__note">
                Last matching entry wins · — means no entry for that axis (falls back)
              </span>
              <span className="m3-vd__spacer" />
              <M3Button
                variant="secondary"
                icon="braces"
                className="m3-vd__footer-button"
                onClick={() =>
                  downloadBlob(
                    new Blob([`${JSON.stringify(exportDtcg(vars), null, 2)}\n`], {
                      type: "application/json",
                    }),
                    `${String(header.meta?.name ?? "variables").replace(/[^\w.-]+/g, "-")}.tokens.json`,
                  )
                }
              >
                Export DTCG
              </M3Button>
              <M3Button
                variant="primary"
                className="m3-vd__footer-button m3-vd__done"
                onClick={onClose}
              >
                Done
              </M3Button>
            </div>
          </div>
        </div>
        {pop && (
          <DialogPopovers
            m3={m3}
            pop={pop}
            vars={vars}
            themes={themes}
            axes={axes}
            theme={theme}
            onClose={() => setPop(null)}
            onNew={createVariable}
            onGroup={(g) => setPendingGroup(g)}
            onDetails={(name, anchor) => setPop({ kind: "details", anchor, name })}
            onShowEntries={(name) => setOpen((o) => new Set([...o, name]))}
            writeCell={writeCell}
            setPop={setPop}
          />
        )}
      </div>
    </div>
  )
}

function SideNav({
  icon,
  label,
  count,
  mono,
  active,
  missing,
  onClick,
}: {
  icon: string
  label: string
  count: number | string
  mono?: boolean
  active?: boolean
  missing?: boolean
  onClick?: (el: HTMLElement) => void
}) {
  return (
    <button
      type="button"
      className={`m3-side-nav${active ? " m3-side-nav--active" : ""}${missing ? " m3-side-nav--missing" : ""}`}
      aria-current={active || undefined}
      onClick={(e) => onClick?.(e.currentTarget)}
    >
      <span className="m3-side-nav__icon">
        <Icon name={icon} size={14} />
      </span>
      <span className={`m3-side-nav__label${mono ? " m3-side-nav__label--mono" : ""}`}>
        {label}
      </span>
      <span className="m3-side-nav__spacer" />
      <span className="m3-side-nav__count">{count}</span>
    </button>
  )
}

/** The dialog's menus and popovers (board 14 annex: New variable, Row, Column, Alias, Details, color). */
function DialogPopovers({
  m3,
  pop,
  vars,
  themes,
  axes,
  theme,
  onClose,
  onNew,
  onGroup,
  onDetails,
  onShowEntries,
  writeCell,
  setPop,
}: {
  m3: M3Controller
  pop: Pop
  vars: Vars
  themes: Record<string, string[]>
  axes: string[]
  theme: Record<string, string>
  onClose(): void
  onNew(t: VarType): void
  onGroup(g: string): void
  onDetails(name: string, anchor: HTMLElement): void
  onShowEntries(name: string): void
  writeCell(
    name: string,
    axis: string | null,
    value: string | null,
    entry: number | null,
    next: unknown,
  ): void
  setPop(p: Pop | null): void
}) {
  const run = m3.run.bind(m3)
  switch (pop.kind) {
    case "new":
      return (
        <MenuDense
          width={200}
          label="New variable"
          anchor={pop.anchor}
          placement={{ side: "bottom", align: "end", offset: 4 }}
          onClose={onClose}
          autoFocus
          data-testid="new-variable-menu"
        >
          {(["color", "number", "string", "boolean"] as const).map((t) => (
            <M3MenuItem
              key={t}
              icon={TYPE_ICON[t] as string}
              label={t[0]?.toUpperCase() + t.slice(1)}
              meta={t[0]?.toUpperCase()}
              onSelect={() => {
                onClose()
                onNew(t)
              }}
            />
          ))}
          <MenuDivider />
          <M3MenuItem
            icon="folder-plus"
            label="Group…"
            onSelect={() => {
              const g = prompt("Group for the next variable (DTCG path)")
              onClose()
              if (g?.trim()) onGroup(g.trim())
            }}
          />
          <M3MenuItem
            icon="sun-moon"
            label="Theme axis…"
            onSelect={() => setPop({ kind: "axis", anchor: pop.anchor, axis: null })}
          />
        </MenuDense>
      )
    case "row": {
      const v = vars[pop.name]
      const n = v ? entriesOf(v.value).length : 0
      return (
        <MenuDense
          width={220}
          label="Variable"
          anchor={pop.anchor}
          placement={{ side: "bottom", align: "end", offset: 4 }}
          onClose={onClose}
          autoFocus
          data-testid="row-menu"
        >
          <M3MenuItem
            icon="pencil"
            label="Edit details…"
            onSelect={() => onDetails(pop.name, pop.anchor)}
          />
          <M3MenuItem
            icon="list-ordered"
            label="Show entries"
            meta={String(n)}
            onSelect={() => {
              onClose()
              onShowEntries(pop.name)
            }}
          />
          <M3MenuItem
            icon="folder-input"
            label="Move to group…"
            onSelect={() => onDetails(pop.name, pop.anchor)}
          />
          <MenuDivider />
          <M3MenuItem
            icon="copy"
            label="Duplicate"
            onSelect={() => {
              onClose()
              run(
                {
                  cmd: "duplicateVariable",
                  from: pop.name,
                  to: freeName(`${pop.name}-copy`, Object.keys(vars)),
                },
                "Duplicate variable",
              )
            }}
          />
          <M3MenuItem
            icon="trash-2"
            label="Delete"
            danger
            onSelect={() => {
              onClose()
              const dry = m3.plan({ cmd: "deleteVariable", name: pop.name })
              if (dry.ok) run({ cmd: "deleteVariable", name: pop.name }, "Delete variable")
              else if (dry.error.code === "IN_USE")
                void m3
                  .confirm({
                    title: `Delete ${pop.name}?`,
                    desc: "It is still used. Bindings keep their current value as a literal.",
                    icon: "trash-2",
                    tone: "danger",
                    items: [{ icon: "circle-dot", text: dry.error.message }],
                    confirm: "Delete & detach",
                  })
                  .then(
                    (ok) =>
                      ok &&
                      run(
                        { cmd: "deleteVariable", name: pop.name, detach: true },
                        "Delete variable",
                      ),
                  )
              else m3.toastRefusal(dry.error)
            }}
          />
        </MenuDense>
      )
    }
    case "column":
      return (
        <MenuDense
          width={220}
          label="Column"
          anchor={pop.anchor}
          placement={{ side: "bottom", align: "end", offset: 4 }}
          onClose={onClose}
          autoFocus
          data-testid="column-menu"
        >
          <M3MenuItem
            icon="arrow-left-to-line"
            label="Make default (moves first)"
            disabled={themes[pop.axis]?.[0] === pop.value}
            onSelect={() => {
              onClose()
              run(
                { cmd: "moveAxisValue", axis: pop.axis, value: pop.value, index: 0 },
                "Make default",
              )
            }}
          />
          <M3MenuItem
            icon="pencil"
            label="Rename value"
            onSelect={() =>
              setPop({ kind: "rename-value", anchor: pop.anchor, axis: pop.axis, value: pop.value })
            }
          />
          <M3MenuItem
            icon="copy"
            label="Duplicate value"
            onSelect={() => {
              onClose()
              run(
                {
                  cmd: "duplicateAxisValue",
                  axis: pop.axis,
                  from: pop.value,
                  to: freeName(`${pop.value}-copy`, themes[pop.axis] ?? []),
                },
                "Duplicate value",
              )
            }}
          />
          <MenuDivider />
          <M3MenuItem
            icon="trash-2"
            label="Delete value"
            danger
            disabled={(themes[pop.axis]?.length ?? 0) < 2}
            onSelect={() => {
              onClose()
              const dry = m3.plan({ cmd: "removeAxisValue", axis: pop.axis, value: pop.value })
              if (dry.ok)
                run({ cmd: "removeAxisValue", axis: pop.axis, value: pop.value }, "Delete value")
              else if (dry.error.code === "IN_USE")
                void m3
                  .confirm({
                    title: `Delete ${pop.axis} = ${pop.value}?`,
                    desc: "Entries and pins that name it are removed.",
                    icon: "trash-2",
                    tone: "danger",
                    items: [{ icon: "circle-dot", text: dry.error.message }],
                    confirm: "Delete value",
                  })
                  .then(
                    (ok) =>
                      ok &&
                      run(
                        { cmd: "removeAxisValue", axis: pop.axis, value: pop.value, force: true },
                        "Delete value",
                      ),
                  )
              else m3.toastRefusal(dry.error)
            }}
          />
        </MenuDense>
      )
    case "rename-value":
      return (
        <TextPopover
          title={`Rename ${pop.axis} value`}
          anchor={pop.anchor}
          initial={pop.value}
          onCommit={(t) =>
            run({ cmd: "renameAxisValue", axis: pop.axis, from: pop.value, to: t }, "Rename value")
          }
          onClose={onClose}
        />
      )
    case "axis":
      return (
        <AxisPopover
          m3={m3}
          axis={pop.axis}
          values={pop.axis ? (themes[pop.axis] ?? []) : []}
          anchor={pop.anchor}
          onClose={onClose}
        />
      )
    case "details":
      return (
        <DetailsPopover
          m3={m3}
          name={pop.name}
          v={vars[pop.name]}
          anchor={pop.anchor}
          onClose={onClose}
        />
      )
    case "entry":
      return (
        <MenuDense width={200} label="Entry" anchor={pop.anchor} onClose={onClose} autoFocus>
          <M3MenuItem
            icon="trash-2"
            label="Delete entry"
            danger
            onSelect={() => {
              onClose()
              const v = vars[pop.name]
              if (!v) return
              const list = entriesOf(v.value).filter((_, i) => i !== pop.entry)
              if (!list.length) return
              run({ cmd: "setVariableValue", name: pop.name, value: list }, "Delete entry")
            }}
          />
        </MenuDense>
      )
    case "alias":
      return (
        <AliasPicker
          m3={m3}
          vars={vars}
          name={pop.name}
          axisLabel={pop.value ?? (pop.entry !== null ? `entry ${pop.entry + 1}` : "all themes")}
          axes={axes}
          themes={themes}
          anchor={pop.anchor}
          onPick={(ref) => writeCell(pop.name, pop.axis, pop.value, pop.entry, { $ref: ref })}
          onDetach={() => {
            const v = vars[pop.name]
            if (!v) return
            const entry =
              pop.entry ??
              (isPlain(v.value)
                ? null
                : cellOf(v.value, pop.axis ?? "", pop.value ?? "").kind === "value"
                  ? (cellOf(v.value, pop.axis ?? "", pop.value ?? "") as { entry: number }).entry
                  : null)
            run({ cmd: "detachAlias", name: pop.name, entry }, "Detach alias")
          }}
          onCustom={() =>
            setPop({ ...pop, kind: vars[pop.name]?.type === "color" ? "color" : "text" })
          }
          onClose={onClose}
          theme={theme}
        />
      )
    case "color": {
      const v = vars[pop.name]
      const cur = currentValue(v?.value, pop)
      const oklch = typeof cur === "object" && cur !== null && (cur as Rec).space === "oklch"
      return (
        <ColorPicker
          anchor={pop.anchor}
          placement={{ side: "bottom", align: "start", offset: 4 }}
          color={toHexApprox(cur) ?? "#000000"}
          format={oklch ? "oklch" : undefined}
          onChange={(hex) =>
            writeCell(pop.name, pop.axis, pop.value, pop.entry, inSpaceOf(cur, hex))
          }
          onChangeStart={() => m3.beginGesture()}
          onChangeEnd={() => m3.endGesture()}
          onClose={onClose}
        />
      )
    }
    case "text": {
      const v = vars[pop.name]
      const cur = currentValue(v?.value, pop)
      return (
        <TextPopover
          title={`${pop.name}${pop.value ? ` · ${pop.value}` : ""}`}
          anchor={pop.anchor}
          initial={cur === undefined ? "" : String(cur)}
          onCommit={(t) => {
            const parsed = parseValue((v?.type ?? "string") as VarType, t)
            if (parsed === null) return
            writeCell(pop.name, pop.axis, pop.value, pop.entry, parsed)
          }}
          onClose={onClose}
        />
      )
    }
  }
}

function currentValue(
  value: unknown,
  pop: { axis: string | null; value: string | null; entry: number | null },
): unknown {
  if (pop.entry !== null && pop.axis === null) return entriesOf(value)[pop.entry]?.value
  if (pop.axis !== null && pop.value !== null) {
    const c = cellOf(value, pop.axis, pop.value)
    return c.kind === "value" ? c.value : undefined
  }
  return isPlain(value) ? value : undefined
}

function TextPopover({
  title,
  anchor,
  initial,
  onCommit,
  onClose,
}: {
  title: string
  anchor: PopoverAnchor
  initial: string
  onCommit(text: string): void
  onClose(): void
}) {
  const [text, setText] = useState(initial)
  return (
    <Popover
      title={title}
      anchor={anchor}
      onClose={onClose}
      initialFocus="first"
      data-testid="text-popover"
    >
      <form
        className="m3-text-popover"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim() !== "" || initial === "") onCommit(text)
          onClose()
        }}
      >
        <Input aria-label={title} value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <M3Button variant="primary" type="submit">
          Apply
        </M3Button>
      </form>
    </Popover>
  )
}

function DetailsPopover({
  m3,
  name,
  v,
  anchor,
  onClose,
}: {
  m3: M3Controller
  name: string
  v: Vars[string] | undefined
  anchor: PopoverAnchor
  onClose(): void
}) {
  const [n, setN] = useState(name)
  const [g, setG] = useState(v?.group ?? "")
  const [d, setD] = useState(v?.description ?? "")
  if (!v) return null
  return (
    <Popover
      title="Variable details"
      anchor={anchor}
      onClose={onClose}
      initialFocus="first"
      data-testid="details-popover"
      style={{ width: 320 }}
    >
      <form
        className="m3-details"
        onSubmit={(e) => {
          e.preventDefault()
          let target = name
          if (n.trim() && n.trim() !== name) {
            const r = m3.run({ cmd: "renameVariable", from: name, to: n.trim() }, "Rename variable")
            if (!r.ok) return
            target = n.trim()
          }
          if ((v.group ?? "") !== g.trim() || (v.description ?? "") !== d)
            m3.run(
              {
                cmd: "updateVariable",
                name: target,
                patch: { group: g.trim() || null, description: d || null },
              },
              "Edit variable",
            )
          onClose()
        }}
      >
        <div className="m3-details__field">
          <span className="m3-details__label">Name</span>
          <Input aria-label="Name" value={n} onChange={(e) => setN(e.currentTarget.value)} />
        </div>
        <div className="m3-details__field">
          <span className="m3-details__label">Group</span>
          <Input
            aria-label="Group"
            placeholder="DTCG path, e.g. color"
            value={g}
            onChange={(e) => setG(e.currentTarget.value)}
          />
        </div>
        <div className="m3-details__field">
          <span className="m3-details__label">Description</span>
          <Input aria-label="Description" value={d} onChange={(e) => setD(e.currentTarget.value)} />
        </div>
        <div className="m3-details__field">
          <span className="m3-details__label">Type</span>
          <span className="m3-details__type">
            <TypeGlyph type={glyphOf(v.type)} />
            {v.type}
          </span>
        </div>
        <M3Button variant="primary" type="submit" className="m3-details__save">
          Save
        </M3Button>
      </form>
    </Popover>
  )
}

function AxisPopover({
  m3,
  axis,
  values,
  anchor,
  onClose,
}: {
  m3: M3Controller
  axis: string | null
  values: readonly string[]
  anchor: PopoverAnchor
  onClose(): void
}) {
  const [name, setName] = useState(axis ?? "")
  const [vals, setVals] = useState(axis ? values.join(", ") : "light, dark")
  return (
    <Popover
      title={axis ? `Axis · ${axis}` : "New theme axis"}
      anchor={anchor}
      onClose={onClose}
      initialFocus="first"
      data-testid="axis-popover"
    >
      <form
        className="m3-details"
        onSubmit={(e) => {
          e.preventDefault()
          const list = [
            ...new Set(
              vals
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ]
          if (!axis) {
            if (name.trim() && list.length)
              m3.run({ cmd: "createAxis", axis: name.trim(), values: list }, "Add axis")
          } else {
            if (name.trim() && name.trim() !== axis)
              m3.run({ cmd: "renameAxis", from: axis, to: name.trim() }, "Rename axis")
            const target = name.trim() || axis
            for (const v of list)
              if (!values.includes(v))
                m3.run({ cmd: "addAxisValue", axis: target, value: v }, "Add value")
          }
          onClose()
        }}
      >
        <div className="m3-details__field">
          <span className="m3-details__label">Axis</span>
          <Input
            aria-label="Axis name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </div>
        <div className="m3-details__field">
          <span className="m3-details__label">Values (first = default)</span>
          <Input
            aria-label="Axis values"
            value={vals}
            onChange={(e) => setVals(e.currentTarget.value)}
          />
        </div>
        <div className="m3-details__row">
          {axis && (
            <M3Button
              variant="ghost"
              icon="trash-2"
              onClick={() => {
                onClose()
                m3.run({ cmd: "deleteAxis", axis }, "Delete axis")
              }}
            >
              Delete axis
            </M3Button>
          )}
          <span className="m3-vd__spacer" />
          <M3Button variant="primary" type="submit">
            {axis ? "Save" : "Add axis"}
          </M3Button>
        </div>
      </form>
    </Popover>
  )
}

/** Alias Picker (board 14 `pP5bp`, 268): variables of the same type, local then libraries. */
function AliasPicker({
  m3,
  vars,
  name,
  axisLabel,
  axes,
  themes,
  anchor,
  theme,
  onPick,
  onDetach,
  onCustom,
  onClose,
}: {
  m3: M3Controller
  vars: Vars
  name: string
  axisLabel: string
  axes: string[]
  themes: Record<string, string[]>
  anchor: PopoverAnchor
  theme: Record<string, string>
  onPick(ref: string): void
  onDetach(): void
  onCustom(): void
  onClose(): void
}) {
  const [q, setQ] = useState("")
  const type = vars[name]?.type
  const libs = m3.libraries()
  const doc = m3.doc()
  const mode = axes.includes("mode") ? "mode" : axes[0]
  const current = (() => {
    const v = vars[name]
    return v ? entriesOf(v.value).find((e) => isRef(e.value))?.value : undefined
  })()
  const groups: { title: string; items: string[] }[] = [
    {
      title: "local",
      items: Object.keys(vars).filter((n) => n !== name && vars[n]?.type === type),
    },
    ...Object.entries(libs).map(([alias, lib]) => ({
      title: `${alias} · library`,
      items: Object.entries((lib.variables ?? {}) as Vars)
        .filter(([, v]) => v.type === type)
        .map(([n]) => `${alias}:${n}`),
    })),
  ]
  const resolved = resolveUnder(doc, name, theme, libs)
  return (
    <Popover
      title={`Alias · ${axisLabel}`}
      anchor={anchor}
      onClose={onClose}
      initialFocus="first"
      data-testid="alias-picker"
      style={{ width: 268 }}
    >
      <Input
        icon={<Icon name="search" size={16} />}
        placeholder="Search variables"
        aria-label="Search variables"
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      <div className="m3-alias-list" role="listbox">
        {groups.map((g) => {
          const items = g.items.filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()))
          if (!items.length) return null
          return (
            <Fragment key={g.title}>
              <div className="m3-alias-list__group">{g.title}</div>
              {items.map((n) => {
                const r = resolveUnder(doc, n, theme, libs)
                const chips = mode
                  ? (themes[mode] ?? []).map((mv) => ({
                      mv,
                      r: resolveUnder(doc, n, { ...theme, [mode]: mv }, libs),
                    }))
                  : []
                const on = isRef(current) && current.$ref === n
                return (
                  <button
                    type="button"
                    key={n}
                    className="m3-alias-item"
                    role="option"
                    aria-selected={on}
                    onClick={() => {
                      onPick(n)
                      onClose()
                    }}
                  >
                    {type === "color" && (
                      <span
                        className="m3-alias-item__swatch"
                        style={{ background: r.ok ? (cssColor(r.value) ?? undefined) : undefined }}
                      />
                    )}
                    <span className="m3-alias-item__name">{n}</span>
                    <span className="m3-alias-item__spacer" />
                    {type === "color" &&
                      chips.map((c) => (
                        <span
                          key={c.mv}
                          className="m3-alias-item__chip"
                          title={c.mv}
                          style={{
                            background: c.r.ok ? (cssColor(c.r.value) ?? undefined) : undefined,
                          }}
                        />
                      ))}
                    {on && (
                      <span className="m3-alias-item__check">
                        <Icon name="check" size={14} />
                      </span>
                    )}
                  </button>
                )
              })}
            </Fragment>
          )
        })}
      </div>
      <div className="m3-alias-actions">
        <M3Button
          variant="ghost"
          icon="unlink"
          disabled={!isRef(current)}
          onClick={() => {
            onDetach()
            onClose()
          }}
        >
          {`Detach alias${resolved.ok ? ` · keep ${valueText(type ?? "string", resolved.value)}` : ""}`}
        </M3Button>
        {type === "color" && (
          <M3Button variant="ghost" icon="pipette" onClick={onCustom}>
            Custom value (OKLCH / P3)…
          </M3Button>
        )}
      </div>
    </Popover>
  )
}

const glyphOf = (t: string) =>
  (t === "color" || t === "number" || t === "string" || t === "boolean" ? t : "number") as
    | "color"
    | "number"
    | "string"
    | "boolean"

/**
 * VarCell adapter: the grid's cell kinds onto `@kimo/ui` VarCell. A click anywhere but on the
 * toggle / alias chip edits the cell (anchor = the cell); out-of-sRGB colors get the corner flag.
 */
function GridCell({
  kind,
  text,
  swatch,
  multi,
  gamut,
  checked,
  alias,
  onClick,
  onToggle,
  onAlias,
  axisValue,
}: {
  kind: "color" | "number" | "string" | "boolean" | "alias" | "empty"
  text?: string
  swatch?: string
  multi?: boolean
  gamut?: boolean
  checked?: boolean
  alias?: string
  onClick?: (anchor: HTMLElement) => void
  onToggle?: (v: boolean) => void
  onAlias?: () => void
  axisValue?: string
}) {
  const value: VarCellValue =
    kind === "color"
      ? { kind, color: swatch ?? "transparent", label: text ?? "" }
      : kind === "number" || kind === "string"
        ? { kind, label: text ?? "" }
        : kind === "boolean"
          ? { kind, value: !!checked }
          : kind === "alias"
            ? { kind, name: alias ?? "" }
            : { kind: "empty" }
  return (
    <VarCell
      value={value}
      multi={multi}
      data-axis-value={axisValue}
      title={gamut ? "Outside sRGB (shown gamut-mapped)" : undefined}
      className={`${onClick ? "m3-cell--editable" : ""}${gamut ? " m3-cell--gamut" : ""}`}
      onAliasClick={onAlias}
      onToggle={onToggle}
      role="gridcell"
      tabIndex={-1}
      aria-readonly={onClick ? undefined : true}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".kimo-toggle, .kimo-alias-chip")) return
        onClick?.(e.currentTarget)
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === "F2") && onClick) {
          e.preventDefault()
          onClick(e.currentTarget)
        }
      }}
    />
  )
}
