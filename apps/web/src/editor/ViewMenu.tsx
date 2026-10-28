/**
 * The View menu — board 27 §4 (a) "View menu" (rmQMe › F5DXf): `Menu/Dense` (G7A3Aj) at width
 * 244, opened from the topbar zoom control. `MenuItem/Dense` rows, checkable items use the Check
 * Slot (Hl922) and the Meta (T4CD1) holds the shortcut:
 *
 *   Zoom in ⌘+ · Zoom out ⌘− · Zoom to 100 % ⌘0 · Zoom to fit ⇧1 · Zoom to selection ⇧2 · ─ ·
 *   ✓ Pixel grid ⇧' · ✓ Snap to pixel grid · ✓ Snap to objects · Rulers ⇧R · ─ ·
 *   ✓ Show left panel · ✓ Show right panel · ─ · ✓ Show layer names on canvas · Preview ⇧Space
 *
 * Board 44 §5 rule "Collapse": Show left panel / Show right panel toggle the floating cards
 * (checked while the card is expanded); ⌘\ toggles both, so neither row carries a Meta.
 *
 * Toggling writes the same `canvas.*` preference as Settings › Canvas (rule Dos9n). Not as
 * designed: Snap to pixel grid has no Meta — the design's ⇧⌘' is Previous conflict (board 18 /
 * SHORTCUTS "previousConflict"), so it is not bound.
 */
import type { HostOS, SettingsApi } from "@kimo/platform"
import type { PopoverAnchor } from "@kimo/ui"
import { MenuDense, MenuDivider, MenuItemDense } from "@kimo/ui"
import { type CanvasViewPrefs, toggleViewPref, type ViewToggleKey } from "../canvas/view-prefs"
import { usesMacGlyphs } from "./FileMenu"
import { useFailureToast } from "./failure-toast"

/** F5DXf `width: 244`. */
const VIEW_MENU_WIDTH = 244

interface ViewMenuProps {
  anchor: PopoverAnchor
  os: HostOS
  prefs: CanvasViewPrefs
  settings: SettingsApi
  zoomIn(): void
  zoomOut(): void
  zoom100(): void
  zoomToFit(): void
  zoomToSelection(): void
  onPreview(): void
  /** E10: the frame Preview would open (`usePreviewTarget`); null disables Preview (no frames). */
  previewTarget?: string | null
  /** Board 44: the floating cards' collapsed state and their toggles (omitted: no rows). */
  panels?: {
    leftCollapsed: boolean
    rightCollapsed: boolean
    toggleLeft(): void
    toggleRight(): void
  }
  onClose(): void
}

/** The design's macOS glyphs; off macOS ⌘ reads Ctrl+ and ⇧ reads Shift+ (board 20 VJFSo). */
function viewMeta(os: HostOS, mac: string): string {
  if (usesMacGlyphs(os)) return mac
  return mac.replace("⇧", "Shift+").replace("⌘", "Ctrl+")
}

export function ViewMenu(props: ViewMenuProps) {
  const { os, prefs, settings, onClose } = props
  const run = (f: () => void) => () => {
    onClose()
    f()
  }
  const fail = useFailureToast()
  const toggle = (key: ViewToggleKey) =>
    run(() => toggleViewPref(settings, key, (e) => fail("change the view setting", e)))
  const m = (mac: string) => viewMeta(os, mac)
  return (
    <MenuDense
      anchor={props.anchor}
      placement={{ side: "bottom", align: "end" }}
      width={VIEW_MENU_WIDTH}
      label="View"
      autoFocus
      onClose={onClose}
      className="view-menu"
      data-pen="F5DXf"
    >
      <MenuItemDense label="Zoom in" meta={m("⌘+")} onSelect={run(props.zoomIn)} />
      <MenuItemDense label="Zoom out" meta={m("⌘−")} onSelect={run(props.zoomOut)} />
      <MenuItemDense label="Zoom to 100 %" meta={m("⌘0")} onSelect={run(props.zoom100)} />
      <MenuItemDense label="Zoom to fit" meta={m("⇧1")} onSelect={run(props.zoomToFit)} />
      <MenuItemDense
        label="Zoom to selection"
        meta={m("⇧2")}
        onSelect={run(props.zoomToSelection)}
      />
      <MenuDivider />
      <MenuItemDense
        label="Pixel grid"
        toggled={prefs.pixelGrid}
        meta={m("⇧'")}
        onSelect={toggle("canvas.pixelGrid")}
      />
      <MenuItemDense
        label="Snap to pixel grid"
        toggled={prefs.snapToPixelGrid}
        onSelect={toggle("canvas.snapToPixelGrid")}
      />
      <MenuItemDense
        label="Snap to objects"
        toggled={prefs.snapToObjects}
        onSelect={toggle("canvas.snapToObjects")}
      />
      <MenuItemDense
        label="Rulers"
        toggled={prefs.rulers}
        meta={m("⇧R")}
        onSelect={toggle("canvas.rulers")}
      />
      <MenuDivider />
      {props.panels && (
        <>
          <MenuItemDense
            label="Show left panel"
            toggled={!props.panels.leftCollapsed}
            onSelect={run(props.panels.toggleLeft)}
          />
          <MenuItemDense
            label="Show right panel"
            toggled={!props.panels.rightCollapsed}
            onSelect={run(props.panels.toggleRight)}
          />
          <MenuDivider />
        </>
      )}
      <MenuItemDense
        label="Show layer names on canvas"
        toggled={prefs.layerNames}
        onSelect={toggle("canvas.layerNames")}
      />
      <MenuItemDense
        label="Preview"
        meta={m("⇧Space")}
        disabled={props.previewTarget === null}
        onSelect={run(props.onPreview)}
      />
    </MenuDense>
  )
}
