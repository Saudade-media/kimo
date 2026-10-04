/**
 * Board 27 §1 (c) C1rd4 "⌘P quick switcher": a 400 px palette 20 % from the top of the canvas
 * (the Dialog overlay recipe). Quick Switcher (JFfml): column, bg-overlay, stroke 1 border,
 * radius-xl, shadow 0 16 48 shadow-strong.
 * - Search (XOWkf): 44 high, gap 8, padding [0, 14], bottom border: search 16 text-tertiary ·
 *   Query sans text-base text-primary · Spacer · Scope "Pages" sans text-xs text-tertiary.
 * - Results (rzSck): column, gap 1, padding 6: PaletteRow / PaletteRow/Active ("N layers"),
 *   plus "New page “q”" (plus icon, meta ⌘↵ mono) while there is a query.
 * - Hints (p5RLB7): gap 14, padding [8, 14], top border: Kbd + label (sans text-xs
 *   text-tertiary, gap 6): ↑↓ Move · ↵ Go to page · ⌘↵ New page · esc Close.
 * Fuzzy match on names, current page sorted last, first match pre-selected; empty query lists
 * every page in document order with a check on the current one.
 */
import { Kbd, PaletteRow } from "@kimo/ui"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createBus, useBus } from "../../lib/hooks"
import { Icon } from "../../lib/icons"
import type { M3Controller } from "../m3/controller"
import type { FileSession } from "../session"
import { activatePage, addPage } from "./actions"
import { pageLayerCount, rootsPerPage } from "./model"
import { usePageList } from "./PagesStrip"

/** Open state of each file's switcher (the footer and ⌘P open it). */
const buses = new WeakMap<FileSession, ReturnType<typeof createBus<boolean>>>()
export function pageSwitcherBus(session: FileSession) {
  let b = buses.get(session)
  if (!b) {
    b = createBus(false)
    buses.set(session, b)
  }
  return b
}

/** Subsequence score: lower is better; null = no match. */
export function fuzzyScore(name: string, query: string): number | null {
  const n = name.toLowerCase()
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const direct = n.indexOf(q)
  if (direct >= 0) return direct
  let at = -1
  let gaps = 0
  for (const ch of q) {
    const i = n.indexOf(ch, at + 1)
    if (i < 0) return null
    if (at >= 0) gaps += i - at - 1
    at = i
  }
  return 100 + gaps
}

interface Result {
  kind: "page" | "new"
  id: string | null
  name: string
  meta: string
  current: boolean
}

export function PageSwitcher({ session, m3 }: { session: FileSession; m3: M3Controller }) {
  const bus = pageSwitcherBus(session)
  const open = useBus(bus, (v) => v)
  if (!open) return null
  return <SwitcherPanel session={session} m3={m3} onClose={() => bus.set(false)} />
}

function SwitcherPanel({
  session,
  m3,
  onClose,
}: {
  session: FileSession
  m3: M3Controller
  onClose(): void
}) {
  const { pages, active } = usePageList(session)
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const ctx = useMemo(() => ({ session, m3 }), [session, m3])
  const [box, setBox] = useState<{ left: number; top: number } | null>(null)

  // Focus once placed (a `visibility: hidden` input can't take focus).
  useEffect(() => {
    if (box) input.current?.focus()
  }, [box])
  useLayoutEffect(() => {
    const host = document.querySelector<HTMLElement>(".canvas-host")
    const r = host?.getBoundingClientRect()
    setBox(
      r
        ? { left: r.left + r.width / 2 - 200, top: r.top + r.height * 0.2 }
        : { left: window.innerWidth / 2 - 200, top: window.innerHeight * 0.2 },
    )
  }, [])

  const results = useMemo<Result[]>(() => {
    const roots = rootsPerPage(session.store)
    const count = (id: string | null) => {
      const n = pageLayerCount(session.store, roots.get(id ?? "") ?? [])
      return `${n} ${n === 1 ? "layer" : "layers"}`
    }
    const q = query.trim()
    const list: Result[] = []
    if (!q) {
      for (const p of pages)
        list.push({
          kind: "page",
          id: p.id,
          name: p.name,
          meta: count(p.id),
          current: p.id === active,
        })
      return list
    }
    const scored = pages
      .map((p, i) => ({ p, i, s: fuzzyScore(p.name, q) }))
      .filter((x): x is { p: (typeof pages)[number]; i: number; s: number } => x.s !== null)
      .sort((a, b) => {
        const ca = a.p.id === active ? 1 : 0
        const cb = b.p.id === active ? 1 : 0
        return ca - cb || a.s - b.s || a.i - b.i
      })
    for (const { p } of scored)
      list.push({
        kind: "page",
        id: p.id,
        name: p.name,
        meta: count(p.id),
        current: p.id === active,
      })
    list.push({ kind: "new", id: null, name: `New page “${q}”`, meta: "⌘↵", current: false })
    return list
  }, [pages, active, query, session.store])

  const sel = Math.min(index, Math.max(0, results.length - 1))

  const go = (r: Result | undefined) => {
    if (!r) return
    onClose()
    if (r.kind === "new") addPage(ctx, query.trim())
    else activatePage(ctx, r.id)
  }

  return (
    <div
      className="page-switcher__scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="page-switcher"
        role="dialog"
        aria-label="Go to page"
        style={box ? { left: box.left, top: box.top } : { visibility: "hidden" }}
      >
        <div className="page-switcher__search">
          <span className="page-switcher__search-icon">
            <Icon name="search" size={16} />
          </span>
          <input
            ref={input}
            className="page-switcher__query"
            aria-label="Page name"
            role="combobox"
            aria-expanded="true"
            aria-controls="page-switcher-results"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                e.stopPropagation()
                onClose()
              } else if (e.key === "ArrowDown") {
                e.preventDefault()
                setIndex((i) => Math.min(results.length - 1, i + 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === "Enter") {
                e.preventDefault()
                e.stopPropagation()
                if ((e.metaKey || e.ctrlKey) && query.trim()) go(results[results.length - 1])
                else go(results[sel])
              }
            }}
          />
          <span className="page-switcher__spacer" />
          <span className="page-switcher__scope">Pages</span>
        </div>
        <div className="page-switcher__results" id="page-switcher-results" role="listbox">
          {results.map((r, i) => (
            <PaletteRow
              key={r.kind === "new" ? "new" : (r.id ?? "implicit")}
              icon={
                <Icon
                  name={r.kind === "new" ? "plus" : !query && r.current ? "check" : "file"}
                  size={14}
                />
              }
              name={r.name}
              meta={r.meta}
              metaMono={r.kind === "new"}
              active={i === sel}
              data-page-id={r.id ?? ""}
              onPointerMove={() => setIndex(i)}
              onClick={() => go(r)}
            />
          ))}
        </div>
        <div className="page-switcher__hints">
          <Hint keys="↑↓" label="Move" />
          <Hint keys="↵" label="Go to page" />
          <Hint keys="⌘↵" label="New page" />
          <Hint keys="esc" label="Close" />
        </div>
      </div>
    </div>
  )
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="page-switcher__hint">
      <Kbd>{keys}</Kbd>
      <span className="page-switcher__hint-label">{label}</span>
    </span>
  )
}
