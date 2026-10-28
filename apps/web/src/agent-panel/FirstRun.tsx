/**
 * Agent tab first run (board 25 "v1 Polish" §5 p55vU, rules GXL4Z). Replaces the Thread Header
 * and the Thread; the Composer Wrap stays, disabled at 50 % (rule "Composer").
 *
 *   Body (E3icY / WJCW5) column, gap 12, padding [16, 24], center / center, fill
 *   (a) CLI found (FrS9y): AgentMark/32/Listening · Title "Meet Kimo" sans 16 / 600 · Desc sans
 *       12 text-secondary lh 1.45 center · Detected card (fFG6G) column gap 10, padding 12,
 *       bg-subtle, stroke border, radius-lg › Row (K8IHwR) gap 10: Host Tile 32 (bg-muted,
 *       radius-md, square-terminal 16) · Text column gap 2: Name Row gap 6 (Name sans 12 / 500 ·
 *       "Detected" StatusPill) · Path mono 11 tertiary › Use Claude Code (Button/Primary h 32,
 *       fill, square-terminal 14, label 12) › Note sans 11 tertiary lh 1.45 center · Alt (mPBZ5)
 *       row gap 4: "Or add an API key" sans 11 / 500 secondary + arrow-right 12
 *   (b) Nothing found (D8covN): AgentMark/32/Static · "Connect a model" · Desc · Key Card
 *       (rPDtX) column gap 8, padding 12 › Label Row gap 6 (key-round 14 $agent · sans 12 / 500)
 *       › Key Field h 32, padding [0, 10], bg-app, stroke border, radius-sm, mono 11 › Connect
 *       (Button/Primary h 32, fill) · Other (tp7XM) column gap 6, center: "Other providers →" ·
 *       CLI hint sans 11 tertiary
 */
import type { CliDetection } from "@kimo/ai-agent"
import { AgentMark, AgentTonePill, CompactButton } from "@kimo/ui"
import { ArrowRight, KeyRound, SquareChevronRight, SquareTerminal, Terminal } from "lucide-react"
import { type CSSProperties, useState } from "react"
import type { AgentPanelControllerExt, OnboardingView } from "./controller"

/** Button/Primary h 32 (jfK4g / kBBgE): CompactButton takes 24–30, the instance is 32. */
const H32 = { "--kimo-compact-h": "32px" } as CSSProperties

const CLI_ICONS: Record<string, typeof SquareTerminal> = {
  "claude-code": SquareTerminal,
  codex: Terminal,
  "gemini-cli": SquareChevronRight,
}

/** "Runs on your Claude subscription. Kimo never sees a key." per CLI. */
const PLAN: Record<string, string> = {
  "claude-code": "Claude",
  codex: "ChatGPT",
  "gemini-cli": "Google",
}

/** `/Users/me/.local/bin/claude` → `~/.local/bin/claude`. */
function tildePath(path: string | undefined): string {
  if (!path) return ""
  return path.replace(/^(\/Users|\/home)\/[^/]+/, "~").replace(/^[A-Z]:\\Users\\[^\\]+/i, "~")
}

export function FirstRun({
  view,
  controller,
  platform,
  onOpenSettings,
}: {
  view: OnboardingView
  controller: AgentPanelControllerExt
  platform: "desktop" | "web" | "node"
  onOpenSettings?: () => void
}) {
  if (view.kind === "cli")
    return <CliFound cli={view.cli} controller={controller} onOpenSettings={onOpenSettings} />
  return (
    <KeyCard
      view={view}
      controller={controller}
      showCliHint={platform === "desktop"}
      onOpenSettings={onOpenSettings}
    />
  )
}

