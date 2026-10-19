/**
 * Board 41 section 4 (WpWSj): Settings › Multiplayer.
 *
 * Title Bar "Multiplayer" · What a relay is (tMoaA: bg-subtle box, server icon, the self-hosting
 * guide) · Relay URL (pXQUm: Input + Test, then one result: testing, a Kimo relay answered, not a
 * relay, unreachable within 5 s, relay too old) · Your name (empty shows Guest N) · Show other
 * cursors · Fetch images and fonts (On demand / Never). Every control writes at once.
 */
import type { KimoPlatform } from "@kimo/platform"
import { Button, Input, Select, SettingRow, StatusPill, Toggle } from "@kimo/ui"
import { useEffect, useMemo, useState } from "react"
import { Icon } from "../../lib/icons"
import { PaneTitle } from "../../settings/panes"
import { emptySnapshot, type ShareBackend } from "../backend"
import { useMultiplayer, useMultiplayerSettings, useRelayTest } from "../hooks"
import { createMultiplayerModel, type MultiplayerModel } from "../model"
import { refusedText, relayResultView } from "./copy"
import { GuideLink, openRelayGuide } from "./shared"
import "./share-ui.css"

const FETCH_OPTIONS = [
  { value: "on-demand" as const, label: "On demand" },
  { value: "never" as const, label: "Never" },
]

/** Settings only reads settings and tests relays: a backend for a window without one. */
const inertBackend: ShareBackend = {
  snapshot: (key) => emptySnapshot(key),
  subscribe: () => () => {},
  start: () => Promise.reject(new Error("sharing is not available here")),
  stop: async () => ({ relayNotified: false }),
  links: async () => [],
  mintLink: () => Promise.reject(new Error("sharing is not available here")),
  revokeLink: () => Promise.reject(new Error("sharing is not available here")),
  resetAllLinks: () => Promise.reject(new Error("sharing is not available here")),
  setPresence: () => {},
  ensureAsset: async () => false,
  resumeAgent: () => {},
  stopAgent: () => {},
}

export interface MultiplayerPaneProps {
  platform: KimoPlatform
  /** Default: the window's model ({@link useMultiplayer}). */
  model?: MultiplayerModel | null
}

export function MultiplayerPane({ platform, model: given }: MultiplayerPaneProps) {
  const runtime = useMultiplayer()
  const fallback = useMemo(
    () =>
      given || runtime
        ? null
        : createMultiplayerModel({
            backend: inertBackend,
            settings: platform.settings,
            platformKind: platform.kind,
          }),
    [given, runtime, platform],
  )
  useEffect(() => () => fallback?.dispose(), [fallback])
  const model = given ?? runtime ?? fallback
  if (!model) return null
  return <Pane platform={platform} model={model} />
}

