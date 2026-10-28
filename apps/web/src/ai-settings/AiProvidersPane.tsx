/**
 * Settings › AI providers (board 23 g6AqH "Settings Window · AI providers · Local agents",
 * which supersedes board 22 S1cdx; web variant board 22 BWkRR). Content (EGVxF) children, in
 * node order:
 *
 *   Title Bar (oXKjz) 56, center: Title (p6nHC) sans 14 / 600 · Spacer · Agent Status (SVobH)
 *   Intro (L56aX) sans 11 text-secondary lh 1.45
 *   Group · Local agents (j5dTH) column gap 2, padding [24, 0, 8, 0]: Title Row (qLbia) 28,
 *     gap 8, center: Title 13/600 · Subtitle 12 tertiary · Spacer · Re-check all (Ghost h 28) ·
 *     Desc (MZM7I) · Spacer 8 (ypvLL) · Precedence (Y84n9)
 *   Local · <CLI> rows (eJZeF, s6Tc2O, DkrLb)
 *   Group · Providers (rXLN6) padding [24, 0, 4, 0]: Title Row (rKyoU) · Desc (HDutC)
 *   Provider rows (AgentHostRow fRQJO instances) + the expanded Detail (cDi2t)
 *   Group · Usage & limits (tAaTK) · Usage Card (DCGkU) · Setting rows (RNTFy, VgFYb, UtSey)
 *
 * Web: no Local agents group (CLIs run only on desktop — not designed for web, hidden), the
 * detail is the BWkRR variant (Banner/Warning + Body with the Anthropic browser opt-in).
 */
import { type CliDetection, MODEL_CATALOG, type ProviderKind } from "@kimo/ai-agent"
import type { KimoPlatform } from "@kimo/platform"
import { AgentHostRow, AgentTonePill, Banner, Button, Select, SettingRow, Toggle } from "@kimo/ui"
import {
  Activity,
  ArrowRight,
  Braces,
  ChevronUp,
  Cloud,
  Copy,
  ExternalLink,
  Eye,
  Gem,
  HardDrive,
  Info,
  ListOrdered,
  Lock,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Route,
  Server,
  Sparkle,
  SquareChevronRight,
  SquareTerminal,
  Star,
  StarOff,
  Terminal,
  Trash2,
} from "lucide-react"
import { type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { ProviderRowView } from "../platform/contract"
import { useSetSetting, useSettings } from "../settings/hooks"
import { SettingsBannerContext, SettingsFailContext } from "../settings/panes"
import { AddProviderDialog } from "./AddProviderDialog"
import { CloudCards } from "./CloudCards"
import {
  type AiSettingsController,
  type AiSettingsState,
  BUILTIN_BASE_URL_NOTE,
} from "./controller"
import {
  amount,
  CLI_INSTALL_GUIDE,
  CLI_SIGN_IN,
  cliMeta,
  cliName,
  cliPill,
  cliState,
  defaultBaseURL,
  defaultProviderChoices,
  hostOf,
  isCloud,
  isConnectedRow,
  keyPlaceholder,
  keyWithheld,
  maskKey,
  modelChoices,
  money,
  OLLAMA_ID,
  originOf,
  parseAmount,
  providerMeta,
  providerPill,
  selectionForProvider,
  storageLabel,
} from "./model"
import { useAiProviders, useAiSettingsState } from "./runtime"
import { TestResult } from "./TestResult"
import "./ai-settings.css"

const PROVIDER_ICONS: Record<ProviderKind, ReactNode> = {
  anthropic: <Sparkle />,
  openai: <Braces />,
  gemini: <Gem />,
  openrouter: <Route />,
  custom: <Server />,
  bedrock: <Cloud />,
  vertex: <Cloud />,
  foundry: <Cloud />,
}

const CLI_ICONS: Record<string, ReactNode> = {
  "claude-code": <SquareTerminal />,
  codex: <Terminal />,
  "gemini-cli": <SquareChevronRight />,
}

/** Board 23 copy (L56aX), with the machine / store names of this host. */
/**
 * Audit A5: a failed action shows "Couldn't <what>." with the cause in the pane banner (board 37
 * CT1wv) instead of a silent rejection.
 */
function useReport(): (what: string, p: Promise<unknown>) => void {
  const fail = useContext(SettingsFailContext)
  return useCallback((what, p) => void p.catch((e: unknown) => fail(what, e)), [fail])
}

async function copyToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard) throw new Error("The clipboard isn't available here")
  await navigator.clipboard.writeText(text)
}