function CliFound({
  cli,
  controller,
  onOpenSettings,
}: {
  cli: CliDetection
  controller: AgentPanelControllerExt
  onOpenSettings?: () => void
}) {
  const Icon = CLI_ICONS[cli.id] ?? SquareTerminal
  const plan = PLAN[cli.id]
  return (
    <div className="agent-first-run" data-pen="E3icY" data-testid="agent-first-run-cli">
      <AgentMark size={32} state="listening" />
      <h3 className="agent-first-run__title">Meet Kimo</h3>
      <p className="agent-first-run__desc">
        Kimo designs and edits on this canvas with you. It needs a model to think with.
      </p>
      <div className="agent-first-run__card" data-pen="fFG6G">
        <div className="agent-first-run__row" data-pen="K8IHwR">
          <span className="agent-first-run__tile" aria-hidden="true">
            <Icon />
          </span>
          <div className="agent-first-run__text">
            <div className="agent-first-run__name-row">
              <span className="agent-first-run__name">{cli.label}</span>
              <AgentTonePill tone="success" label="Detected" />
            </div>
            <span className="agent-first-run__path">
              {[tildePath(cli.path), cli.signedIn ? "signed in" : null].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
        <CompactButton
          variant="primary"
          height={30}
          padX={12}
          className="agent-first-run__primary"
          style={H32}
          icon={<Icon />}
          onClick={() => void controller.chooseCli(cli.id)}
          data-pen="jfK4g"
        >
          {`Use ${cli.label}`}
        </CompactButton>
        <p className="agent-first-run__note">
          {plan
            ? `Runs on your ${plan} subscription. Kimo never sees a key.`
            : "Runs on your CLI's own sign-in. Kimo never sees a key."}
        </p>
      </div>
      <button type="button" className="agent-first-run__link" onClick={onOpenSettings}>
        <span>Or add an API key</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </div>
  )
}

function KeyCard({
  view,
  controller,
  showCliHint,
  onOpenSettings,
}: {
  view: Extract<OnboardingView, { kind: "key" }>
  controller: AgentPanelControllerExt
  showCliHint: boolean
  onOpenSettings?: () => void
}) {
  const [key, setKey] = useState("")
  const connect = (k: string) => {
    if (!k.trim() || view.connecting) return
    void controller.connectKey(k.trim())
  }
  return (
    <div className="agent-first-run" data-pen="WJCW5" data-testid="agent-first-run-key">
      <AgentMark size={32} static />
      <h3 className="agent-first-run__title">Connect a model</h3>
      <p className="agent-first-run__desc">
        Bring your own key. The provider bills the usage, not Kimo.
      </p>
      <div className="agent-first-run__card agent-first-run__card--key" data-pen="rPDtX">
        <label className="agent-first-run__label-row" htmlFor="agent-first-run-key">
          <KeyRound className="agent-first-run__key-icon" aria-hidden="true" />
          <span className="agent-first-run__label">Anthropic API key</span>
        </label>
        <span
          className={`agent-first-run__field${view.error ? " is-danger" : ""}`}
          data-pen="WxxLI"
        >
          <input
            id="agent-first-run-key"
            className="agent-first-run__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={key}
            disabled={view.connecting}
            aria-invalid={view.error ? true : undefined}
            aria-describedby={view.error ? "agent-first-run-error" : undefined}
            onChange={(e) => setKey(e.currentTarget.value)}
            onPaste={(e) => {
              // Paste → auto-test (board 25 D8covN decision).
              const text = e.clipboardData.getData("text").trim()
              if (text) {
                e.preventDefault()
                setKey(text)
                connect(text)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") connect(key)
            }}
          />
        </span>
        {view.error && (
          // Not drawn: a failed Connect keeps the card, field in danger, the Test's reason.
          <span className="agent-first-run__error" id="agent-first-run-error" role="alert">
            {view.error}
          </span>
        )}
        <CompactButton
          variant="primary"
          height={30}
          padX={12}
          className="agent-first-run__primary"
          style={H32}
          disabled={!key.trim() || view.connecting}
          onClick={() => connect(key)}
          data-pen="kBBgE"
        >
          {view.connecting ? "Connecting…" : "Connect"}
        </CompactButton>
      </div>
      <div className="agent-first-run__other" data-pen="tp7XM">
        <button type="button" className="agent-first-run__link" onClick={onOpenSettings}>
          <span>Other providers</span>
          <ArrowRight aria-hidden="true" />
        </button>
        {showCliHint && (
          <span className="agent-first-run__hint">
            Have Claude Code? Install it and reopen this tab.
          </span>
        )}
      </div>
    </div>
  )
}
