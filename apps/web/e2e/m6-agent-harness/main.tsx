/**
 * M6 agent harness (e2e only, not part of the app bundle): the Agent tab (board 22 s4pGz0) in a
 * 360 × 800 right panel under its Tabs, over the real `@kimo/ai-agent` loop with a mocked
 * provider, the in-window M5 tool host and a real DocStore; `?scene=marks` renders AgentMark
 * states / sizes / personas (board 24 ZkIvw) and the mode canvas pieces. Driven through
 * `window.__m6`.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import type { ProviderConfig, ProviderRequest } from "@kimo/ai-agent"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import {
  AGENT_MARK_STATES,
  AgentMark,
  agentMarkRendererStats,
  PERSONAS,
  ScopeTag,
  Tabs,
} from "@kimo/ui"
import { StrictMode, useEffect, useMemo } from "react"
import { createRoot } from "react-dom/client"
import {
  AgentCursorPill,
  AgentPanel,
  createAgentPanelController,
  createInWindowTools,
  ModeSummaryPill,
  PassChip,
  RejectedOpPill,
  useAgentPanelState,
} from "../../src/agent-panel"
import { createTestRuntime, MOCK_ANTHROPIC, type Script } from "../../src/agent-panel/testing"

/** Board 39 states A, C, D, E, F: which CLIs and providers the chooser lists. */
function chooserSetup(state: string): Partial<Parameters<typeof createTestRuntime>[0]> {
  const cli = (id: string, label: string, signedIn = true) => ({
    id,
    label,
    installed: true,
    path: `/Users/me/.local/bin/${id}`,
    signedIn,
    billing: signedIn ? ("subscription" as const) : null,
  })
  const providers: ProviderConfig[] = [
    MOCK_ANTHROPIC,
    {
      id: "openai",
      kind: "openai",
      label: "OpenAI-compatible",
      models: { agent: "gpt-4.1", fast: "gpt-4.1-mini" },
      apiKey: "sk-test",
    },
    {
      id: "gemini",
      kind: "gemini",
      label: "Google Gemini",
      models: { agent: "gemini-2.5-pro", fast: "gemini-2.5-flash" },
      apiKey: "g-test",
    },
    {
      id: "custom:ollama",
      kind: "custom",
      label: "Ollama · localhost",
      models: { agent: "llama3.3:70b", fast: "qwen2.5-coder:32b" },
      free: true,
    },
  ]
  if (state === "c")
    providers.push({
      id: "openrouter",
      kind: "openrouter",
      label: "OpenRouter",
      models: { agent: "anthropic/claude-sonnet-5-5", fast: "google/gemini-2.5-flash" },
      extraModels: Array.from({ length: 8 }, (_, i) => `vendor/model-${i + 1}`),
      apiKey: "or-test",
    })
  if (state === "d") return { platform: "desktop", providers: [], clis: [], defaultSelection: null }
  const clis =
    state === "e"
      ? [
          cli("claude-code", "Claude Code", false),
          cli("codex", "Codex"),
          cli("gemini-cli", "Gemini CLI"),
        ]
      : [cli("claude-code", "Claude Code"), cli("codex", "Codex"), cli("gemini-cli", "Gemini CLI")]
  return {
    platform: "desktop",
    providers,
    clis,
    defaultSelection:
      state === "f"
        ? { provider: "custom:ollama", model: "llama3.3:70b" }
        : state === "e"
          ? { provider: "cli:codex", model: "default" }
          : { provider: "cli:claude-code", model: "claude-sonnet-5-5" },
    recentModels:
      state === "a"
        ? [
            { provider: "cli:claude-code", model: "claude-sonnet-5-5" },
            { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
          ]
        : [],
  }
}

function doc(): KimoDocument {
  const d = createEmptyDocument("Marketing site") as KimoDocument & {
    nodes: Record<string, unknown>
  }
  const frame = (id: string, name: string, parent: string | null, order: string, extra = {}) => {
    d.nodes[id] = { type: "frame", parent, order, name, x: 0, y: 0, w: 280, h: 340, ...extra }
  }
  frame("Pricing0001", "Pricing", null, "a0")
  frame("Hero000001", "Hero", "Pricing0001", "a0", { h: 120 })
  frame("CtaRow0001", "CTA Row", "Pricing0001", "a1", { h: 60 })
  frame("Navbar0001", "Navbar", null, "a1", { x: 400 })
  return d
}

const store = importDocument(doc())
const tools = createInWindowTools({ store, path: "/Users/me/Marketing site.kimo" })
const docId = () => tools.docId()

const lastUser = (req: ProviderRequest) => {
  const u = [...req.messages].reverse().find((m) => m.role === "user")
  return u?.role === "user" ? u.content.map((p) => (p.type === "text" ? p.text : "")).join("") : ""
}
const afterTool = (req: ProviderRequest) => req.messages[req.messages.length - 1]?.role === "tool"

/** Scripted replies by the prompt's keywords (mocked provider, no network). */
/** Board 33 §1 (ME2DT) reply text: the same Markdown as the Pencil "before" vignette. */
export const FORMATTED_REPLY = [
  'Added two sections to "Landing — Desktop (Analytics)", above the footer.',
  "",
  "- **Pricing:** your three plans, unchanged.",
  "- **FAQ:** six questions, collapsed.",
  "  - Uses the analytics heading style.",
  "",
  "To move FAQ above Pricing:",
  "",
  "1. Select FAQ in the Layers panel.",
  "2. Press `⌥↑` once.",
  "",
  "Answers use the `faq/answer` style:",
  "",
  "```",
  "font: Inter 15/24",
  "color: $text-secondary",
  "```",
  "",
  "Prices are *placeholders*.",
  "",
  "Copy from [pricing.md](https://kimo.dev/pricing).",
].join("\n")

const script: Script = (req) => {
  const text = lastUser(req)
  const brief = /Your brief: ([^\n]*)/.exec(req.system.volatile ?? "")?.[1] ?? ""
  // Side-by-side children: build inside the variant frame.
  const frame = /your frame is (\w+)/i.exec(text)?.[1]
  if (frame)
    return afterTool(req)
      ? { text: "Variant done.", usage: { inputTokens: 900, outputTokens: 300 } }
      : {
          tools: [
            {
              name: "kimo_apply_ops",
              input: {
                docId: docId(),
                label: "Tiers",
                ops: [
                  {
                    op: "insert",
                    key: "t",
                    parent: frame,
                    node: { type: "rect", name: "Tier", x: 0, y: 0, w: 80, h: 80 },
                  },
                ],
              },
            },
          ],
          delayMs: 60,
        }
  // Split children: Agent 1 tries to leave its scope (rejected), Agent 2 edits its section.
  if (brief)
    return afterTool(req)
      ? { text: "Section done." }
      : {
          tools: [
            {
              name: "kimo_apply_ops",
              input: {
                docId: docId(),
                ops: [
                  {
                    op: "update",
                    id: brief.includes("Hero") ? "Navbar0001" : "CtaRow0001",
                    set: { name: brief.includes("Hero") ? "Hacked" : "CTA Row ✓" },
                  },
                ],
              },
            },
          ],
          delayMs: 60,
        }
  // Streamed edits (ADR 0013 §4.7): the call's input streams slowly, so its layers land one by
  // one before the call itself ends.
  if (text.includes("Stream a pricing card"))
    return afterTool(req)
      ? { text: "Added a pricing card to Pricing." }
      : {
          text: "Building the pricing card\n",
          tools: [
            {
              name: "kimo_apply_ops",
              input: {
                docId: docId(),
                ops: [
                  {
                    op: "insert",
                    key: "card",
                    parent: "Pricing0001",
                    node: { type: "frame", name: "Pro card", x: 0, y: 0, w: 240, h: 300 },
                  },
                  ...["Pro", "$49/mo", "Unlimited files", "Priority support"].map((t, i) => ({
                    op: "insert",
                    parent: "@card",
                    node: {
                      type: "text",
                      name: `Line ${i + 1}`,
                      content: t,
                      x: 16,
                      y: 16 + i * 32,
                      style: { size: 16 },
                      fill: "#111111",
                    },
                  })),
                ],
              },
            },
          ],
          streamInput: { chunk: 12, delayMs: 25 },
        }
  // kimo_script (ADR 0013 addendum 7): a script streams; each statement's layers land while the
  // call is still being written, in the sandbox worker.
  if (text.includes("Script a pricing card"))
    return afterTool(req)
      ? { text: "Added a pricing card to Pricing." }
      : {
          text: "Building the pricing card\n",
          tools: [
            {
              name: "kimo_script",
              input: {
                docId: docId(),
                code: [
                  `const card = Insert("Pricing0001", {type: "frame", name: "Pro card", x: 0, y: 0, w: 240, h: 300})`,
                  ...["Pro", "$49/mo", "Unlimited files", "Priority support"].map(
                    (t, i) =>
                      `Insert(card, {type: "text", name: "Line ${i + 1}", content: ${JSON.stringify(t)}, x: 16, y: ${16 + i * 32}, style: {size: 16}, fill: "#111111"})`,
                  ),
                  `Print(Get("Pricing0001").name)`,
                  "",
                ].join("\n"),
              },
            },
          ],
          streamInput: { chunk: 12, delayMs: 25 },
        }
  if (text.includes("landing"))
    return afterTool(req)
      ? { text: "Sections are in." }
      : {
          tools: [
            {
              name: "kimo_spawn_agents",
              input: {
                docId: docId(),
                agents: [
                  { frameId: "Hero000001", brief: "Build the Hero" },
                  { frameId: "CtaRow0001", brief: "Build the CTA" },
                ],
              },
            },
          ],
        }
  if (text.startsWith("Iterate pass"))
    return afterTool(req)
      ? { text: "Raised contrast on the Team card." }
      : {
          tools: [
            {
              name: "kimo_apply_ops",
              input: {
                docId: docId(),
                ops: [
                  { op: "update", id: "Hero000001", set: { name: "Hero premium" } },
                  { op: "update", id: "CtaRow0001", set: { name: "CTA premium" } },
                ],
              },
            },
          ],
        }
  if (req.responseSchema)
    return {
      text: JSON.stringify({
        title: text.includes("warm") ? "Warm up the hero" : "Hero copy pass",
      }),
    }
  if (text.includes("auth")) return { error: "auth", status: 401, message: "invalid x-api-key" }
  // Board 34: an edit outside the selected Hero (Single mode asks: out of its area).
  if (text.includes("Tidy the navbar") && !afterTool(req))
    return {
      tools: [
        {
          name: "kimo_apply_ops",
          input: {
            docId: docId(),
            ops: [{ op: "update", id: "Navbar0001", set: { name: "Navbar" } }],
          },
        },
      ],
    }
  if (text.includes("Tidy the navbar"))
    return { text: "Tidied the navbar.", usage: { inputTokens: 600, outputTokens: 40 } }
  // Board 38: a search and a page read before the reply, which ends with its sources.
  if (text.includes("Tailwind v4"))
    return {
      web: [
        { tool: "web_search", input: { query: "tailwind v4 fonts" } },
        { tool: "web_fetch", input: { url: "https://tailwindcss.com/docs/font-family" } },
      ],
      text: "Body now uses the Tailwind v4 default sans stack, system fonts first and the emoji fonts last.\n\nSources:\n- https://tailwindcss.com/docs/font-family",
      usage: { inputTokens: 900, outputTokens: 60 },
      delayMs: 400,
    }
  // Board 33 §1: a reply with every block of the Markdown subset.
  if (text.includes("formatted reply"))
    return { text: FORMATTED_REPLY, usage: { inputTokens: 900, outputTokens: 120 }, delayMs: 10 }
  // Board 25 §5: refusal (dIkT6), generic error (u8mh7l), approval outside the scope (OlhpU).
  if (text.includes("Stripe"))
    return {
      text: "Recreating the Stripe logo pixel-for-pixel isn't something I'll draw. I can make an original mark in a similar spirit — geometric, two-tone, rounded.",
      stop: "refusal",
    }
  if (text.includes("broken"))
    return {
      error: "invalid_request",
      status: 400,
      message: "Anthropic returned 400 · invalid_request_error",
    }
  if (text.includes("legacy") && !afterTool(req))
    return {
      text: "Found 3 legacy cards. Removing them needs your OK.",
      tools: [
        {
          name: "kimo_apply_ops",
          input: { docId: docId(), ops: [{ op: "delete", id: "Navbar0001" }] },
        },
      ],
    }
  if (text.includes("rate") && window.__m6.rateLimited++ === 0)
    return { error: "rate_limit", status: 429, retryAfterMs: 1500 }
  // Board 31: a note before the tool call (the live status), then a slow final reply.
  if (text.includes("slow") && !afterTool(req))
    return {
      text: "Adding the waitlist form\n",
      tools: [
        {
          name: "kimo_apply_ops",
          input: {
            docId: docId(),
            ops: [{ op: "update", id: "CtaRow0001", set: { name: "CTA Row" } }],
          },
        },
      ],
      usage: { inputTokens: 1400, outputTokens: 90 },
    }
  if (text.includes("slow"))
    return {
      text: "Added an email field and a black Join button that reuses Button/Primary.",
      delayMs: 600,
      usage: { inputTokens: 2800, outputTokens: 312 },
    }
  if (text.includes("warm") && !afterTool(req))
    return {
      text: "",
      tools: [
        {
          name: "kimo_apply_ops",
          input: {
            docId: docId(),
            label: "Warm Hero",
            ops: [{ op: "update", id: "Hero000001", set: { name: "Hero" } }],
          },
        },
      ],
      usage: { inputTokens: 1600, outputTokens: 400 },
    }
  if (text.includes("waitlist") && !afterTool(req))
    return {
      tools: [
        { name: "kimo_get_state", input: {} },
        {
          name: "kimo_apply_ops",
          input: {
            docId: docId(),
            label: "Waitlist Form",
            ops: [
              {
                op: "insert",
                key: "w",
                parent: "Pricing0001",
                node: { type: "frame", name: "Waitlist Form", x: 0, y: 200, w: 240, h: 48 },
              },
            ],
          },
        },
      ],
      delayMs: 200,
    }
  return {
    text: text.includes("warm")
      ? "Warmed the palette and swapped the headline to Fraunces. 7 changes in Hero."
      : "Done — the hero copy now matches the moodboard.",
    usage: { inputTokens: 1500, outputTokens: 1000 },
    delayMs: 10,
  }
}

// `?runtime=first-cli` (board 25 FrS9y) | `first-key` (D8covN): no API provider yet.
const firstRun = new URLSearchParams(location.search).get("runtime")
let cliChosen = false
let keyOk = false
// `?warn=0.05` (board 27 §10 b EP0Ir): Usage & limits with that per-turn warning; Show cost is
// flipped through `window.__m6.usage` + `controller.refresh()`.
const warnQ = new URLSearchParams(location.search).get("warn")
const harnessUsage = {
  monthlyLimitUsd: 0,
  warnPerTurnUsd: Number(warnQ ?? 1),
  showCost: true,
  defaultModel: null,
}
// Board 38: Allow web access / No third-party fetch, flipped through `window.__m6.web` +
// `controller.refresh()`.
const harnessWeb = { enabled: true, blocked: false }
// `?chooser=a|c|d|e|f` (board 39 qNrfY states): desktop CLIs and providers for the model chooser.
const chooserQ = new URLSearchParams(location.search).get("chooser")
const chooserRuntime = chooserQ ? chooserSetup(chooserQ) : {}
const base = createTestRuntime({
  tools: tools.factory,
  script,
  platform: "web",
  webAccess: () => harnessWeb,
  ...chooserRuntime,
  ...(warnQ ? { usage: () => ({ ...harnessUsage, monthUsd: 0 }) } : {}),
  ...(firstRun
    ? {
        providers: [],
        defaultSelection:
          firstRun === "first-cli" ? { provider: "cli:claude-code", model: "default" } : null,
        clis:
          firstRun === "first-cli"
            ? [
                {
                  id: "claude-code",
                  label: "Claude Code",
                  installed: true,
                  path: "/Users/me/.local/bin/claude",
                  signedIn: true,
                  billing: "subscription" as const,
                },
              ]
            : [],
      }
    : {}),
})
const runtime = firstRun
  ? {
      ...base,
      apiReady: () => keyOk,
      cliConfirmed: () => cliChosen,
      chooseCli: async () => {
        cliChosen = true
      },
      connectKey: async (_p: string, key: string) => {
        keyOk = key === "sk-ant-api03-test-3f9a"
        return keyOk ? { ok: true, detail: "ok" } : { ok: false, detail: "401 · invalid x-api-key" }
      },
    }
  : base
const controller = createAgentPanelController({
  runtime,
  fileId: "f-marketing",
  fileName: "Marketing site.kimo",
  docId,
  nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name,
  parentOf: (id) => (store.getNode(id) as { parent?: string | null } | undefined)?.parent ?? null,
  frameBox: (id) => {
    const n = store.getNode(id) as unknown as
      | { name: string; x: number; y: number; w: number; h: number }
      | undefined
    return n ? { id, name: n.name, x: n.x, y: n.y, w: n.w, h: n.h } : null
  },
})

declare global {
  interface Window {
    __m6: {
      controller: typeof controller
      store: typeof store
      rateLimited: number
      stats: typeof agentMarkRendererStats
      copied: string[]
      usage: typeof harnessUsage
      followed: string[][]
      web: typeof harnessWeb
    }
  }
}
window.__m6 = {
  controller,
  store,
  rateLimited: 0,
  stats: agentMarkRendererStats,
  copied: [],
  usage: harnessUsage,
  followed: [],
  web: harnessWeb,
}

function PanelScene() {
  const state = useAgentPanelState(controller)
  useEffect(() => {
    void controller.refresh()
  }, [])
  return (
    <aside className="h-panel" data-testid="right-panel">
      <Tabs
        label="Right panel"
        items={[
          { value: "design", label: "Design" },
          { value: "code", label: "Code" },
          { value: "agent", label: "Agent" },
        ]}
        value="agent"
      />
      <AgentPanel
        controller={controller}
        fileName="Marketing site.kimo"
        platform={firstRun ? "desktop" : "web"}
        parentNameOf={(id) => {
          const n = store.getNode(id) as { parent?: string | null } | undefined
          const p = n?.parent
            ? (store.getNode(n.parent) as { name?: string } | undefined)
            : undefined
          return p?.name ?? "Page 1"
        }}
        onCopy={(t) => window.__m6.copied.push(t)}
        onFollow={(ids) => window.__m6.followed.push(ids)}
      />
      <span hidden data-testid="busy">
        {String(state.busy)}
      </span>
    </aside>
  )
}

function MarksScene() {
  const run = useMemo(
    () => ({
      id: "r",
      mode: "split" as const,
      agents: (["teal", "iris", "violet"] as const).map((p, i) => ({
        origin: `agent:kimo.s.${i}`,
        label: i ? `Agent ${i}` : "Lead",
        scopeName: "x",
        modelLabel: "Opus 5.5",
        ops: 0,
        rejected: 0,
        costUsd: 0.1,
        state: "running" as const,
        persona: p,
        personaRound: 1,
        mark: "working" as const,
        groups: [],
      })),
      done: 1,
      total: 3,
      costUsd: 0.25,
      tokens: 52_000,
      running: true,
      log: [],
    }),
    [],
  )
  return (
    <div className="h-marks">
      <div className="h-row" data-testid="marks-32">
        {AGENT_MARK_STATES.map((s) => (
          <AgentMark key={s} size={32} state={s} data-testid={`mark-32-${s}`} />
        ))}
      </div>
      <div className="h-row" data-testid="marks-24">
        {AGENT_MARK_STATES.map((s) => (
          <AgentMark key={s} size={24} state={s} data-testid={`mark-24-${s}`} />
        ))}
      </div>
      <div className="h-row" data-testid="marks-12">
        {AGENT_MARK_STATES.map((s) => (
          <AgentMark key={s} size={12} state={s} data-testid={`mark-12-${s}`} />
        ))}
      </div>
      <div className="h-row" data-testid="marks-personas">
        {PERSONAS.map((p) => (
          <AgentMark key={p} size={32} persona={p} data-testid={`mark-${p}`} />
        ))}
        <AgentMark size={32} static data-testid="mark-static" />
      </div>
      <div className="h-row">
        <ModeSummaryPill run={run} onStopAll={() => {}} />
        <PassChip pass={2} of={3} reviewing />
        <ScopeTag label="Agent 1 · only inside Hero" persona="iris" />
      </div>
      <div className="h-row">
        <AgentCursorPill label="Agent 1 · setting Headline font…" persona="iris" state="working" />
        <AgentCursorPill label="Agent 3 · planning Feature 2" persona="rose" state="thinking" />
        <RejectedOpPill text="Agent 1 · update Navbar → OUT_OF_SCOPE" />
      </div>
    </div>
  )
}

const scene = new URLSearchParams(location.search).get("scene") ?? "panel"
const css = document.createElement("style")
css.textContent = `
  html, body { margin: 0; background: var(--kimo-bg-canvas); font-family: var(--kimo-font-sans); }
  .h-panel { box-sizing: border-box; display: flex; flex-direction: column; width: 360px; height: 800px; margin: 23px 0 0 0; overflow: hidden; border-radius: var(--kimo-radius-md); background: var(--kimo-bg-app); box-shadow: inset 0 0 0 1px var(--kimo-border); }
  .h-marks { display: flex; flex-direction: column; gap: 16px; padding: 24px; background: var(--kimo-bg-app); }
  .h-row { display: flex; gap: 12px; align-items: center; }
`
document.head.append(css)
const root = document.getElementById("root")
if (root)
  createRoot(root).render(
    <StrictMode>{scene === "marks" ? <MarksScene /> : <PanelScene />}</StrictMode>,
  )
