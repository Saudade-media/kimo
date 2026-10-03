/**
 * Shared state of the Design tab: the session, the undo-grouping editor, the document header
 * (variables), the asset store and the icon provider. Sections read it with {@link usePanel}.
 */
import type { Theme } from "@kimo/core-schema"
import type { NodeData } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import type { IconProvider } from "@kimo/renderer"
import type { PopoverProps } from "@kimo/ui"
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react"
import type { FontSystem } from "../fonts/font-system"
import type { AssetStore } from "../lib/assets"
import { type DocHeader, resolveColor } from "../lib/header"
import type { Bus } from "../lib/hooks"
import type { Editor } from "./fields"
import type { FileSession } from "./session"

export interface Sel {
  id: string
  node: NodeData
}

export interface PanelContextValue {
  session: FileSession
  editor: Editor
  header: DocHeader
  layout: Bus<LayoutResult | null>
  assets: AssetStore | null
  icons: IconProvider | null
  /** The window's font system (Text section: font picker sources, shipped weights). */
  fonts?: FontSystem | null
  /**
   * Effective theme of the single selected node (§10.4, its pins and its ancestors'); swatches
   * of bindings resolve in it. Absent: the document defaults.
   */
  theme?: Theme
}

export const PanelContext = createContext<PanelContextValue | null>(null)

export function usePanel(): PanelContextValue {
  const v = useContext(PanelContext)
  if (!v) throw new Error("usePanel outside the Design tab")
  return v
}

/** Resolves a color binding for swatches, in the selection's effective theme. */
export function useResolver(): (name: string) => string | null {
  const { header, theme } = usePanel()
  return (name) => resolveColor(header, name, theme)
}

/**
 * Object URLs for asset references (image fill swatches and previews); re-renders when one
 * resolves.
 */
export function useAssetUrls(srcs: readonly string[]): (src: string) => string | null {
  const { assets } = usePanel()
  const subscribe = (cb: () => void) => assets?.subscribe(cb) ?? (() => {})
  const key = srcs.join("\u0000")
  useSyncExternalStore(subscribe, () => (assets ? srcs.map((s) => assets.urlSync(s)).join() : ""))
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `srcs`
  useEffect(() => {
    if (assets) for (const s of srcs) void assets.url(s)
  }, [assets, key])
  return (src) => assets?.urlSync(src) ?? null
}

/** Natural size of an image asset (Mode Badge "2400 × 1600"). */
export function useAssetSize(src: string | null): { width: number; height: number } | null {
  const { assets } = usePanel()
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    let live = true
    setSize(null)
    if (!assets || !src) return
    void assets.info(src).then((i) => {
      if (live && i?.width && i.height) setSize({ width: i.width, height: i.height })
    })
    return () => {
      live = false
    }
  }, [assets, src])
  return size
}

/**
 * Board 09 placement: popovers open to the LEFT of the 280 panel with an 8px gap, their top
 * on the trigger row's top, clamped to the viewport. The anchor is the row itself (so it can
 * toggle the popover); the offset spans from the row to the panel's left edge plus 8.
 */
export function panelPlacement(anchor: HTMLElement | null): PopoverProps["placement"] {
  const panel = anchor?.closest(".right-panel")
  const inset =
    anchor && panel ? anchor.getBoundingClientRect().left - panel.getBoundingClientRect().left : 0
  return { side: "left", align: "start", offset: inset + 8, flip: false }
}

/**
 * Keeps keyboard focus in a panel popover once it is open (Escape closes the popover instead of
 * reaching the canvas, where it would change the selection). The `@kimo/ui` Popover focuses
 * itself on mount, but not always (observed with ImageFillPopover); this re-focuses the newest
 * open dialog on the next frame when focus is still outside it.
 * TODO(ui): drop once Popover's initial focus is reliable.
 */
export function useKeepPopoverFocus(open: string | number | boolean | null) {
  useEffect(() => {
    if (open === null || open === false) return
    const raf = requestAnimationFrame(() => {
      const dialogs = document.querySelectorAll<HTMLElement>(".kimo-popover[role=dialog]")
      const d = dialogs[dialogs.length - 1]
      if (d && !d.contains(document.activeElement)) d.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(raf)
  }, [open])
}