function Pane({ platform, model }: { platform: KimoPlatform; model: MultiplayerModel }) {
  const settings = useMultiplayerSettings(model)
  const test = useRelayTest(model)
  const [url, setUrl] = useState(settings.relayUrl ?? "")
  const [name, setName] = useState(settings.displayName)
  const [urlError, setUrlError] = useState<string | null>(null)
  // A change from elsewhere (the Share popover) shows here.
  useEffect(() => setUrl(settings.relayUrl ?? ""), [settings.relayUrl])
  useEffect(() => setName(settings.displayName), [settings.displayName])

  const saveUrl = async (value: string) => {
    try {
      setUrlError(null)
      const saved = await model.settings.setRelayUrl(value)
      setUrl(saved ?? "")
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : String(e))
    }
  }
  const runTest = async () => {
    const result = await model.relayTest.test(url)
    if (result.kind === "ok") await saveUrl(result.url)
  }
  const result =
    urlError !== null
      ? // A URL the app refuses (not ws/http, or plain http to a public host on desktop): say why.
        ({ kind: "danger", icon: "circle-x", text: refusedText(urlError) } as const)
      : test.kind !== "idle" && "url" in test && test.url.trim() !== ""
        ? relayResultView(test)
        : null

  return (
    <>
      <PaneTitle>Multiplayer</PaneTitle>
      <div className="mp-relay-box" data-pen="tMoaA">
        <span className="mp-relay-box__icon" aria-hidden="true">
          <Icon name="server" size={16} />
        </span>
        <div className="mp-text">
          <p className="mp-desc">
            A relay passes encrypted updates between people in a file. It cannot read them, keeps no
            accounts, and Kimo does not run one for you. Host kimo-relay on any small server, or use
            one a teammate runs.
          </p>
          <GuideLink
            label="Self-hosting guide"
            leadingIcon={false}
            className="mp-guide--settings"
            onOpen={() => void openRelayGuide(platform)}
          />
        </div>
      </div>
      <div className="mp-setting" data-pen="pXQUm">
        <div className="mp-text mp-text--2">
          <label className="mp-setting__label" htmlFor="mp-relay-url">
            Relay URL
          </label>
          <p className="mp-desc">
            Used when you start sharing a file. Files already shared keep the relay they started on.
          </p>
        </div>
        <div className="mp-input-row">
          <Input
            id="mp-relay-url"
            frameProps={{ className: "mp-relay-input" }}
            icon={<Icon name="server" size={16} />}
            placeholder="wss://relay.example.com"
            spellCheck={false}
            autoComplete="off"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onBlur={(e) => {
              if (e.currentTarget.value.trim() !== (settings.relayUrl ?? ""))
                void saveUrl(e.currentTarget.value)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runTest()
            }}
          />
          <Button
            variant="secondary"
            className="mp-test"
            icon={<Icon name="activity" size={16} />}
            disabled={test.kind === "testing" || url.trim() === ""}
            onClick={() => void runTest()}
          >
            Test
          </Button>
        </div>
        {result && (
          <div className="mp-result" data-result={result.kind} role="status">
            {result.kind === "ok" ? (
              <>
                <StatusPill status="linked" label={result.pill} />
                <span className="mp-meta-mono">
                  {result.time} · {result.protocol}
                </span>
              </>
            ) : result.kind === "testing" ? (
              <>
                <span className="mp-result__icon mp-result__icon--testing">
                  <Icon name="loader-circle" size={14} />
                </span>
                <span className="mp-result__text mp-result__text--testing">{result.text}</span>
              </>
            ) : (
              <>
                <span className={`mp-result__icon mp-result__icon--${result.kind}`}>
                  <Icon name={result.icon} size={14} />
                </span>
                <p className="mp-result__text">{result.text}</p>
              </>
            )}
          </div>
        )}
      </div>
      <SettingRow
        label="Your name"
        description="Shown on your cursor and in the list, kept on this device. Leave it empty to appear as Guest 1, Guest 2 and so on."
        control={(ids) => (
          <Input
            frameProps={{ className: "mp-name-input" }}
            aria-labelledby={ids.labelId}
            aria-describedby={ids.descriptionId}
            placeholder="Guest"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.currentTarget.value)}
            onBlur={(e) => {
              if (e.currentTarget.value.trim() !== settings.displayName)
                void model.settings.setDisplayName(e.currentTarget.value)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
            }}
          />
        )}
      />
      <SettingRow
        label="Show other cursors"
        description="Names and selections of people and agents on the canvas."
        control={(ids) => (
          <Toggle
            checked={settings.showCursors}
            aria-labelledby={ids.labelId}
            aria-describedby={ids.descriptionId}
            onChange={(v) => void model.settings.setShowCursors(v)}
          />
        )}
      />
      <SettingRow
        last
        label="Fetch images and fonts"
        description="On demand, when a frame that uses them comes into view."
        control={
          <Select
            dense
            className="mp-fetch-select"
            label="Fetch images and fonts"
            options={FETCH_OPTIONS}
            value={settings.fetchAssets ? "on-demand" : "never"}
            onChange={(v) => void model.settings.setFetchAssets(v === "on-demand")}
          />
        }
      />
    </>
  )
}
