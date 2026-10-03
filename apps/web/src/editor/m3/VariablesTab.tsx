/**
 * Left panel · Variables tab (board 14 `A49BBi`): the compact read-and-bind list. Search
 * (padding [4, 8, 8, 8]) · body (column, gap 1, padding [0, 8]): Preview Theme (`zGMmt`: `eye`
 * 12 + pill "preview" + value + `chevron-down`; editor state, not in the file) · groups by the
 * `group` field's first segment (`pA5k7`) · VariableListRows (padding-left 22) · Open variables
 * (`table-2`, opens the dialog, ⌘⇧V). Empty state: board 15 `L1LDv6`.
 */
import { axisDisplayOrder, isRef, type KimoDocument } from "@kimo/core-schema"
import { EmptyState, Input, MenuDense, MenuDivider, VariableListRow } from "@kimo/ui"
import { Fragment, useMemo, useRef, useState } from "react"
import { useDocHeader } from "../../lib/header"
import { Icon } from "../../lib/icons"
import type { FileSession } from "../session"
import { type M3Controller, useBusValue, useLibraries } from "./controller"
import { M3MenuItem, MenuLabel } from "./menus"
import { M3Button } from "./ui"
import {
  cssColor,
  entriesOf,
  groupOf,
  importDtcg,
  previewTheme,
  resolveUnder,
  themeLabel,
  valueText,
} from "./variables"

const listType = (t: string) =>
  (t === "color" || t === "number" || t === "string" || t === "boolean" ? t : "number") as
    | "color"
    | "number"
    | "string"
    | "boolean"

