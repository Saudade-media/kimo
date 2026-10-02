/**
 * Icon picker popover (board 09 `jKClR` › `b1gaD`; Material + empty search `Vr0Sk` ›
 * `r6tBTD`): the `@kimo/ui` IconPicker over the renderer's lazy {@link IconProvider} (one glyph
 * at a time), with recent picks kept per browser.
 */
import type { IconProvider } from "@kimo/renderer"
import { IconPicker, type PopoverProps } from "@kimo/ui"
import { useState } from "react"
import { gestureProps } from "../fields"
import { panelPlacement, usePanel } from "../panel-context"

const RECENT_KEY = "kimo.recent-icons"

export interface RecentIcon {
  set: string
  name: string
}

export function readRecentIcons(): RecentIcon[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(v)
      ? v.filter(
          (r): r is RecentIcon => !!r && typeof r.name === "string" && typeof r.set === "string",
        )
      : []
  } catch {
    return []
  }
}

export function pushRecentIcon(r: RecentIcon) {
  try {
    const list = [r, ...readRecentIcons().filter((x) => x.set !== r.set || x.name !== r.name)]
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 32)))
  } catch {
    // Storage unavailable: recents are a convenience.
  }
}

export function IconPickerPopover({
  anchor,
  provider,
  set,
  name,
  weight,
  onPick,
  onWeight,
  onClose,
  placement,
  focusSearch,
}: {
  anchor: HTMLElement
  /** Default: board 09 panel placement (left of the panel, top on the row). */
  placement?: PopoverProps["placement"]
  provider: IconProvider
  /** The icon node's current `set` and `icon`. */
  set: string
  name: string
  weight: number
  /** One undo step. */
  onPick(set: string, name: string): void
  /** Material weight slider (one gesture = one undo step). */
  onWeight(weight: number): void
  onClose(): void
  /** Focus the search box on open (the canvas I-key picker). */
  focusSearch?: boolean
}) {
  const { editor } = usePanel()
  const [recent] = useState(readRecentIcons)
  const g = gestureProps(editor)
  return (
    <IconPicker
      anchor={anchor}
      placement={placement ?? panelPlacement(anchor)}
      provider={provider}
      set={set}
      name={name}
      weight={weight}
      recent={recent}
      onSelect={(icon) => {
        pushRecentIcon(icon)
        onPick(icon.set, icon.name)
      }}
      onWeightChange={onWeight}
      onWeightChangeStart={g.onChangeStart}
      onWeightChangeEnd={g.onChangeEnd}
      onClose={onClose}
      focusSearch={focusSearch}
    />
  )
}
