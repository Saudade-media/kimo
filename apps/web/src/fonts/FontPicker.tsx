/**
 * Font picker (board 19 `azBUI`, "Font picker · sources · offline"): `Popover/Wide` (u0aiz, 296)
 * titled "Font". Body (JlUHF): column, gap 8, padding [8, 8, 6, 8]:
 *   Search (KtLZF) Input h 28, icon 14, "Search 1,642 fonts" sans 12
 *   Sources (y8QmGh) row gap 2: Tab/Active "All" · Tab "Document" · "Local" · "Google"
 *   List (T7zLdr) column gap 1: group labels (padding [8, 8, 4, 8], sans 11 / 600, letterSpacing
 *     0.6, text-tertiary: IN THIS DOCUMENT · ON THIS MAC · GOOGLE FONTS) and MenuItem/Dense rows
 *     whose label is drawn in the family itself (Meta `12 styles` / `local` / `cached` /
 *     `not cached`; a Google family that is not cached while offline: opacity 0.45, Inter)
 *   Offline Note (wYmyJ): row gap 8 padding [8, 10] bg-subtle radius-sm: `wifi-off` 14
 *     text-tertiary + sans 11 text-secondary lineHeight 1.45
 *   "No third-party fetch" variant (ljh5h): row gap 8 padding [8, 10] bg-app stroke 1 border
 *     radius-md: `shield` 14 + the same text style.
 */
import { Input, MenuItemDense, Popover, Tab } from "@kimo/ui"
import { Search, Shield, WifiOff } from "lucide-react"
import { type CSSProperties, type KeyboardEvent, useMemo, useRef, useState } from "react"
import "./fonts.css"

export type FontSourceGroup = "document" | "local" | "google"

export interface FontPickerEntry {
  family: string
  group: FontSourceGroup
  /** `12 styles`, `local`, `cached`, `not cached`. */
  meta: string
  /** False for a Google family that cannot render now (not cached while blocked/offline). */
  available: boolean
}

/** Google Fonts state for the picker notes. */
export type GoogleFontsState = "online" | "offline" | "blocked" | "off"

export interface FontPickerProps {
  value: string | null
  entries: readonly FontPickerEntry[]
  google: GoogleFontsState
  onPick: (family: string) => void
  onClose?: () => void
  anchor?: HTMLElement | null
  /** Gallery specimen (rendered in flow, no initial focus). */
  inline?: boolean
}

const GROUPS: { id: FontSourceGroup; label: string; tab: string }[] = [
  { id: "document", label: "IN THIS DOCUMENT", tab: "Document" },
  { id: "local", label: "ON THIS MAC", tab: "Local" },
  { id: "google", label: "GOOGLE FONTS", tab: "Google" },
]

type Filter = "all" | FontSourceGroup

/** Search placeholder: "Search 1,642 fonts". */
export function searchPlaceholder(n: number): string {
  return `Search ${n.toLocaleString("en-US")} font${n === 1 ? "" : "s"}`
}

/** The offline note (wYmyJ) copy. */
export function offlineNote(cachedGoogle: number): string {
  return `Offline — Google shows the ${cachedGoogle} font${cachedGoogle === 1 ? "" : "s"} already cached. Others download when you're back online.`
}

export const BLOCKED_NOTE =
  "Google fonts are off (No third-party fetch). Cached fonts still work. Change in Settings › Fonts & privacy."
export const GOOGLE_OFF_NOTE =
  "Google fonts are off. Cached fonts still work. Change in Settings › Fonts & privacy."

/** Entries filtered by tab and query; offers the typed family from Google when allowed. */
export function filterFontEntries(
  entries: readonly FontPickerEntry[],
  filter: Filter,
  query: string,
  google: GoogleFontsState,
): FontPickerEntry[] {
  const q = query.trim().toLowerCase()
  const out = entries.filter(
    (e) => (filter === "all" || e.group === filter) && (!q || e.family.toLowerCase().includes(q)),
  )
  if (
    q &&
    google === "online" &&
    (filter === "all" || filter === "google") &&
    !entries.some((e) => e.family.toLowerCase().includes(q))
  )
    out.push({ family: query.trim(), group: "google", meta: "not cached", available: true })
  return out
}

export function FontPicker({
  value,
  entries,
  google,
  onPick,
  onClose,
  anchor,
  inline = false,
}: FontPickerProps) {
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const shown = useMemo(
    () => filterFontEntries(entries, filter, query, google),
    [entries, filter, query, google],
  )
  const cachedGoogle = entries.filter((e) => e.group === "google" && e.available).length

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <Popover
      wide
      title="Font"
      className="fonts-picker"
      bodyProps={{ className: "fonts-picker__body" }}
      initialFocus={inline ? "none" : search}
      {...(onClose ? { onClose } : {})}
      {...(anchor ? { anchor } : {})}
      data-pen="azBUI"
    >
      <Input
        ref={search}
        dense
        icon={<Search />}
        frameProps={{ className: "fonts-picker__search" }}
        placeholder={searchPlaceholder(entries.length)}
        aria-label="Search fonts"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            list.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
          }
        }}
      />
      <div className="fonts-picker__sources" role="tablist" aria-label="Font sources">
        {(["all", ...GROUPS.map((g) => g.id)] as Filter[]).map((f) => (
          <Tab key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : GROUPS.find((g) => g.id === f)?.tab}
          </Tab>
        ))}
      </div>
      <div
        ref={list}
        className="fonts-picker__list"
        role="menu"
        aria-label="Fonts"
        onKeyDown={onListKey}
      >
        {GROUPS.map((g) => {
          const rows = shown.filter((e) => e.group === g.id)
          if (!rows.length) return null
          return [
            <div key={`h-${g.id}`} className="fonts-picker__group" role="presentation">
              <span className="fonts-picker__group-label">{g.label}</span>
            </div>,
            ...rows.map((e) => (
              <MenuItemDense
                key={`${g.id}-${e.family}`}
                className={`fonts-picker__item${e.available ? "" : " fonts-picker__item--unavailable"}`}
                style={
                  {
                    "--fonts-picker-family": e.available
                      ? `"${e.family.replace(/["\\]/g, "")}", var(--kimo-font-sans)`
                      : "var(--kimo-font-sans)",
                  } as CSSProperties
                }
                label={e.family}
                meta={e.meta}
                checked={e.family === value}
                onSelect={() => onPick(e.family)}
              />
            )),
          ]
        })}
      </div>
      {google === "offline" && (
        <div className="fonts-picker__note" data-pen="wYmyJ">
          <WifiOff className="fonts-picker__note-icon" aria-hidden="true" />
          <span className="fonts-picker__note-text">{offlineNote(cachedGoogle)}</span>
        </div>
      )}
      {(google === "blocked" || google === "off") && (
        <div className="fonts-picker__note fonts-picker__note--blocked" data-pen="ljh5h">
          <Shield className="fonts-picker__note-icon" aria-hidden="true" />
          <span className="fonts-picker__note-text">
            {google === "blocked" ? BLOCKED_NOTE : GOOGLE_OFF_NOTE}
          </span>
        </div>
      )}
    </Popover>
  )
}