function introCopy(s: AiSettingsState): string {
  if (s.platform === "web")
    return "Bring your own API key, billed by the provider and kept in this browser. Agent CLIs need the desktop app."
  const machine = s.os === "macos" ? "this Mac" : "this computer"
  const store =
    s.os === "windows"
      ? "the Windows Credential Manager"
      : s.os === "linux"
        ? "the Secret Service"
        : "the macOS Keychain"
  return `Use a coding-agent CLI you are already signed in to, or bring your own API key. Your subscription or the provider bills the usage, not Kimo. Keys stay on ${machine}, in ${store}, and are never written to .kimo files, settings JSON or logs.`
}

export interface AiProvidersPaneProps {
  platform: KimoPlatform | null
  /** Harness/tests: an explicit controller (else the window's). */
  controller?: AiSettingsController
  /** Opens external links (install guides, key pages). Default: `platform.files.openExternalUrl`. */
  openUrl?: (url: string) => void
  /** Scrolls to this group on open (the agent's Usage card opens Settings on `usage`). */
  section?: "usage"
}

export function AiProvidersPane({ platform, controller, openUrl, section }: AiProvidersPaneProps) {
  const report = useReport()
  const banner = useContext(SettingsBannerContext)
  const fromWindow = useAiProviders(controller ? null : platform)
  const ctl = controller ?? fromWindow
  const s = useAiSettingsState(ctl)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    void ctl?.refresh()
  }, [ctl])
  const usage = useRef<HTMLDivElement>(null)
  const ready = !!ctl && !!s
  useEffect(() => {
    if (ready && section === "usage") usage.current?.scrollIntoView({ block: "start" })
  }, [ready, section])
  if (!ctl || !s) return null
  const open = (url: string) => {
    if (openUrl) openUrl(url)
    else if (platform)
      void platform.files.openExternalUrl(url).catch(() => window.open(url, "_blank"))
    else window.open(url, "_blank", "noopener")
  }
  const machine = s.os === "macos" ? "this Mac" : "this computer"
  const apiDefault = s.providers.find((p) => p.isDefault) ?? null
  const cliDefault = s.clis.find((c) => c.isDefault) ?? null
  const activeStep = cliDefault ? 1 : apiDefault ? 2 : 3

  return (
    <div className="ai-pane" data-pen="EGVxF">
      <div className="ai-title-bar" data-pen="oXKjz" data-tauri-drag-region="deep">
        <h2 className="ai-title">AI providers</h2>
        <span className="ai-spacer" />
        <AgentTonePill
          className="ai-agent-status"
          data-pen="taPqr"
          tone={s.agentStatus.tone}
          label={s.agentStatus.label}
        />
      </div>
      {banner}
      <DefaultRows s={s} ctl={ctl} />
      {platform && <WebAccessRow platform={platform} />}
      <p className="ai-intro" data-pen="L56aX">
        {introCopy(s)}
      </p>

      {s.platform === "desktop" && (
        <>
          <div className="ai-group ai-group--local" data-pen="j5dTH">
            <div className="ai-group__title-row" data-pen="qLbia">
              <h3 className="ai-group__title">Local agents</h3>
              <span className="ai-group__subtitle">uses your subscription</span>
              <span className="ai-spacer" />
              <GhostButton
                icon={<RefreshCw />}
                busy={s.checking}
                onClick={() => report("check the agent CLIs", ctl.redetectClis())}
                data-pen="euQQn"
              >
                Re-check all
              </GhostButton>
            </div>
            <p className="ai-group__desc" data-pen="MZM7I">
              Kimo drives a coding-agent CLI that is already installed and signed in on {machine},
              so turns are billed to your Claude, ChatGPT or Google plan instead of an API key. Kimo
              never sees or stores the CLI's credentials.
            </p>
            <span className="ai-spacer-8" aria-hidden="true" />
            <div className="ai-precedence" data-pen="Y84n9" data-active-step={activeStep}>
              <ListOrdered className="ai-precedence__icon" aria-hidden="true" />
              <span className="ai-precedence__key">Precedence</span>
              <span className={`ai-precedence__step${activeStep === 1 ? " is-active" : ""}`}>
                1 · Default CLI, if signed in
              </span>
              <ArrowRight className="ai-precedence__arrow" aria-hidden="true" />
              <span className={`ai-precedence__step${activeStep === 2 ? " is-active" : ""}`}>
                2 · API default
              </span>
              <ArrowRight className="ai-precedence__arrow" aria-hidden="true" />
              <span className={`ai-precedence__step${activeStep === 3 ? " is-active" : ""}`}>
                3 · Agent off
              </span>
            </div>
          </div>
          {s.clis.length === 0 && !s.detected && (
            <p className="ai-group__desc ai-checking">
              Looking for Claude Code, Codex and Gemini CLI…
            </p>
          )}
          {s.clis.map((c) => (
            <CliRow
              key={c.detection.id}
              detection={c.detection}
              isDefault={c.isDefault}
              checking={s.checking}
              home={s.home}
              onRecheck={() => report("check the agent CLIs", ctl.redetectClis())}
              onInstallGuide={() => open(CLI_INSTALL_GUIDE[c.detection.id] ?? "")}
            />
          ))}
        </>
      )}

      <div className="ai-group ai-group--providers" data-pen="rXLN6">
        <div className="ai-group__title-row" data-pen="rKyoU">
          <h3 className="ai-group__title">API providers</h3>
          <span className="ai-spacer" />
          <GhostButton icon={<Plus />} onClick={() => setAdding(true)} data-pen="A1ueIJ">
            Add provider
          </GhostButton>
        </div>
        <p className="ai-group__desc" data-pen="HDutC">
          {s.platform === "desktop"
            ? "Used when no local agent is signed in, or when a session or prompt node picks one explicitly. A model is always {provider, model}. An unknown one fails with an error and never falls back."
            : "Used by the agent in this browser, or when a session or prompt node picks one explicitly. A model is always {provider, model}. An unknown one fails with an error and never falls back."}
        </p>
      </div>
      {adding && (
        <AddProviderDialog
          ctl={ctl}
          backend={s.secretsBackend}
          os={s.os}
          onAdded={(id) => {
            setAdding(false)
            setExpanded(id)
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {s.providers.map((p) => (
        <ProviderBlock
          key={p.id}
          row={p}
          s={s}
          ctl={ctl}
          expanded={expanded === p.id}
          onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
        />
      ))}

      <div ref={usage} className="ai-group ai-group--usage" data-pen="tAaTK" id="settings-usage">
        <div className="ai-group__title-row ai-group__title-row--usage" data-pen="T7x0M">
          <h3 className="ai-group__title">Usage &amp; limits</h3>
          <span className="ai-spacer" />
          <span className="ai-usage__period">{s.usage.period}</span>
        </div>
        <p className="ai-group__desc" data-pen="E8Erp5">
          Estimated from each response's token usage × the provider's published price. Your
          provider's invoice is the source of truth.
        </p>
      </div>
      <UsageCard s={s} />
      <SettingRow
        data-pen="RNTFy"
        label="Monthly limit"
        description="When reached the agent finishes the current op batch, then stops and asks. 0 = no limit."
        control={(ids) => (
          <AmountField
            value={s.settings.monthlyLimitUsd}
            labelledBy={ids.labelId}
            onCommit={(v) =>
              report("save the usage settings", ctl.setUsageSettings({ monthlyLimitUsd: v }))
            }
          />
        )}
      />
      <SettingRow
        data-pen="VgFYb"
        label="Warn per turn above"
        description="Ask before a single turn is expected to cost more than this (side by side × N counts as one turn)."
        control={(ids) => (
          <AmountField
            value={s.settings.warnPerTurnUsd}
            labelledBy={ids.labelId}
            onCommit={(v) =>
              report("save the usage settings", ctl.setUsageSettings({ warnPerTurnUsd: v }))
            }
          />
        )}
      />
      <SettingRow
        data-pen="UtSey"
        label="Show cost in the agent panel"
        description="Per message tokens and cost, and the session total in the thread header."
        control={(ids) => (
          <Toggle
            checked={s.settings.showCost}
            aria-labelledby={ids.labelId}
            aria-describedby={ids.descriptionId}
            onChange={(v) =>
              report("save the usage settings", ctl.setUsageSettings({ showCost: v }))
            }
          />
        )}
      />
    </div>
  )
}

// --- Default provider / model (board 27 §10 (a) q2UAb) -------------------------------------------

/**
 * Setting · Default provider (AseJa) + Setting · Default model (WmFb2): SettingRow (MuoTX)
 * instances whose Control holds a 180 × 28 Select (gP276 look). Only connected providers are
 * listed; none → disabled "Connect a provider first". The model list is that provider's.
 */
function DefaultRows({ s, ctl }: { s: AiSettingsState; ctl: AiSettingsController }) {
  const report = useReport()
  const choices = defaultProviderChoices({
    platform: s.platform,
    providers: s.providers,
    clis: s.clis,
    selection: s.defaultSelection,
  })
  const sel = s.defaultSelection
  const current = choices.find((c) => c.provider === sel?.provider) ?? null
  const none = choices.length === 0
  return (
    <>
      <SettingRow
        data-pen="AseJa"
        className="ai-default-row"
        label="Default provider"
        description="New agent sessions start here. Only connected providers are listed."
        control={
          <Select
            className="ai-default-select"
            data-testid="ai-default-provider"
            label="Default provider"
            disabled={none}
            placeholder={none ? "Connect a provider first" : "Choose…"}
            options={choices.map((c) => ({ value: c.provider, label: c.label }))}
            value={current?.provider ?? null}
            onChange={(v) =>
              report("change the default model", ctl.setDefault(selectionForProvider(choices, v)))
            }
          />
        }
      />
      <SettingRow
        data-pen="WmFb2"
        className="ai-default-row"
        label="Default model"
        description="Fast model is used for titles and summaries."
        control={
          <Select
            className="ai-default-select"
            data-testid="ai-default-model"
            label="Default model"
            disabled={!current}
            placeholder={none ? "Connect a provider first" : "Choose…"}
            options={current?.models ?? []}
            value={current ? (sel?.model ?? current.model) : null}
            onChange={(v) => {
              if (current)
                report(
                  "change the default model",
                  ctl.setDefault({ provider: current.provider, model: v }),
                )
            }}
          />
        }
      />
    </>
  )
}

// --- Allow web access (board 38 §1) ---------------------------------------------------------------

/**
 * Setting · Allow web access: SettingRow (MuoTX) right after Default model, Toggle in the
 * Control slot. Board 38 B: while No third-party fetch is on the row is dimmed 0.45 with the
 * toggle off and disabled, and the description names the reason.
 */
function WebAccessRow({ platform }: { platform: KimoPlatform }) {
  const fail = useContext(SettingsFailContext)
  const settings = useSettings(platform.settings)
  const set = useSetSetting(platform.settings, (e) => fail("save Allow web access", e))
  const blocked = settings["privacy.noThirdPartyFetch"]
  return (
    <SettingRow
      className="ai-web-row"
      data-testid="ai-web-access"
      label="Allow web access"
      description={
        blocked
          ? "Off while No third-party fetch is on in Settings › Fonts & privacy."
          : "Lets the agent search and read the web for outside facts, shown in the thread. New sessions use this setting."
      }
      dimmed={blocked}
      control={(ids) => (
        <Toggle
          checked={!blocked && settings["ai.webAccess"]}
          disabled={blocked}
          aria-labelledby={ids.labelId}
          aria-describedby={ids.descriptionId}
          onChange={(v) => void set("ai.webAccess", v)}
        />
      )}
    />
  )
}

/**
 * Provider row first action (LLVpP / DdxQS › Copy config lxvvC): h 28, padding [0, 12], gap 6,
 * radius-pill, no fill. Default: star 14 + label text-primary; Make default: star-off 14
 * text-tertiary + label text-secondary.
 */
function DefaultAction({ isDefault, onMake }: { isDefault: boolean; onMake: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`ai-button ai-button--ghost ai-default-action${isDefault ? " is-default" : ""}`}
      icon={isDefault ? <Star /> : <StarOff />}
      aria-pressed={isDefault}
      data-testid="ai-default-action"
      onClick={() => {
        if (!isDefault) onMake()
      }}
    >
      {isDefault ? "Default" : "Make default"}
    </Button>
  )
}

// --- Leaves ---------------------------------------------------------------------------------------

/** Button/Ghost instances on board 23: h 28, padding [0, 12], icon 14, label 12 text-primary. */
function GhostButton({
  icon,
  busy = false,
  children,
  onClick,
  disabled,
  ...rest
}: {
  icon?: ReactNode
  busy?: boolean
  children: string
  onClick: () => void
  disabled?: boolean
  "data-pen"?: string
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`ai-button ai-button--ghost${busy ? " is-busy" : ""}`}
      icon={icon}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
      {...rest}
    >
      {children}
    </Button>
  )
}

/** Button/Secondary instances ("Edit", "Add key", "Set up"): h 28, padding [0, 12], label 12. */
function SecondaryButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: string
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="ai-button"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** IconButton instances in the key field (u7omGi …): 22 × 22, transparent, icon 13 tertiary. */
function FieldIcon({
  label,
  icon,
  onClick,
  disabled,
  title,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      className="ai-field-icon"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  )
}

/** Status pill with free label (StatusPill SVobH overrides). */
const Pill = AgentTonePill

// --- Local agents ---------------------------------------------------------------------------------

function CliRow({
  detection: d,
  isDefault,
  checking,
  home,
  onRecheck,
  onInstallGuide,
}: {
  detection: CliDetection
  isDefault: boolean
  checking: boolean
  home: string | null
  onRecheck: () => void
  onInstallGuide: () => void
}) {
  const report = useReport()
  const [copied, setCopied] = useState(false)
  const state = cliState(d)
  const pill = cliPill(d)
  const command = CLI_SIGN_IN[d.id] ?? d.id
  const binary =
    d.path
      ?.split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/, "") ?? d.id
  return (
    <div className="ai-cli-row" data-cli={d.id} data-state={state}>
      <span className="ai-cli-row__tile">
        <span className="ai-cli-row__icon" aria-hidden="true">
          {CLI_ICONS[d.id] ?? <Terminal />}
        </span>
      </span>
      <span className="ai-cli-row__text">
        <span className="ai-cli-row__name-row">
          <span className="ai-cli-row__name">{cliName(d)}</span>
          <Pill tone={pill.tone} label={pill.label} />
          {isDefault && (
            <span className="ai-default-badge" data-pen="dPHWu">
              <span className="ai-default-badge__label">Default</span>
            </span>
          )}
        </span>
        <span className="ai-cli-row__meta">{cliMeta(d, binary, home)}</span>
        {(state === "not-signed-in" || state === "unknown") && (
          <span className="ai-cli-row__hint" data-pen="kERUT">
            <Info className="ai-cli-row__hint-icon" aria-hidden="true" />
            <span className="ai-cli-row__hint-text">{`Sign in in terminal: run “${command}”`}</span>
          </span>
        )}
      </span>
      <span className="ai-cli-row__actions">
        {(state === "not-signed-in" || state === "unknown") && (
          <GhostButton
            icon={<Copy />}
            onClick={() => {
              report("copy the command", copyToClipboard(command))
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? "Copied" : "Copy command"}
          </GhostButton>
        )}
        {state === "not-found" ? (
          <GhostButton icon={<ExternalLink />} onClick={onInstallGuide}>
            Install guide
          </GhostButton>
        ) : (
          <GhostButton icon={<RefreshCw />} busy={checking} onClick={onRecheck}>
            Re-check
          </GhostButton>
        )}
      </span>
    </div>
  )
}

// --- API providers --------------------------------------------------------------------------------

function ProviderBlock({
  row,
  s,
  ctl,
  expanded,
  onToggle,
}: {
  row: ProviderRowView
  s: AiSettingsState
  ctl: AiSettingsController
  expanded: boolean
  onToggle: () => void
}) {
  const report = useReport()
  const cloud = isCloud(row.kind)
  const webCloud = cloud && s.platform === "web"
  const failed = row.lastTest && !row.lastTest.ok && row.status === "key-saved"
  // Board 25 rule "Add provider": a failing first Test leaves it "Not verified".
  const unverified = ctl.storedOf(row.id)?.unverified === true && row.status !== "connected"
  const pill = providerPill(unverified ? "unverified" : failed ? "failed" : row.status)
  const isApiDefault =
    row.isDefault || (row.id === "anthropic" && !s.providers.some((p) => p.isDefault))
  const meta = providerMeta(
    {
      id: row.id,
      kind: row.kind,
      label: row.label,
      models: row.models,
      ...(row.baseURL ? { baseURL: row.baseURL } : {}),
    },
    { isApiDefault: row.kind === "anthropic" && isApiDefault },
  )
  const testing = s.testing[row.id] === true
  let actions: ReactNode
  if (expanded)
    actions = (
      <GhostButton icon={<ChevronUp />} onClick={onToggle}>
        Collapse
      </GhostButton>
    )
  else if (cloud)
    actions = (
      <SecondaryButton
        onClick={onToggle}
        disabled={webCloud}
        {...(webCloud ? { title: "Signed credentials need the desktop app" } : {})}
      >
        Set up
      </SecondaryButton>
    )
  else if (row.status === "not-set")
    actions = (
      <SecondaryButton onClick={onToggle}>
        {row.kind === "custom" ? "Set up" : "Add key"}
      </SecondaryButton>
    )
  else
    actions = (
      <>
        {isConnectedRow(row.status) && (
          <DefaultAction
            isDefault={row.isDefault}
            onMake={() =>
              report(
                "change the default model",
                ctl.setDefault({ provider: row.id, model: row.models.agent }),
              )
            }
          />
        )}
        <GhostButton
          icon={<Activity />}
          busy={testing}
          onClick={() => report("test the provider", ctl.test(row.id))}
        >
          Test
        </GhostButton>
        <SecondaryButton onClick={onToggle}>Edit</SecondaryButton>
      </>
    )
  return (
    <>
      <AgentHostRow
        className={`ai-provider-row ai-provider-row--${row.kind}${row.isDefault ? " is-default" : ""}`}
        data-provider={row.id}
        data-status={row.status}
        icon={PROVIDER_ICONS[row.kind]}
        name={row.label}
        status={pill}
        path={meta}
        actions={actions}
      />
      {expanded && <ProviderDetail row={row} s={s} ctl={ctl} onRemoved={onToggle} />}
    </>
  )
}

function ProviderDetail({
  row,
  s,
  ctl,
  onRemoved,
}: {
  row: ProviderRowView
  s: AiSettingsState
  ctl: AiSettingsController
  onRemoved: () => void
}) {
  const report = useReport()
  const web = s.platform === "web"
  const cloud = isCloud(row.kind)
  const keyless =
    row.kind === "custom" ? row.status === "local" || row.id === "custom:ollama" : cloud
  const [bannerHidden, setBannerHidden] = useState(false)
  const stored = ctl.storedOf(row.id)
  const t = row.lastTest ? ctl.testOf(row.id) : undefined
  // Board 25: the offending field gets a danger stroke; a withheld key asks to be re-entered.
  const withheld = stored ? keyWithheld(stored) : false
  const keyDanger = withheld || (t !== undefined && !t.ok && t.errorKind === "auth")
  const urlDanger =
    t !== undefined && !t.ok && (t.errorKind === "network" || t.errorKind === "timeout")
  const open = MODEL_CATALOG[isCloud(row.kind) ? "anthropic" : row.kind].length === 0
  const result = t && (
    <TestResult
      test={t}
      retrying={s.testing[row.id] === true}
      onRetry={() => report("test the provider", ctl.test(row.id))}
    />
  )
  // Board 25 gpmey: the cloud row expands one detail card per cloud (no key field).
  if (cloud)
    return (
      <div className="ai-clouds" data-pen="HPWcv" data-provider={row.id}>
        <CloudCards ctl={ctl} readOnly={web} />
        {result}
      </div>
    )
  const fields = (
    <>
      {!keyless && <KeyField row={row} s={s} ctl={ctl} danger={keyDanger} withheld={withheld} />}
      {web && row.kind === "anthropic" && (
        <div className="ai-optin" data-pen="N0dsja">
          <Toggle
            checked={row.allowBrowser === true}
            aria-labelledby={`optin-${row.id}`}
            onChange={(v) => report("change browser access", ctl.setAllowBrowser(row.id, v))}
          />
          <span className="ai-optin__text">
            <span className="ai-optin__label" id={`optin-${row.id}`}>
              Allow Anthropic calls from the browser
            </span>
            <span className="ai-optin__desc">
              Required by Anthropic for direct browser access. Off = the agent is unavailable on web
              for this provider.
            </span>
          </span>
        </div>
      )}
      <BaseUrlField row={row} ctl={ctl} danger={urlDanger} />
      <div className="ai-field ai-field--models" data-pen="GESY1">
        <span className="ai-field__label">Models</span>
        {(["agent", "fast"] as const).map((role) => (
          <span key={role} className="ai-model" data-role={role}>
            <span className="ai-model__role">{role === "agent" ? "Agent" : "Fast"}</span>
            {open ? (
              <input
                className="ai-value-input ai-model__input"
                aria-label={`${role === "agent" ? "Agent" : "Fast"} model id`}
                placeholder={role === "agent" ? "model id" : "fast model id"}
                defaultValue={row.models[role]}
                spellCheck={false}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim()
                  if (v !== row.models[role])
                    report("change the models", ctl.setModels(row.id, { ...row.models, [role]: v }))
                }}
              />
            ) : (
              <Select
                className="ai-select"
                label={`${role === "agent" ? "Agent" : "Fast"} model`}
                options={modelChoices(row.kind, [row.models.agent, row.models.fast])}
                value={row.models[role]}
                onChange={(v) =>
                  report("change the models", ctl.setModels(row.id, { ...row.models, [role]: v }))
                }
              />
            )}
          </span>
        ))}
      </div>
      <div className="ai-storage" data-pen={web ? "eXP8m" : "z9hHLf"}>
        {web ? (
          <HardDrive className="ai-storage__icon" aria-hidden="true" />
        ) : (
          <Lock className="ai-storage__icon" aria-hidden="true" />
        )}
        <span className="ai-storage__label">
          {keyless
            ? "No key · requests go straight to this endpoint"
            : storageLabel(row.id, s.secretsBackend, s.os)}
        </span>
      </div>
      {result}
      {row.id.startsWith("custom:") && row.id !== "custom:ollama" && (
        <div className="ai-detail__footer">
          <GhostButton
            icon={<Trash2 />}
            onClick={() => {
              report("remove the provider", ctl.removeProvider(row.id))
              onRemoved()
            }}
          >
            Remove endpoint
          </GhostButton>
        </div>
      )}
    </>
  )
  if (!web)
    return (
      <div className="ai-detail" data-pen="cDi2t" data-provider={row.id}>
        {fields}
      </div>
    )
  return (
    <div className="ai-detail ai-detail--web" data-pen="BWkRR" data-provider={row.id}>
      {!bannerHidden && !keyless && (
        <Banner
          className="ai-detail__banner"
          tone="warning"
          title="Stored in this browser only"
          body="Not synced or encrypted at rest. Anyone with this browser profile can read it; the desktop app uses the Keychain."
          onDismiss={() => setBannerHidden(true)}
        />
      )}
      <div className="ai-detail__body" data-pen="Fkjob">
        {fields}
      </div>
    </div>
  )
}

