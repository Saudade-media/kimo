/**
 * Approval Prompt (weJXw, board 21 L2eaCu): anchored under the presence chip; the agent's call
 * blocks until Deny / Always for this session / Allow once, or the 2-minute timeout denies it.
 * Prompts queue oldest first (rule "Approval"); Esc = Deny.
 */
import { AgentOpRow, AgentOrb, Button, useAnchoredPosition } from "@kimo/ui"
import { useEffect, useRef } from "react"
import type { AgentsControllerExt } from "./controller"
import { useAgentsState, useNow } from "./hooks"
import {
  approvalDescription,
  approvalFootnote,
  approvalMeta,
  approvalTargets,
  approvalTitle,
  DEFAULT_POLICY,
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
  const answer = (choice: "deny" | "session" | "once") => void controller.answer(r.id, choice)
  return (
    <div
      ref={root}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="agents-approval-title"
      aria-describedby="agents-approval-desc"
      className="agents-approval"
      data-testid="agent-approval"
      data-reason={r.reason.kind}
      style={
        pos
          ? {
              position: "fixed",
              left: pos.x,
              top: pos.y,
              visibility: pos.ready ? "visible" : "hidden",
            }
          : undefined
      }
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
        <AgentOrb size={32} />
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
        <div className="agents-approval__targets">
          {targets.map((t) => (
            <AgentOpRow
              key={`${t.op}-${t.nodeId}`}
              op={t.op}
              target={t.target}
              detail={t.detail}
              tone={t.tone}
            />
          ))}
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
    </div>
  )
}
