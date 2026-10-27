/**
 * Approval Prompt (weJXw, board 21 L2eaCu): anchored under the presence chip; the agent's call
 * blocks until Deny / Always for this session / Allow once, or the 2-minute timeout denies it.
 * Prompts queue oldest first (rule "Approval"); Esc = Deny.
 */
import { AgentMark, AgentOpRow, Button, floating, useAnchoredPosition } from "@kimo/ui"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { AgentsControllerExt } from "./controller"
import { useAgentsState, useNow } from "./hooks"
import {
  approvalDescription,
  approvalFootnote,
  approvalMeta,
  approvalTargets,
  approvalTitle,
  DEFAULT_POLICY,
  groupApprovalTargets,
} from "./model"

export interface ApprovalPromptProps {
  controller: AgentsControllerExt
  /** The presence chip; null: top-right under the topbar (fixed). */
  anchor: HTMLElement | null
}

const FALLBACK = { x: 0, y: 48, width: 0, height: 0 }

export function ApprovalPrompt({ controller, anchor }: ApprovalPromptProps) {
  const store = controller.store
  const state = useAgentsState(controller)
  const prompt = state.prompt
  const root = useRef<HTMLDivElement>(null)
  const now = useNow(!!prompt, 1000)
  const rect =
    anchor ??
    (typeof window !== "undefined" ? { ...FALLBACK, x: window.innerWidth - 16 } : FALLBACK)
  const pos = useAnchoredPosition(root, rect, {
    side: "bottom",
    align: "end",
    offset: anchor ? 18 : 8,
  })
  const id = prompt?.request.id
  // Board 34 §4: "Show all" lists every row; a new request starts folded.
  const [showAll, setShowAll] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per request.
  useEffect(() => setShowAll(false), [id])
  // Esc = Deny (rule "Approval") wherever focus is, unless a text field or another dialog/menu
  // owns the key.
  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (root.current?.contains(t)) return // handled by the prompt itself
      if (
        t?.closest(
          "input, textarea, select, [contenteditable='true'], [role='menu'], [role='dialog']",
        )
      )
        return
      e.preventDefault()
      void controller.answer(id, "deny")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [id, controller])
  useEffect(() => {
    if (id)
      root.current
        ?.querySelector<HTMLButtonElement>("[data-choice='once']")
        ?.focus({ preventScroll: true })
  }, [id])
  if (!prompt) return null
  const r = prompt.request
  const policy = state.policies[r.client.client] ?? DEFAULT_POLICY
  const remaining = Math.max(0, r.expiresAt - now)
  const targets = approvalTargets(r, store)
  const groups = groupApprovalTargets(r, targets, showAll)
  const total = groups ? groups.reduce((n, g) => n + g.total, 0) : targets.length
  const folded = groups?.some((g) => g.more > 0 && g.rows.length < g.total) ?? false
  // Board 34 §4: height capped at min(70vh, the space below the anchor − 16).
  const top = anchor ? anchor.getBoundingClientRect().bottom + 18 : FALLBACK.y + 8
  const answer = (choice: "deny" | "session" | "once") => void controller.answer(r.id, choice)
  return floating(
    <div
      ref={root}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="agents-approval-title"
      aria-describedby="agents-approval-desc"
      className="agents-approval"
      data-testid="agent-approval"
      data-reason={r.reason.kind}
      style={{
        maxHeight: `min(70vh, calc(100vh - ${Math.round(top)}px - 16px))`,
        ...(pos
          ? {
              position: "fixed",
              left: pos.x,
              top: pos.y,
              visibility: pos.ready ? "visible" : "hidden",
            }
          : {}),
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          answer("deny")
        }
      }}
    >
      {/* Head (CDPPh) */}
      <div className="agents-approval__head">
        <AgentMark size={32} state="listening" />
        <div className="agents-approval__text">
          <span id="agents-approval-title" className="agents-approval__title">
            {approvalTitle(r, store)}
          </span>
          <span id="agents-approval-desc" className="agents-approval__desc">
            {approvalDescription(r, policy.level)}
          </span>
        </div>
      </div>
      {/* Targets (dBQHl) */}
      {targets.length > 0 && (
        <div className="agents-approval__targets" data-testid="agent-approval-targets">
          {groups
            ? groups.map((g) => (
                // Board 34 §4 Group (pXG9M): header, rows, "and N more".
                <div key={g.kind} className="agents-approval__group" data-kind={g.kind}>
                  <div className="agents-approval__group-head">
                    <span className="agents-approval__group-kind">{g.label}</span>
                    <span className="agents-approval__group-count">{g.total}</span>
                  </div>
                  {g.rows.map((t) => (
                    <AgentOpRow
                      key={`${t.op}-${t.nodeId}`}
                      op={t.op}
                      target={t.target}
                      detail={t.detail}
                      tone={t.tone}
                    />
                  ))}
                  {g.more > 0 && (
                    <div className="agents-approval__more" data-testid="agent-approval-more">
                      and {g.more} more
                    </div>
                  )}
                </div>
              ))
            : targets.map((t) => (
                <AgentOpRow
                  key={`${t.op}-${t.nodeId}`}
                  op={t.op}
                  target={t.target}
                  detail={t.detail}
                  tone={t.tone}
                />
              ))}
          {groups && (folded || showAll) && (
            <button
              type="button"
              className="agents-approval__show-all"
              data-testid="agent-approval-show-all"
              aria-expanded={showAll}
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              <span>{showAll ? "Show fewer" : `Show all ${total}`}</span>
            </button>
          )}
        </div>
      )}
      {/* Meta (zqzx0) */}
      <div className="agents-approval__meta">
        <span className="agents-approval__call">{approvalMeta(r)}</span>
      </div>
      {/* Footer (AUE48) */}
      <div className="agents-approval__footer">
        <Button
          size="sm"
          variant="ghost"
          className="agents-button agents-button--30 agents-button--ghost-secondary"
          data-choice="deny"
          onClick={() => answer("deny")}
        >
          Deny
        </Button>
        <span className="agents-spacer" />
        {prompt.choices.includes("session") && (
          <Button
            size="sm"
            variant="secondary"
            className="agents-button agents-button--30"
            data-choice="session"
            onClick={() => answer("session")}
          >
            Always for this session
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          className="agents-button agents-button--30 agents-button--pad14"
          data-choice="once"
          onClick={() => answer("once")}
        >
          Allow once
        </Button>
      </div>
      <span className="agents-approval__footnote" data-testid="agent-approval-footnote">
        {approvalFootnote(r, remaining, prompt.queued)}
      </span>
    </div>,
    anchor,
  )
}