function KeyField({
  row,
  s,
  ctl,
  danger = false,
  withheld = false,
}: {
  row: ProviderRowView
  s: AiSettingsState
  ctl: AiSettingsController
  danger?: boolean
  withheld?: boolean
}) {
  const report = useReport()
  const [editing, setEditing] = useState(row.keyHint === null)
  const [draft, setDraft] = useState("")
  const [revealed, setRevealed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (row.keyHint === null) setEditing(true)
  }, [row.keyHint])
  useEffect(() => {
    if (!revealed) return
    // Reveal holds for 5 s (board 22 "Key entry").
    const t = setTimeout(() => setRevealed(null), 5000)
    return () => clearTimeout(t)
  }, [revealed])
  const save = async (value: string) => {
    if (!value.trim()) return
    setBusy(true)
    setError(null)
    try {
      await ctl.setKey(row.id, value)
      setDraft("")
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const desktop = s.platform === "desktop"
  return (
    <div className="ai-field" data-pen={desktop ? "vfqoC" : "E0Zog5"}>
      <label className="ai-field__label" htmlFor={`key-${row.id}`}>
        API key
      </label>
      <span
        className={`ai-value-field${editing ? " is-editing" : ""}${danger && !editing ? " is-danger" : ""}`}
        data-pen="purB3"
      >
        {editing ? (
          <input
            ref={input}
            id={`key-${row.id}`}
            className="ai-value-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={keyPlaceholder(row)}
            value={draft}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onPaste={(e) => {
              // Paste → auto Test (board 22 "Key entry").
              const text = e.clipboardData.getData("text")
              if (text.trim()) {
                e.preventDefault()
                setDraft(text.trim())
                void save(text)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save(draft)
              if (e.key === "Escape" && row.keyHint !== null) {
                setDraft("")
                setEditing(false)
              }
            }}
          />
        ) : (
          <span className="ai-value" id={`key-${row.id}`}>
            {revealed ?? maskKey(row.kind, row.keyHint ?? "", s.platform)}
          </span>
        )}
        {!editing && <span className="ai-spacer" />}
        {!editing && withheld && (
          <button
            type="button"
            className="ai-test__action ai-reenter"
            onClick={() => {
              setEditing(true)
              setTimeout(() => input.current?.focus(), 0)
            }}
          >
            Re-enter key
          </button>
        )}
        {!editing && (
          <>
            <FieldIcon
              label="Reveal key"
              icon={<Eye />}
              disabled={desktop}
              title={desktop ? "Keys never leave the keychain" : "Reveal for 5 s"}
              onClick={() => report("show the key", ctl.revealKey(row.id).then(setRevealed))}
            />
            <FieldIcon
              label="Replace key"
              icon={<Pencil />}
              onClick={() => {
                setEditing(true)
                setTimeout(() => input.current?.focus(), 0)
              }}
            />
            <FieldIcon
              label="Remove key"
              icon={<Trash2 />}
              onClick={() => report("delete the key", ctl.deleteKey(row.id))}
            />
          </>
        )}
      </span>
      {error && <span className="ai-field__error">{error}</span>}
    </div>
  )
}

function BaseUrlField({
  row,
  ctl,
  danger = false,
}: {
  row: ProviderRowView
  ctl: AiSettingsController
  danger?: boolean
}) {
  const report = useReport()
  const def = defaultBaseURL(row)
  // Built-in providers only call their own API (the relay never sends their key elsewhere):
  // the field shows the default, read-only (board 23 tAma7 "https://api.anthropic.com (default)").
  if (row.kind !== "custom")
    return (
      <div className="ai-field" data-pen="sogTB">
        <span className="ai-field__label">Base URL</span>
        <span
          className="ai-value-field ai-value-field--url"
          data-pen="RrLvC"
          title={BUILTIN_BASE_URL_NOTE}
        >
          <span className="ai-value">{`${def}  (default)`}</span>
          <span className="ai-spacer" />
        </span>
      </div>
    )
  return (
    <>
      <div className="ai-field" data-pen="sogTB">
        <label className="ai-field__label" htmlFor={`url-${row.id}`}>
          Base URL
        </label>
        <span
          className={`ai-value-field ai-value-field--url${danger ? " is-danger" : ""}`}
          data-pen="RrLvC"
        >
          <input
            id={`url-${row.id}`}
            key={row.baseURL}
            className="ai-value-input ai-value-input--url"
            placeholder={def ? `${def}  (default)` : "https://…"}
            defaultValue={row.baseURL && row.baseURL !== def ? row.baseURL : ""}
            spellCheck={false}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim()
              if (v !== (row.baseURL && row.baseURL !== def ? row.baseURL : ""))
                report("save the base URL", ctl.setBaseURL(row.id, v || null))
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
            }}
          />
        </span>
      </div>
      {row.status !== "local" && row.id !== OLLAMA_ID && (
        // Board 25 Origin Pin Note (W2ERTF), with the row's pinned (or current) host.
        <div className="ai-add__pin" data-pen="W2ERTF">
          <Pin className="ai-add__pin-icon" aria-hidden="true" />
          <p className="ai-add__pin-text">
            This key is pinned to the first origin it's sent to:{" "}
            {hostOf(ctl.storedOf(row.id)?.pinnedOrigin ?? originOf(row.baseURL) ?? "this endpoint")}
            . If the base URL later points at another host, Kimo withholds the key until you
            re-enter it.
          </p>
        </div>
      )}
    </>
  )
}

