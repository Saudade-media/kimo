/**
 * The Agent tab controller (contract `AgentPanelController`, ADR 0014 §5–§12). One per editor
 * window/document. It drives `@kimo/ai-agent` — `runTurn` for API providers, `runCliTurn` for
 * local CLIs — over the injected {@link AgentPanelRuntime}, and turns the `AgentEvent` stream
 * into the board 22 thread (streaming text with a caret, AgentStep rows, MessageMeta, inline
 * error cards), the session list, the model picker, the "/" skills menu, attachments, modes
 * (single, side by side, split, iterate) with per-agent personas, and the canvas overlays.
 */
import {
  type AgentEvent,
  activeSkills,
  addUsage,
  agentOrigin,
  appendTurn,
  BUILTIN_CLI_ADAPTERS,
  buildSystemPrompt,
  CHILD_EXCLUDED_TOOLS,
  type ChatMessage,
  type ChildResult,
  type ChildSpec,
  type CliDetection,
  childPolicy,
  cliIdOf,
  cliProviderId,
  complete,
  createSpawnTool,
  DEFAULT_MODE,
  type ErrorCard,
  type ErrorCardAction,
  errorCard,
  estimateCost,
  exploreBrief,
  type FrameBox,
  groupSessions,
  historyOf,
  type ImagePart,
  type IteratePass,
  isCliProvider,
  iteratePrompt,
  leadPolicy,
  loadSkills,
  MAX_AGENTS,
  MODEL_CATALOG,
  type ModeConfig,
  type ModelSelection,
  type NoteView,
  newSession,
  newSessionId,
  type OpGroup,
  ProgressTracker,
  type PromptNodeView,
  type PromptRunState,
  type ProviderConfig,
  ProviderError,
  parseSlash,
  planPromptRun,
  planRegenerate,
  planSideBySide,
  type ReviewDecision,
  replyOf,
  resolveRuntime,
  revertCalls,
  runChildren,
  runCliTurn,
  runTurn,
  type Session,
  type SessionMeta,
  type Skill,
  type SkillCatalog,
  START_STATUS,
  type StepNames,
  shimLaunch,
  sumCosts,
  supportsThinkingControl,
  type ThinkingMode,
  TITLE_SCHEMA,
  type ToolHost,
  type TurnRecord,
  titlePrompt,
  type Usage,
  type UserMessage,
  ZERO_USAGE,
} from "@kimo/ai-agent"
import { type ApprovalOutcome, type ApprovalRequest, callTargets } from "@kimo/mcp-server"
import type { McpApprovalChoice } from "@kimo/platform"
import { type AgentMarkState, type Persona, PersonaAllocator } from "@kimo/ui"
import { workAreaIds } from "../canvas/agent-area"
import {
  type AgentComposerView,
  type AgentMessageView,
  type AgentPanelController,
  type AgentPanelState,
  type AgentStepView,
  type ApprovalPromptView,
  type AttachmentChipView,
  approvalChoices,
  type HomeAgentHandoff,
  type MessageMetaView,
  type ModeAgentRowView,
  type ModelPickerGroup,
} from "../platform/contract"
import { autoApprovalLine } from "./approval"
import { type CostWarningView, estimateTurn, shouldWarn } from "./cost-warning"
import { modelLabel, newTokens } from "./format"
import { type AgentPanelRuntime, providerFor } from "./runtime"

// --- View types (contract + what the board draws beyond it) ---------------------------------------

/** A canvas selection item (auto attachment chip). */
export interface SelectionItem {
  id: string
  name: string
  type?: string
}

/** One row of the Split plan / iterate Changes list (board 24 GmEAl Log, board 22 Vacqa). */
export interface PlanLogRow {
  key: string
  op: "reject" | "update" | "insert" | "delete" | "move"
  target: string
  detail: string
  persona: Persona
  /** Undo this op group (Revert icon). */
  undoToken?: string
  origin: string
}

export interface ModeAgentRow extends ModeAgentRowView {
  persona: Persona
  personaRound: number
  mark: AgentMarkState
  /** Scope frame id (side by side: the variant frame). */
  scopeId?: string
  /** Side by side: the child's op groups (Discard undoes them). */
  groups: OpGroup[]
  kept?: boolean
  discarded?: boolean
}

export interface ModeRunView {
  id: string
  mode: "side-by-side" | "split" | "iterate"
  agents: ModeAgentRow[]
  done: number
  total: number
  costUsd: number | null
  tokens: number
  running: boolean
  log: PlanLogRow[]
  iterate?: {
    pass: number
    of: number
    reviewing: boolean
    goal: string
    steer?: string
    summary: string
    changes: number
    costUsd: number | null
    rows: PlanLogRow[]
    passes: IteratePass[]
    /** Pass being previewed: "Before" (0) or "After". */
    view: "before" | "after"
  }
}

export interface CanvasAgentState {
  live: string[]
  info: Record<string, { label: string; persona: Persona; ops: number; paused: boolean }>
  scopes: {
    origin: string
    roots: string[]
    mode: "single" | "side-by-side" | "split" | "iterate"
  }[]
  cursors: {
    origin: string
    nodeId: string
    /** The work area (outline); see `CanvasAgentCursor.nodeIds`. */
    nodeIds?: string[]
    /** Where the cursor points (the last layer the last landed edit added); see `pointerId`. */
    pointerId?: string
    text: string
    state: AgentMarkState
  }[]
  rejections: { key: string; origin: string; nodeId: string; text: string }[]
  /** Board 31 landing flash: the top-most layers each successful edit changed (newest last). */
  landed: { key: string; origin: string; ids: string[] }[]
}

export type PanelMenu = "model" | "skills" | "mode" | null

export interface AgentPanelViewState extends AgentPanelState {
  menu: PanelMenu
  /** The composer's lead mark (Listening while focused / typing). */
  mark: AgentMarkState
  modeRun: ModeRunView | null
  canvas: CanvasAgentState
  /** Selection chips the user removed (until the selection changes). */
  composerFocused: boolean
  /** Short label of the composer's model chip ("Opus 5.5"). */
  modelLabel: string
  /** Mode chip copy ("Single", "Side by side · 3"). */
  modeLabel: string
  /** Running or waiting. */
  busy: boolean
  /** Turn ids already undone with "Undo turn". */
  undoneTurns: string[]
  /** Live tokens / cost of the streaming turn (board 22 A streaming meta). */
  live: LiveMeta | null
  /** Prompt-node run state by node id (app data, ADR 0014 §9; footer + layer row). */
  promptRuns: Readonly<Record<string, PromptRunState>>
  /** Every pending in-app approval, oldest first (board 25 rule "Approval queue"). */
  approvals: ApprovalPromptView[]
  /**
   * Board 34: this session approves every request at once (outcome `auto`). Off for every new
   * session and never saved.
   */
  autoApprove: boolean
  /**
   * Agent tab first run (board 25 §5): a detected, signed-in CLI to confirm (FrS9y), or the
   * inline Anthropic key card (D8covN). Null once a provider passed its Test / a CLI is chosen.
   */
  onboarding: OnboardingView | null
  /** Board 25 rule "Composer": rendered but disabled (50 %) until a provider is connected. */
  composerDisabled: boolean
  /** Settings › AI providers "Show cost" (board 27 r9hTk): off hides every $; tokens stay. */
  showCost: boolean
  /**
   * Board 27 THx2k: a send estimated above "Warn per turn above" is held here (nothing is sent)
   * until Send anyway / Edit message.
   */
  costWarning: CostWarningView | null
}

/** Agent tab first run (board 25 p55vU). */
export type OnboardingView =
  | { kind: "cli"; cli: CliDetection }
  | { kind: "key"; provider: "anthropic"; connecting: boolean; error: string | null }

/** Board 23 detection order: Claude Code, then Codex / Gemini CLI. */
const CLI_ORDER = ["claude-code", "codex", "gemini-cli"]

/** What a prompt-node run needs from the document (board 22 cf2sC, ADR 0014 §9). */
export interface PromptRunInput {
  prompt: PromptNodeView
  /** A frame by id (the prompt's `target`), null when it is not a frame. */
  frame(
    id: string,
  ): { id: string; name?: string; box: { x: number; y: number; w: number; h: number } } | null
  /** Every note of the page (the run reads the ones attached to / overlapping its target). */
  notes: readonly NoteView[]
}

export interface AgentPanelControllerExt extends AgentPanelController {
  readonly state: AgentPanelViewState
  subscribe(listener: (s: AgentPanelViewState) => void): () => void
  setText(text: string): void
  setFocused(focused: boolean): void
  openMenu(menu: PanelMenu): void
  /** Inserts `/name ` at the start of the composer text (skills menu Enter). */
  insertSkill(name: string): void
  setSelection(items: SelectionItem[]): void
  /** Starts the Home hand-off session (origin "home", mode Single, scope page). */
  startFromHome(
    h: HomeAgentHandoff & { model: ModelSelection; frameId?: string; fileName?: string },
  ): Promise<void>
  /** Side by side: Keep / Discard one variant. */
  keepVariant(origin: string): void
  discardVariant(origin: string): Promise<void>
  /** Iterate: Before / After toggle of the review card. */
  setIterateView(view: "before" | "after"): void
  /** Re-reads providers, CLIs and skills. */
  refresh(): Promise<void>
  /** First run (board 25 FrS9y): "Use Claude Code" — makes the detected CLI the default. */
  chooseCli(id: string): Promise<void>
  /**
   * First run (board 25 D8covN): saves the key, runs its Test; on a pass the panel switches to
   * an empty thread. Resolves with the Test outcome.
   */
  connectKey(key: string): Promise<{ ok: boolean; detail: string }>
  /** Refusal "Edit request": the turn's prompt back in the composer. */
  editRequest(turnId: string): void
  /**
   * Board 34 auto-approve for this session. Turning it on approves the pending cards at once
   * (the UI asks first); a new or reopened session starts off.
   */
  setAutoApprove(on: boolean): void
  /** Cost warning "Send anyway": sends the held message without asking again. */
  sendAnyway(): Promise<void>
  /** Cost warning "Edit message": drops the hold; the text stays in the composer. */
  editHeldMessage(): void
  /** Cost warning "Settings" link (Settings › AI providers). */
  openCostSettings(): void
  /** A link in a reply (http, https or mailto; board 33): the system browser. */
  openLink(url: string): void
  /** Board 33 §2 queued message ×: drops it from the queue. */
  removeQueued(index: number): void
  /** Board 33 §2 queued message click / Edit: drops it and puts its text back in the composer. */
  editQueued(index: number): void
  /** Copies a message's text (MessageMeta copy). */
  copyText(messageId: string): string
  /**
   * Runs a prompt node: one Single turn scoped to its `target`, or to a new placeholder frame
   * next to it (`planPromptRun`). Run state lands in `state.promptRuns[nodeId]`.
   */
  runPrompt(input: PromptRunInput): Promise<void>
  /** Stops a running prompt node (its in-flight op batch commits or rolls back). */
  stopPrompt(nodeId: string): void
  dispose(): void
}

export interface AgentPanelOptions {
  runtime: AgentPanelRuntime
  /** Same id as leases / recovery / activity (`sha256(path)[:16]` or `untitled-<docId>`). */
  fileId: string
  fileName: string
  /** The document id the tools address (kimo_get_state docId). */
  docId(): string
  /**
   * Frame geometry for side by side (the original's box). `n` = variants about to be placed:
   * the shell may move the box's `y` so the row of `n` copies lands on free canvas
   * (`sideBySideAnchor`).
   */
  frameBox?(id: string, n?: number): FrameBox | null
  /** Gap between side-by-side variants (board ZFOQf `agblr`: 40). Default 80 (`planSideBySide`). */
  sideBySideGap?: number
  nodeName?(id: string): string | undefined
  /** Board 27 §1: the active page (null for a one-page document), for the system context. */
  activePage?(): { id: string; name: string; count: number } | null
  /** A node's parent id (null at top level): step labels, Follow and landing flashes. */
  parentOf?(id: string): string | null
  /**
   * Board 31 token pass: the compact page outline for the turn context (`buildPageOutline`
   * over the active page; `selection` outlined first and deepest), or null.
   */
  outline?(selection: readonly string[]): string | null
  /**
   * The docId a local CLI's MCP server sees for this file (the document host's), or null when
   * the window is not hosted. API turns use {@link AgentPanelOptions.docId}.
   */
  cliDocId?(): string | null
  now?(): number
}

