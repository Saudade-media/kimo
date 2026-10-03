/**
 * Left panel · Assets tab (board 13 `cVTPY`): Search (padding [4, 8, 8, 8], gap 6) + View
 * Segmented (grid / list); body (`E7P7N`: column, gap 4, padding [0, 8]): PanelHeader "Local
 * components" · groups from name segments before the last "/" (`e2rfIo`) · two-column tile
 * grids (gap 8) or AssetRows · Divider · PanelHeader "Libraries" (settings-2 → Library
 * Manager) · library rows (`dSpOF`) with their AssetRows (padding-left 26) · Link library….
 * Empty (board 15 `M0b6iA`) and missing-library banner (`nSzYt`) states.
 *
 * Drag a tile or row onto the canvas → instance (the editor's canvas drop handler reads the
 * `application/x-kimo-component` payload); double-click inserts at the viewport center.
 */
import {
  AssetRow,
  AssetTile,
  EmptyState,
  Input,
  PanelHeader,
  Segmented,
  StatusPill,
} from "@kimo/ui"
import { Fragment, useEffect, useMemo, useState } from "react"
import { Icon } from "../../lib/icons"
import type { FileSession } from "../session"
import { createComponent, unlinkLibrary } from "./actions"
import { type M3Controller, useComponentRev, useLibraries } from "./controller"
import { type ComponentItem, groupByPath, listComponents, matches } from "./model"
import { linkLibraryFlow, locateLibrary } from "./popovers"
import { M3Button } from "./ui"

/** Drag payload type for components (Assets → canvas / slot / replace). */
export const COMPONENT_MIME = "application/x-kimo-component"

export function setComponentDrag(e: React.DragEvent, item: ComponentItem) {
  e.dataTransfer.setData(COMPONENT_MIME, JSON.stringify({ of: item.qid, name: item.name }))
  e.dataTransfer.setData("text/plain", item.name)
  e.dataTransfer.effectAllowed = "copy"
}

type View = "grid" | "list"