// --- Usage ---------------------------------------------------------------------------------------

const DOT_FILLS = [
  "var(--kimo-text-primary)",
  "var(--kimo-text-tertiary)",
  "var(--kimo-border-strong)",
]

function UsageCard({ s }: { s: AiSettingsState }) {
  const u = s.usage
  const limit = s.settings.monthlyLimitUsd
  const scale = limit > 0 ? limit : Math.max(u.costUsd, 0)
  const paid = u.byProvider.filter((p) => (p.costUsd ?? 0) > 0)
  return (
    <div className="ai-usage" data-pen="DCGkU">
      <div className="ai-usage__top" data-pen="nvLT2">
        <span className="ai-usage__spent">{money(u.costUsd)}</span>
        <span className="ai-usage__of">
          {limit > 0 ? `of ${money(limit)} monthly limit` : "no monthly limit"}
        </span>
        <span className="ai-spacer" />
        <span className="ai-usage__tokens">
          {formatTokensLong(u.tokens)} · {u.sessions} session{u.sessions === 1 ? "" : "s"}
        </span>
      </div>
      <div className="ai-usage__meter" data-pen="GIpCW" aria-hidden="true">
        {scale > 0 &&
          paid.map((p, i) => (
            <span
              key={p.provider}
              className="ai-usage__segment"
              style={{
                width: `${Math.min(100, ((p.costUsd ?? 0) / scale) * 100)}%`,
                background: DOT_FILLS[Math.min(i, 2)],
              }}
            />
          ))}
      </div>
      {u.byProvider.length > 0 && (
        <div className="ai-usage__breakdown" data-pen="b8OQv">
          {u.byProvider.map((p, i) => (
            <span key={p.provider} className="ai-usage__item" data-provider={p.provider}>
              <span
                className="ai-usage__dot"
                style={{ background: DOT_FILLS[Math.min(i, 2)] }}
                aria-hidden="true"
              />
              <span className="ai-usage__name">{p.label}</span>
              <span className="ai-usage__value">
                {p.billing === "subscription"
                  ? `${formatTokensLong(p.tokens)} · subscription`
                  : p.billing === "local"
                    ? `${money(p.costUsd ?? 0)} · local`
                    : p.costUsd === null
                      ? "—"
                      : money(p.costUsd)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** "2.31M tokens" (board 23 ON3Kl). */
function formatTokensLong(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M tokens`
  if (n >= 10_000) return `${Math.round(n / 1000)}k tokens`
  return `${n} tokens`
}

/** Amount Field (pdL0w): 96 × 28, gap 4, padding [0, 8], bg-app, stroke 1 border, radius-sm. */
function AmountField({
  value,
  labelledBy,
  onCommit,
}: {
  value: number
  labelledBy: string
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(amount(value))
  useEffect(() => setDraft(amount(value)), [value])
  const commit = () => {
    const v = parseAmount(draft)
    if (v === null) setDraft(amount(value))
    else if (v !== value) onCommit(v)
    else setDraft(amount(value))
  }
  return (
    <span className="ai-amount" data-pen="pdL0w">
      <span className="ai-amount__prefix" aria-hidden="true">
        $
      </span>
      <input
        className="ai-amount__value"
        inputMode="decimal"
        aria-labelledby={labelledBy}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
      />
    </span>
  )
}
