/**
 * Home "Start With AI" (board 06 LKOqL) as the M6 agent composer:
 *
 * - Idle (board 06 LKOqL / board 24 o8YoQ): Heading (title row with AgentMark/32/Listening while
 *   the composer is focused) · Composer (JvIbi) · Chips (y5Si79, prefill + frame preset).
 * - Submitted (board 22 fYVvl / board 24 o8YoQ): the composer keeps the prompt, Send turns
 *   agent with AgentMark/12/Thinking; the chips give way to Progress (uEl8e): Created
 *   <file>.kimo · Opening the editor · agent starting with <model> · Kimo drafts the first frame.
 * - First run (board 22 XsZVb): no usable provider (no key, no signed-in CLI) → the Empty State
 *   card (H33gp) replaces the chips, the composer stays visible at 50 % with Send disabled.
 *   "Design by hand instead" opens an empty file and dismisses the card until a provider is
 *   added. Web: "stored in this browser only" copy and the Anthropic opt-in toggle.
 */
import { DEFAULT_MODELS } from "@kimo/ai-agent"
import type { KimoPlatform } from "@kimo/platform"
import { AgentMark, Button, Toggle } from "@kimo/ui"
import {
  ArrowUp,
  Braces,
  ChevronDown,
  Circle,
  CircleCheck,
  Gem,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Lock,
  Monitor,
  Presentation,
  Route,
  Server,
  Smartphone,
  Sparkle,
  SwatchBook,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { AiSettingsController } from "../ai-settings/controller"
import { OLLAMA_ID, shortModelLabel } from "../ai-settings/model"
import { useAiProviders, useAiSettingsState } from "../ai-settings/runtime"
import { createFile, listFiles } from "../lib/files"
import { useOpenSettings, useRuntime } from "../platform/runtime"
import { diskPath, navigate } from "../router"
import { stashHomeHandoff } from "./handoff"
import { emptyDocument, HOME_PRESETS, type HomePreset, submitHomePrompt } from "./submit"
import "../ai-settings/ai-settings.css"
import "./home-ai.css"

const CHIP_ICONS: Record<HomePreset, ReactNode> = {
  "Landing page": <Monitor />,
  "Mobile app": <Smartphone />,
  Dashboard: <LayoutDashboard />,
  "Design system": <SwatchBook />,
  Slides: <Presentation />,
}

/** Provider Buttons (TVv9O): Anthropic first (primary when selected). */
const FIRST_RUN_PROVIDERS = [
  { id: "anthropic", label: "Anthropic", icon: <Sparkle />, site: "console.anthropic.com" },
  { id: "openai", label: "OpenAI", icon: <Braces />, site: "platform.openai.com" },
  { id: "gemini", label: "Gemini", icon: <Gem />, site: "aistudio.google.com" },
  { id: "openrouter", label: "OpenRouter", icon: <Route />, site: "openrouter.ai" },
  { id: OLLAMA_ID, label: "Local", icon: <Server />, site: "ollama.com" },
] as const

const KEY_URLS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/keys",
  [OLLAMA_ID]: "https://ollama.com/download",
}

const PLACEHOLDERS: Record<string, string> = {
  anthropic: "Paste your Anthropic key (sk-ant-…)",
  openai: "Paste your OpenAI key (sk-…)",
  gemini: "Paste your Gemini key (AIza…)",
  openrouter: "Paste your OpenRouter key (sk-or-…)",
  [OLLAMA_ID]: "http://localhost:11434/v1",
}

type Phase =
  | { kind: "idle" }
  | {
      kind: "submitting"
      created: { fileName: string; display: string } | null
      opening: boolean
      model: string
    }

export interface HomeComposerProps {
  platform: KimoPlatform
  /** Harness/tests: explicit controller. */
  controller?: AiSettingsController
  /** Navigation (default: the router). */
  onOpen?: (target: { kind: "disk"; ref: string } | { kind: "web"; id: string }) => void
  /** Progress dwell before the editor opens (board: ≤ 1 s). */
  dwellMs?: number
}

