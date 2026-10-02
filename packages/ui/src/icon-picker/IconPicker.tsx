import { Search, SearchX, X } from "lucide-react"
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"
import { Button } from "../button/Button"
import { IconTile } from "../icon-tile/IconTile"
import { Input } from "../input/Input"
import { cx } from "../internal/util"
import { Popover } from "../popover/Popover"
import type { PlacementOptions } from "../popover/position"
import type { PopoverAnchor } from "../popover/usePopover"
import { Segmented } from "../segmented/Segmented"
import { Slider } from "../slider/Slider"

/** Icon libraries of the picker (Library segmented, board 09 `CSNC1`). */
export type IconLibraryId = "lucide" | "phosphor" | "material" | "feather"
/** Material Symbols styles (Style segmented `w5XAy`). */
export type MaterialStyle = "outlined" | "rounded" | "sharp"

/** A normalized glyph (structurally the renderer's `IconGlyph`). */
export interface IconPickerGlyph {
  viewBox: readonly [number, number, number, number]
  paths: readonly {
    d: string
    paint: "fill" | "stroke"
    fillRule?: "nonzero" | "evenodd"
    opacity?: number
  }[]
  /** Stroke sets: native stroke width in viewBox units (lucide/feather: 2). */
  strokeWidth?: number
}

/**
 * Icon index + glyph source. Structurally a subset of `@kimo/renderer`'s `IconProvider`, so the
 * editor passes the renderer's provider straight through (this package cannot import it).
 */
export interface IconIndexProvider {
  catalog(set: string): Promise<readonly { name: string; tags?: readonly string[] }[]>
  load(set: string, name: string, weight?: number): Promise<IconPickerGlyph | null>
  get(set: string, name: string, weight?: number): IconPickerGlyph | null
  onIconLoaded?(listener: (set: string, name: string) => void): () => void
}

/** `.kimo` icon `set` of a library (+ Material style). */
export function iconSetOf(library: IconLibraryId, style: MaterialStyle = "outlined"): string {
  return library === "material" ? `material-${style}` : library
}

/** Library (+ style) of a `.kimo` icon `set`. */
export function libraryOf(set: string): { library: IconLibraryId; style: MaterialStyle } {
  if (set.startsWith("material")) {
    const style = set.slice("material-".length)
    return {
      library: "material",
      style: style === "rounded" || style === "sharp" ? style : "outlined",
    }
  }
  return {
    library: set === "phosphor" || set === "feather" ? set : "lucide",
    style: "outlined",
  }
}

/** Footer license label per library (NOTICE). */
export const ICON_LICENSES: Record<IconLibraryId, string> = {
  lucide: "lucide · ISC",
  phosphor: "phosphor · MIT",
  material: "material · Apache-2.0",
  feather: "feather · MIT",
}

const LIBRARIES = [
  { value: "lucide", label: "Lucide" },
  { value: "phosphor", label: "Phosphor" },
  { value: "material", label: "Material" },
  { value: "feather", label: "Feather" },
] as const

const STYLES = [
  { value: "outlined", label: "Outlined" },
  { value: "rounded", label: "Rounded" },
  { value: "sharp", label: "Sharp" },
] as const

/** Grid geometry from the node: 8 columns of 32 with gap 2; rows 32 with gap 4 (pitch 36). */
export const ICON_GRID = { columns: 8, cell: 32, columnGap: 2, rowGap: 4, visibleRows: 4 } as const
const PITCH = ICON_GRID.cell + ICON_GRID.rowGap
const VIEWPORT =
  ICON_GRID.visibleRows * ICON_GRID.cell + (ICON_GRID.visibleRows - 1) * ICON_GRID.rowGap