const ROTATE_LABEL: Record<Exclude<ModeConfig["mode"], "single">, string> = {
  "side-by-side": "Side by side",
  split: "Split",
  iterate: "Iterate",
}

export function modeChipLabel(m: ModeConfig): string {
  if (m.mode === "single") return "Single"
  return `${ROTATE_LABEL[m.mode]} · ${m.mode === "iterate" ? m.passes : m.agents}`
}

/** Mark state of an agent message / row from its live progress (board 24 mapping eqlcN). */
export function markOf(
  streaming: boolean,
  steps: AgentStepView[],
  card?: ErrorCard,
): AgentMarkState {
  if (card && (card.severity === "danger" || card.kind === "refusal")) return "error"
  if (!streaming) return "done"
  return steps.length > 0 ? "working" : "thinking"
}

const textOf = (m: ChatMessage): string =>
  m.role === "tool"
    ? ""
    : m.content
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("")

/** Re-creates the thread view of finished turns (opening a session). */
export function messagesFromTurns(
  turns: readonly TurnRecord[],
  meta: (t: TurnRecord, last: boolean) => MessageMetaView,
): AgentMessageView[] {
  const out: AgentMessageView[] = []
  turns.forEach((t, i) => {
    const user = t.messages[0]
    if (user?.role === "user") {
      const skills = t.skillsUsed
      out.push({
        kind: "user",
        id: `${t.id}:u`,
        text: textOf(user),
        attachments: user.content
          .filter((p): p is ImagePart => p.type === "image")
          .map((p, k) => ({
            id: `${t.id}:img${k}`,
            kind: "image" as const,
            label: "image",
            image: { mimeType: p.mimeType, data: p.data },
          })),
        skills,
        fromHome: false,
      })
    }
    const steps: AgentStepView[] = []
    for (const m of t.messages)
      if (m.role === "assistant")
        for (const p of m.content)
          if (p.type === "tool_call")
            steps.push({ callId: p.id, tool: p.name, label: p.name, state: "done", changed: [] })
    for (const m of t.messages)
      if (m.role === "tool")
        for (const r of m.results) {
          const s = steps.find((x) => x.callId === r.callId)
          if (!s) continue
          try {
            const env = JSON.parse(r.content) as { ok: boolean; summary: string }
            s.label = env.summary || s.label
            s.state = env.ok ? "done" : "failed"
          } catch {}
        }
    const text = replyOf(t.messages)
    out.push({
      kind: "agent",
      id: `${t.id}:a`,
      turnId: t.id,
      text,
      streaming: false,
      steps,
      meta: meta(t, i === turns.length - 1),
      ...(t.autoApproved?.length ? { autoApproved: [...t.autoApproved] } : {}),
      ...(t.error && t.status !== "done" ? { card: t.error } : {}),
    })
  })
  return out
}

/** One finished turn's MessageMeta. */
export function turnMeta(t: TurnRecord, canRegenerate: boolean): MessageMetaView {
  return {
    // Board 31: new tokens only; cached re-reads go to the tooltip.
    tokensIn: t.usage.inputTokens + t.usage.cacheWriteTokens,
    tokensOut: t.usage.outputTokens,
    tokensCached: t.usage.cacheReadTokens,
    costUsd: t.billing === "subscription" ? null : t.cost.usd,
    billing: t.billing ?? "api",
    wallMs: Math.max(0, t.endedAt - t.startedAt),
    canRegenerate,
  }
}

/** Model picker groups (board 22 C): local CLIs first (Claude Code default when signed in), then API providers, default first. */
export function pickerGroups(input: {
  platform: "desktop" | "web" | "node"
  providers: readonly ProviderConfig[]
  unavailable: readonly { id: string; label: string; tag: string }[]
  clis: readonly CliDetection[]
  defaultSelection: ModelSelection | null
  labelOf(provider: string): string
}): ModelPickerGroup[] {
  const groups: ModelPickerGroup[] = []
  if (input.platform === "desktop") {
    const order = [...input.clis].sort(
      (a, b) => Number(b.id === "claude-code") - Number(a.id === "claude-code"),
    )
    for (const d of order) {
      if (!d.installed) continue
      const adapter = BUILTIN_CLI_ADAPTERS.find((a) => a.def.id === d.id)
      const signedIn = d.signedIn === true
      groups.push({
        provider: cliProviderId(d.id),
        label: d.label,
        family: "cli",
        isDefault: input.defaultSelection?.provider === cliProviderId(d.id),
        available: signedIn,
        ...(signedIn
          ? { tag: d.billing === "cli-api-key" ? "API key" : "subscription" }
          : { tag: "not signed in" }),
        billing: d.billing ?? "subscription",
        models: (adapter?.def.models ?? [{ id: "default", label: d.label }]).map((m) => ({
          id: m.id,
          label: m.label,
          thinking: d.id === "claude-code" || d.id === "codex",
        })),
      })
    }
  }
  const apis = [...input.providers].sort(
    (a, b) =>
      Number(b.id === input.defaultSelection?.provider) -
      Number(a.id === input.defaultSelection?.provider),
  )
  for (const p of apis) {
    const ids = [...new Set([p.models.agent, p.models.fast, ...(p.extraModels ?? [])])].filter(
      Boolean,
    )
    groups.push({
      provider: p.id,
      label: p.label,
      family: "api",
      isDefault: input.defaultSelection?.provider === p.id,
      available: true,
      ...(p.free ? { tag: "local" } : {}),
      billing: p.free ? "local" : "api",
      models: ids.map((id) => {
        const info =
          MODEL_CATALOG[p.kind].find((m) => m.id === id) ??
          (p.kind === "bedrock" || p.kind === "vertex" || p.kind === "foundry"
            ? MODEL_CATALOG.anthropic.find((m) => m.id === id)
            : undefined)
        return {
          id,
          label: info?.label ?? id,
          ...(p.free
            ? { role: "local" as const }
            : id === p.models.agent
              ? { role: "agent" as const }
              : id === p.models.fast
                ? { role: "fast" as const }
                : {}),
          thinking: info ? supportsThinkingControl(info) : false,
        }
      }),
    })
  }
  for (const u of input.unavailable)
    if (!groups.some((g) => g.provider === u.id))
      groups.push({
        provider: u.id,
        label: u.label,
        family: "api",
        isDefault: false,
        available: false,
        tag: u.tag,
        billing: "api",
        models: [],
      })
  return groups
}

let turnSeq = 0
const turnId = () => `t${Date.now().toString(36)}${(++turnSeq).toString(36)}`

