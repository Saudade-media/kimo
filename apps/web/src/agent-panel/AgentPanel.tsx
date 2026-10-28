/**
 * The Agent tab body (board 22 "Agent panel" s4pGz0, panels A RH3G0 · B J7bfOc · C r6eAFo ·
 * D gVw5S, errors wxgY1, rules PKVKm), mounted by RightPanel below its Tabs frame:
 *
 *   Thread Header (w1BjvW) h 44, gap 8, padding [0, 8, 0, 12]: Title · Session Cost · Spacer ·
 *     History (IconButton, Active while the list is open) · New
 *   Thread (aCRfC) fill, column, gap 12, padding 16 — or the Session List (zJTW2)
 *   Composer Wrap (mt5k9) padding [0, 12, 12, 12] › Composer/Agent (Bry8p) + its menus
 */
import type { CliDetection } from "@kimo/ai-agent"
import {
  AgentErrorCard,
  type AgentErrorCardAction,
  AgentMarkdown,
  AgentStatus,
  AgentStep,
  ApprovalCard,
  AttachmentChip,
  AttachmentThumb,
  ComposerAgent,
  CostWarningCard,
  composerMoreDot,
  IconButton,
  IconErrorCard,
  Message,
  MessageMeta,
  ModeChip,
  RefusalCard,
  StepsToggle,
  stripMarkdown,
} from "@kimo/ui"
import {
  BookOpen,
  CircleX,
  Cloud,
  Component,
  Copy,
  Download,
  FilePlus,
  FolderOpen,
  HardDrive,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  SquareDashed,
  SquarePen,
  Terminal,
  Trash2,
  Variable,
  X,
} from "lucide-react"
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { AgentMessageView, AttachmentChipView } from "../platform/contract"
import { inTauri } from "../platform/runtime"
import { AreaBusyCard, type AreaBusyEnv, useAreaWaitStatus } from "./AreaBusyCard"
import { type ApprovalOpIcon, approvalOps } from "./approval"
import type { AgentPanelControllerExt, AgentPanelViewState } from "./controller"
import { markOf } from "./controller"
import { costWarningCopy } from "./cost-warning"
import { FirstRun } from "./FirstRun"
import {
  costLabel,
  durationLabel,
  elapsedLabel,
  headerCostLabel,
  tokensLabel,
  tokensTitle,
} from "./format"
import { useAgentPanelState } from "./hooks"
import { ModelMenu, ModeMenu, MoreMenu, SkillsMenu, visibleSkills } from "./Menus"
import { PlanCard, ReviewCard } from "./Modes"
import { SessionList } from "./Sessions"

export interface AgentPanelProps {
  controller: AgentPanelControllerExt
  /** File name for the session list group ("This file · Marketing site"). */
  fileName: string
  /** Detected CLIs (labels in session rows). */
  clis?: readonly CliDetection[]
  /** "Manage providers…", "Add a key…", Open settings card actions. */
  onOpenSettings?: () => void
  /** "Open skills folder" (desktop: reveal ~/.kimo/skills). */
  onOpenSkillsFolder?: () => void
  /** Copy (MessageMeta). Default: navigator.clipboard. */
  onCopy?: (text: string) => void
  now?: () => number
  /** Approval op rows: a node's name / its parent's name ("Delete 3 layers · in Pricing"). */
  nodeNameOf?: (id: string) => string | undefined
  parentNameOf?: (id: string) => string | undefined
  /** First run "Have Claude Code?…" hint (desktop only). Default: the host (Tauri → desktop). */
  platform?: "desktop" | "web"
  /** Board 31 Follow chip: zoom the canvas to these layers. Omitted: no chip. */
  onFollow?: (ids: string[]) => void
  /** Board 41 › 7 C: AREA_BUSY steps show the Waiting card (omitted: they stay failed steps). */
  areaBusy?: AreaBusyEnv
}

