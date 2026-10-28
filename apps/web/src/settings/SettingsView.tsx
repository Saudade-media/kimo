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
import type { KimoPlatform, SettingKey, SettingsPane } from "@kimo/platform"
import { Banner } from "@kimo/ui"
import {
  Bot,
  HardDrive,
  Info,
  KeyRound,
  RefreshCw,
  Ruler,
  Settings as SettingsIcon,
  Shield,
  Users,
} from "lucide-react"
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AiProvidersPane } from "../ai-settings/AiProvidersPane"
import { causeOf } from "../editor/errors"
import { MultiplayerPane } from "../multiplayer/ui/MultiplayerPane"
import { WorkspacePane } from "../multiplayer/ui/WorkspacePane"
import { useOptionalRuntime } from "../platform/runtime"
import { AboutPane } from "./AboutPane"
import { AgentsPane } from "./AgentsPane"
import { useSetSetting, useSettings } from "./hooks"
import { SETTINGS_PANES, settingsWriteErrorCopy } from "./model"
import {
  CanvasPane,
  FilesPane,
  FontsPane,
  GeneralPane,
  type PaneProps,
  SettingsBannerContext,
  type SettingsFail,
  SettingsFailContext,
  type SettingsFailure,
  UpdatesPane,
} from "./panes"
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
  users: Users,
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
  /** What the pane opens on: an MCP client to expand (Agents & MCP), `usage` (AI providers). */
  focus?: string | null
  /**
   * A write was refused (INVALID / IO). Default (board 37 D13 CT1wv): a Banner/Danger under the
   * pane's Title Bar, "Couldn't save <setting>" with Retry; the control shows the stored value.
   */
  onError?: (e: unknown, key: SettingKey, value: unknown) => void
}

export function SettingsView({
  platform,
  pane,
  onPaneChange,
  variant,
  onClose,
  onFontCacheCleared,
  onError,
  focus = null,
}: SettingsViewProps) {
  const settings = useSettings(platform.settings)
  // Board 37 (CT1wv / eEmwX): a refused write or a failed one-shot action in a pane shows one
  // Banner/Danger under the pane's Title Bar ("Couldn't …" + the cause), with Retry when the
  // action can run again. Switching panes clears it.
  const [failure, setFailure] = useState<SettingsFailure | null>(null)
  const set = useSetSetting(
    platform.settings,
    useCallback(
      (error: unknown, key: SettingKey, value: unknown) => {
        if (onError) return onError(error, key, value)
        const copy = settingsWriteErrorCopy(key, error)
        setFailure({ ...copy, retry: () => void setRef.current(key, value as never) })
      },
      [onError],
    ),
  )
  const setRef = useRef(set)
  setRef.current = set
  const fail = useCallback<SettingsFail>((what, error, retry) => {
    const body = causeOf(error)
    setFailure({ title: `Couldn't ${what}`, body, ...(retry ? { retry } : {}) })
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new pane drops the old failure.
  useEffect(() => setFailure(null), [pane])
  const banner = useMemo(() => {
    if (!failure) return null
    return (
      <Banner
        tone="danger"
        className="settings-banner"
        data-pen="CT1wv"
        data-testid="settings-write-error"
        title={failure.title}
        {...(failure.body ? { body: failure.body } : {})}
        actions={failure.retry ? [{ id: "retry", label: "Retry", variant: "primary" }] : []}
        onAction={() => {
          setFailure(null)
          failure.retry?.()
        }}
        onDismiss={() => setFailure(null)}
      />
    )
  }, [failure])
  const nav = useRef<(HTMLButtonElement | null)[]>([])
  // Board 46: Workspace is listed only while Kimo Cloud is on (the window has a workspace store).
  const cloudOn = !!useOptionalRuntime()?.workspaces
  const panes = useMemo(
    () => SETTINGS_PANES.filter((p) => p.id !== "workspace" || cloudOn),
    [cloudOn],
  )
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
      const n = panes.length
      const to = e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : -1
      if (to < 0) return
      e.preventDefault()
      nav.current[to]?.focus()
      const p = panes[to]
      if (p) onPaneChange(p.id)
    },
    [onPaneChange, panes],
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
        <div className="settings-lights" data-pen="L2zCG" data-tauri-drag-region="">
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
          {panes.map((p, i) => {
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
        <SettingsFailContext.Provider value={fail}>
          <SettingsBannerContext.Provider value={banner}>
            {pane === "general" && <GeneralPane {...props} />}
            {pane === "canvas" && <CanvasPane {...props} />}
            {pane === "files" && <FilesPane {...props} />}
            {pane === "fonts" && <FontsPane {...props} />}
            {pane === "agents-mcp" && (
              <AgentsPane key={focus ?? ""} platform={platform} expandedClient={focus} />
            )}
            {pane === "ai-providers" && (
              <AiProvidersPane
                key={focus ?? ""}
                platform={platform}
                {...(focus === "usage" ? { section: "usage" as const } : {})}
              />
            )}
            {pane === "multiplayer" && <MultiplayerPane platform={platform} />}
            {pane === "workspace" && cloudOn && <WorkspacePane key={focus ?? ""} focus={focus} />}
            {pane === "updates" && <UpdatesPane {...props} />}
            {pane === "about" && <AboutPane platform={platform} />}
          </SettingsBannerContext.Provider>
        </SettingsFailContext.Provider>
      </section>
    </div>
  )
}