export function HomeComposer({ platform, controller, onOpen, dwellMs = 450 }: HomeComposerProps) {
  const fromWindow = useAiProviders(controller ? null : platform)
  const ctl = controller ?? fromWindow
  const s = useAiSettingsState(ctl)
  const { manager } = useRuntime()
  const openSettings = useOpenSettings()
  const [text, setText] = useState("")
  const [preset, setPreset] = useState<HomePreset | undefined>(undefined)
  const [focused, setFocused] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    void ctl?.refresh()
  }, [ctl])

  const web = platform.kind === "browser"
  const open =
    onOpen ??
    ((t: { kind: "disk"; ref: string } | { kind: "web"; id: string }) =>
      navigate(t.kind === "disk" ? diskPath(t.ref) : `/file/${t.id}`))

  // Desktop: wait for CLI detection before deciding there is no provider.
  const ready = s?.detected ?? false
  const noProvider = ready && (s?.noProvider ?? false)
  const showCard = noProvider && !(s?.homeCardDismissed ?? false)
  const blocked = noProvider || !ready
  const submitting = phase.kind === "submitting"
  const model = s?.defaultSelection ?? null
  // No provider yet (XsZVb): the blocked composer shows the default API model ("Opus 5.5").
  const modelLabel = shortModelLabel(
    model ?? { provider: "anthropic", model: DEFAULT_MODELS.anthropic?.agent ?? "" },
    ctl?.clis() ?? [],
  )

  const submit = async (prompt: string) => {
    const t = prompt.trim()
    if (!t || !ctl || submitting) return
    const sel = ctl.state.defaultSelection
    if (!sel) return
    setError(null)
    setPhase({ kind: "submitting", created: null, opening: false, model: modelLabel })
    try {
      const h = await submitHomePrompt(
        t,
        preset,
        {
          platform,
          model: sel,
          nameFile: (p) => ctl.nameFile(p),
          ...(web
            ? {
                createWebFile: (name, document) => createFile(name, { document }),
                webNames: async () => (await listFiles()).map((f) => f.name),
              }
            : {}),
          stash: stashHomeHandoff,
        },
        (step) =>
          setPhase((p) =>
            p.kind !== "submitting"
              ? p
              : step.step === "created"
                ? { ...p, created: { fileName: step.fileName, display: step.display } }
                : { ...p, opening: true },
          ),
      )
      await new Promise((r) => setTimeout(r, dwellMs))
      open(web ? { kind: "web", id: h.path } : { kind: "disk", ref: h.path })
    } catch (e) {
      setPhase({ kind: "idle" })
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const designByHand = async () => {
    ctl?.dismissHomeCard(true)
    try {
      if (web)
        open({
          kind: "web",
          id: await createFile("Untitled", { document: emptyDocument("Untitled") }),
        })
      else open({ kind: "disk", ref: (await manager.newUntitled()).ref })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const listening = focused || submitting
  return (
    <section
      className={`home-ai${showCard ? " home-ai--first-run" : ""}${submitting ? " home-ai--submitted" : ""}`}
      aria-labelledby="home-ai-title"
      data-pen={showCard ? "CRnOE" : submitting ? "qJahe" : "LKOqL"}
    >
      <div className="home-ai__heading">
        {listening && !showCard ? (
          <div className="home-ai__title-row" data-pen="r8BkUL">
            <AgentMark size={32} state={submitting ? "thinking" : "listening"} />
            <h2 id="home-ai-title" className="home-ai__title">
              What do you want to design?
            </h2>
          </div>
        ) : (
          <h2 id="home-ai-title" className="home-ai__title">
            What do you want to design?
          </h2>
        )}
        {!showCard && (
          <p className="home-ai__desc">
            Describe it and the agent drafts it on a new canvas. Every change is a reviewable diff.
          </p>
        )}
      </div>

      {showCard && ctl && s && (
        <FirstRunCard
          ctl={ctl}
          web={web}
          os={platform.os}
          onOpenUrl={(u) =>
            void platform.files.openExternalUrl(u).catch(() => window.open(u, "_blank"))
          }
          onReady={() => {
            if (text.trim()) void submit(text)
          }}
          onDesignByHand={() => void designByHand()}
        />
      )}

      <form
        className={`kimo-composer home-ai__composer${blocked ? " home-ai__composer--blocked" : ""}${submitting ? " home-ai__composer--submitted" : ""}`}
        data-pen={showCard ? "cObts" : "deES7"}
        onSubmit={(e) => {
          e.preventDefault()
          if (!blocked) void submit(text)
        }}
      >
        <textarea
          ref={input}
          className="kimo-composer__input"
          rows={1}
          aria-label="Describe what to design"
          placeholder={
            showCard
              ? "A pricing page for a calm budgeting app…"
              : "A pricing page for a calm budgeting app, three tiers, soft greens…"
          }
          value={text}
          readOnly={submitting}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (!blocked) void submit(text)
            }
          }}
        />
        <div className="kimo-composer__bar">
          <button
            type="button"
            className="kimo-composer__model"
            title="Models and providers"
            onClick={() => openSettings("ai-providers")}
          >
            <span className="kimo-composer__model-label">{modelLabel}</span>
            <span className="kimo-composer__model-icon" aria-hidden="true">
              <ChevronDown />
            </span>
          </button>
          <span className="kimo-composer__spacer" aria-hidden="true" />
          <button
            type="submit"
            className="kimo-composer__send home-ai__send"
            aria-label={submitting ? "Starting the agent" : "Send"}
            disabled={blocked || submitting || text.trim() === ""}
          >
            {submitting ? (
              <AgentMark size={12} state="thinking" />
            ) : (
              <span className="kimo-composer__send-icon" aria-hidden="true">
                <ArrowUp />
              </span>
            )}
          </button>
        </div>
      </form>

      {error && (
        <p className="home-ai__error" role="alert">
          {error}
        </p>
      )}

      {phase.kind === "submitting" ? (
        <div className="home-ai__progress" data-pen="uEl8e" aria-live="polite">
          <div className="home-ai__step home-ai__step--done" data-pen="ZQ43R">
            {phase.created ? (
              <CircleCheck
                className="home-ai__step-icon home-ai__step-icon--done"
                aria-hidden="true"
              />
            ) : (
              <LoaderCircle
                className="home-ai__step-icon home-ai__step-icon--spin"
                aria-hidden="true"
              />
            )}
            <span className="home-ai__step-label">
              {phase.created ? `Created ${phase.created.fileName}` : "Creating the file…"}
            </span>
            <span className="home-ai__spacer" />
            {phase.created && <span className="home-ai__step-meta">{phase.created.display}</span>}
          </div>
          <div
            className={`home-ai__step${phase.created ? " home-ai__step--active" : " home-ai__step--pending"}`}
            data-pen="XMAAs"
          >
            {phase.created ? (
              <AgentMark size={12} state="thinking" className="home-ai__step-mark" />
            ) : (
              <Circle className="home-ai__step-icon" aria-hidden="true" />
            )}
            <span className="home-ai__step-label">
              Opening the editor · agent starting with {phase.model}
            </span>
            <span className="home-ai__spacer" />
            <span className="home-ai__step-meta">Single · scope: page</span>
          </div>
          <div className="home-ai__step home-ai__step--pending" data-pen="s65NC">
            <Circle className="home-ai__step-icon" aria-hidden="true" />
            <span className="home-ai__step-label">Kimo drafts the first frame (placeholder)</span>
            <span className="home-ai__spacer" />
          </div>
        </div>
      ) : (
        !showCard && (
          <div className="home-ai__chips" data-pen="y5Si79">
            {(Object.keys(HOME_PRESETS) as HomePreset[]).map((label) => (
              <button
                key={label}
                type="button"
                className={`home-chip${preset === label ? " home-chip--selected" : ""}`}
                aria-pressed={preset === label}
                disabled={blocked}
                onClick={() => {
                  setPreset(label)
                  if (!text.trim() || Object.values(HOME_PRESETS).some((p) => p.prefill === text))
                    setText(HOME_PRESETS[label].prefill)
                  input.current?.focus()
                }}
              >
                <span className="home-chip__icon">{CHIP_ICONS[label]}</span>
                <span className="home-chip__label">{label}</span>
              </button>
            ))}
          </div>
        )
      )}
    </section>
  )
}