export function AssetsTab({ session, m3 }: { session: FileSession; m3: M3Controller }) {
  const rev = useComponentRev(m3)
  const libs = useLibraries(m3)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<View>("grid")
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const [dragging, setDragging] = useState<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rev` = component structure changed
  const local = useMemo(() => listComponents(m3.doc(), m3.libraries(), null), [m3, rev])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rev` = instances changed
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of Object.values(m3.doc().nodes as Record<string, { type?: string; of?: string }>))
      if (n.type === "instance" && n.of) m.set(n.of, (m.get(n.of) ?? 0) + 1)
    return m
  }, [m3, rev])
  const toggle = (key: string) =>
    setClosed((c) => {
      const n = new Set(c)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const insert = (item: ComponentItem) => {
    const canvas = m3.canvas()
    const el = document.querySelector(".editor__canvas")
    const r = el?.getBoundingClientRect()
    const center =
      canvas && r ? canvas.screenToWorld({ x: r.width / 2, y: r.height / 2 }) : { x: 0, y: 0 }
    m3.run(
      {
        cmd: "createInstance",
        of: item.qid,
        placement: {
          parent: null,
          x: Math.round(center.x),
          y: Math.round(center.y),
          name: item.name,
        },
      },
      "Insert instance",
    )
  }
  const filtered = local.filter((i) => matches(i, query))
  const missing = libs.filter((l) => l.status === "missing")
  const empty = local.length === 0 && libs.length === 0
  // Board 15 `l80zQc`: a missing library and no local components → Banner, Libraries header
  // and library rows only (body padding 8, gap 8; no search, no Local components header).
  const missingOnly = missing.length > 0 && local.length === 0
  const instancesOfLibrary = (alias: string) => {
    let n = 0
    for (const [of, count] of usage) if (of.startsWith(`${alias}:`)) n += count
    return n
  }

  const thumbs = useThumbnails(m3, local, rev)
  const itemNode = (i: ComponentItem, indent?: number) => {
    const label = i.from ? `${i.name} · from ${i.from}` : i.name
    return view === "grid" && indent === undefined ? (
      <AssetTile
        key={i.qid}
        name={label}
        thumbnail={thumbs.get(i.qid) ?? undefined}
        dragging={dragging === i.qid}
        draggable
        tabIndex={0}
        data-asset={label}
        onDragStart={(e) => {
          setComponentDrag(e, i)
          setDragging(i.qid)
        }}
        onDragEnd={() => setDragging(null)}
        onDoubleClick={() => insert(i)}
      />
    ) : (
      <AssetRow
        key={i.qid}
        name={label}
        meta={usage.get(i.qid) ? `${usage.get(i.qid)}×` : "—"}
        indent={indent !== undefined}
        draggable
        data-asset={label}
        onDragStart={(e) => setComponentDrag(e, i)}
        onDoubleClick={() => insert(i)}
      />
    )
  }

  return (
    <div className="m3-assets" data-testid="assets-tab">
      {!missingOnly && (
        <div className="m3-assets__search">
          <Input
            icon={<Icon name="search" size={16} />}
            placeholder="Search assets"
            aria-label="Search assets"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            frameProps={{ className: "left-panel__search-input" }}
          />
          <Segmented
            label="Assets view"
            className="m3-assets__view"
            options={[
              { value: "grid", label: "Grid", icon: <Icon name="layout-grid" size={14} /> },
              { value: "list", label: "List", icon: <Icon name="list" size={14} /> },
            ]}
            value={view}
            onChange={(v) => setView(v as View)}
          />
        </div>
      )}
      {empty ? (
        <div className="m3-assets__empty">
          <EmptyState
            icon={<Icon name="component" size={18} />}
            title="No components yet"
            description="Select layers and press ⌥⌘K to make a component, or link a library to use its components."
          />
          <div className="m3-assets__empty-actions">
            <M3Button
              variant="primary"
              icon="component"
              className="m3-assets__empty-button"
              onClick={() => {
                const sel = session.ui.getState().selection
                if (sel.length) createComponent(m3, sel, m3.canvas()?.layout() ?? null)
                else m3.toast({ tone: "warning", text: "Select layers first, then press ⌥⌘K" })
              }}
            >
              Create component
            </M3Button>
            <M3Button
              variant="secondary"
              icon="link-2"
              className="m3-assets__empty-button"
              onClick={() => void linkLibraryFlow(m3)}
            >
              Link library…
            </M3Button>
          </div>
        </div>
      ) : (
        <div className={`m3-assets__body${missingOnly ? " m3-assets__body--missing" : ""}`}>
          {missing.map((l) => (
            <div className="m3-missing-banner" key={l.alias} data-testid="missing-banner">
              <div className="m3-missing-banner__head">
                <span className="m3-missing-banner__icon">
                  <Icon name="unlink" size={14} />
                </span>
                <span className="m3-missing-banner__title">{l.name} library is missing</span>
              </div>
              <div className="m3-missing-banner__desc">
                {missingCopy(l.path, instancesOfLibrary(l.alias), l.doc !== null)}
              </div>
              <div className="m3-missing-banner__actions">
                <M3Button
                  variant="secondary"
                  icon="folder-search"
                  className="m3-missing-banner__locate"
                  onClick={() => void locateLibrary(m3, l.alias)}
                >
                  Locate…
                </M3Button>
                <M3Button
                  variant="ghost"
                  className="m3-missing-banner__unlink"
                  onClick={() => void unlinkLibrary(m3, l.alias)}
                >
                  Unlink
                </M3Button>
              </div>
            </div>
          ))}
          {!missingOnly && (
            <>
              <PanelHeader
                title="Local components"
                className="m3-assets__header"
                action={{
                  label: "Collapse all",
                  icon: <Icon name="chevrons-down-up" size={14} />,
                  onClick: () =>
                    setClosed(new Set(groupByPath(filtered).map(([g]) => `local:${g}`))),
                }}
              />
              {groupByPath(filtered).map(([group, items]) => {
                const key = `local:${group}`
                const open = !closed.has(key)
                return (
                  <Fragment key={key}>
                    {group !== "" && (
                      <button
                        type="button"
                        className="m3-asset-group"
                        aria-expanded={open}
                        onClick={() => toggle(key)}
                      >
                        <span className="m3-asset-group__disclosure">
                          <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
                        </span>
                        <span className="m3-asset-group__folder">
                          <Icon name="folder" size={14} />
                        </span>
                        <span className="m3-asset-group__path">{group}</span>
                        <span className="m3-asset-group__spacer" />
                        <span className="m3-asset-group__count">{items.length}</span>
                      </button>
                    )}
                    {open &&
                      (view === "grid" ? (
                        pairs(items).map((pair) => (
                          <div className="m3-asset-tiles" key={pair[0]?.qid}>
                            {pair.map((i) => itemNode(i))}
                            {pair.length === 1 && <span className="m3-asset-tiles__pad" />}
                          </div>
                        ))
                      ) : (
                        <div className="m3-asset-rows">{items.map((i) => itemNode(i))}</div>
                      ))}
                  </Fragment>
                )
              })}
              {filtered.length === 0 && local.length > 0 && (
                <div className="m3-assets__none">No matching components</div>
              )}
              <div className="m3-assets__divider">
                <span className="m3-assets__divider-line" />
              </div>
            </>
          )}
          <PanelHeader
            title="Libraries"
            className={missingOnly ? undefined : "m3-assets__header"}
            action={{
              label: "Manage libraries",
              icon: <Icon name="settings-2" size={14} />,
              onClick: () => m3.openPanel({ libraryManager: true }),
            }}
          />
          {libs.map((l) => {
            const key = `lib:${l.alias}`
            const open = closed.has(key) // libraries start collapsed
            const items = listComponents(m3.doc(), m3.libraries(), l.alias).filter((i) =>
              matches(i, query),
            )
            const status = l.status === "loading" ? "linked" : l.status
            return (
              <Fragment key={key}>
                <button
                  type="button"
                  className={`m3-library-item${status === "missing" ? " m3-library-item--missing" : ""}`}
                  aria-expanded={open}
                  data-library={l.alias}
                  onClick={(e) => {
                    // The Changed pill opens the review (board 13 Library Changes).
                    if (
                      status === "changed" &&
                      (e.target as HTMLElement).closest(".kimo-status-pill")
                    ) {
                      m3.openPanel({ libraryChanges: l.alias })
                      return
                    }
                    toggle(key)
                  }}
                >
                  <span className="m3-library-item__disclosure">
                    <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
                  </span>
                  <span className="m3-library-item__icon">
                    <Icon name="library" size={14} />
                  </span>
                  <span className="m3-library-item__name">{l.name}</span>
                  <span className="m3-library-item__alias">{l.alias}</span>
                  <span className="m3-library-item__spacer" />
                  {status === "linked" ? (
                    <span className="m3-library-item__count">{items.length}</span>
                  ) : (
                    <StatusPill status={status} compact />
                  )}
                </button>
                {open && items.map((i) => itemNode({ ...i, name: i.name }, 26))}
              </Fragment>
            )
          })}
          <M3Button
            variant="secondary"
            icon="link-2"
            className="m3-assets__link"
            onClick={() => void linkLibraryFlow(m3)}
          >
            Link library…
          </M3Button>
        </div>
      )}
    </div>
  )
}

/** Missing-library banner description (board 15 `jmgI8`). */
function missingCopy(path: string, instances: number, cached: boolean): string {
  const n = `${instances} ${instances === 1 ? "instance draws" : "instances draw"}`
  return `${path} was moved or deleted. ${n} as missing-component placeholders${
    cached
      ? " (Kimo shows a cached preview only on this machine; a fresh clone shows placeholders)"
      : ""
  }. Locate the file to restore them.`
}

function pairs<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2))
  return out
}

