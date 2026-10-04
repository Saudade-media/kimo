/**
 * Settings entry points (ADR 0012: a separate window on desktop, an in-app dialog on the web):
 * - {@link openSettings}: ⌘, / menu → `platform.window.openSettings(pane)`; on `"dialog"` the
 *   caller shows {@link SettingsDialog}.
 * - {@link SettingsDialog}: the web dialog (scrim + the 840 × 536 window frame).
 * - {@link SettingsRoute}: the desktop Settings window's content for `#/settings/<pane>`.
 * - {@link useSettingsShortcut}: ⌘, / Ctrl+, opens Settings.
 */
import type { KimoPlatform, SettingsPane } from "@kimo/platform"
import { useFocusTrap } from "@kimo/ui"
import { useEffect, useRef, useState } from "react"
import { matches } from "../shortcuts/shortcuts"
import { DEFAULT_PANE, parseSettingsHash, settingsHash } from "./model"
import { SettingsView, type SettingsViewProps } from "./SettingsView"

/** Opens Settings; resolves `"dialog"` when the caller must show {@link SettingsDialog}. */
export async function openSettings(
  platform: KimoPlatform,
  pane: SettingsPane = DEFAULT_PANE,
): Promise<"window" | "dialog"> {
  try {
    return await platform.window.openSettings(pane)
  } catch {
    return "dialog"
  }
}

export interface SettingsDialogProps
  extends Omit<SettingsViewProps, "variant" | "pane" | "onPaneChange" | "onClose"> {
  initialPane?: SettingsPane
  onClose: () => void
}

/** The in-app Settings dialog (web). Escape, an outside press and the red light close it. */
export function SettingsDialog({
  initialPane = DEFAULT_PANE,
  onClose,
  ...rest
}: SettingsDialogProps) {
  const [pane, setPane] = useState<SettingsPane>(initialPane)
  const root = useRef<HTMLDivElement>(null)
  const trap = useFocusTrap(root, "first")
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim closes on outside press
    <div
      ref={root}
      className="settings-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          return
        }
        trap(e)
      }}
    >
      <SettingsView
        {...rest}
        variant="dialog"
        pane={pane}
        onPaneChange={setPane}
        onClose={onClose}
      />
    </div>
  )
}

/** The desktop Settings window (`#/settings/<pane>`); the pane follows the hash. */
export function SettingsRoute(
  props: Omit<SettingsViewProps, "variant" | "pane" | "onPaneChange"> & { hash: string },
) {
  const { hash, ...rest } = props
  const pane = parseSettingsHash(hash) ?? DEFAULT_PANE
  return (
    <SettingsView
      {...rest}
      variant="window"
      pane={pane}
      onPaneChange={(p) => {
        location.hash = settingsHash(p)
      }}
    />
  )
}

/** ⌘, (macOS) / Ctrl+, opens Settings at `pane` via {@link openSettings}. */
export function useSettingsShortcut(
  platform: KimoPlatform,
  showDialog: (pane: SettingsPane) => void,
  pane: SettingsPane = DEFAULT_PANE,
): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matches("settings", e)) return
      e.preventDefault()
      void openSettings(platform, pane).then((how) => {
        if (how === "dialog") showDialog(pane)
      })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [platform, showDialog, pane])
}