/** Case-insensitive name/tag filter, name prefix matches first. */
export function filterIcons<T extends { name: string; tags?: readonly string[] }>(
  entries: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (q === "") return [...entries]
  const prefix: T[] = []
  const rest: T[] = []
  for (const e of entries) {
    const n = e.name.toLowerCase()
    if (n.startsWith(q)) prefix.push(e)
    else if (n.includes(q) || e.tags?.some((t) => t.toLowerCase().includes(q))) rest.push(e)
  }
  return [...prefix, ...rest]
}

/** Visible row range of a virtualized grid (with `overscan` rows each side). */
export function visibleRows(
  scrollTop: number,
  viewport: number,
  rowCount: number,
  overscan = 2,
): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollTop / PITCH) - overscan)
  const last = Math.min(rowCount - 1, Math.ceil((scrollTop + viewport) / PITCH) + overscan)
  return { first, last }
}

/** Draws a provider glyph; loads it lazily and re-renders when it arrives. */
export function IconGlyphSvg({
  provider,
  set,
  name,
  weight,
}: {
  provider: IconIndexProvider
  set: string
  name: string
  weight?: number
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const glyph = provider.get(set, name, weight)
  useEffect(() => {
    if (glyph) return
    let alive = true
    provider.load(set, name, weight).then(
      () => alive && bump(),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [provider, set, name, weight, glyph])
  if (!glyph) return <svg viewBox="0 0 24 24" aria-hidden="true" />
  return (
    <svg viewBox={glyph.viewBox.join(" ")} aria-hidden="true">
      {glyph.paths.map((p, i) =>
        p.paint === "stroke" ? (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: glyph paths are static and ordered.
            key={i}
            d={p.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={glyph.strokeWidth ?? 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={p.opacity}
          />
        ) : (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: glyph paths are static and ordered.
            key={i}
            d={p.d}
            fill="currentColor"
            fillRule={p.fillRule}
            opacity={p.opacity}
          />
        ),
      )}
    </svg>
  )
}

/** Props for {@link IconPicker}. */
export interface IconPickerProps {
  provider: IconIndexProvider
  /** Current `.kimo` icon set (`lucide`, `material-rounded`, …). */
  set: string
  /** Current icon name (selected tile). */
  name: string
  /** Material weight 100–700. Default 400. */
  weight?: number
  /** Recently used icons (newest first); those of the shown library fill the Recent row. */
  recent?: readonly { set: string; name: string }[]
  /** Pick (one undo step). */
  onSelect?: (icon: { set: string; name: string }) => void
  /** Material weight slider (one gesture = one step via start/end). */
  onWeightChange?: (weight: number) => void
  onWeightChangeStart?: () => void
  onWeightChangeEnd?: () => void
  /** Focus the search box on open (the canvas I-key picker: typing searches). Default false. */
  focusSearch?: boolean
  /** Search text on open (e.g. restoring the last query). Default empty. */
  initialQuery?: string
  onClose?: () => void
  anchor?: PopoverAnchor
  placement?: PlacementOptions
}

/**
 * Icon picker popover (board 09 `jKClR` › `b1gaD`; empty Material state `Vr0Sk` › `r6tBTD`):
 * Popover/Wide 296 "Icon". Body: Search (dense Input, "Search 1,600 icons") · Library Segmented
 * fill · Material only: Style Segmented + Weight Row (label 40 "Weight" + Slider 224, 100–700) ·
 * Grid (vertical gap 8: Recent / All icons, each vertical gap 4 with a sans 11 / 500 label and
 * rows of 8 IconTiles, gap 2) · Footer (gap 8, padding-top 8, top stroke: name mono 11
 * text-primary · Spacer · license mono 11 text-tertiary). No match: Empty State (vertical gap 6,
 * padding [28, 16], center, bg-subtle, radius-md: `search-x` 20 · message · hint · Clear search).
 * "All icons" is virtualized (4 rows visible, rows of 36px pitch); glyphs load per visible tile.
 * Keyboard: ←/→/↑/↓ move, Home/End, Enter picks.
 */
export function IconPicker({
  provider,
  set,
  name,
  weight = 400,
  recent = [],
  onSelect,
  onWeightChange,
  onWeightChangeStart,
  onWeightChangeEnd,
  initialQuery = "",
  focusSearch = false,
  onClose,
  anchor,
  placement,
}: IconPickerProps) {
  const id = useId()
  const search = useRef<HTMLInputElement>(null)
  const initial = libraryOf(set)
  const [library, setLibrary] = useState<IconLibraryId>(initial.library)
  const [style, setStyle] = useState<MaterialStyle>(initial.style)
  const [query, setQuery] = useState(initialQuery)
  const [catalogs, setCatalogs] = useState<
    Record<string, readonly { name: string; tags?: readonly string[] }[]>
  >({})
  const [active, setActive] = useState(-1)
  const [scrollTop, setScrollTop] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const shownSet = iconSetOf(library, style)
  const glyphWeight = library === "material" ? weight : undefined

  useEffect(() => {
    if (catalogs[shownSet]) return
    let alive = true
    provider.catalog(shownSet).then(
      (entries) => alive && setCatalogs((c) => ({ ...c, [shownSet]: entries })),
      () => alive && setCatalogs((c) => ({ ...c, [shownSet]: [] })),
    )
    return () => {
      alive = false
    }
  }, [provider, shownSet, catalogs])

  const catalog = catalogs[shownSet]
  const results = useMemo(() => filterIcons(catalog ?? [], query), [catalog, query])
  const recentHere = useMemo(
    () =>
      query.trim() === ""
        ? recent
            .filter((r) => libraryOf(r.set).library === library)
            .slice(0, ICON_GRID.columns)
            .map((r) => r.name)
        : [],
    [recent, library, query],
  )
  const rowCount = Math.ceil(results.length / ICON_GRID.columns)
  const range = visibleRows(scrollTop, VIEWPORT, rowCount)
  const isSelected = (n: string) => n === name && libraryOf(set).library === library
  const pick = (n: string) => onSelect?.({ set: shownSet, name: n })
  const footerName = results[active]?.name ?? name

  // Reset highlight and scroll when the result list changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on query / library change only.
  useEffect(() => {
    setActive(-1)
    setScrollTop(0)
    if (viewport.current) viewport.current.scrollTop = 0
  }, [query, shownSet])

  const move = (i: number) => {
    const next = Math.max(0, Math.min(results.length - 1, i))
    setActive(next)
    const el = viewport.current
    if (!el) return
    const top = Math.floor(next / ICON_GRID.columns) * PITCH
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ICON_GRID.cell > el.scrollTop + VIEWPORT)
      el.scrollTop = top + ICON_GRID.cell - VIEWPORT
  }

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cols = ICON_GRID.columns
    const from = active < 0 ? 0 : active
    let handled = true
    if (e.key === "ArrowRight") move(active < 0 ? 0 : from + 1)
    else if (e.key === "ArrowLeft") move(from - 1)
    else if (e.key === "ArrowDown") move(active < 0 ? 0 : from + cols)
    else if (e.key === "ArrowUp") move(from - cols)
    else if (e.key === "Home") move(0)
    else if (e.key === "End") move(results.length - 1)
    else if (e.key === "Enter" || e.key === " ") {
      const r = results[active]
      if (r) pick(r.name)
    } else handled = false
    if (handled) e.preventDefault()
  }

  const total = catalog?.length
  const placeholder =
    total !== undefined && total > 0
      ? `Search ${total.toLocaleString("en-US")} icons`
      : "Search icons"
  const empty = catalog !== undefined && results.length === 0

  const tile = (
    n: string,
    key: string,
    extra?: { id?: string; highlighted?: boolean },
  ): ReactNode => (
    <IconTile
      key={key}
      id={extra?.id}
      name={n}
      selected={isSelected(n)}
      highlighted={extra?.highlighted}
      icon={<IconGlyphSvg provider={provider} set={shownSet} name={n} weight={glyphWeight} />}
      onSelect={() => pick(n)}
    />
  )

  const rows: ReactNode[] = []
  for (let r = range.first; r <= range.last; r++) {
    const cells = results.slice(r * ICON_GRID.columns, (r + 1) * ICON_GRID.columns)
    rows.push(
      <div
        key={r}
        role="presentation"
        className="kimo-icon-picker__row kimo-icon-picker__row--virtual"
        style={{ top: r * PITCH }}
      >
        {cells.map((c, j) => {
          const i = r * ICON_GRID.columns + j
          return tile(c.name, c.name, { id: `${id}-opt-${i}`, highlighted: i === active })
        })}
      </div>,
    )
  }

  return (
    <Popover
      title="Icon"
      wide
      onClose={onClose}
      anchor={anchor}
      placement={placement}
      className="kimo-icon-picker"
      initialFocus={focusSearch ? search : "root"}
    >
      <Input
        ref={search}
        dense
        icon={<Search />}
        placeholder={placeholder}
        aria-label="Search icons"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && results.length > 0) {
            e.preventDefault()
            viewport.current?.focus()
            move(0)
          }
        }}
      />
      <Segmented
        fill
        label="Icon library"
        options={LIBRARIES}
        value={library}
        onChange={setLibrary}
      />
      {library === "material" && (
        <>
          <Segmented
            fill
            label="Material style"
            options={STYLES}
            value={style}
            onChange={setStyle}
          />
          <div className="kimo-icon-picker__weight-row">
            <span className="kimo-icon-picker__weight-label" id={`${id}-weight`}>
              Weight
            </span>
            <Slider
              aria-label="Weight"
              aria-labelledby={`${id}-weight`}
              min={100}
              max={700}
              step={1}
              value={weight}
              valueText={String(Math.round(weight))}
              onChange={(w) => onWeightChange?.(Math.round(w))}
              onChangeStart={onWeightChangeStart}
              onChangeEnd={onWeightChangeEnd}
            />
          </div>
        </>
      )}
      {empty ? (
        <div className="kimo-icon-picker__empty" role="status">
          <span className="kimo-icon-picker__empty-icon" aria-hidden="true">
            <SearchX />
          </span>
          <span className="kimo-icon-picker__empty-title">No icons match “{query.trim()}”</span>
          <span className="kimo-icon-picker__empty-hint">
            Try another library or a shorter word
          </span>
          <Button variant="ghost" size="sm" icon={<X />} onClick={() => setQuery("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <>
          <div className="kimo-icon-picker__grid">
            {recentHere.length > 0 && (
              <div className="kimo-icon-picker__section">
                <span className="kimo-icon-picker__label" id={`${id}-recent`}>
                  Recent
                </span>
                <div
                  className="kimo-icon-picker__row"
                  role="listbox"
                  aria-labelledby={`${id}-recent`}
                >
                  {recentHere.map((n) => tile(n, `recent:${n}`))}
                </div>
              </div>
            )}
            <div className="kimo-icon-picker__section">
              <span className="kimo-icon-picker__label" id={`${id}-all`}>
                All icons
              </span>
              <div
                ref={viewport}
                role="listbox"
                tabIndex={0}
                aria-labelledby={`${id}-all`}
                aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
                className="kimo-icon-picker__viewport"
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                onKeyDown={onGridKey}
              >
                <div
                  className="kimo-icon-picker__rows"
                  style={{ height: Math.max(0, rowCount * PITCH - ICON_GRID.rowGap) }}
                >
                  {rows}
                </div>
              </div>
            </div>
          </div>
          <div className="kimo-icon-picker__footer">
            <span className="kimo-icon-picker__name">{footerName}</span>
            <span className="kimo-icon-picker__spacer" />
            <span className={cx("kimo-icon-picker__license")}>{ICON_LICENSES[library]}</span>
          </div>
        </>
      )}
    </Popover>
  )
}
