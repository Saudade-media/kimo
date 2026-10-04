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
import {
  BROWSER_SUPPORT,
  type CliDetection,
  MODEL_CATALOG,
  type ProviderKind,
} from "@kimo/ai-agent"
import type { KimoPlatform } from "@kimo/platform"
import { AgentHostRow, AgentTonePill, Banner, Button, Select, SettingRow, Toggle } from "@kimo/ui"
import {
  Activity,
  ArrowRight,
  Braces,
  ChevronUp,
  CircleCheck,
  CircleX,
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
  Plus,
  RefreshCw,
  Route,
  Server,
  Sparkle,
  SquareChevronRight,
  SquareTerminal,
  Terminal,
  Trash2,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { ProviderRowView } from "../platform/contract"
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
  isCloud,
  keyPlaceholder,
  maskKey,
  money,
  OLLAMA_ID,
  parseAmount,
  providerMeta,
  providerPill,
  storageLabel,
  testDetail,
  testLabel,
} from "./model"
import { useAiProviders, useAiSettingsState } from "./runtime"
import "./ai-settings.css"

/** Not designed (relay rule): a custom endpoint's key is pinned to the first origin it reaches. */
const CUSTOM_KEY_PIN_NOTE =
  "Its key is pinned to the first origin it is sent to; saving or deleting the key clears the pin."

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
function introCopy(s: AiSettingsState): string {
  if (s.platform === "web")
    return "Bring your own API key — usage is billed by the provider, never by Kimo. Keys stay in this browser (localStorage, this origin only); they are never written to .kimo files, settings JSON or logs. Local agent CLIs run in the desktop app."
  const machine = s.os === "macos" ? "this Mac" : "this computer"
  const store =
    s.os === "windows"
      ? "the Windows Credential Manager"
      : s.os === "linux"
        ? "the Secret Service"
        : "the macOS Keychain"
  return `Use a coding-agent CLI you are already signed in to, or bring your own API key — usage is billed by your subscription or by the provider, never by Kimo. Keys stay on ${machine}, in ${store}; they are never written to .kimo files, settings JSON or logs.`
}

export interface AiProvidersPaneProps {
  platform: KimoPlatform | null
  /** Harness/tests: an explicit controller (else the window's). */
  controller?: AiSettingsController
  /** Opens external links (install guides, key pages). Default: `platform.files.openExternalUrl`. */
  openUrl?: (url: string) => void
}

export function AiProvidersPane({ platform, controller, openUrl }: AiProvidersPaneProps) {
  const fromWindow = useAiProviders(controller ? null : platform)
  const ctl = controller ?? fromWindow
  const s = useAiSettingsState(ctl)
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => {
    void ctl?.refresh()
  }, [ctl])
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
      <div className="ai-title-bar" data-pen="oXKjz">
        <h2 className="ai-title">AI providers</h2>
        <span className="ai-spacer" />
        <AgentTonePill
          className="ai-agent-status"
          data-pen="taPqr"
          tone={s.agentStatus.tone}
          label={s.agentStatus.label}
        />
      </div>
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
                onClick={() => void ctl.redetectClis()}
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
              onRecheck={() => void ctl.redetectClis()}
              onInstallGuide={() => open(CLI_INSTALL_GUIDE[c.detection.id] ?? "")}
            />
          ))}
        </>
      )}

      <div className="ai-group ai-group--providers" data-pen="rXLN6">
        <div className="ai-group__title-row" data-pen="rKyoU">
          <h3 className="ai-group__title">API providers</h3>
          <span className="ai-spacer" />
          <GhostButton
            icon={<Plus />}
            onClick={() => setExpanded(expanded === "+custom" ? null : "+custom")}
            data-pen="A1ueIJ"
          >
            Add provider
          </GhostButton>
        </div>
        <p className="ai-group__desc" data-pen="HDutC">
          {s.platform === "desktop"
            ? "Used when no local agent is signed in, or when a session or prompt node picks one explicitly. A model is always {provider, model} — an unknown one fails loudly, never falls back."
            : "Used by the agent in this browser, or when a session or prompt node picks one explicitly. A model is always {provider, model} — an unknown one fails loudly, never falls back."}
        </p>
      </div>
      {expanded === "+custom" && (
        <AddCustomCard
          ctl={ctl}
          onDone={(id) => setExpanded(id)}
          onCancel={() => setExpanded(null)}
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

      <div className="ai-group ai-group--usage" data-pen="tAaTK">
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
            onCommit={(v) => void ctl.setUsageSettings({ monthlyLimitUsd: v })}
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
            onCommit={(v) => void ctl.setUsageSettings({ warnPerTurnUsd: v })}
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
            onChange={(v) => void ctl.setUsageSettings({ showCost: v })}
          />
        )}
      />
    </div>
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
              void navigator.clipboard?.writeText(command).catch(() => {})
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
  const cloud = isCloud(row.kind)
  const webCloud = cloud && s.platform === "web"
  const failed = row.lastTest && !row.lastTest.ok && row.status === "key-saved"
  const pill = providerPill(failed ? "failed" : row.status)
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
        <GhostButton icon={<Activity />} busy={testing} onClick={() => void ctl.test(row.id)}>
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