export function VariablesTab({ session, m3 }: { session: FileSession; m3: M3Controller }) {
  const header = useDocHeader(session.store)
  useLibraries(m3)
  const preview = useBusValue(m3.previewTheme)
  const [query, setQuery] = useState("")
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [themeMenu, setThemeMenu] = useState<HTMLElement | null>(null)
  const doc = header as unknown as KimoDocument
  const libs = m3.libraries()
  const axes = axisDisplayOrder(doc)
  const theme = previewTheme(doc, libs, preview)
  const vars = (header.variables ?? {}) as Record<
    string,
    { type: string; value: unknown; group?: string }
  >
  const names = Object.keys(vars).sort()
  const groups = useMemo(() => {
    const g = new Map<string, string[]>()
    for (const n of names) {
      if (query && !n.toLowerCase().includes(query.trim().toLowerCase())) continue
      const k = groupOf(vars[n])
      const l = g.get(k)
      if (l) l.push(n)
      else g.set(k, [n])
    }
    return [...g.entries()].sort((a, b) =>
      a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0]),
    )
  }, [names, query, vars])
  const fileInput = useRef<HTMLInputElement>(null)

  const importFile = async (file: File) => {
    try {
      const parsed = importDtcg(JSON.parse(await file.text()))
      const set: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(parsed)) if (!Object.hasOwn(vars, k)) set[k] = v
      if (!Object.keys(set).length) {
        m3.toast({ tone: "warning", text: "No new variables in that file" })
        return
      }
      session.apply([{ op: "setVariables", set } as never], "Import DTCG")
    } catch (e) {
      m3.toast({ tone: "danger", text: `Could not import: ${e instanceof Error ? e.message : e}` })
    }
  }

  if (names.length === 0)
    return (
      <div className="m3-vars m3-vars--empty" data-testid="variables-tab">
        <div className="m3-assets__empty">
          <EmptyState
            icon={<Icon name="table-2" size={18} />}
            title="No variables yet"
            description="Variables hold colors, numbers, strings and booleans you can bind to fields and switch per theme."
          />
          <div className="m3-assets__empty-actions">
            <M3Button
              variant="primary"
              icon="plus"
              className="m3-assets__empty-button"
              onClick={() => m3.openPanel({ variables: true })}
            >
              New variable
            </M3Button>
            <M3Button
              variant="secondary"
              icon="braces"
              className="m3-assets__empty-button"
              onClick={() => fileInput.current?.click()}
            >
              Import DTCG…
            </M3Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.currentTarget.files?.[0]
                if (f) void importFile(f)
                e.currentTarget.value = ""
              }}
            />
          </div>
        </div>
      </div>
    )

  return (
    <div className="m3-vars" data-testid="variables-tab">
      <div className="left-panel__search">
        <Input
          icon={<Icon name="search" size={16} />}
          placeholder="Search variables"
          aria-label="Search variables"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          frameProps={{ className: "left-panel__search-input" }}
        />
      </div>
      <div className="m3-vars__list" role="listbox" aria-label="Variables">
        {axes.length > 0 && (
          <div className="m3-preview-theme">
            <span className="m3-preview-theme__eye">
              <Icon name="eye" size={12} />
            </span>
            <button
              type="button"
              className="m3-preview-theme__pill"
              onClick={(e) => setThemeMenu(themeMenu ? null : e.currentTarget)}
              aria-haspopup="menu"
            >
              <span className="m3-preview-theme__axis">preview</span>
              <span className="m3-preview-theme__value">{themeLabel(theme, axes)}</span>
              <span className="m3-preview-theme__chevron">
                <Icon name="chevron-down" size={10} />
              </span>
            </button>
          </div>
        )}
        {themeMenu && (
          <MenuDense
            width={200}
            label="Preview theme"
            anchor={themeMenu}
            onClose={() => setThemeMenu(null)}
            autoFocus
          >
            {axes.map((a, i) => (
              <Fragment key={a}>
                {i > 0 && <MenuDivider />}
                <MenuLabel>{a}</MenuLabel>
                {((header.themes ?? {}) as Record<string, string[]>)[a]?.map((v) => (
                  <M3MenuItem
                    key={v}
                    icon={theme[a] === v ? "check" : "circle"}
                    label={v}
                    onSelect={() => m3.previewTheme.set({ ...(preview ?? {}), [a]: v })}
                  />
                ))}
              </Fragment>
            ))}
          </MenuDense>
        )}
        {groups.map(([group, list]) => {
          const open = !closed.has(group)
          return (
            <Fragment key={group || "\u0000"}>
              {group !== "" && (
                <button
                  type="button"
                  className="m3-var-group"
                  aria-expanded={open}
                  onClick={() =>
                    setClosed((c) => {
                      const n = new Set(c)
                      if (n.has(group)) n.delete(group)
                      else n.add(group)
                      return n
                    })
                  }
                >
                  <span className="m3-var-group__disclosure">
                    <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
                  </span>
                  <span className="m3-var-group__name">{group}</span>
                  <span className="m3-var-group__spacer" />
                  <span className="m3-var-group__count">{list.length}</span>
                </button>
              )}
              {open &&
                list.map((name) => {
                  const v = vars[name]
                  if (!v) return null
                  const r = resolveUnder(doc, name, theme, libs)
                  const first = entriesOf(v.value)
                  const aliased = first.some((e) => isRef(e.value))
                  const value = r.ok ? (r.matched ? valueText(v.type, r.value) : "no match") : "—"
                  return (
                    <VariableListRow
                      key={name}
                      name={name}
                      type={listType(v.type)}
                      style={{ paddingLeft: group === "" ? 8 : 22 }}
                      color={
                        v.type === "color" && r.ok ? (cssColor(r.value) ?? undefined) : undefined
                      }
                      value={value}
                      className={r.ok && !r.matched ? "m3-var-list-row--no-match" : undefined}
                      title={
                        r.ok && !r.matched ? "THEME_NO_MATCH under the preview theme" : undefined
                      }
                      alias={aliased}
                      selected={selected === name}
                      data-variable={name}
                      role="option"
                      aria-selected={selected === name}
                      tabIndex={-1}
                      onClick={() => setSelected(name)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setSelected(name)
                      }}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-kimo-variable", name)
                        e.dataTransfer.setData("text/plain", name)
                      }}
                    />
                  )
                })}
            </Fragment>
          )
        })}
        <div className="m3-vars__open">
          <M3Button
            variant="secondary"
            icon="table-2"
            className="m3-vars__open-button"
            onClick={() => m3.openPanel({ variables: true })}
          >
            Open variables
          </M3Button>
        </div>
      </div>
    </div>
  )
}
