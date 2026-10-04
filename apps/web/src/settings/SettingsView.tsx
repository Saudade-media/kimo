/**
 * Settings window (board 19 `XmeDB`, "Settings window · Files & autosave"): 840 × 536, bg-app,
 * stroke 1 border, radius-md, shadow 0 16 48 shadow-strong, clip.
 *   Sidebar (h7qQD) 216, column gap 2, padding [0, 12, 12, 12], bg-subtle, right stroke 1 border:
 *     Traffic Lights (WindowChrome/TrafficLights L2zCG, padding [0, 0, 0, 4]) · Nav items:
 *     32 tall, gap 10, padding [0, 10], radius-md; icon 16 text-secondary + label sans 13
 *     text-secondary. Active (GDXwe): bg-muted, stroke 1 border, radius-pill, icon accent-text,
 *     label 600 text-primary.
 *   Content (EHSmX): column, padding [0, 32, 24, 32], fill: Title Bar 56 + SettingRows.
 *
 * Desktop: its own window (⌘,; `#/settings/<pane>`), the OS draws the traffic lights in the
 * reserved 68 × 48 frame. Web: the same frame as an in-app dialog; with no native lights the
 * frame draws them, and the red one closes the dialog.
 */
import type { KimoPlatform, SettingsPane } from "@kimo/platform"
import {
  Bot,
  HardDrive,
  Info,
  KeyRound,
  RefreshCw,
  Ruler,
  Settings as SettingsIcon,
  Shield,
} from "lucide-react"
import { type KeyboardEvent, useCallback, useRef } from "react"
import { AiProvidersPane } from "../ai-settings/AiProvidersPane"
import { AboutPane } from "./AboutPane"
import { AgentsPane } from "./AgentsPane"
import { useSetSetting, useSettings } from "./hooks"
import { SETTINGS_PANES } from "./model"
import { CanvasPane, FilesPane, FontsPane, GeneralPane, type PaneProps, UpdatesPane } from "./panes"
import "./settings.css"

const ICONS = {
  settings: SettingsIcon,
  ruler: Ruler,
  "hard-drive": HardDrive,
  shield: Shield,
  "refresh-cw": RefreshCw,
  info: Info,
  bot: Bot,
  "key-round": KeyRound,
} as const

export interface SettingsViewProps {
  platform: KimoPlatform
  pane: SettingsPane
  onPaneChange: (pane: SettingsPane) => void
  /** `window`: fills its own OS window; `dialog`: the 840 × 536 frame inside the editor. */
  variant: "window" | "dialog"
  /** Dialog only: the red light / Escape. */
  onClose?: () => void
  onFontCacheCleared?: PaneProps["onFontCacheCleared"]
  /** A write was refused (INVALID / IO). */
  onError?: (e: unknown) => void
}

export function SettingsView({
  platform,
  pane,
  onPaneChange,
  variant,
  onClose,
  onFontCacheCleared,
  onError,
}: SettingsViewProps) {
  const settings = useSettings(platform.settings)
  const set = useSetSetting(platform.settings, onError)
  const nav = useRef<(HTMLButtonElement | null)[]>([])
  const props: PaneProps = {
    platform,
    settings,
    set,
    ...(onFontCacheCleared ? { onFontCacheCleared } : {}),
  }
  const nativeLights = platform.window.trafficLightPosition() !== null
  const drawLights = variant === "dialog" || !nativeLights

  const onNavKey = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
      const n = SETTINGS_PANES.length
      const to = e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : -1
      if (to < 0) return
      e.preventDefault()
      nav.current[to]?.focus()
      const p = SETTINGS_PANES[to]
      if (p) onPaneChange(p.id)
    },
    [onPaneChange],
  )

  return (
    <div
      className={`settings-window settings-window--${variant}`}
      data-pen="XmeDB"
      {...(variant === "dialog"
        ? { role: "dialog", "aria-modal": true, "aria-label": "Settings" }
        : {})}
    >
      <nav className="settings-sidebar" aria-label="Settings sections">
        <div className="settings-lights" data-pen="L2zCG">
          {drawLights && (
            <>
              <button
                type="button"
                className="settings-light settings-light--close"
                aria-label="Close settings"
                disabled={!onClose}
                onClick={onClose}
              />
              <span className="settings-light settings-light--minimize" aria-hidden="true" />
              <span className="settings-light settings-light--zoom" aria-hidden="true" />
            </>
          )}
        </div>
        <div role="tablist" aria-orientation="vertical" className="settings-nav">
          {SETTINGS_PANES.map((p, i) => {
            const Icon = ICONS[p.icon]
            const active = p.id === pane
            return (
              <button
                key={p.id}
                ref={(el) => {
                  nav.current[i] = el
                }}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="settings-pane"
                tabIndex={active ? 0 : -1}
                className={`settings-nav-item${active ? " settings-nav-item--active" : ""}`}
                data-pane={p.id}
                onClick={() => onPaneChange(p.id)}
                onKeyDown={(e) => onNavKey(e, i)}
              >
                <Icon className="settings-nav-item__icon" aria-hidden="true" />
                <span className="settings-nav-item__label">{p.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
      <section id="settings-pane" role="tabpanel" className="settings-content" data-pane={pane}>
        {pane === "general" && <GeneralPane {...props} />}
        {pane === "canvas" && <CanvasPane {...props} />}
        {pane === "files" && <FilesPane {...props} />}
        {pane === "fonts" && <FontsPane {...props} />}
        {pane === "agents-mcp" && <AgentsPane platform={platform} />}
        {pane === "ai-providers" && <AiProvidersPane platform={platform} />}
        {pane === "updates" && <UpdatesPane {...props} />}
        {pane === "about" && <AboutPane platform={platform} />}
      </section>
    </div>
  )
}