const OP_ICONS: Record<ApprovalOpIcon, typeof Trash2> = {
  "trash-2": Trash2,
  pencil: Pencil,
  plus: Plus,
  variable: Variable,
  component: Component,
  save: Save,
  download: Download,
  "file-plus": FilePlus,
  "folder-open": FolderOpen,
  "square-dashed": SquareDashed,
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const

/** png / jpeg / webp ≤ 5 MB → base64 (board 22 rule "Attachments"). */
async function readImage(file: File): Promise<NonNullable<AttachmentChipView["image"]> | null> {
  if (!IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number])) return null
  if (file.size > MAX_IMAGE_BYTES) return null
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ""
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return { mimeType: file.type as (typeof IMAGE_TYPES)[number], data: btoa(bin) }
}

const ACTION_LABEL: Record<string, string> = {
  open_settings: "Open settings",
  retry: "Retry",
  retry_now: "Retry now",
  stop: "Stop",
  switch_model: "Switch model",
  undo_turn: "Undo turn",
  continue: "Continue",
  raise_limit: "Raise limit",
  usage: "Usage",
  get_desktop: "Get desktop",
  provider_matrix: "Provider matrix",
}

export function AgentPanel({
  controller,
  fileName,
  clis = [],
  onOpenSettings,
  onOpenSkillsFolder,
  onCopy,
  now = Date.now,
  nodeNameOf,
  parentNameOf,
  platform = inTauri() ? "desktop" : "web",
  onFollow,
  areaBusy,
}: AgentPanelProps) {
  const state = useAgentPanelState(controller)
  const thread = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  /** Board 40 "…": Escape in its menu hands focus back here. */
  const moreButton = useRef<HTMLButtonElement | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [agentModelTarget, setAgentModelTarget] = useState<number | null>(null)

  // Keep the newest content in view while streaming.
  const last = state.messages[state.messages.length - 1]
  const lastLen = last
    ? last.text.length + (last.kind === "agent" ? last.steps.length + (last.progress ? 1 : 0) : 0)
    : 0
  // Board 31: the status line's elapsed clock ticks every second while a turn runs.
  const [tick, setTick] = useState(() => now())
  useEffect(() => {
    if (!state.busy) return
    setTick(now())
    const t = setInterval(() => setTick(now()), 1000)
    return () => clearInterval(t)
  }, [state.busy, now])
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content.
  useLayoutEffect(() => {
    const el = thread.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.messages.length, lastLen, state.modeRun, state.composer.queued.length])

  useEffect(() => {
    if (state.menu !== "model") setAgentModelTarget(null)
  }, [state.menu])

  const editQueued = (i: number) => {
    controller.editQueued(i)
    setTimeout(() => textarea.current?.focus(), 0)
  }

  const addFiles = async (files: Iterable<File>) => {
    for (const f of files) {
      const img = await readImage(f)
      if (img) controller.addImage(img)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      if (state.menu) controller.openMenu(null)
      else if (state.busy) controller.stop()
      return
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (state.menu === "skills") {
        e.preventDefault()
        // The menu's top row (same filter as the menu): ↵ inserts it, ⌥↵ toggles it.
        const first = visibleSkills(state)[0]
        if (!first) return
        if (e.altKey) controller.toggleSkill(first.name, !state.skills.enabled.includes(first.name))
        else controller.insertSkill(first.name)
        return
      }
      e.preventDefault()
      void controller.send(state.composer.text)
    }
  }

  const copy = (text: string) => {
    if (onCopy) onCopy(text)
    else if (!navigator.clipboard)
      controller.reportError("Couldn't copy the reply. The clipboard isn't available here.")
    else
      void navigator.clipboard
        .writeText(text)
        .catch(() => controller.reportError("Couldn't copy the reply. The clipboard refused it."))
  }

  const header = state.header
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole panel is an image drop zone.
    <div
      className="agent-panel"
      data-testid="agent-panel"
      onDragOver={(e: DragEvent) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === "file")) e.preventDefault()
      }}
      onDrop={(e: DragEvent) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault()
          void addFiles(e.dataTransfer.files)
        }
      }}
    >
      {state.onboarding ? (
        <FirstRun
          view={state.onboarding}
          controller={controller}
          platform={platform}
          {...(onOpenSettings ? { onOpenSettings } : {})}
        />
      ) : (
        <>
          <div className="agent-panel__header">
            <span className="agent-panel__title" data-testid="agent-thread-title">
              {state.sessionsOpen ? "Sessions" : header.title}
            </span>
            {!state.sessionsOpen && state.session && (
              <span className="agent-panel__cost" data-testid="agent-session-cost">
                <span className="agent-panel__cost-label">
                  {headerCostLabel(header, state.showCost)}
                </span>
              </span>
            )}
            {!state.sessionsOpen && state.approvals.length > 1 && (
              // Board 25 rule "Approval queue": the header shows "N waiting" (not drawn: the
              // Session Cost pill look).
              <span className="agent-panel__cost" data-testid="agent-approvals-waiting">
                <span className="agent-panel__cost-label">{state.approvals.length} waiting</span>
              </span>
            )}
            <span className="agent-panel__spacer" aria-hidden="true" />
            <IconButton
              label="History"
              icon={<History />}
              active={state.sessionsOpen}
              onClick={() => controller.toggleHistory()}
            />
            <IconButton
              label="New session"
              icon={<SquarePen />}
              onClick={() => controller.newSession()}
            />
          </div>

          {state.sessionsOpen ? (
            <SessionList
              controller={controller}
              state={state}
              fileName={fileName}
              clis={clis}
              now={now()}
            />
          ) : (
            <div className="agent-panel__thread" ref={thread} data-testid="agent-thread">
              {state.messages.map((m, i) => (
                <ThreadItem
                  key={m.id}
                  m={m}
                  nowMs={tick}
                  waiting={i === state.messages.length - 1 && state.approvals.length > 0}
                  {...(onFollow ? { onFollow } : {})}
                  {...(areaBusy ? { areaBusy } : {})}
                  state={state}
                  controller={controller}
                  onCopy={copy}
                  onEditRequest={(turnId) => {
                    controller.editRequest(turnId)
                    setTimeout(() => textarea.current?.focus(), 0)
                  }}
                />
              ))}
              {state.approvals.map((a) => (
                // Board 25 OlhpU: a thread-level card per pending approval, oldest first.
                <ApprovalCard
                  key={a.request.id}
                  data-testid="agent-approval"
                  data-pen="OlhpU"
                  title="Kimo wants to"
                  ops={approvalOps(a.request, {
                    ...(nodeNameOf ? { nodeName: nodeNameOf } : {}),
                    ...(parentNameOf ? { parentName: parentNameOf } : {}),
                  }).map((o) => {
                    const Icon = OP_ICONS[o.icon]
                    return { icon: <Icon />, label: o.label, ...(o.meta ? { meta: o.meta } : {}) }
                  })}
                  choices={(["once", "session", "deny"] as const).filter((c) =>
                    a.choices.includes(c),
                  )}
                  onChoose={(c) => void controller.answerApproval(a.request.id, c)}
                />
              ))}
              {state.modeRun && state.modeRun.mode !== "iterate" && (
                <PlanCard controller={controller} run={state.modeRun} />
              )}
              {state.modeRun?.mode === "iterate" && state.modeRun.iterate && (
                <ReviewCard controller={controller} run={state.modeRun} />
              )}
              {state.composer.queued.map((q, i) => (
                // Board 33 §2 JISdq: sent while a turn runs, muted at the bottom of the thread.
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: the queue is positional (FIFO)
                  key={`${i}:${q}`}
                  className="agent-panel__queued-message"
                  data-testid="agent-queued-message"
                  data-pen="JISdq"
                >
                  <button
                    type="button"
                    className="agent-panel__queued-bubble"
                    title="Edit"
                    onClick={() => editQueued(i)}
                  >
                    {q}
                  </button>
                  <div className="agent-panel__queued-meta">
                    <span className="agent-panel__queued-label">Queued</span>
                    <IconButton
                      size="sm"
                      tone="quiet"
                      label="Edit queued message"
                      icon={<Pencil />}
                      data-testid="agent-queued-edit"
                      onClick={() => editQueued(i)}
                    />
                    <IconButton
                      size="sm"
                      tone="quiet"
                      label="Remove queued message"
                      icon={<X />}
                      data-testid="agent-queued-remove"
                      onClick={() => controller.removeQueued(i)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {(!state.sessionsOpen || state.onboarding) && (
        <div className="agent-panel__composer-wrap">
          {state.menu === "model" && (
            <ModelMenu
              controller={controller}
              state={state}
              target={agentModelTarget}
              onManage={onOpenSettings}
            />
          )}
          {state.menu === "skills" && (
            <SkillsMenu controller={controller} state={state} onOpenFolder={onOpenSkillsFolder} />
          )}
          {state.menu === "more" && (
            <MoreMenu
              state={state}
              onSkills={() => {
                controller.openMenu("skills")
                moreButton.current?.focus()
              }}
              onAutoApprove={() => controller.setAutoApprove(!state.autoApprove)}
              onWebAccess={(on) => controller.setWebAccess(on)}
              onClose={() => controller.openMenu(null)}
              onEscape={() => {
                controller.openMenu(null)
                moreButton.current?.focus()
              }}
            />
          )}
          {state.menu === "mode" && (
            <ModeMenu
              controller={controller}
              state={state}
              personaOf={(i) =>
                (["iris", "violet", "rose", "ember", "moss"] as const)[i % 5] ?? "iris"
              }
              onPickAgentModel={(i) => {
                controller.openMenu("model")
                setAgentModelTarget(i)
              }}
            />
          )}
          {state.costWarning && !state.busy && (
            <CostWarningCard
              data-testid="agent-cost-warning"
              data-pen="qtTiZ"
              className="agent-panel__cost-warning"
              {...costWarningCopy(state.costWarning, state.showCost)}
              onSendAnyway={() => void controller.sendAnyway()}
              onEditMessage={() => {
                controller.editHeldMessage()
                textarea.current?.focus()
              }}
              onSettings={() => controller.openCostSettings()}
            />
          )}
          <ComposerAgent
            data-testid="agent-composer"
            className={state.composerDisabled ? "agent-panel__composer--off" : undefined}
            disabled={state.composerDisabled}
            value={state.composer.text}
            onChange={(t) => controller.setText(t)}
            placeholder={
              state.composerDisabled
                ? "Connect a model to start"
                : state.approvals.length > 0
                  ? "Kimo is waiting for your approval…"
                  : state.busy
                    ? "Queue a follow-up for when this turn ends"
                    : "Ask Kimo to design or edit…"
            }
            textareaRef={textarea}
            onTextareaKeyDown={onKeyDown}
            onTextareaPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => {
              const files = [...e.clipboardData.files]
              if (files.length) {
                e.preventDefault()
                void addFiles(files)
              }
            }}
            onFocusChange={(f) => controller.setFocused(f)}
            attachments={(state.composerDisabled || state.approvals.length > 0
              ? []
              : state.composer.attachments
            ).map((a) =>
              a.kind === "image" ? (
                <button
                  key={a.id}
                  type="button"
                  className="agent-panel__thumb-button"
                  aria-label="Remove image"
                  onClick={() => controller.removeAttachment(a.id)}
                >
                  <AttachmentThumb
                    name="image"
                    size={24}
                    {...(a.image ? { src: `data:${a.image.mimeType};base64,${a.image.data}` } : {})}
                  />
                </button>
              ) : (
                <AttachmentChip
                  key={a.id}
                  label={a.label}
                  onRemove={() => controller.removeAttachment(a.id)}
                />
              ),
            )}
            onAttach={() => fileInput.current?.click()}
            modeChip={
              <ModeChip
                mode={state.composer.mode.mode}
                label={state.modeLabel}
                open={state.menu === "mode"}
                data-agent-menu-anchor=""
                onClick={() => controller.openMenu("mode")}
              />
            }
            more={{
              open: state.menu === "more" || state.menu === "skills",
              dot: composerMoreDot({
                // Trusted is the default (ADR 0013 Addendum 8), so it carries no warning dot.
                autoApprove: false,
                webAccessOn: state.webAccess.on,
                webAccessBlocked: state.webAccess.disabled !== null,
              }),
              onClick: () => controller.openMenu(state.menu === "skills" ? null : "more"),
            }}
            moreRef={(el) => {
              moreButton.current = el
              el?.setAttribute("data-agent-menu-anchor", "")
            }}
            model={{
              label: state.modelLabel,
              open: state.menu === "model",
              disabled: state.composerDisabled,
              markState: state.busy ? "working" : "idle",
              // Board 39 G: terminal for a CLI, cloud for an API, hard-drive for Local.
              ...(state.modelMark
                ? {
                    mark:
                      state.modelMark === "cli" ? (
                        <Terminal />
                      ) : state.modelMark === "local" ? (
                        <HardDrive />
                      ) : (
                        <Cloud />
                      ),
                  }
                : {}),
              onClick: () => {
                setAgentModelTarget(null)
                controller.openMenu("model")
              },
            }}
            modelRef={(el) => el?.setAttribute("data-agent-menu-anchor", "")}
            action={state.busy ? "stop" : "send"}
            sendDisabled={
              !state.composer.text.trim() &&
              !state.composer.attachments.some((a) => a.kind === "image")
            }
            onSend={() => void controller.send(state.composer.text)}
            onStop={() => controller.stop()}
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.currentTarget.files ?? [])]
              e.currentTarget.value = ""
              void addFiles(files)
            }}
          />
        </div>
      )}
    </div>
  )
}

function ThreadItem({
  m,
  nowMs,
  waiting,
  onFollow,
  areaBusy,
  state,
  controller,
  onCopy,
  onEditRequest,
}: {
  m: AgentMessageView
  nowMs: number
  waiting: boolean
  onFollow?: (ids: string[]) => void
  areaBusy?: AreaBusyEnv
  state: AgentPanelViewState
  controller: AgentPanelControllerExt
  onCopy(text: string): void
  onEditRequest(turnId: string): void
}) {
  const [stepsToggled, setStepsToggled] = useState<boolean | null>(null)
  // Board 41 › 7 C: AREA_BUSY steps (their card) and the status while the agent waits for one.
  const busyIds =
    m.kind === "agent" && areaBusy
      ? m.steps.filter((s) => s.errorCode === "AREA_BUSY").map((s) => s.callId)
      : NO_BUSY
  const areaStatus = useAreaWaitStatus(areaBusy, busyIds)
  if (m.kind === "user")
    return (
      <div className="agent-panel__user" data-testid="agent-user-message">
        {m.attachments.length > 0 && (
          <div className="agent-panel__user-attachments">
            {m.attachments.map((a) =>
              a.kind === "image" ? (
                <AttachmentThumb
                  key={a.id}
                  name="image"
                  size={24}
                  {...(a.image ? { src: `data:${a.image.mimeType};base64,${a.image.data}` } : {})}
                />
              ) : (
                <AttachmentChip key={a.id} label={a.label} />
              ),
            )}
          </div>
        )}
        <Message from="user">{m.text}</Message>
        {m.fromHome && <span className="agent-panel__from-home">From Home</span>}
        {m.skills.some((s) => s !== "kimo-design") && (
          <div className="agent-panel__skill-used" data-testid="agent-skill-used">
            <BookOpen className="agent-panel__skill-used-icon" aria-hidden="true" />
            <span className="agent-panel__skill-used-label">Using {m.skills.join(" · ")}</span>
          </div>
        )}
      </div>
    )
  const card = m.card
  const undone = state.undoneTurns.includes(m.turnId)
  const actions: AgentErrorCardAction[] = (card?.actions ?? [])
    .concat(card?.kind === "offline" && m.streaming ? ["stop"] : [])
    .map((id) => ({
      id,
      label:
        id === "switch_model"
          ? `Switch to ${switchLabel(state)}`
          : id === "undo_turn" && undone
            ? "Turn undone"
            : (ACTION_LABEL[id] ?? id),
      onClick: () => {
        if (id === "undo_turn" && undone) return
        controller.cardAction(m.turnId, id)
      },
    }))
  const failed = m.steps.filter((s) => s.state === "failed").length
  // Board 31 Steps toggle: always folded by default (a failed step only adds "· N failed"), not
  // remembered.
  const stepsOpen = stepsToggled ?? false
  const progress = m.progress
  const running = m.steps.findLast((s) => s.state === "running")
  const status = waiting
    ? "Waiting for your approval"
    : areaStatus
      ? areaStatus
      : progress && progress.source !== "start"
        ? progress.status
        : running
          ? running.label.replace(/…$/, "")
          : (progress?.status ?? "Thinking…")
  return (
    <div
      className="agent-panel__agent"
      data-testid="agent-message"
      data-turn={m.turnId}
      {...(m.streaming ? {} : { "data-meta-hover": "" })}
    >
      {areaBusy && busyIds.length > 0 && <AreaBusyCards env={areaBusy} callIds={busyIds} />}
      {m.streaming ? (
        <AgentStatus
          data-testid="agent-status"
          data-pen="qi4M9"
          data-source={
            progress?.source === "start" && running ? "tool" : (progress?.source ?? "start")
          }
          status={status}
          elapsed={elapsedLabel(nowMs - (progress?.startedAt ?? nowMs))}
          {...(m.steps.length
            ? { steps: `${m.steps.length} step${m.steps.length === 1 ? "" : "s"}` }
            : {})}
          markState={
            waiting || areaStatus
              ? "waiting"
              : state.composer.state === "paused"
                ? "paused"
                : m.steps.length === 0 && progress?.source !== "note"
                  ? "thinking"
                  : "working"
          }
          {...(onFollow && progress?.follow.length
            ? { onFollow: () => onFollow(progress.follow) }
            : {})}
        />
      ) : null}
      {m.streaming && <AutoApprovedLines lines={m.autoApproved} />}
      {m.streaming ? null : (
        <>
          {card?.kind !== "refusal" && (m.text || !card) && (
            <Message from="agent" markState={markOf(false, m.steps, card)}>
              {/* Board 33 ME2DT: the reply's Markdown subset, React elements only. */}
              <AgentMarkdown
                data-testid="agent-reply"
                source={m.text}
                onOpenLink={(url) => controller.openLink(url)}
              />
            </Message>
          )}
          <AutoApprovedLines lines={m.autoApproved} />
          {m.steps.length > 0 && (
            <StepsToggle
              data-testid="agent-steps-toggle"
              data-pen={stepsOpen ? "ZBNJa" : "RWTLi"}
              count={m.steps.length}
              failed={failed}
              open={stepsOpen}
              onClick={() => setStepsToggled(!stepsOpen)}
            />
          )}
          {stepsOpen && m.steps.length > 0 && (
            <div className="agent-panel__steps" data-testid="agent-steps">
              {m.steps.map((s) => (
                <AgentStep key={s.callId} status={s.state} data-tool={s.tool}>
                  {s.label}
                </AgentStep>
              ))}
            </div>
          )}
          {m.meta && (
            <MessageMeta
              data-testid="agent-message-meta"
              reveal="hover"
              tokens={tokensLabel(m.meta.tokensIn, m.meta.tokensOut)}
              tokensTitle={tokensTitle(m.meta)}
              {...(state.showCost || m.meta.billing === "subscription"
                ? { cost: costLabel(m.meta) }
                : {})}
              duration={durationLabel(m.meta.wallMs)}
              onCopy={() => onCopy(m.text)}
              {...(m.meta.canRegenerate
                ? { onRegenerate: () => void controller.regenerate(m.turnId) }
                : {})}
            />
          )}
          {state.turnIssues[m.turnId] && (
            <p className="agent-panel__turn-issue" role="alert" data-testid="agent-turn-issue">
              {state.turnIssues[m.turnId]}
            </p>
          )}
        </>
      )}
      {card && (
        <div className="agent-panel__indent">
          {card.kind === "refusal" ? (
            // Board 25 dIkT6: neutral, hand, the model's own reason, "Edit request".
            <RefusalCard
              data-testid="agent-error-card"
              data-pen="dIkT6"
              title="Kimo won't do this one"
              reason={stripMarkdown(m.text) || card.body}
              onEditRequest={() => onEditRequest(m.turnId)}
            />
          ) : card.kind === "error" ? (
            // Board 25 u8mh7l: AgentErrorCard + circle-x, Retry + Copy error.
            <IconErrorCard
              data-testid="agent-error-card"
              data-kind="error"
              data-pen="u8mh7l"
              icon={<CircleX />}
              title="Something went wrong"
              description={genericBody(card)}
              actions={[
                ...actions.slice(0, 1).map((a) => ({
                  ...a,
                  icon: a.id === "open_settings" ? <Settings2 /> : <RotateCcw />,
                })),
                {
                  id: "copy_error",
                  label: "Copy error",
                  icon: <Copy />,
                  onClick: () => onCopy(`${card.title}\n${card.body}`),
                },
              ]}
            />
          ) : (
            <AgentErrorCard
              kind={card.kind}
              title={card.title}
              description={card.body}
              actions={actions}
              data-testid="agent-error-card"
            />
          )}
        </div>
      )}
    </div>
  )
}

const NO_BUSY: readonly string[] = []

/**
 * Board 41 › 7 C: one card per busy area (the latest AREA_BUSY call on each holder's area; an
 * agent that retried shows one card, not one per try).
 */
function AreaBusyCards({ env, callIds }: { env: AreaBusyEnv; callIds: readonly string[] }) {
  const latest = new Map<string, string>()
  for (const id of callIds) {
    const b = env.waits.busy(id)
    if (b) latest.set(`${b.detail.holder}\n${b.detail.ids.join(",")}`, id)
  }
  return [...latest.values()].map((id) => <AreaBusyCard key={id} env={env} callId={id} />)
}

/**
 * Board 34 Auto-approved Line (ZbBuI): row, gap 6, padding-left 34, center › shield-check 12
 * warning · Text sans 11 text-secondary, fill.
 */
function AutoApprovedLines({ lines }: { lines: readonly string[] | undefined }) {
  if (!lines?.length) return null
  return lines.map((line, i) => (
    <div
      // biome-ignore lint/suspicious/noArrayIndexKey: lines only append, in order.
      key={i}
      className="agent-panel__auto-line"
      data-testid="agent-auto-approved"
      data-pen="ZbBuI"
    >
      <ShieldCheck className="agent-panel__auto-line-icon" aria-hidden="true" />
      <span className="agent-panel__auto-line-text">{line}</span>
    </div>
  ))
}

/** "Anthropic returned 500 · overloaded_error. Nothing was changed on the canvas." */
function genericBody(card: { body: string; opsApplied: number }): string {
  const body = card.body.trim()
  if (card.opsApplied > 0 || /canvas|kept/i.test(body)) return body
  return `${body}${/[.!?]$/.test(body) ? "" : "."} Nothing was changed on the canvas.`
}

function switchLabel(state: AgentPanelViewState): string {
  const g = state.picker.find((x) => x.provider === state.composer.model?.provider)
  const fast = g?.models.find((x) => x.role === "fast")
  return fast?.label.replace(/^Claude /, "") ?? "the fast model"
}
