/**
 * Board 41 section 4 (WpWSj): Settings › Multiplayer.
 *
 * Title Bar "Multiplayer" · What a relay is (tMoaA: bg-subtle box, server icon, the self-hosting
 * guide) · Relay URL (pXQUm: Input + Test, then one result: testing, a Kimo relay answered, not a
 * relay, unreachable within 5 s, relay too old) · Your name (empty shows Guest N) · Show other
 * cursors · Fetch images and fonts (On demand / Never). Every control writes at once.
 *
 * Board 42 section 1 B: the explainer gets Set up a relay (Secondary, opens the relay setup
 * wizard over Settings) next to the guide.
 *
 * ADR 0017 (section 4 rows 2 to 4): the result says whose the relay is: Yours, Not claimed yet
 * (claimed on the first Start sharing) or Not yours (Add this device · Reset ownership). When it
 * is yours, Devices lists the devices that can start sharing (`DevicesSetting`). A saved relay is
 * tested when the pane opens.
 *
 * Board 43 section 5 (ADR 0018): when Kimo Cloud is the relay, Relay, Account and Devices replace
 * the explainer and the Relay URL row (`CloudSettings`); the rows below stay.
 */
import type { KimoPlatform } from "@kimo/platform"
import { Button, Input, Select, SettingRow, Toggle } from "@kimo/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { Icon } from "../../lib/icons"
import { PaneTitle } from "../../settings/panes"
import { emptySnapshot, type ShareBackend } from "../backend"
import { ownershipFor } from "../device"
import { useMultiplayer, useMultiplayerSettings, useRelayTest } from "../hooks"
import { createMultiplayerModel, type MultiplayerModel } from "../model"
import type { RelayDevice } from "../ownership"
import {
  useCloudState,
  useRelaySetupServices,
  useRelaySetupStateOrNull,
} from "../relay-setup/services"
import { CloudSettings } from "./CloudSettings"
import { ownerPill, refusedText, relayResultView } from "./copy"
import { DevicesSetting } from "./DevicesSetting"
import {
  AddThisDeviceDialog,
  NOT_YOURS_DESC,
  NotYoursActions,
  RESET_OWNERSHIP_URL,
} from "./ownership"
import { RelayWizard } from "./RelayWizard"
import { Pill } from "./relay-parts"
import { copyText, GuideLink, openRelayGuide } from "./shared"
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
            ownership: async (url) => (await ownershipFor(platform).relayOwnership(url)).state,
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
  const relaySetup = useRelaySetupServices(platform)
  const [wizard, setWizard] = useState(false)
  /** The relay URL the open wizard saved, if any. */
  const wizardSaved = useRef<string | null>(null)
  const [addThisDevice, setAddThisDevice] = useState(false)
  const ownership = relaySetup?.ownership ?? ownershipFor(platform)
  const [devices, setDevices] = useState<RelayDevice[] | null>(null)
  const cloud = relaySetup?.cloud ?? null
  const cloudState = useCloudState(cloud)
  const setup = useRelaySetupStateOrNull(relaySetup?.store ?? null)
  // Kimo Cloud is the chosen relay. Signing this device out keeps the choice and clears the URL,
  // so Relay reads Not set up (board 43 5 B, nVGsb) until Change picks another.
  const cloudRelay = cloud !== null && cloudState !== null && setup?.path === "cloud"
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
  const runTest = async (value = url) => {
    const result = await model.relayTest.test(value)
    if (result.kind !== "ok") return
    await saveUrl(result.url)
  }

  // A saved relay is tested when the pane opens, so its ownership and devices show; Kimo Cloud's
  // account is refreshed instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per open
  useEffect(() => {
    if (cloudRelay) {
      void cloud?.refresh()
      return
    }
    if (settings.relayUrl && !(test.kind === "ok" && test.url === settings.relayUrl))
      void model.relayTest.test(settings.relayUrl)
  }, [])

  // Devices: only when the tested relay is yours.
  const yoursUrl = test.kind === "ok" && test.owner === "yours" ? test.url : null
  useEffect(() => {
    setDevices(null)
    if (!yoursUrl) return
    let live = true
    void ownership.listDevices(yoursUrl).then(
      (list) => live && setDevices(list),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [yoursUrl, ownership])
  const result =
    urlError !== null
      ? // A URL the app refuses (not ws/http, or plain http to a public host on desktop): say why.
        ({ kind: "danger", icon: "circle-x", text: refusedText(urlError) } as const)
      : test.kind !== "idle" && "url" in test && test.url.trim() !== ""
        ? relayResultView(test)
        : null

  const wizardSheet = wizard && relaySetup && (
    <RelayWizard
      services={relaySetup}
      from="settings"
      displayName={settings.displayName}
      saveRelayUrl={async (u) => {
        const saved = await model.settings.setRelayUrl(u)
        wizardSaved.current = saved ?? u
        return saved
      }}
      onClose={() => {
        setWizard(false)
        // The wizard tested and may have claimed the relay it saved: read its ownership again, so
        // Yours and Devices show without another Test (Kimo Cloud's relay shows its account).
        const saved = wizardSaved.current
        wizardSaved.current = null
        if (saved && relaySetup.store.getState().path !== "cloud") void model.relayTest.test(saved)
      }}
    />
  )
  const rows = <PersonalRows model={model} name={name} setName={setName} />
  const selfHost = (
    <>
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
          <div className="mp-relay-box__actions" data-pen="TPCDP">
            {relaySetup && (
              <Button
                variant="secondary"
                className="rw-btn--28 mp-setup-relay-settings"
                icon={<Icon name="wand-sparkles" size={16} />}
                onClick={() => setWizard(true)}
              >
                Set up a relay
              </Button>
            )}
            <GuideLink
              label="Self-hosting guide"
              leadingIcon={false}
              className="mp-guide--settings"
              onOpen={() => void openRelayGuide(platform)}
            />
          </div>
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
        {result?.kind === "ok" && (result.owner === "unclaimed" || result.owner === "other") ? (
          <div className="mp-result-group" data-result="ok" data-owner={result.owner}>
            <div className="mp-result" role="status">
              <Pill {...ownerPill(result.owner, "settings", result.relay)} />
              <span className="mp-meta-mono">
                {result.relay} · {result.time}
              </span>
            </div>
            <p className="mp-desc">
              {result.owner === "unclaimed"
                ? "Kimo claims it for this device the first time you start sharing."
                : NOT_YOURS_DESC}
            </p>
            {result.owner === "other" && (
              <NotYoursActions
                iconSize={14}
                onAddThisDevice={() => setAddThisDevice(true)}
                onResetOwnership={() => void platform.files.openExternalUrl(RESET_OWNERSHIP_URL)}
              />
            )}
          </div>
        ) : (
          result && (
            <div className="mp-result" data-result={result.kind} role="status">
              {result.kind === "ok" ? (
                <>
                  <Pill {...ownerPill(result.owner, "settings", result.relay)} />
                  <span className="mp-meta-mono">
                    {result.relay} · {result.time}
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
          )
        )}
      </div>
      {yoursUrl && devices && (
        <DevicesSetting
          ownership={ownership}
          relayUrl={yoursUrl}
          devices={devices}
          onDevices={setDevices}
          onRemovedSelf={() => void model.relayTest.test(yoursUrl)}
          copy={(text) => (relaySetup ? relaySetup.copy(text) : copyText(platform, text))}
        />
      )}
      {addThisDevice && (
        <AddThisDeviceDialog
          host={hostOf(test.kind === "ok" ? test.url : url)}
          onClose={() => setAddThisDevice(false)}
        />
      )}
    </>
  )

  // One tree for both bodies, so the open wizard keeps its place (and its step) when saving a
  // relay switches between them.
  return (
    <>
      <PaneTitle>Multiplayer</PaneTitle>
      {cloudRelay && cloud && cloudState ? (
        <CloudSettings
          cloud={cloud}
          state={cloudState}
          onChange={() => setWizard(true)}
          onSignedOut={async () => {
            await model.settings.setRelayUrl(null)
          }}
        />
      ) : (
        selfHost
      )}
      {wizardSheet}
      {rows}
    </>
  )
}

/** Your name · Show other cursors · Fetch images and fonts (board 41 section 4). */
function PersonalRows({
  model,
  name,
  setName,
}: {
  model: MultiplayerModel
  name: string
  setName(name: string): void
}) {
  const settings = useMultiplayerSettings(model)
  return (
    <>
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

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