/**
 * Asset tile thumbnails (board 13 Preview `hwUNY`): the renderer's `exportPng` of each local
 * main, fit into the 72-high preview at 2× (object URLs, refreshed when components change).
 */
function useThumbnails(m3: M3Controller, items: readonly ComponentItem[], rev: number) {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map())
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rev` = components changed
  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      const canvas = m3.canvas()
      const layout = canvas?.layout()
      if (!canvas || !layout) return
      const next = new Map<string, string>()
      for (const it of items.slice(0, 48)) {
        const box = layout.nodes.get(it.qid)?.local
        if (!box || box.w <= 0 || box.h <= 0) continue
        const scale = Math.min(2, (2 * 96) / box.w, (2 * 64) / box.h)
        try {
          const png = await canvas.exportPng(it.qid, scale)
          if (!live) break
          next.set(it.qid, URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" })))
        } catch {
          // Not renderable yet (fonts loading, empty main): keep the glyph placeholder.
        }
      }
      if (!live) {
        for (const u of next.values()) URL.revokeObjectURL(u)
        return
      }
      setUrls((prev) => {
        for (const u of prev.values()) URL.revokeObjectURL(u)
        return next
      })
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [m3, items, rev])
  useEffect(
    () => () => {
      setUrls((prev) => {
        for (const u of prev.values()) URL.revokeObjectURL(u)
        return prev
      })
    },
    [],
  )
  return urls
}