export function createAgentPanelController(o: AgentPanelOptions): AgentPanelControllerExt {
  const rt = o.runtime
  const now = o.now ?? rt.now ?? Date.now
  const listeners = new Set<(s: AgentPanelViewState) => void>()
  let personas = new PersonaAllocator(now)
  let disposed = false

  let providers: ProviderConfig[] = []
  let catalog: SkillCatalog = { builtin: [], user: [], errors: [] }
  let session: Session | null = null
  let selection: SelectionItem[] = []
  let removedSelection = new Set<string>()
  let images: AttachmentChipView[] = []
  let text = ""
  let model: ModelSelection | null = rt.defaultSelection()
  let thinking: ThinkingMode = "auto"
  let mode: ModeConfig = { ...DEFAULT_MODE }
  let enabledSkills: string[] = ["kimo-design"]
  let messages: AgentMessageView[] = []
  let queued: string[] = []
  let menu: PanelMenu = null
  let focused = false
  let sessionsOpen = false
  let sessionQuery = ""
  let sessionList: SessionMeta[] = []
  let approvalQueue: (ApprovalPromptView & { resolve(o: ApprovalOutcome): void })[] = []
  let autoApprove = false
  let connect: { connecting: boolean; error: string | null } = { connecting: false, error: null }
  let abort: AbortController | null = null
  let composerState: AgentComposerView["state"] = "idle"
  let modeRun: ModeRunView | null = null
  let canvas: CanvasAgentState = {
    live: [],
    info: {},
    scopes: [],
    cursors: [],
    rejections: [],
    landed: [],
  }
  let undoneTurns: string[] = []
  let liveUsage: Usage = { ...ZERO_USAGE }
  let liveCost: number | null = 0
  let pendingFromHome = false
  // Finished prompt runs come back from app data (ADR 0014 §9); live ones stay in memory.
  let promptRuns: Record<string, PromptRunState> = loadPromptRuns()
  /** The prompt node the running turn belongs to, with its lead origin. */
  let runningPrompt: { nodeId: string; origin: string } | null = null
  let lastRecord: TurnRecord | null = null
  let costWarning: CostWarningView | null = null

  // --- State ------------------------------------------------------------------------------------

  const info = (sel: ModelSelection | null) => {
    if (!sel || isCliProvider(sel.provider)) return null
    const p = providers.find((x) => x.id === sel.provider)
    if (!p) return null
    return (
      MODEL_CATALOG[p.kind].find((m) => m.id === sel.model) ??
      MODEL_CATALOG.anthropic.find((m) => m.id === sel.model) ??
      null
    )
  }
  const billingOf = (sel: ModelSelection | null): MessageMetaView["billing"] => {
    if (!sel) return "api"
    if (isCliProvider(sel.provider)) {
      const d = rt.clis().find((c) => c.id === cliIdOf(sel.provider))
      return d?.billing ?? "subscription"
    }
    return providers.find((p) => p.id === sel.provider)?.free ? "local" : "api"
  }

  /** Layer names for step labels: undefined when unnamed (the shell falls back to the id). */
  const layerName = (id: string): string | undefined => {
    const n = o.nodeName?.(id)
    return n && n !== id ? n : undefined
  }
  const stepNames: StepNames = {
    name: layerName,
    parentName: (id) => {
      const p = o.parentOf?.(id)
      return p ? layerName(p) : undefined
    },
  }

  /** The top-most of `ids` (drops ids whose ancestor is listed too), at most `max`. */
  /** Board 31 Follow: the layer the cursor points at, else its work area. */
  function followOf(c: { nodeId: string; nodeIds?: string[]; pointerId?: string }): string[] {
    return c.pointerId ? [c.pointerId] : (c.nodeIds ?? [c.nodeId])
  }

  function topMost(ids: readonly string[], max = 24): string[] {
    const set = new Set(ids)
    const out: string[] = []
    for (const id of ids) {
      let p = o.parentOf?.(id) ?? null
      let covered = false
      for (let guard = 0; p && guard < 256; guard++) {
        if (set.has(p)) {
          covered = true
          break
        }
        p = o.parentOf?.(p) ?? null
      }
      if (!covered && !out.includes(id)) out.push(id)
      if (out.length >= max) break
    }
    return out
  }

  function attachments(): AttachmentChipView[] {
    return [
      ...selection
        .filter((s) => !removedSelection.has(s.id))
        .map((s) => ({
          id: `sel:${s.id}`,
          kind: "selection" as const,
          label: s.name,
          nodeIds: [s.id],
        })),
      ...images,
    ]
  }

  function slash(): AgentComposerView["slash"] {
    if (menu === "skills") {
      const m = /^\/([a-z0-9-]*)$/.exec(text.trimStart())
      return { open: true, filter: m?.[1] ?? "" }
    }
    return null
  }

  /**
   * Board 25 §5 rules GXL4Z: no API provider + a signed-in local CLI (detection order) → confirm
   * it ("Use Claude Code"); no provider and no CLI → the inline key card. A thread with messages
   * never shows it.
   */
  function onboardingOf(clis: readonly CliDetection[]): OnboardingView | null {
    const ready = rt.apiReady ? rt.apiReady() : providers.length > 0
    if (ready || messages.length > 0) return null
    const usable = clis.filter((c) => c.signedIn === true).sort((a, b) => rank(a.id) - rank(b.id))
    const cli = usable[0]
    if (cli) {
      if (rt.cliConfirmed?.() ?? true) return null
      return { kind: "cli", cli }
    }
    if (model) return null
    return { kind: "key", provider: "anthropic", ...connect }
  }
  const rank = (id: string) => {
    const i = CLI_ORDER.indexOf(id)
    return i < 0 ? CLI_ORDER.length : i
  }

  function compute(): AgentPanelViewState {
    const clis = rt.clis()
    const groups = pickerGroups({
      platform: rt.platform,
      providers,
      unavailable: rt.unavailable?.() ?? [],
      clis,
      defaultSelection: rt.defaultSelection(),
      labelOf: rt.labelOf,
    })
    const inf = info(model)
    const cliThinking =
      model && isCliProvider(model.provider)
        ? ["claude-code", "codex"].includes(cliIdOf(model.provider))
        : false
    const tokens = session ? newTokens(session.usage) : 0
    const firstRun = !model && providers.length === 0 && !clis.some((c) => c.signedIn === true)
    const busy = composerState !== "idle"
    const approval = approvalQueue[0] ?? null
    const onboarding = onboardingOf(clis)
    return {
      session: session ? metaOf(session) : null,
      messages,
      composer: {
        state: composerState,
        text,
        queued,
        model,
        thinking,
        thinkingAvailable: inf ? supportsThinkingControl(inf) : cliThinking,
        mode,
        attachments: attachments(),
        slash: slash(),
      },
      header: {
        title: session?.title ?? "New session",
        costUsd: session?.costUsd ?? 0,
        tokens,
        billing: session ? (session.billing === "api" ? "api" : session.billing) : billingOf(model),
      },
      sessionsOpen,
      sessions: { ...groupSessions(sessionList, o.fileId), query: sessionQuery },
      skills: {
        builtin: catalog.builtin,
        user: catalog.user,
        enabled: enabledSkills,
        errors: catalog.errors.map((e) => `${e.path ?? ""}${e.path ? ": " : ""}${e.message}`),
      },
      picker: groups,
      modeSummary: modeRun
        ? {
            mode: modeRun.mode,
            agents: modeRun.agents,
            done: modeRun.done,
            total: modeRun.total,
            costUsd: modeRun.costUsd,
            tokens: modeRun.tokens,
            ...(modeRun.iterate
              ? {
                  iterate: {
                    pass: modeRun.iterate.pass,
                    of: modeRun.iterate.of,
                    reviewing: modeRun.iterate.reviewing,
                    summary: modeRun.iterate.summary,
                    changes: modeRun.iterate.changes,
                  },
                }
              : {}),
          }
        : null,
      approval: approval
        ? {
            request: approval.request,
            queued: approvalQueue.length,
            choices: approval.choices,
            remainingMs: approval.remainingMs,
          }
        : null,
      autoApprove,
      approvals: approvalQueue.map((a, i) => ({
        request: a.request,
        queued: approvalQueue.length - i,
        choices: a.choices,
        remainingMs: a.remainingMs,
      })),
      onboarding,
      composerDisabled: onboarding !== null,
      showCost: rt.usage?.().showCost ?? true,
      costWarning,
      firstRun,
      menu,
      mark:
        approvalQueue.length > 0
          ? "waiting"
          : busy
            ? "working"
            : focused || text.length > 0
              ? "listening"
              : "idle",
      modeRun,
      canvas,
      composerFocused: focused,
      modelLabel: modelLabel(model, clis),
      modeLabel: modeChipLabel(mode),
      busy,
      undoneTurns,
      live: busy ? liveMeta() : null,
      promptRuns: livePromptRuns(),
    }
  }

  function loadPromptRuns(): Record<string, PromptRunState> {
    try {
      return rt.promptRuns?.load(o.fileId) ?? {}
    } catch {
      return {}
    }
  }
  function savePromptRun(nodeId: string) {
    const st = promptRuns[nodeId]
    try {
      if (st) rt.promptRuns?.save(o.fileId, nodeId, st)
    } catch {
      // App data unavailable: the state lives until the window closes.
    }
  }

  /** Prompt runs with the running one's live op count / cost. */
  function livePromptRuns(): Record<string, PromptRunState> {
    if (!runningPrompt) return promptRuns
    const cur = promptRuns[runningPrompt.nodeId]
    if (cur?.status !== "running") return promptRuns
    const ops = canvas.info[runningPrompt.origin]?.ops ?? cur.live?.ops ?? 0
    return {
      ...promptRuns,
      [runningPrompt.nodeId]: { ...cur, live: { ops, costUsd: liveMeta().costUsd } },
    }
  }

  let state = compute()
  function emit() {
    if (disposed) return
    state = compute()
    for (const l of listeners) l(state)
  }

  const metaOf = ({ turns: _t, cliSessionId: _c, ...m }: Session): SessionMeta => m

  // --- Sessions ---------------------------------------------------------------------------------

  async function reloadSessions() {
    try {
      sessionList = sessionQuery.trim()
        ? await rt.sessions.search(sessionQuery)
        : await rt.sessions.list()
    } catch {
      sessionList = []
    }
    emit()
  }

  function ensureSession(origin: Session["origin"] = "panel", id?: string): Session {
    if (session) return session
    const sel = model as ModelSelection
    session = newSession({
      ...(id ? { id } : { id: newSessionId(rt.random ?? Math.random) }),
      fileId: o.fileId,
      fileName: o.fileName,
      model: sel,
      thinking,
      mode,
      origin,
      enabledSkills,
      billing: (() => {
        const b = billingOf(sel)
        return b === "api" ? "api" : b
      })(),
      now: now(),
    })
    return session
  }

  async function persist() {
    if (!session) return
    try {
      await rt.sessions.put(session)
    } catch {}
    void reloadSessions()
  }

  // --- Approvals (in-app: wait indefinitely; Stop answers deny) ----------------------------------

  function requestApproval(req: ApprovalRequest): Promise<ApprovalOutcome> {
    if (autoApprove) {
      noteAutoApproved(req)
      emit()
      return Promise.resolve("auto")
    }
    return new Promise((resolve) => {
      // More than one pending: cards stack in order (board 25 rule "Approval queue").
      approvalQueue = [
        ...approvalQueue,
        {
          request: req as never,
          queued: 1,
          choices: approvalChoices(req as never),
          remainingMs: Number.POSITIVE_INFINITY,
          resolve,
        },
      ]
      composerState = "waiting-approval"
      emit()
    })
  }

  /** Answers one pending approval (the oldest when `id` is omitted). */
  function settleApproval(outcome: ApprovalOutcome, id?: string) {
    const a = id ? approvalQueue.find((x) => x.request.id === id) : approvalQueue[0]
    if (!a) return
    approvalQueue = approvalQueue.filter((x) => x !== a)
    if (approvalQueue.length === 0 && composerState === "waiting-approval")
      composerState = "streaming"
    a.resolve(outcome)
    emit()
  }

  /**
   * Board 34 thread line: "Approved automatically: …" on the running agent turn (the last
   * streaming agent message, else the last agent message).
   */
  function noteAutoApproved(req: ApprovalRequest) {
    const line = autoApprovalLine(req as never, stepNames)
    const target =
      messages.findLast((m) => m.kind === "agent" && m.streaming) ??
      messages.findLast((m) => m.kind === "agent")
    if (target)
      updateAgentMessage(target.id, (m) => ({
        ...m,
        autoApproved: [...(m.autoApproved ?? []), line],
      }))
  }

  /** Stop answers every pending approval Deny. */
  function denyAll() {
    while (approvalQueue.length) settleApproval("deny")
  }

  // --- Canvas bookkeeping -----------------------------------------------------------------------

  function setLive(origin: string, label: string, persona: Persona, on: boolean) {
    const live = new Set(canvas.live)
    if (on) live.add(origin)
    else live.delete(origin)
    canvas = {
      ...canvas,
      live: [...live],
      info: {
        ...canvas.info,
        [origin]: { label, persona, ops: canvas.info[origin]?.ops ?? 0, paused: false },
      },
      ...(on ? {} : { cursors: canvas.cursors.filter((c) => c.origin !== origin) }),
    }
  }

  /**
   * Moves the origin's work area to the existing layers in `ids` (no-op if none). The pointer
   * (board 31 "Agent cursor") moves to `pointer` when given, else stays on its layer.
   */
  function moveCursor(origin: string, ids: readonly string[], pointer?: string) {
    const exists = (id: string) => !o.nodeName || o.nodeName(id) !== undefined
    const area = workAreaIds(ids.filter(exists), (id) => o.parentOf?.(id) ?? null).slice(0, 50)
    if (!area.length) return
    const prev = canvas.cursors.find((c) => c.origin === origin)?.pointerId
    const pointerId = pointer && exists(pointer) ? pointer : prev
    canvas = {
      ...canvas,
      cursors: [
        ...canvas.cursors.filter((c) => c.origin !== origin),
        // Board 31: the canvas label is the agent's name only; status lives in the panel.
        {
          origin,
          nodeId: area[0] as string,
          nodeIds: area,
          ...(pointerId ? { pointerId } : {}),
          text: canvas.info[origin]?.label ?? "Kimo",
          state: "working",
        },
      ],
    }
  }

  function trackCanvas(origin: string, e: AgentEvent) {
    if (e.type === "step_start") {
      // The cursor moves to the layers this step reads or edits; a batch that only inserts
      // keeps the last area (its nodes have no box until it lands), else its insert parents.
      const tg = callTargets(e.tool, e.input)
      const had = canvas.cursors.some((c) => c.origin === origin)
      moveCursor(origin, tg.ids.length ? tg.ids : had ? [] : tg.parents)
    } else if (e.type === "step_end") {
      // A landed edit: the area becomes what it created / changed (not the page frame) and the
      // pointer moves to the last layer it added (board 31 "Agent cursor").
      if (e.ok && e.changed.length) moveCursor(origin, e.changed, e.pointer)
      const inf = canvas.info[origin]
      if (inf && e.ok) {
        const changed = e.changed.length
        canvas = {
          ...canvas,
          info: { ...canvas.info, [origin]: { ...inf, ops: inf.ops + (changed ? 1 : 0) } },
        }
      }
      if (e.ok && e.changed.length && e.undoToken) {
        const ids = topMost(e.changed)
        if (ids.length)
          canvas = {
            ...canvas,
            landed: [...canvas.landed.slice(-7), { key: `${origin}:${e.callId}`, origin, ids }],
          }
      }
      if (!e.ok && (e.errorCode === "OUT_OF_SCOPE" || e.errorCode === "PERMISSION_DENIED")) {
        const cursor = canvas.cursors.find((c) => c.origin === origin)
        canvas = {
          ...canvas,
          rejections: [
            ...canvas.rejections.slice(-5),
            {
              key: `${origin}:${e.callId}`,
              origin,
              nodeId: cursor?.nodeId ?? "",
              text: `${e.tool.replace(/^kimo_/, "").replace(/_/g, " ")} → ${e.errorCode}`,
            },
          ],
        }
      }
    }
  }

  // --- Running one agent ------------------------------------------------------------------------

  interface AgentRunInput {
    origin: `agent:${string}`
    label: string
    persona: Persona
    policy: ReturnType<typeof leadPolicy>
    exclude?: readonly string[]
    extra?: Parameters<AgentPanelRuntime["tools"]>[0]["extra"]
    model: ModelSelection
    thinking: ThinkingMode
    history: ChatMessage[]
    user: UserMessage
    skills: Skill[]
    scope?: { id: string; name: string }[]
    selectionSummary?: string
    brief?: string
    fromHome?: boolean
    modeName: ModeConfig["mode"]
    cliSessionId?: string
    signal: AbortSignal
    onEvent(e: AgentEvent): void
  }

  function toolsFor(
    i: Pick<AgentRunInput, "origin" | "label" | "policy" | "exclude" | "extra">,
  ): ToolHost {
    const parsed = /^agent:kimo\.([a-z0-9]+)\./.exec(i.origin)
    return rt.tools({
      origin: i.origin,
      label: i.label,
      session: parsed?.[1] ?? "kimo",
      policy: i.policy,
      ...(i.exclude ? { exclude: i.exclude } : {}),
      ...(i.extra ? { extra: i.extra } : {}),
      requestApproval,
    })
  }

  /** Board 31 token pass: what the turn context says about the document (never throws). */
  function docContext(cli: boolean, scope: readonly { id: string }[] | undefined) {
    let docId: string | null = null
    let outline: string | null = null
    try {
      docId = (cli ? o.cliDocId?.() : o.docId()) || null
    } catch {}
    try {
      outline = o.outline?.((scope ?? []).map((s) => s.id).filter(Boolean)) ?? null
    } catch {}
    return {
      ...(docId ? { doc: { id: docId, name: o.fileName } } : {}),
      ...(outline ? { outline } : {}),
    }
  }

  async function runAgent(i: AgentRunInput): Promise<TurnRecord> {
    const id = turnId()
    const activePage = o.activePage?.() ?? null
    const system = buildSystemPrompt({
      mode: i.modeName,
      skills: i.skills,
      ...(i.scope ? { scope: i.scope } : {}),
      ...(i.selectionSummary ? { selection: i.selectionSummary } : {}),
      ...(i.brief ? { brief: i.brief } : {}),
      ...(i.fromHome ? { fromHome: true } : {}),
      ...(activePage ? { page: activePage } : {}),
      ...docContext(isCliProvider(i.model.provider), i.scope),
    })
    const failRecord = (err: ProviderError): TurnRecord => {
      const record: TurnRecord = {
        id,
        model: i.model,
        thinking: i.thinking,
        startedAt: now(),
        endedAt: now(),
        messages: [i.user],
        usage: { ...ZERO_USAGE },
        cost: { usd: null, estimated: true, priceVersion: "n/a" },
        opGroups: [],
        opsApplied: 0,
        status: "error",
        error: errorCard(err, { providerLabel: rt.labelOf(i.model.provider), opsApplied: 0 }),
        servedBy: i.model.model,
        skillsUsed: i.skills.map((s) => s.name),
      }
      i.onEvent({ type: "turn_start", turnId: id })
      i.onEvent({ type: "turn_end", record })
      return record
    }
    let resolved: ReturnType<typeof resolveRuntime>
    try {
      resolved = resolveRuntime(i.model, {
        providers,
        clis: rt.clis(),
        platform: rt.platform,
      })
    } catch (e) {
      return failRecord(
        e instanceof ProviderError
          ? e
          : new ProviderError("unknown", e instanceof Error ? e.message : String(e), {
              provider: i.model.provider,
            }),
      )
    }
    if (resolved.kind === "cli") {
      if (!rt.cliHost)
        return failRecord(
          new ProviderError(
            "unsupported_platform",
            "Local agent CLIs run only in the desktop app.",
            {
              provider: i.model.provider,
            },
          ),
        )
      const cli = resolved.adapter.def.id
      return runCliTurn({
        turnId: id,
        adapter: resolved.adapter,
        detection: resolved.detection,
        host: rt.cliHost,
        session: session?.id ?? "kimo",
        ...(i.cliSessionId ? { cliSessionId: i.cliSessionId } : {}),
        model: i.model,
        thinking: i.thinking,
        user: i.user,
        // Stable part = the CLI's system prompt; this turn's context leads the user message.
        systemPrompt: system.stable,
        ...(system.volatile ? { context: system.volatile } : {}),
        mcp: rt.mcpLaunch?.(cli) ?? shimLaunch("kimo-mcp", cli),
        signal: i.signal,
        onEvent: i.onEvent,
        now,
        names: stepNames,
      })
    }
    const provider = providerFor(rt, resolved.config)
    const usage = rt.usage?.()
    return runTurn({
      turnId: id,
      provider,
      model: i.model,
      info: resolved.resolved.info,
      thinking: i.thinking,
      system,
      history: i.history,
      user: i.user,
      tools: toolsFor(i),
      origin: i.origin,
      signal: i.signal,
      onEvent: i.onEvent,
      skillsUsed: i.skills.map((s) => s.name),
      providerLabel: rt.labelOf(i.model.provider),
      names: stepNames,
      ...(resolved.config.free ? { free: true } : {}),
      ...(rt.online ? { online: rt.online } : {}),
      ...(rt.waitForOnline ? { waitForOnline: rt.waitForOnline } : {}),
      ...(rt.random ? { random: rt.random } : {}),
      now,
      ...(usage && usage.monthlyLimitUsd > 0
        ? {
            budget: {
              check: (turnUsd: number) =>
                usage.monthUsd + turnUsd >= usage.monthlyLimitUsd
                  ? `Monthly limit reached · $${usage.monthlyLimitUsd.toFixed(2)}`
                  : null,
            },
          }
        : {}),
    })
  }

  /**
   * Board 27 THx2k: the held warning for sending `t` now, or null (under the threshold, CLI /
   * local / unpriced model, 0 = never warn).
   */
  function costWarningFor(t: string): CostWarningView | null {
    const usage = rt.usage?.()
    if (!usage || !model || isCliProvider(model.provider)) return null
    const p = providers.find((x) => x.id === model?.provider)
    if (!p) return null
    const atts = attachments()
    const estimate = estimateTurn({
      kind: p.kind,
      model: model.model,
      ...(p.free ? { free: true } : {}),
      text: t,
      history: messages.map((m) => m.text),
      frames: atts.filter((a) => a.kind === "selection").length,
      images: atts.filter((a) => a.kind === "image").length,
      multiplier:
        mode.mode === "side-by-side" || mode.mode === "split"
          ? mode.agents
          : mode.mode === "iterate"
            ? mode.passes
            : 1,
    })
    return shouldWarn(estimate, usage.warnPerTurnUsd)
      ? { text: t, estimate, thresholdUsd: usage.warnPerTurnUsd }
      : null
  }

  // --- The thread's live agent message ----------------------------------------------------------

  function updateAgentMessage(
    id: string,
    patch: (
      m: Extract<AgentMessageView, { kind: "agent" }>,
    ) => Extract<AgentMessageView, { kind: "agent" }>,
  ) {
    messages = messages.map((m) => (m.kind === "agent" && m.id === id ? patch(m) : m))
  }

  /**
   * AgentEvent → thread view for the lead's message `msgId` (board 31): streamed text feeds the
   * live status line (the agent's notes) and is not shown; the reply lands at turn end
   * (`finishTurn`). A BATCH_TOO_LARGE refusal is the agent's own correction: it never shows as a
   * step, a failure or a card.
   */
  function threadHandler(msgId: string, origin: string) {
    const tracker = new ProgressTracker()
    const fresh = () => ({
      status: START_STATUS.text,
      source: START_STATUS.source,
      startedAt: now(),
      follow: [] as string[],
    })
    const patchProgress = (
      patch: Partial<NonNullable<Extract<AgentMessageView, { kind: "agent" }>["progress"]>>,
    ) =>
      updateAgentMessage(msgId, (m) => ({
        ...m,
        progress: {
          ...(m.progress ?? fresh()),
          status: tracker.status.text,
          source: tracker.status.source,
          ...patch,
        },
      }))
    return (e: AgentEvent) => {
      trackCanvas(origin, e)
      switch (e.type) {
        case "turn_start":
          liveUsage = { ...ZERO_USAGE }
          liveCost = 0
          updateAgentMessage(msgId, (m) => ({
            ...m,
            turnId: e.turnId,
            progress: m.progress ?? fresh(),
          }))
          break
        case "text_delta":
          tracker.text(e.text)
          patchProgress({})
          break
        case "discard_partial":
          tracker.discard()
          patchProgress({})
          break
        case "message_end":
          tracker.messageEnd()
          break
        case "step_start": {
          tracker.step(e.label)
          // Follow targets where the cursor points, else its area.
          const cursor = canvas.cursors.find((c) => c.origin === origin)
          if (cursor) patchProgress({ follow: followOf(cursor) })
          updateAgentMessage(msgId, (m) => ({
            ...m,
            steps: [
              ...m.steps,
              {
                callId: e.callId,
                tool: e.tool,
                label: `${e.label}…`,
                state: "running",
                changed: [],
              },
            ],
          }))
          break
        }
        case "step_end":
          if (!e.ok && e.errorCode === "BATCH_TOO_LARGE") {
            updateAgentMessage(msgId, (m) => ({
              ...m,
              steps: m.steps.filter((s) => s.callId !== e.callId),
            }))
            break
          }
          updateAgentMessage(msgId, (m) => ({
            ...m,
            steps: m.steps.map((s) =>
              s.callId === e.callId
                ? {
                    ...s,
                    state: e.ok ? "done" : "failed",
                    label: e.summary || s.label.replace(/…$/, ""),
                    summary: e.summary,
                    changed: e.changed,
                    ...(e.undoToken ? { undoToken: e.undoToken } : {}),
                    ...(e.errorCode ? { errorCode: e.errorCode } : {}),
                  }
                : s,
            ),
          }))
          if (e.ok && e.changed.length && e.undoToken) {
            const cursor = canvas.cursors.find((c) => c.origin === origin)
            const ids = cursor ? followOf(cursor) : topMost(e.changed)
            if (ids.length) patchProgress({ follow: ids })
          }
          break
        case "usage":
          liveUsage = e.usage
          liveCost = e.cost.usd
          break
        case "retry":
        case "paused":
          if (e.type === "paused") composerState = "paused"
          updateAgentMessage(msgId, (m) => ({ ...m, card: e.card }))
          break
        case "resumed":
          composerState = "streaming"
          updateAgentMessage(msgId, ({ card: _c, ...m }) => m)
          break
        case "turn_end":
          break
      }
      emit()
    }
  }

  /** Live streaming meta of the running message (board 22 A uZbJj). */
  function liveMeta(): { tokensIn: number; tokensOut: number; costUsd: number | null } {
    return {
      tokensIn: liveUsage.inputTokens + liveUsage.cacheWriteTokens,
      tokensOut: liveUsage.outputTokens,
      costUsd: liveCost,
    }
  }

  // --- Send -------------------------------------------------------------------------------------

  function userMessageOf(
    raw: string,
    atts: AttachmentChipView[],
  ): { user: UserMessage; forced: string[] } {
    const known = new Set([...catalog.builtin, ...catalog.user].map((s) => s.name))
    const { forced, text: rest } = parseSlash(raw, known)
    const imgs = atts.filter((a) => a.kind === "image" && a.image)
    const user: UserMessage = {
      role: "user",
      content: [
        { type: "text", text: rest || raw },
        ...imgs.map((a) => ({
          type: "image" as const,
          mimeType: (a.image as NonNullable<AttachmentChipView["image"]>).mimeType,
          data: (a.image as NonNullable<AttachmentChipView["image"]>).data,
        })),
      ],
    }
    return { user, forced }
  }

  function selectionSummary(atts: AttachmentChipView[]): string | undefined {
    const sel = atts.filter((a) => a.kind === "selection")
    if (!sel.length) return undefined
    return sel.map((a) => `${a.label} (${a.nodeIds?.[0] ?? ""})`).join(", ")
  }

  async function finishTurn(raw: TurnRecord, msgId: string, extra?: { agents?: number }) {
    const s = ensureSession()
    // Board 34: the turn's auto-approved lines are saved with it (reopening shows them).
    const msg = messages.find((m) => m.kind === "agent" && m.id === msgId)
    const record: TurnRecord =
      msg?.kind === "agent" && msg.autoApproved?.length
        ? { ...raw, autoApproved: msg.autoApproved }
        : raw
    lastRecord = record
    session = appendTurn(s, record, now())
    if (extra?.agents) session = { ...session, agents: extra.agents }
    if (record.cli?.sessionId) session = { ...session, cliSessionId: record.cli.sessionId }
    // Only the last turn can regenerate (its op groups are on top of the undo stack).
    messages = messages.map((m) =>
      m.kind === "agent" && m.meta ? { ...m, meta: { ...m.meta, canRegenerate: false } } : m,
    )
    const showCard =
      record.status !== "done" &&
      record.error &&
      !(record.status === "stopped" && record.opsApplied === 0 && false)
    updateAgentMessage(msgId, (m) => {
      const { card: _c, progress: _p, ...rest } = m
      return {
        ...rest,
        // Board 31: the reply appears now — the text after the last tool call (mode runs set
        // their own summary first).
        text: rest.text || replyOf(record.messages),
        turnId: record.id,
        streaming: false,
        steps: rest.steps.map((st) => (st.state === "running" ? { ...st, state: "failed" } : st)),
        meta: turnMeta(record, record.status !== "error"),
        ...(showCard && record.error ? { card: record.error } : {}),
      }
    })
    rt.recordUsage?.({
      at: now(),
      provider: record.model.provider,
      label: rt.labelOf(record.model.provider),
      tokens: newTokens(record.usage),
      costUsd: record.billing === "subscription" ? null : record.cost.usd,
      billing: record.billing ?? "api",
      sessionId: session.id,
    })
    if (session.turns.length === 1 && session.title === "New session") void nameSession(record)
    await persist()
  }

  /** The fast model names the session after turn 1 (structured output); CLIs: first words. */
  async function nameSession(record: TurnRecord) {
    const first = textOf(record.messages[0] as ChatMessage)
    const fallback = first
      .split(/\s+/)
      .slice(0, 6)
      .join(" ")
      .replace(/[.!?]+$/, "")
    let title = fallback.charAt(0).toUpperCase() + fallback.slice(1)
    const sel = record.model
    if (!isCliProvider(sel.provider)) {
      const cfg = providers.find((p) => p.id === sel.provider)
      if (cfg?.models.fast)
        try {
          const r = await complete(providerFor(rt, cfg), {
            model: cfg.models.fast,
            system: { stable: "You name design sessions." },
            messages: [{ role: "user", content: [{ type: "text", text: titlePrompt(first) }] }],
            tools: [],
            thinking: "off",
            maxTokens: 64,
            responseSchema: TITLE_SCHEMA as unknown as {
              name: string
              schema: Record<string, unknown>
            },
          })
          const t = (JSON.parse(r.text) as { title?: string }).title?.trim()
          if (t) title = t.slice(0, 80)
        } catch {}
    }
    if (!session || !title) return
    session = { ...session, title }
    emit()
    await persist()
  }

  async function sendNow(
    raw: string,
    opts: {
      fromHome?: boolean
      regenerateOf?: UserMessage
      /** Prompt-node run: the scope roots (replaces the selection chips; Single mode). */
      scope?: { id: string; name: string }[]
    } = {},
  ) {
    if (!model) {
      messages = [
        ...messages,
        {
          kind: "agent",
          id: `m${now().toString(36)}`,
          turnId: "",
          text: "",
          streaming: false,
          steps: [],
          card: errorCard(
            new ProviderError("unknown_model", "Add an API key or sign in to a local agent CLI.", {
              provider: "none",
            }),
            { providerLabel: "Kimo", opsApplied: 0 },
          ),
        },
      ]
      emit()
      return
    }
    const atts = opts.regenerateOf || opts.scope ? [] : attachments()
    const { user, forced } = opts.regenerateOf
      ? { user: opts.regenerateOf, forced: [] as string[] }
      : userMessageOf(raw, atts)
    const s = ensureSession(opts.fromHome ? "home" : "panel")
    const skills = activeSkills(catalog, enabledSkills, forced)
    const uid = `u${now().toString(36)}${(++turnSeq).toString(36)}`
    const aid = `a${now().toString(36)}${(++turnSeq).toString(36)}`
    messages = [
      ...messages,
      {
        kind: "user",
        id: uid,
        text: textOf(user),
        attachments: atts,
        skills: skills.map((k) => k.name),
        fromHome: !!opts.fromHome,
      },
      {
        kind: "agent",
        id: aid,
        turnId: "",
        text: "",
        streaming: true,
        steps: [],
        progress: {
          status: START_STATUS.text,
          source: START_STATUS.source,
          startedAt: now(),
          follow: [],
        },
      },
    ]
    if (!opts.regenerateOf) {
      text = ""
      images = []
    }
    menu = null
    composerState = "streaming"
    abort = new AbortController()
    emit()

    const scopeItems: AttachmentChipView[] = opts.scope
      ? opts.scope.map((x) => ({
          id: `scope:${x.id}`,
          kind: "selection",
          label: x.name,
          nodeIds: [x.id],
        }))
      : atts.filter((a) => a.kind === "selection")
    try {
      // A prompt node always runs one Single turn (ADR 0014 §9), whatever the composer's mode.
      const m = opts.scope ? "single" : mode.mode
      if ((m === "side-by-side" || m === "split") && isCliProvider(model.provider))
        await finishTurn(
          syntheticRecord(
            user,
            [],
            "error",
            new ProviderError(
              "invalid_request",
              "Side by side and split run their child agents in Kimo; pick an API model for this mode.",
              { provider: model.provider },
            ),
          ),
          aid,
        )
      else if (m === "side-by-side") await runSideBySide(raw, user, skills, scopeItems, aid)
      else if (m === "split") await runSplit(user, skills, scopeItems, aid)
      else if (m === "iterate") await runIterate(raw, user, skills, scopeItems, aid)
      else {
        const origin = agentOrigin(s.id, 0)
        setLive(origin, "Kimo", "teal", true)
        const record = await runAgent({
          origin,
          label: "Kimo",
          persona: "teal",
          policy: leadPolicy(scopeItems.flatMap((a) => a.nodeIds ?? [])),
          model,
          thinking,
          history: historyOf(s),
          user,
          skills,
          ...(scopeItems.length
            ? { scope: scopeItems.map((a) => ({ id: a.nodeIds?.[0] ?? "", name: a.label })) }
            : {}),
          ...(selectionSummary(atts) ? { selectionSummary: selectionSummary(atts) } : {}),
          ...(opts.fromHome ? { fromHome: true } : {}),
          modeName: "single",
          ...(s.cliSessionId ? { cliSessionId: s.cliSessionId } : {}),
          signal: abort.signal,
          onEvent: threadHandler(aid, origin),
        })
        setLive(origin, "Kimo", "teal", false)
        await finishTurn(record, aid)
      }
    } finally {
      abort = null
      if (approvalQueue.length) denyAll()
      composerState = "idle"
      emit()
      const next = queued.shift()
      if (next !== undefined) {
        emit()
        void sendNow(next)
      }
    }
  }

  // --- Modes ------------------------------------------------------------------------------------

  function childModel(i: number): ModelSelection {
    return mode.models === "same"
      ? (model as ModelSelection)
      : (mode.models[i] ?? (model as ModelSelection))
  }

  function newRun(kind: ModeRunView["mode"], total: number): ModeRunView {
    modeRun = {
      id: turnId(),
      mode: kind,
      agents: [],
      done: 0,
      total,
      costUsd: 0,
      tokens: 0,
      running: true,
      log: [],
    }
    return modeRun
  }

  function patchRow(origin: string, patch: Partial<ModeAgentRow>) {
    if (!modeRun) return
    modeRun = {
      ...modeRun,
      agents: modeRun.agents.map((a) => (a.origin === origin ? { ...a, ...patch } : a)),
    }
  }

  function totals() {
    if (!modeRun) return
    const costs = modeRun.agents.map((a) => ({
      usd: a.costUsd,
      estimated: true as const,
      priceVersion: "",
    }))
    const sum = sumCosts(costs)
    modeRun = {
      ...modeRun,
      done: modeRun.agents.filter((a) => a.state === "done").length,
      costUsd: sum.partial && sum.usd === 0 ? null : sum.usd,
    }
  }

  /** AgentEvent → mode row + plan log for one child. */
  function childHandler(origin: string, label: string, persona: Persona) {
    let usage: Usage = { ...ZERO_USAGE }
    return (e: AgentEvent) => {
      trackCanvas(origin, e)
      const row = modeRun?.agents.find((a) => a.origin === origin)
      if (!row || !modeRun) return
      if (e.type === "step_start") patchRow(origin, { mark: "working", state: "running" })
      else if (e.type === "step_end") {
        if (e.ok && e.undoToken) {
          patchRow(origin, { ops: row.ops + Math.max(1, e.changed.length) })
          modeRun = {
            ...modeRun,
            log: [
              ...modeRun.log,
              {
                key: `${origin}:${e.callId}`,
                op: "update",
                target:
                  e.changed
                    .map((id) => o.nodeName?.(id) ?? id)
                    .slice(0, 2)
                    .join(", ") || "—",
                detail: `${label} · ${e.summary}`,
                persona,
                undoToken: e.undoToken,
                origin,
              },
            ],
          }
        } else if (!e.ok && e.errorCode) {
          patchRow(origin, { rejected: row.rejected + 1 })
          modeRun = {
            ...modeRun,
            log: [
              ...modeRun.log,
              {
                key: `${origin}:${e.callId}`,
                op: "reject",
                target: canvas.cursors.find((c) => c.origin === origin)?.nodeId
                  ? (o.nodeName?.(
                      canvas.cursors.find((c) => c.origin === origin)?.nodeId as string,
                    ) ?? "")
                  : "",
                detail: `${label} · ${e.summary}`,
                persona,
                origin,
              },
            ],
          }
        }
      } else if (e.type === "usage") {
        usage = e.usage
        patchRow(origin, { costUsd: e.cost.usd })
        modeRun = {
          ...modeRun,
          tokens:
            modeRun.agents.reduce((n, a) => n + (a.origin === origin ? 0 : 0), 0) +
            newTokens(usage),
        }
      } else if (e.type === "text_delta" && row.mark !== "working")
        patchRow(origin, { mark: "thinking" })
      else if (e.type === "turn_end") {
        const r = e.record
        patchRow(origin, {
          state:
            r.status === "done"
              ? "done"
              : r.status === "stopped"
                ? "stopped"
                : r.status === "budget"
                  ? "paused"
                  : "error",
          mark: r.status === "done" ? "done" : r.status === "stopped" ? "idle" : "error",
          costUsd: r.cost.usd,
          groups: r.opGroups,
        })
        totals()
      }
      emit()
    }
  }

  function addRow(
    r: Omit<ModeAgentRow, "groups" | "ops" | "rejected" | "costUsd" | "state" | "mark">,
  ) {
    if (!modeRun) return
    modeRun = {
      ...modeRun,
      agents: [
        ...modeRun.agents,
        { ...r, groups: [], ops: 0, rejected: 0, costUsd: 0, state: "running", mark: "thinking" },
      ],
    }
  }

  /** Runs one spawned child (API providers only: children are in-process M5 clients). */
  async function runChild(
    spec: ChildSpec,
    label: string,
    persona: Persona,
    skills: Skill[],
    signal: AbortSignal,
  ): Promise<{ result: ChildResult; record: TurnRecord }> {
    setLive(spec.origin, label, persona, true)
    const name = o.nodeName?.(spec.scopeRoots[0] as string) ?? (spec.scopeRoots[0] as string)
    const record = await runAgent({
      origin: spec.origin,
      label,
      persona,
      policy: spec.policy,
      exclude: CHILD_EXCLUDED_TOOLS,
      model: spec.model,
      thinking: spec.thinking,
      history: [],
      user: { role: "user", content: [{ type: "text", text: spec.brief }] },
      skills,
      scope: spec.scopeRoots.map((id) => ({ id, name: o.nodeName?.(id) ?? id })),
      brief: spec.brief,
      modeName: "single",
      signal,
      onEvent: childHandler(spec.origin, label, persona),
    })
    setLive(spec.origin, label, persona, false)
    // The child disconnects when its turn ends: its hue is free again (held 10 min for it).
    personas.release(spec.origin)
    for (const g of record.opGroups) groupOrigins.set(g.undoToken, spec.origin)
    const rejected = modeRun?.agents.find((a) => a.origin === spec.origin)?.rejected ?? 0
    return {
      record,
      result: {
        index: spec.index,
        origin: spec.origin,
        status: record.status,
        opsApplied: record.opsApplied,
        rejected,
        summary:
          record.messages
            .filter((m) => m.role === "assistant")
            .map(textOf)
            .join(" ")
            .slice(0, 300) || `${name}: ${record.status}`,
        costUsd: record.cost.usd,
      },
    }
  }

  const childLabel = (index: number) => `Agent ${index}`

  async function runSideBySide(
    raw: string,
    user: UserMessage,
    skills: Skill[],
    scopeItems: AttachmentChipView[],
    aid: string,
  ) {
    const s = ensureSession()
    const signal = (abort as AbortController).signal
    const originalId = scopeItems[0]?.nodeIds?.[0]
    const box = originalId ? o.frameBox?.(originalId, Math.min(mode.agents, MAX_AGENTS)) : null
    const leadOrigin = agentOrigin(s.id, 0)
    if (!originalId || !box)
      return finishTurn(
        syntheticRecord(
          user,
          [],
          "error",
          new ProviderError("invalid_request", "Select the frame to explore, then send again.", {
            provider: "kimo",
          }),
        ),
        aid,
      )
    const n = Math.min(mode.agents, MAX_AGENTS)
    const run = newRun("side-by-side", n)
    const children = Array.from({ length: n }, (_, i) => {
      const origin = agentOrigin(s.id, i + 1)
      const slot = personas.assign({ id: origin })
      return { origin, slot, label: childLabel(i + 1), index: i + 1 }
    })
    const lead = toolsFor({ origin: leadOrigin, label: "Kimo", policy: leadPolicy([]) })
    const ops = planSideBySide(
      box,
      n,
      children.map((c) => c.origin),
      { now: new Date(now()), ...(o.sideBySideGap !== undefined ? { gap: o.sideBySideGap } : {}) },
    )
    const setup = await lead.call(
      {
        id: `setup-${run.id}`,
        name: "kimo_apply_ops",
        input: { docId: o.docId(), ops, label: `Side by side · ${n} variants` },
      },
      signal,
    )
    if (!setup.result.ok)
      return finishTurn(
        syntheticRecord(
          user,
          [],
          "error",
          new ProviderError("invalid_request", setup.result.summary, { provider: "kimo" }),
        ),
        aid,
      )
    const created = new Map((setup.result.created ?? []).map((c) => [c.key, c.id]))
    const leadGroups: OpGroup[] = setup.result.undoToken
      ? [
          {
            docId: o.docId(),
            undoToken: setup.result.undoToken,
            summary: setup.result.summary,
            changed: setup.result.changed ?? [],
            tool: "kimo_apply_ops",
          },
        ]
      : []
    updateAgentMessage(aid, (m) => ({
      ...m,
      steps: [
        {
          callId: "setup",
          tool: "kimo_apply_ops",
          label: `Created ${n} variant frames next to ${box.name}`,
          state: "done",
          changed: setup.result.ok ? (setup.result.changed ?? []) : [],
        },
      ],
    }))
    const specs: ChildSpec[] = children.map((c, i) => {
      const frame = created.get(`v${i + 1}`) ?? ""
      addRow({
        origin: c.origin,
        label: c.label,
        scopeName: `${box.name} · v${i + 1}`,
        modelLabel: modelLabel(childModel(i), rt.clis()),
        persona: c.slot.persona,
        personaRound: c.slot.round,
        scopeId: frame,
      })
      return {
        index: c.index,
        origin: c.origin,
        docId: o.docId(),
        scopeRoots: [frame],
        policy: childPolicy([frame]),
        model: childModel(i),
        thinking,
        brief: `${raw}\n\n${exploreBrief(mode.explore, i, n)}\nThe original frame is ${box.name} (${originalId}); your frame is ${frame}.`,
      }
    })
    canvas = {
      ...canvas,
      scopes: specs.map((sp) => ({
        origin: sp.origin,
        roots: sp.scopeRoots,
        mode: "side-by-side" as const,
      })),
    }
    emit()
    const records: TurnRecord[] = []
    const labelOfIndex = new Map(children.map((c) => [c.origin, c]))
    await runChildren(
      specs,
      async (spec, sig) => {
        const c = labelOfIndex.get(spec.origin) as (typeof children)[number]
        const { result, record } = await runChild(spec, c.label, c.slot.persona, skills, sig)
        records.push(record)
        return result
      },
      signal,
    )
    if (modeRun) modeRun = { ...modeRun, running: false }
    canvas = { ...canvas, scopes: [] }
    const settled = await settleVariants(
      lead,
      specs.map((sp) => ({ origin: sp.origin, frame: sp.scopeRoots[0] ?? "" })),
    )
    // Undo of the turn also reverts the clean-up (it touches only the variant frames themselves).
    if (settled) leadGroups.push(settled)
    const summary = `${modeRun?.done ?? 0} of ${n} variants done next to ${box.name}.`
    updateAgentMessage(aid, (m) => ({ ...m, text: summary }))
    await finishTurn(
      aggregate(user, records, leadGroups, signal.aborted ? "stopped" : "done", summary),
      aid,
      { agents: n },
    )
  }

  /**
   * ADR 0014 §6/§9: a turn ends by clearing the placeholders it set — done, stopped or failed.
   * Side by side's variant frames are created by the lead's setup (owned by the children), so no
   * child loop tracks them: a variant its child built into loses the flag, one left empty
   * (stopped, failed, nothing built) is removed and its row reads discarded.
   */
  async function settleVariants(
    lead: ToolHost,
    variants: { origin: string; frame: string }[],
  ): Promise<OpGroup | null> {
    const signal = new AbortController().signal
    const ops: Record<string, unknown>[] = []
    const emptied: string[] = []
    for (const v of variants) {
      if (!v.frame) continue
      const q = await lead.call(
        {
          id: `settle-query-${v.frame}`,
          name: "kimo_query",
          input: { docId: o.docId(), select: { ids: [v.frame] }, depth: 0 },
        },
        signal,
      )
      if (!q.result.ok) continue
      const node = (
        q.result.data as { nodes?: { id: string; children?: string[]; placeholder?: unknown }[] }
      ).nodes?.find((x) => x.id === v.frame)
      if (!node) continue
      if (!node.children?.length) {
        ops.push({ op: "delete", id: v.frame })
        emptied.push(v.origin)
      } else if (node.placeholder !== undefined && node.placeholder !== null)
        ops.push({ op: "update", id: v.frame, unset: ["placeholder"] })
    }
    if (!ops.length) return null
    const r = await lead.call(
      {
        id: `settle-${variants[0]?.frame ?? "variants"}`,
        name: "kimo_apply_ops",
        input: { docId: o.docId(), ops, label: "Clear variant placeholders" },
      },
      signal,
    )
    if (!r.result.ok) return null
    for (const origin of emptied) {
      patchRow(origin, { discarded: true })
      personas.release(origin)
    }
    return r.result.undoToken
      ? {
          docId: o.docId(),
          undoToken: r.result.undoToken,
          summary: r.result.summary,
          changed: r.result.changed ?? [],
          tool: "kimo_apply_ops",
        }
      : null
  }

  async function runSplit(
    user: UserMessage,
    skills: Skill[],
    scopeItems: AttachmentChipView[],
    aid: string,
  ) {
    const s = ensureSession()
    const signal = (abort as AbortController).signal
    const leadOrigin = agentOrigin(s.id, 0)
    const scope = scopeItems.flatMap((a) => a.nodeIds ?? [])
    newRun("split", mode.agents)
    addRow({
      origin: leadOrigin,
      label: "Lead",
      scopeName: "page",
      modelLabel: modelLabel(model, rt.clis()),
      persona: "teal",
      personaRound: 1,
    })
    let next = 0
    const records: TurnRecord[] = []
    const spawn = createSpawnTool({
      session: s.id,
      leadScope: scope,
      defaultModel: model as ModelSelection,
      thinking,
      cap: Math.min(mode.agents, MAX_AGENTS),
      nextIndex: () => ++next,
      validateFrame: () => null,
      runner: async (spec, sig) => {
        const slot = personas.assign({ id: spec.origin })
        const label = `Agent ${spec.index}`
        const frame = spec.scopeRoots[0] as string
        addRow({
          origin: spec.origin,
          label,
          scopeName: o.nodeName?.(frame) ?? frame,
          modelLabel: modelLabel(spec.model, rt.clis()),
          persona: slot.persona,
          personaRound: slot.round,
          scopeId: frame,
        })
        canvas = {
          ...canvas,
          scopes: [
            ...canvas.scopes,
            { origin: spec.origin, roots: spec.scopeRoots, mode: "split" },
          ],
        }
        if (modeRun)
          modeRun = { ...modeRun, total: Math.max(modeRun.total, modeRun.agents.length - 1) }
        emit()
        const { result, record } = await runChild(spec, label, slot.persona, skills, sig)
        records.push(record)
        return result
      },
    })
    setLive(leadOrigin, "Kimo", "teal", true)
    const leadEvents = threadHandler(aid, leadOrigin)
    const record = await runAgent({
      origin: leadOrigin,
      label: "Kimo",
      persona: "teal",
      policy: leadPolicy(scope),
      extra: [spawn],
      model: model as ModelSelection,
      thinking,
      history: historyOf(s),
      user,
      skills,
      ...(scopeItems.length
        ? { scope: scopeItems.map((a) => ({ id: a.nodeIds?.[0] ?? "", name: a.label })) }
        : {}),
      modeName: "split",
      signal,
      onEvent: (e) => {
        leadEvents(e)
        if (e.type === "turn_end")
          patchRow(leadOrigin, {
            state: e.record.status === "done" ? "done" : "error",
            mark: e.record.status === "done" ? "done" : "error",
            ops: e.record.opsApplied,
            costUsd: e.record.cost.usd,
          })
      },
    })
    setLive(leadOrigin, "Kimo", "teal", false)
    if (modeRun) modeRun = { ...modeRun, running: false }
    totals()
    canvas = { ...canvas, scopes: [] }
    const all = aggregate(user, [record, ...records], [], record.status, undefined, record)
    await finishTurn(all, aid, { agents: records.length + 1 })
  }

  async function runIterate(
    raw: string,
    user: UserMessage,
    skills: Skill[],
    scopeItems: AttachmentChipView[],
    aid: string,
    steer?: string,
  ) {
    const s = ensureSession()
    const signal = (abort as AbortController).signal
    const frame =
      scopeItems[0]?.nodeIds?.[0] ?? (modeRun?.iterate ? modeRun.agents[0]?.scopeId : undefined)
    if (!frame)
      return finishTurn(
        syntheticRecord(
          user,
          [],
          "error",
          new ProviderError("invalid_request", "Select the frame to iterate on, then send again.", {
            provider: "kimo",
          }),
        ),
        aid,
      )
    const prev = modeRun?.mode === "iterate" ? modeRun.iterate : undefined
    const pass = (prev?.pass ?? 0) + 1
    const of = prev?.of ?? mode.passes
    const goal = prev?.goal ?? raw
    const origin = agentOrigin(s.id, 0)
    if (!prev) {
      newRun("iterate", 1)
      addRow({
        origin,
        label: "Kimo",
        scopeName: o.nodeName?.(frame) ?? frame,
        modelLabel: modelLabel(model, rt.clis()),
        persona: "teal",
        personaRound: 1,
        scopeId: frame,
      })
    }
    canvas = { ...canvas, scopes: [{ origin, roots: [frame], mode: "iterate" }] }
    if (modeRun)
      modeRun = {
        ...modeRun,
        running: true,
        iterate: {
          pass,
          of,
          reviewing: false,
          goal,
          ...(steer ? { steer } : {}),
          summary: "",
          changes: 0,
          costUsd: 0,
          rows: [],
          passes: prev?.passes ?? [],
          view: "after",
        },
      }
    emit()
    setLive(origin, "Kimo", "teal", true)
    const events = threadHandler(aid, origin)
    const passUser: UserMessage = {
      ...user,
      content: [
        { type: "text", text: iteratePrompt(goal, pass, of, steer) },
        ...user.content.filter((p) => p.type === "image"),
      ],
    }
    const rows: PlanLogRow[] = []
    const record = await runAgent({
      origin,
      label: "Kimo",
      persona: "teal",
      policy: { ...leadPolicy([frame]), grants: [] },
      model: model as ModelSelection,
      thinking,
      history: historyOf(s),
      user: passUser,
      skills,
      scope: [{ id: frame, name: o.nodeName?.(frame) ?? frame }],
      modeName: "iterate",
      ...(s.cliSessionId ? { cliSessionId: s.cliSessionId } : {}),
      signal,
      onEvent: (e) => {
        if (e.type === "step_start" && e.tool === "kimo_apply_ops" && Array.isArray(e.input.ops))
          for (const [k, op] of (e.input.ops as Record<string, unknown>[]).entries())
            rows.push(opRow(op, `${e.callId}:${k}`, origin))
        events(e)
      },
    })
    setLive(origin, "Kimo", "teal", false)
    const summary = replyOf(record.messages)
    if (modeRun?.iterate) {
      const passes = [
        ...modeRun.iterate.passes,
        {
          pass,
          undoTokens: record.opGroups.map((g) => ({ docId: g.docId, token: g.undoToken })),
          changes: record.opsApplied,
          costUsd: record.cost.usd,
        },
      ]
      modeRun = {
        ...modeRun,
        running: false,
        agents: modeRun.agents.map((a) => ({
          ...a,
          state: record.status === "done" ? "done" : "error",
          mark: record.status === "done" ? "done" : "error",
          ops: a.ops + record.opsApplied,
          costUsd: record.cost.usd,
        })),
        iterate: {
          ...modeRun.iterate,
          reviewing: record.status === "done",
          summary,
          changes: record.opsApplied,
          costUsd: record.cost.usd,
          rows,
          passes,
        },
      }
    }
    canvas = { ...canvas, scopes: [] }
    await finishTurn(record, aid)
  }

  function opRow(op: Record<string, unknown>, key: string, origin: string): PlanLogRow {
    const kind = String(op.op ?? "update")
    const id = typeof op.id === "string" ? op.id : typeof op.parent === "string" ? op.parent : ""
    const set = (op.set ?? op.node ?? {}) as Record<string, unknown>
    const detail = Object.entries(set)
      .filter(([k]) => k !== "type" && k !== "children")
      .slice(0, 2)
      .map(
        ([k, v]) => `${k} → ${typeof v === "object" ? JSON.stringify(v).slice(0, 24) : String(v)}`,
      )
      .join(" · ")
    return {
      key,
      op: (["update", "insert", "delete", "move"].includes(kind)
        ? kind
        : "update") as PlanLogRow["op"],
      target: (o.nodeName?.(id) ?? (typeof set.name === "string" ? set.name : id)) || "—",
      detail: detail || kind,
      persona: "teal",
      origin,
    }
  }

  function syntheticRecord(
    user: UserMessage,
    groups: OpGroup[],
    status: TurnRecord["status"],
    err?: ProviderError,
    text = "",
  ): TurnRecord {
    return {
      id: turnId(),
      model: model as ModelSelection,
      thinking,
      startedAt: now(),
      endedAt: now(),
      messages: [user, { role: "assistant", content: text ? [{ type: "text", text }] : [] }],
      usage: { ...ZERO_USAGE },
      cost: { usd: 0, estimated: true, priceVersion: "n/a" },
      opGroups: groups,
      opsApplied: 0,
      status,
      ...(err ? { error: errorCard(err, { providerLabel: "Kimo", opsApplied: 0 }) } : {}),
      servedBy: model?.model ?? "",
      skillsUsed: [],
    }
  }

  /** One session turn for a side-by-side / split run (children usage summed; undo covers all groups). */
  function aggregate(
    user: UserMessage,
    records: TurnRecord[],
    leadGroups: OpGroup[],
    status: TurnRecord["status"],
    text?: string,
    lead?: TurnRecord,
  ): TurnRecord {
    const usage = records.reduce((u, r) => addUsage(u, r.usage), { ...ZERO_USAGE } as Usage)
    const sum = sumCosts(records.map((r) => r.cost))
    const base = lead ?? syntheticRecord(user, [], status, undefined, text)
    return {
      ...base,
      messages: lead ? lead.messages : base.messages,
      usage,
      cost: {
        usd: sum.partial && sum.usd === 0 ? null : sum.usd,
        estimated: true,
        priceVersion: records[0]?.cost.priceVersion ?? "n/a",
      },
      opGroups: [...leadGroups, ...records.flatMap((r) => r.opGroups)],
      opsApplied: records.reduce((n, r) => n + r.opsApplied, 0),
      status,
      billing: billingOf(model) === "api" ? "api" : (billingOf(model) as TurnRecord["billing"]),
    }
  }

  // --- Undo ---------------------------------------------------------------------------------------

  async function undoGroups(groups: { docId: string; token: string }[], origin: `agent:${string}`) {
    const host = toolsFor({ origin, label: "Kimo", policy: leadPolicy([]) })
    let ok = true
    let stale = false
    for (const g of groups) {
      const r = await host.call(
        {
          id: `undo-${g.token}`,
          name: "kimo_history",
          input: { docId: g.docId, action: "undo", token: g.token },
        },
        new AbortController().signal,
      )
      if (!r.result.ok) {
        ok = false
        if (r.result.errors[0]?.code === "REVISION_CONFLICT") stale = true
        break
      }
      if ((r.result.data as { stale?: boolean } | undefined)?.stale) stale = true
    }
    return { ok, stale }
  }

  /** Undo groups as their own origin (children's groups live on their own stacks). */
  async function undoByOrigin(groups: OpGroup[]) {
    let ok = true
    let stale = false
    for (const g of [...groups].reverse()) {
      const origin = (canvasOriginOf(g) ??
        agentOrigin(session?.id ?? "kimo", 0)) as `agent:${string}`
      const r = await undoGroups([{ docId: g.docId, token: g.undoToken }], origin)
      ok &&= r.ok
      stale ||= r.stale
    }
    return { ok, stale }
  }

  const groupOrigins = new Map<string, string>()
  const canvasOriginOf = (g: OpGroup) => groupOrigins.get(g.undoToken)

  // --- Controller -------------------------------------------------------------------------------

  const controller: AgentPanelControllerExt = {
    get state() {
      return state
    },
    subscribe(l) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    async send(raw) {
      const t = raw.trim()
      if (!t && images.length === 0) return
      if (composerState !== "idle") {
        queued = [...queued, t]
        text = ""
        emit()
        return
      }
      const held = costWarningFor(t)
      costWarning = held
      if (held) {
        // Board 27 THx2k: hold the message (it stays in the composer) until the user chooses.
        text = raw
        emit()
        return
      }
      await sendNow(t)
    },
    async sendAnyway() {
      const held = costWarning
      if (!held || composerState !== "idle") return
      costWarning = null
      // The composer may have been edited while the card was up: send what is there now.
      await sendNow(text.trim() || held.text)
    },
    editHeldMessage() {
      if (!costWarning) return
      costWarning = null
      emit()
    },
    openCostSettings() {
      rt.openSettings?.("ai-providers")
    },
    openLink(url) {
      if (rt.openLink) rt.openLink(url)
      else window.open(url, "_blank", "noopener,noreferrer")
    },
    removeQueued(index) {
      if (index < 0 || index >= queued.length) return
      queued = queued.filter((_, i) => i !== index)
      emit()
    },
    editQueued(index) {
      const t = queued[index]
      if (t === undefined) return
      queued = queued.filter((_, i) => i !== index)
      text = text.trim() ? `${t}\n${text}` : t
      emit()
    },
    stop() {
      abort?.abort()
      if (approvalQueue.length) denyAll()
      queued = []
      emit()
    },
    stopAll() {
      controller.stop()
    },
    async regenerate(id) {
      if (!session || composerState !== "idle") return
      const plan = planRegenerate(session, id)
      if (!plan) return
      const r = await undoGroups(plan.undo, agentOrigin(session.id, 0))
      if (!r.ok) return
      const gone = session.turns[session.turns.length - 1] as TurnRecord
      session = {
        ...plan.rest,
        messageCount: Math.max(
          0,
          plan.rest.messageCount - gone.messages.filter((m) => m.role !== "tool").length,
        ),
        usage: {
          inputTokens: plan.rest.usage.inputTokens - gone.usage.inputTokens,
          outputTokens: plan.rest.usage.outputTokens - gone.usage.outputTokens,
          cacheReadTokens: plan.rest.usage.cacheReadTokens - gone.usage.cacheReadTokens,
          cacheWriteTokens: plan.rest.usage.cacheWriteTokens - gone.usage.cacheWriteTokens,
        },
        costUsd:
          plan.rest.costUsd === null || gone.cost.usd === null
            ? plan.rest.costUsd
            : plan.rest.costUsd - gone.cost.usd,
      }
      model = plan.model
      thinking = plan.thinking
      const idx = messages.findIndex((m) => m.kind === "agent" && m.turnId === id)
      if (idx > 0) messages = messages.slice(0, idx - 1)
      emit()
      await sendNow(textOf(plan.prompt), { regenerateOf: plan.prompt })
    },
    async undoTurn(id) {
      const t = session?.turns.find((x) => x.id === id)
      if (!t || !session) return { ok: false, stale: false }
      const r = await undoByOrigin(t.opGroups)
      if (r.ok) undoneTurns = [...undoneTurns, id]
      emit()
      return r
    },
    async continueTurn() {
      await controller.send("Continue.")
    },
    newSession() {
      if (composerState !== "idle") controller.stop()
      session = null
      autoApprove = false
      messages = []
      modeRun = null
      costWarning = null
      personas = new PersonaAllocator(now)
      sessionsOpen = false
      undoneTurns = []
      model = rt.defaultSelection() ?? model
      emit()
    },
    async openSession(id) {
      const s = await rt.sessions.get(id)
      if (!s) return
      session = s
      autoApprove = false
      model = s.model
      thinking = s.thinking
      mode = s.mode
      enabledSkills = s.enabledSkills
      messages = messagesFromTurns(s.turns, (t, last) => turnMeta(t, last))
      sessionsOpen = false
      modeRun = null
      emit()
    },
    async deleteSession(id) {
      await rt.sessions.delete(id)
      if (session?.id === id) controller.newSession()
      await reloadSessions()
    },
    searchSessions(q) {
      sessionQuery = q
      void reloadSessions()
    },
    toggleHistory() {
      sessionsOpen = !sessionsOpen
      menu = null
      if (sessionsOpen) void reloadSessions()
      emit()
    },
    setModel(sel) {
      model = sel
      const inf = info(sel)
      if (inf && !supportsThinkingControl(inf)) thinking = "auto"
      if (session) session = { ...session, model: sel }
      menu = null
      emit()
    },
    setThinking(m) {
      thinking = m
      if (session) session = { ...session, thinking: m }
      emit()
    },
    setMode(cfg) {
      mode = { ...cfg, agents: Math.max(1, Math.min(MAX_AGENTS, cfg.agents)) }
      if (session) session = { ...session, mode }
      if (cfg.mode === "single") modeRun = null
      emit()
    },
    toggleSkill(name, on) {
      enabledSkills = on
        ? [...new Set([...enabledSkills, name])].sort()
        : enabledSkills.filter((n) => n !== name)
      if (session) session = { ...session, enabledSkills }
      emit()
    },
    addImage(image) {
      images = [
        ...images,
        { id: `img${now().toString(36)}${images.length}`, kind: "image", label: "image", image },
      ]
      emit()
    },
    removeAttachment(id) {
      if (id.startsWith("sel:")) removedSelection = new Set([...removedSelection, id.slice(4)])
      else images = images.filter((i) => i.id !== id)
      emit()
    },
    async answerApproval(id, choice: McpApprovalChoice) {
      settleApproval(choice, id || undefined)
    },
    setAutoApprove(on) {
      if (autoApprove === on) return
      autoApprove = on
      // Cards already waiting are approved now, oldest first.
      if (on)
        for (const a of [...approvalQueue]) {
          noteAutoApproved(a.request as unknown as ApprovalRequest)
          settleApproval("auto", a.request.id)
        }
      emit()
    },
    cardAction(id, action: ErrorCardAction) {
      switch (action) {
        case "open_settings":
        case "raise_limit":
          rt.openSettings?.("ai-providers")
          break
        case "usage":
          rt.openSettings?.("usage")
          break
        case "retry":
        case "retry_now": {
          const t = session?.turns.find((x) => x.id === id)
          const last = [...messages].reverse().find((m) => m.kind === "user")
          if (composerState !== "idle") return
          if (t) void controller.regenerate(id)
          else if (last?.kind === "user") void sendNow(last.text)
          break
        }
        case "stop":
          controller.stop()
          break
        case "switch_model": {
          const fast = providers.find((p) => p.id === model?.provider)?.models.fast
          if (model && fast) controller.setModel({ provider: model.provider, model: fast })
          break
        }
        case "undo_turn":
          void controller.undoTurn(id)
          break
        case "continue":
          void controller.continueTurn()
          break
        case "get_desktop":
          rt.openLink?.("https://kimo.design/docs/getting-started/")
          break
        case "provider_matrix":
          rt.openLink?.("https://kimo.design/docs/built-in-agent/#api-providers")
          break
      }
    },
    async review(d: ReviewDecision) {
      const it = modeRun?.iterate
      if (!modeRun || !it || !session) return
      if (d.action === "stop") {
        modeRun = { ...modeRun, iterate: { ...it, reviewing: false } }
        emit()
        return
      }
      if (d.action === "revert") {
        const calls = revertCalls(it.passes, d.toPass)
        await undoGroups(calls, agentOrigin(session.id, 0))
        modeRun = {
          ...modeRun,
          iterate: {
            ...it,
            pass: d.toPass,
            passes: it.passes.filter((p) => p.pass <= d.toPass),
            reviewing: d.toPass > 0,
          },
        }
        emit()
        return
      }
      if (it.pass >= it.of) {
        modeRun = { ...modeRun, iterate: { ...it, of: it.of + 1 } }
      }
      const frame = modeRun.agents[0]?.scopeId
      const user: UserMessage = {
        role: "user",
        content: [{ type: "text", text: d.steer ? `Next pass: ${d.steer}` : "Next pass" }],
      }
      const aid = `a${now().toString(36)}${(++turnSeq).toString(36)}`
      messages = [
        ...messages,
        {
          kind: "user",
          id: `u${aid}`,
          text: d.steer ?? `Run pass ${it.pass + 1}`,
          attachments: [],
          skills: [],
          fromHome: false,
        },
        {
          kind: "agent",
          id: aid,
          turnId: "",
          text: "",
          streaming: true,
          steps: [],
          progress: {
            status: START_STATUS.text,
            source: START_STATUS.source,
            startedAt: now(),
            follow: [],
          },
        },
      ]
      composerState = "streaming"
      abort = new AbortController()
      emit()
      try {
        await runIterate(
          it.goal,
          user,
          activeSkills(catalog, enabledSkills, []),
          frame
            ? [
                {
                  id: `sel:${frame}`,
                  kind: "selection",
                  label: o.nodeName?.(frame) ?? frame,
                  nodeIds: [frame],
                },
              ]
            : [],
          aid,
          d.steer,
        )
      } finally {
        abort = null
        composerState = "idle"
        emit()
      }
    },
    setText(t) {
      text = t
      if (/^\/[a-z0-9-]*$/.test(t.trimStart())) menu = "skills"
      else if (menu === "skills" && !t.trimStart().startsWith("/")) menu = null
      emit()
    },
    setFocused(f) {
      focused = f
      emit()
    },
    openMenu(m) {
      menu = menu === m ? null : m
      emit()
    },
    insertSkill(name) {
      text = `/${name} ${text.replace(/^\s*\/[a-z0-9-]*\s*/, "")}`
      menu = null
      emit()
    },
    setSelection(items) {
      selection = items
      removedSelection = new Set()
      emit()
    },
    async startFromHome(h) {
      if (session?.id === h.sessionId) return
      pendingFromHome = true
      model = h.model
      session = null
      autoApprove = false
      messages = []
      mode = { ...DEFAULT_MODE }
      ensureSession("home", h.sessionId)
      emit()
      await sendNow(h.prompt, { fromHome: true })
      pendingFromHome = false
    },
    keepVariant(origin) {
      patchRow(origin, { kept: true })
      emit()
    },
    async discardVariant(origin) {
      const row = modeRun?.agents.find((a) => a.origin === origin)
      if (!row) return
      for (const g of [...row.groups].reverse())
        await undoGroups([{ docId: g.docId, token: g.undoToken }], origin as `agent:${string}`)
      if (row.scopeId) {
        const lead = toolsFor({
          origin: agentOrigin(session?.id ?? "kimo", 0),
          label: "Kimo",
          policy: leadPolicy([]),
        })
        await lead.call(
          {
            id: `discard-${row.scopeId}`,
            name: "kimo_apply_ops",
            input: {
              docId: o.docId(),
              ops: [{ op: "delete", id: row.scopeId }],
              label: `Discard ${row.scopeName}`,
            },
          },
          new AbortController().signal,
        )
      }
      patchRow(origin, { discarded: true })
      personas.release(origin)
      emit()
    },
    setIterateView(view) {
      if (modeRun?.iterate) modeRun = { ...modeRun, iterate: { ...modeRun.iterate, view } }
      emit()
    },
    async refresh() {
      try {
        providers = await rt.providers()
      } catch {
        providers = []
      }
      try {
        catalog = await loadSkills(rt.skills)
      } catch {}
      if (!model) model = rt.defaultSelection()
      emit()
    },
    async chooseCli(id) {
      const sel = { provider: `cli:${id}`, model: "default" }
      await rt.chooseCli?.(id)
      model = sel
      emit()
    },
    async connectKey(key) {
      if (!rt.connectKey) return { ok: false, detail: "Open Settings › AI providers." }
      connect = { connecting: true, error: null }
      emit()
      try {
        const r = await rt.connectKey("anthropic", key)
        connect = { connecting: false, error: r.ok ? null : r.detail }
        if (r.ok) {
          await controller.refresh()
          if (!model || !providers.some((p) => p.id === model?.provider))
            model = rt.defaultSelection()
        }
        emit()
        return r
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        connect = { connecting: false, error: detail }
        emit()
        return { ok: false, detail }
      }
    },
    editRequest(turnId) {
      const i = messages.findIndex((m) => m.kind === "agent" && m.turnId === turnId)
      const before = (i < 0 ? messages : messages.slice(0, i)).filter((m) => m.kind === "user")
      const last = before[before.length - 1]
      if (last) controller.setText(last.text)
    },
    copyText(id) {
      const m = messages.find((x) => x.id === id)
      return m ? m.text : ""
    },
    async runPrompt(input) {
      const nodeId = input.prompt.id
      const fail = (kind: string, message: string) => {
        promptRuns = {
          ...promptRuns,
          [nodeId]: { ...promptRuns[nodeId], status: "failed", error: { kind, message } },
        }
        savePromptRun(nodeId)
        emit()
      }
      if (abort || runningPrompt) return fail("busy", "the agent is busy with another turn")
      const fallback = model ?? rt.defaultSelection()
      if (!fallback) return fail("unknown_model", "add an API key or sign in to a local agent CLI")
      const s = ensureSession()
      const origin = agentOrigin(s.id, 0)
      // CLI selections are not API providers: let the plan resolve them as listed models.
      const configured = [
        ...providers,
        ...(isCliProvider(fallback.provider) && !providers.some((p) => p.id === fallback.provider)
          ? [
              {
                id: fallback.provider,
                kind: "anthropic" as const,
                label: rt.labelOf(fallback.provider),
                models: { agent: fallback.model, fast: fallback.model },
              },
            ]
          : []),
      ]
      let plan: ReturnType<typeof planPromptRun>
      try {
        plan = planPromptRun(
          input.prompt,
          { frame: input.frame, notes: input.notes, origin, now: new Date(now()) },
          configured,
          fallback,
        )
      } catch (e) {
        return fail(
          e instanceof ProviderError ? e.kind : "unknown",
          e instanceof Error ? e.message : String(e),
        )
      }
      runningPrompt = { nodeId, origin }
      promptRuns = { ...promptRuns, [nodeId]: { status: "running", live: { ops: 0, costUsd: 0 } } }
      emit()
      const lead = toolsFor({ origin, label: "Kimo", policy: leadPolicy([]) })
      let roots = plan.scopeRoots
      let created: string | null = null
      if (plan.setup.length) {
        const setup = await lead.call(
          {
            id: `prompt-setup-${nodeId}`,
            name: "kimo_apply_ops",
            input: { docId: o.docId(), ops: plan.setup, label: "Prompt result frame" },
          },
          new AbortController().signal,
        )
        created = setup.result.ok
          ? ((setup.result.created ?? []).find((c) => c.key === plan.createdKey)?.id ?? null)
          : null
        if (!created) {
          runningPrompt = null
          return fail("invalid_request", setup.result.ok ? "no result frame" : setup.result.summary)
        }
        roots = [created]
      }
      const notes = plan.notes.length
        ? `\n\nNotes on the target:\n${plan.notes.map((n) => `- ${n.author ? `${n.author}: ` : ""}${n.content}`).join("\n")}`
        : ""
      const before = model
      model = plan.model.selection
      lastRecord = null
      try {
        await sendNow(`${plan.userText}${notes}`, {
          scope: roots.map((id) => ({
            id,
            name: o.nodeName?.(id) ?? input.frame(id)?.name ?? id,
          })),
        })
      } finally {
        model = before
        runningPrompt = null
      }
      // The result frame's placeholder was set by the setup, not by the turn: clear it.
      if (created && o.nodeName?.(created) !== undefined)
        await lead
          .call(
            {
              id: `prompt-clear-${nodeId}`,
              name: "kimo_apply_ops",
              input: {
                docId: o.docId(),
                ops: [{ op: "update", id: created, unset: ["placeholder"] }],
                label: "Clear flag",
              },
            },
            new AbortController().signal,
          )
          .catch(() => {})
      const r = lastRecord as TurnRecord | null
      if (!r || r.status === "error")
        return fail(
          r?.error?.providerError ?? r?.error?.kind ?? "unknown",
          r?.error?.body || r?.error?.title || "the run did not finish",
        )
      promptRuns = {
        ...promptRuns,
        [nodeId]: {
          status: "idle",
          lastRun: {
            at: now(),
            ops: r.opsApplied,
            costUsd: r.billing === "subscription" ? null : r.cost.usd,
            billing: r.billing === "cli-api-key" ? "api" : (r.billing ?? "api"),
          },
        },
      }
      savePromptRun(nodeId)
      emit()
    },
    stopPrompt(nodeId) {
      if (runningPrompt?.nodeId === nodeId) abort?.abort()
    },
    dispose() {
      disposed = true
      abort?.abort()
      unsub?.()
      unwatch?.()
      listeners.clear()
    },
  }

  void pendingFromHome
  const unsub = rt.subscribe?.(() => void controller.refresh())
  const unwatch = rt.skills?.watch?.(() => void controller.refresh())
  void controller.refresh()
  void reloadSessions()
  void estimateCost
  void cliProviderId
  return controller
}

/** The live streaming meta for the current message (exported for the view). */
export type LiveMeta = { tokensIn: number; tokensOut: number; costUsd: number | null }