function FirstRunCard({
  ctl,
  web,
  os,
  onOpenUrl,
  onReady,
  onDesignByHand,
}: {
  ctl: AiSettingsController
  web: boolean
  os: string
  onOpenUrl: (url: string) => void
  onReady: () => void
  onDesignByHand: () => void
}) {
  const [selected, setSelected] = useState<string>("anthropic")
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = ctl.state
  const row = s.providers.find((p) => p.id === selected)
  const local = selected === OLLAMA_ID
  const p = FIRST_RUN_PROVIDERS.find((x) => x.id === selected) ?? FIRST_RUN_PROVIDERS[0]
  const store =
    os === "windows"
      ? "Windows Credential Manager"
      : os === "linux"
        ? "Secret Service"
        : "macOS Keychain"

  const save = async () => {
    const v = value.trim()
    if (!v && !local) return
    setBusy(true)
    setError(null)
    try {
      let ok: boolean
      let detail = ""
      if (local) {
        if (v) await ctl.setBaseURL(OLLAMA_ID, v)
        const t = await ctl.test(OLLAMA_ID)
        ok = t.ok
        detail = t.detail
      } else {
        const t = await ctl.setKey(selected, v)
        ok = t.ok
        detail = t.detail
        // Web Anthropic needs the opt-in before the agent can use the key.
        if (ok && web && selected === "anthropic" && !row?.allowBrowser)
          await ctl.setAllowBrowser("anthropic", true)
      }
      if (ok) {
        setValue("")
        onReady()
      } else setError(detail || "The test failed.")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="home-ai-card" data-pen="H33gp">
      <div className="home-ai-card__head" data-pen="FVt9Y">
        <span className="home-ai-card__tile" aria-hidden="true">
          <KeyRound />
        </span>
        <div className="home-ai-card__text">
          <h3 className="home-ai-card__title">Add an API key to use the agent</h3>
          <p className="home-ai-card__desc">
            {web
              ? "Kimo doesn't sell models: bring your own key. It stays in this browser, and requests go straight to the provider."
              : `Kimo doesn't sell models: bring your own key. Your ${store} keeps it; requests go straight to the provider.`}
          </p>
        </div>
      </div>
      <div
        className="home-ai-card__providers"
        role="radiogroup"
        aria-label="Provider"
        data-pen="TVv9O"
      >
        {FIRST_RUN_PROVIDERS.map((x) => (
          <Button
            key={x.id}
            variant={x.id === selected ? "primary" : "secondary"}
            size="sm"
            className={`home-ai-card__provider${x.id === selected ? " is-selected" : ""}`}
            icon={x.icon}
            role="radio"
            aria-checked={x.id === selected}
            onClick={() => {
              setSelected(x.id)
              setError(null)
              setValue("")
            }}
          >
            {x.label}
          </Button>
        ))}
      </div>
      <div className="home-ai-card__key-row" data-pen="bCoL9">
        <label className="home-ai-card__key-field" data-pen="yrAll">
          <Lock className="home-ai-card__lock" aria-hidden="true" />
          <input
            className="home-ai-card__key-input"
            type={local ? "url" : "password"}
            autoComplete="off"
            spellCheck={false}
            aria-label={local ? "Local endpoint URL" : `${p.label} API key`}
            placeholder={PLACEHOLDERS[selected]}
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save()
            }}
          />
        </label>
        <Button
          variant="primary"
          size="sm"
          className="home-ai-card__connect"
          disabled={busy || (!local && !value.trim())}
          aria-busy={busy || undefined}
          onClick={() => void save()}
        >
          {busy ? "Testing…" : "Test & save"}
        </Button>
      </div>
      {web && selected === "anthropic" && (
        <div className="ai-optin home-ai-card__optin">
          <Toggle
            checked={row?.allowBrowser === true}
            aria-labelledby="home-optin-label"
            onChange={(v) => void ctl.setAllowBrowser("anthropic", v)}
          />
          <span className="ai-optin__text">
            <span className="ai-optin__label" id="home-optin-label">
              Allow Anthropic calls from the browser
            </span>
            <span className="ai-optin__desc">
              Required by Anthropic for direct browser access. Off = the agent is unavailable on web
              for this provider.
            </span>
          </span>
        </div>
      )}
      {error && (
        <p className="home-ai-card__error" role="alert">
          {error}
        </p>
      )}
      <div className="home-ai-card__footer" data-pen="oHxwJ">
        <button
          type="button"
          className="home-ai-card__link"
          onClick={() => onOpenUrl(KEY_URLS[selected] ?? "")}
        >
          {local ? `Get Ollama at ${p.site} ↗` : `Get a key at ${p.site} ↗`}
        </button>
        <span className="home-ai__spacer" />
        <button type="button" className="home-ai-card__skip" onClick={onDesignByHand}>
          Design by hand instead
        </button>
      </div>
    </div>
  )
}