function modelOptions(kind: ProviderKind, current: string[]) {
  const catalog = MODEL_CATALOG[isCloud(kind) ? "anthropic" : kind]
  const seen = new Set<string>()
  const out: { value: string; label: string }[] = []
  for (const m of catalog) {
    // Dated snapshots and their aliases share a label: keep the first id per label.
    if (seen.has(m.label)) continue
    seen.add(m.label)
    out.push({ value: m.id, label: m.label })
  }
  for (const c of current)
    if (c && !out.some((o) => o.value === c)) out.push({ value: c, label: c })
  return out
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
  const web = s.platform === "web"
  const cloud = isCloud(row.kind)
  const keyless =
    row.kind === "custom" ? row.status === "local" || row.id === "custom:ollama" : cloud
  const [bannerHidden, setBannerHidden] = useState(false)
  const t = row.lastTest
  const cors = t && !t.ok && t.error?.kind === "cors"
  const how = BROWSER_SUPPORT.find((r) => r.kind === row.kind)?.how
  const open = MODEL_CATALOG[isCloud(row.kind) ? "anthropic" : row.kind].length === 0
  const fields = (
    <>
      {!keyless && <KeyField row={row} s={s} ctl={ctl} />}
      {web && row.kind === "anthropic" && (
        <div className="ai-optin" data-pen="N0dsja">
          <Toggle
            checked={row.allowBrowser === true}
            aria-labelledby={`optin-${row.id}`}
            onChange={(v) => void ctl.setAllowBrowser(row.id, v)}
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
      {cloud ? <CloudFields row={row} ctl={ctl} /> : <BaseUrlField row={row} ctl={ctl} />}
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
                    void ctl.setModels(row.id, { ...row.models, [role]: v })
                }}
              />
            ) : (
              <Select
                className="ai-select"
                label={`${role === "agent" ? "Agent" : "Fast"} model`}
                options={modelOptions(row.kind, [row.models.agent, row.models.fast])}
                value={row.models[role]}
                onChange={(v) => void ctl.setModels(row.id, { ...row.models, [role]: v })}
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
          {cloud
            ? "Credentials from your cloud login · signed in Rust, never in JS"
            : keyless
              ? "No key · requests go straight to this endpoint"
              : storageLabel(row.id, s.secretsBackend, s.os)}
        </span>
      </div>
      {t && (
        <div
          className={`ai-test ai-test--${t.ok ? "ok" : "fail"}`}
          data-pen="TUwHz"
          role={t.ok ? "status" : "alert"}
        >
          {t.ok ? (
            <CircleCheck className="ai-test__icon" aria-hidden="true" />
          ) : (
            <CircleX className="ai-test__icon" aria-hidden="true" />
          )}
          <span className="ai-test__label">
            {testLabel({ ok: t.ok, ...(t.error ? { errorKind: t.error.kind } : {}) })}
          </span>
          <span className="ai-test__detail">
            {testDetail(t)}
            {cors && how ? ` · ${how}` : ""}
          </span>
        </div>
      )}
      {row.id.startsWith("custom:") && row.id !== "custom:ollama" && (
        <div className="ai-detail__footer">
          <GhostButton
            icon={<Trash2 />}
            onClick={() => {
              void ctl.removeProvider(row.id)
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
          body="Not synced, not encrypted at rest. Anyone with access to this browser profile can read it. Use the desktop app for Keychain storage."
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
}: {
  row: ProviderRowView
  s: AiSettingsState
  ctl: AiSettingsController
}) {
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
      <span className={`ai-value-field${editing ? " is-editing" : ""}`} data-pen="purB3">
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
        {!editing && (
          <>
            <FieldIcon
              label="Reveal key"
              icon={<Eye />}
              disabled={desktop}
              title={desktop ? "Keys never leave the keychain" : "Reveal for 5 s"}
              onClick={() => void ctl.revealKey(row.id).then(setRevealed)}
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
              onClick={() => void ctl.deleteKey(row.id)}
            />
          </>
        )}
      </span>
      {error && <span className="ai-field__error">{error}</span>}
    </div>
  )
}

function BaseUrlField({ row, ctl }: { row: ProviderRowView; ctl: AiSettingsController }) {
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
        <span className="ai-value-field ai-value-field--url" data-pen="RrLvC">
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
                void ctl.setBaseURL(row.id, v || null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
            }}
          />
        </span>
      </div>
      {row.status !== "local" && row.id !== OLLAMA_ID && (
        <p className="ai-field__note">{CUSTOM_KEY_PIN_NOTE}</p>
      )}
    </>
  )
}

/** Not designed: the cloud row's Set up fields (platform, region, project). */
function CloudFields({ row, ctl }: { row: ProviderRowView; ctl: AiSettingsController }) {
  const kind = row.kind as "bedrock" | "vertex" | "foundry"
  const [region, setRegion] = useState("")
  const [project, setProject] = useState("")
  return (
    <>
      <div className="ai-field">
        <span className="ai-field__label">Platform</span>
        <span className="ai-model ai-model--wide">
          <Select
            className="ai-select"
            label="Cloud platform"
            options={[
              { value: "bedrock", label: "Amazon Bedrock" },
              { value: "vertex", label: "Google Vertex AI" },
              { value: "foundry", label: "Microsoft Foundry" },
            ]}
            value={kind}
            onChange={(v) => void ctl.setCloud(v as typeof kind, { region, project })}
          />
        </span>
      </div>
      {kind !== "foundry" && (
        <div className="ai-field">
          <label className="ai-field__label" htmlFor="cloud-region">
            Region
          </label>
          <span className="ai-value-field">
            <input
              id="cloud-region"
              className="ai-value-input"
              placeholder={kind === "vertex" ? "us-east5" : "us-east-1"}
              value={region}
              onChange={(e) => setRegion(e.currentTarget.value)}
              onBlur={() => void ctl.setCloud(kind, { region, project })}
            />
          </span>
        </div>
      )}
      {kind === "vertex" && (
        <div className="ai-field">
          <label className="ai-field__label" htmlFor="cloud-project">
            Project
          </label>
          <span className="ai-value-field">
            <input
              id="cloud-project"
              className="ai-value-input"
              placeholder="my-gcp-project"
              value={project}
              onChange={(e) => setProject(e.currentTarget.value)}
              onBlur={() => void ctl.setCloud(kind, { region, project })}
            />
          </span>
        </div>
      )}
    </>
  )
}

/** Not designed: "Add provider" → a custom OpenAI- / Anthropic-compatible endpoint. */
function AddCustomCard({
  ctl,
  onDone,
  onCancel,
}: {
  ctl: AiSettingsController
  onDone: (id: string) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState("")
  const [baseURL, setBaseURL] = useState("")
  const [wire, setWire] = useState<"openai-chat" | "openai-responses" | "anthropic">("openai-chat")
  const [agent, setAgent] = useState("")
  const [fast, setFast] = useState("")
  const [free, setFree] = useState(false)
  const ok = label.trim() && /^https?:\/\//.test(baseURL.trim()) && agent.trim()
  const text = (id: string, name: string, v: string, set: (v: string) => void, ph: string) => (
    <div className="ai-field">
      <label className="ai-field__label" htmlFor={id}>
        {name}
      </label>
      <span className="ai-value-field">
        <input
          id={id}
          className="ai-value-input"
          placeholder={ph}
          value={v}
          spellCheck={false}
          onChange={(e) => set(e.currentTarget.value)}
        />
      </span>
    </div>
  )
  return (
    <div className="ai-detail ai-detail--add" data-provider="+custom">
      {text("custom-label", "Name", label, setLabel, "LM Studio")}
      {text("custom-url", "Base URL", baseURL, setBaseURL, "http://localhost:1234/v1")}
      <div className="ai-field">
        <span className="ai-field__label">Format</span>
        <span className="ai-model ai-model--wide">
          <Select
            className="ai-select"
            label="Wire format"
            options={[
              { value: "openai-chat", label: "OpenAI Chat Completions" },
              { value: "openai-responses", label: "OpenAI Responses" },
              { value: "anthropic", label: "Anthropic Messages" },
            ]}
            value={wire}
            onChange={(v) => setWire(v as typeof wire)}
          />
        </span>
      </div>
      <p className="ai-field__note">
        For proxies and self-hosted endpoints. Built-in providers only call their own API. After
        adding, paste a key if it needs one. {CUSTOM_KEY_PIN_NOTE}
      </p>
      {text("custom-agent", "Agent model", agent, setAgent, "model id")}
      {text("custom-fast", "Fast model", fast, setFast, "model id (optional)")}
      <div className="ai-optin">
        <Toggle checked={free} label="Local, no key" onChange={setFree} />
        <span className="ai-optin__text">
          <span className="ai-optin__label">Local runtime, no key</span>
          <span className="ai-optin__desc">Costs estimate to $0.00.</span>
        </span>
      </div>
      <div className="ai-detail__footer">
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        <Button
          variant="primary"
          size="sm"
          className="ai-button"
          disabled={!ok}
          onClick={() =>
            void ctl
              .addCustom({
                label: label.trim(),
                baseURL: baseURL.trim(),
                wire,
                models: { agent: agent.trim(), fast: fast.trim() || agent.trim() },
                free,
              })
              .then(onDone)
          }
        >
          Add endpoint
        </Button>
      </div>
    </div>
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
