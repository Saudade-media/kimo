/**
 * M6 DOM overlays over the canvas (board 22 D0zDSY, board 24 iLW1l). The renderer draws the
 * outlines, shimmer, skeleton, flashes and connectors; this layer renders the pieces with text
 * and controls, positioned by {@link AgentCanvasModel.dom}:
 *
 * - placeholder Tag (EKCy7 `iyhUZ`; AgentMark/12/Working per board 24 nVrLq) and its hover
 *   tooltip (MVnAW `vqqTf`: "Pause agent" / "Edit anyway"); orphans (board 25 UMRAO) read
 *   "Agent stopped · <name>" with `unplug` on bg-muted;
 * - "<name> ready · N ops · Review" chip (MVnAW `i6wxFe`) after a placeholder clears;
 * - ScopeTag (NKE7Z) per scope root, the rejected-op pill (z6D2MM `O2Whh`);
 * - persona cursors (board 24 GmEAl `H6ncRy`: pointer + pill with AgentMark + label);
 * - prompt footers (poE5B `pFCri`: status icon + text, Run / Stop / Retry), the running outline
 *   (n22Gv `VFi4q`: 1.5 `agent`) and target chips (n22Gv `sWQ2b`).
 */
import { Button } from "@kimo/ui"
import { useState } from "react"
import { Icon } from "../lib/icons"
import type { AgentDomState, PromptView } from "./agent-canvas"
import { CanvasAgentMark } from "./agent-mark"
import "./agent-canvas.css"
import type { AgentCanvasProps } from "./contract"

export function AgentCanvasDom({
  dom,
  props,
  hovered,
}: {
  dom: AgentDomState
  props: AgentCanvasProps | null
  /** The canvas-hovered node (a hovered placeholder frame shows its tooltip). */
  hovered: string | null
}) {
  const [tagHover, setTagHover] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const tipFor = tagHover ?? hovered
  return (
    <div className="agent-canvas" data-testid="agent-canvas-dom">
      {dom.prompts.map((p) => (
        <PromptChrome key={p.id} view={p} props={props} />
      ))}
      {dom.tags.map((t) => (
        <div
          key={t.id}
          className={`agent-canvas__tag agent-canvas__tag--${t.state === "interrupted" ? "interrupted" : t.persona}`}
          data-testid="placeholder-tag"
          data-canvas-overlay=""
          data-node-id={t.id}
          data-state={t.state}
          style={{ left: t.left, top: t.top }}
          onPointerEnter={() => setTagHover(t.id)}
          onPointerLeave={() => setTagHover((h) => (h === t.id ? null : h))}
        >
          {t.state === "building" ? (
            <CanvasAgentMark state="working" persona={t.persona} size={12} />
          ) : (
            <Icon name="unplug" size={11} className="agent-canvas__tag-icon" />
          )}
          <span className="agent-canvas__tag-label">{t.text}</span>
          {t.state === "building" && tipFor === t.id && !dismissed.has(t.id) && (
            <div className="agent-canvas__tip" role="tooltip" data-testid="placeholder-tooltip">
              <div className="agent-canvas__tip-head">
                <CanvasAgentMark state="working" persona={t.persona} size={16} />
                <span className="agent-canvas__tip-title">{t.label} is building this frame</span>
              </div>
              <p className="agent-canvas__tip-desc">
                You can still edit; overlapping edits make the agent re-read before its next batch.
              </p>
              <div className="agent-canvas__tip-actions">
                <Button
                  variant="secondary"
                  icon={<Icon name="pause" size={14} />}
                  onClick={() => t.origin && props?.onPauseAgent?.(t.origin)}
                  disabled={!t.origin || !props?.onPauseAgent}
                >
                  Pause agent
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDismissed((d) => new Set(d).add(t.id))
                    setTagHover(null)
                  }}
                >
                  Edit anyway
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      {dom.ready.map((r) => (
        <div
          key={r.id}
          className="agent-canvas__ready"
          data-testid="placeholder-ready"
          data-canvas-overlay=""
          style={{ left: r.left, top: r.top }}
        >
          <Icon name="check" size={12} />
          <span className="agent-canvas__ready-label">
            {r.text} ·{" "}
            <button
              type="button"
              className="agent-canvas__ready-review"
              onClick={() => r.origin && props?.onReviewPlaceholder?.(r.id, r.origin)}
            >
              Review
            </button>
          </span>
        </div>
      ))}
      {dom.scopes.map((s) => (
        <div
          key={s.key}
          className={`agent-canvas__scope agent-canvas__scope--${s.persona}`}
          data-testid="scope-tag"
          style={
            s.anchor === "left"
              ? { left: s.left, top: s.top }
              : { left: s.left, top: s.top, transform: "translateX(-100%)" }
          }
        >
          <Icon name="lock" size={11} />
          <span className="agent-canvas__scope-label">{s.text}</span>
        </div>
      ))}
      {dom.passes.map((c) => (
        <div
          key={c.key}
          className="agent-canvas__pass"
          data-testid="iterate-pass-chip"
          style={{ left: c.left, top: c.top }}
        >
          <Icon name="repeat" size={12} />
          <span className="agent-canvas__pass-label">{c.text}</span>
        </div>
      ))}
      {dom.rejected.map((r) => (
        <div
          key={r.key}
          className="agent-canvas__rejected"
          role="status"
          data-testid="rejected-pill"
          style={{ left: r.cx, top: r.top }}
        >
          <Icon name="ban" size={12} />
          <span className="agent-canvas__rejected-label">{r.text}</span>
        </div>
      ))}
      {dom.cursors.map((c) => (
        <div
          key={c.origin}
          className={`agent-canvas__cursor agent-canvas__cursor--${c.persona}${c.flipX ? " agent-canvas__cursor--flip-x" : ""}${c.flipY ? " agent-canvas__cursor--flip-y" : ""}`}
          data-testid="persona-cursor"
          data-origin={c.origin}
          style={{ left: c.left, top: c.top + c.stack * (22 + 4) }}
        >
          <span className="agent-canvas__cursor-pointer">
            <Icon name="mouse-pointer-2" size={18} />
          </span>
          <div className="agent-canvas__cursor-pill">
            <CanvasAgentMark state={c.state} persona={c.persona} size={12} />
            <span className="agent-canvas__cursor-label">{c.text}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

const STATUS_ICON: Record<PromptView["status"], string | null> = {
  never: null,
  idle: "circle-check",
  running: "loader-circle",
  failed: "circle-alert",
}

const ACTION: Record<PromptView["action"], { icon: string; label: string }> = {
  run: { icon: "play", label: "Run" },
  stop: { icon: "square", label: "Stop" },
  retry: { icon: "rotate-ccw", label: "Retry" },
}

/** Prompt footer contents in world scale (the card and footer fill are canvas-drawn). */
function PromptChrome({ view, props }: { view: PromptView; props: AgentCanvasProps | null }) {
  const { box, zoom } = view
  const icon = STATUS_ICON[view.status]
  const action = ACTION[view.action]
  const footerH = 42 * zoom
  return (
    <>
      {view.status === "running" && (
        <div
          className="agent-canvas__prompt-running"
          data-testid="prompt-running-outline"
          style={{
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            borderRadius: 16 * zoom,
          }}
        />
      )}
      <div
        className={`agent-canvas__prompt-footer agent-canvas__prompt-footer--${view.status}`}
        data-testid="prompt-footer"
        data-node-id={view.id}
        style={{
          left: box.x,
          top: box.y + box.h - footerH,
          width: box.w / zoom,
          transform: `scale(${zoom})`,
        }}
      >
        {icon && (
          <span className="agent-canvas__prompt-status-icon">
            <Icon name={icon} size={12} />
          </span>
        )}
        <span className="agent-canvas__prompt-status">{view.footer}</span>
        <span className="agent-canvas__prompt-spacer" />
        <button
          type="button"
          className={`agent-canvas__prompt-run agent-canvas__prompt-run--${view.action}`}
          data-testid="prompt-run"
          data-action={view.action}
          data-canvas-overlay=""
          onClick={() =>
            view.action === "stop" ? props?.onStopPrompt?.(view.id) : props?.onRunPrompt?.(view.id)
          }
          disabled={view.action === "stop" ? !props?.onStopPrompt : !props?.onRunPrompt}
        >
          <Icon name={action.icon} size={12} />
          <span className="agent-canvas__prompt-run-label">{action.label}</span>
        </button>
      </div>
      {view.target && (
        <div
          className="agent-canvas__target"
          data-testid="prompt-target-chip"
          style={{ left: view.target.left, top: view.target.top }}
        >
          <Icon name="crosshair" size={10} />
          <span className="agent-canvas__target-label">{view.target.text}</span>
        </div>
      )}
    </>
  )
}
