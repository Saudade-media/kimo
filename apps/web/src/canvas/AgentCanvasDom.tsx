/**
 * M6 DOM overlays over the canvas (board 22 D0zDSY, board 24 iLW1l, board 36 XDVdg). The
 * renderer draws the rejected-op flash and prompt connectors; this layer renders the pieces with
 * text and controls, positioned by {@link AgentCanvasModel.dom}:
 *
 * - board 36: per agent one cursor (pointer + name pill) on its section's center, a 1 px outline
 *   on that section, and one fading ring per landed edit on the section;
 * - the rejected-op pill (z6D2MM `O2Whh`) and the Iterate pass chip (h6oHb `NCElh`);
 * - prompt footers (poE5B `pFCri`: status icon + text, Run / Stop / Retry), the running outline
 *   (n22Gv `VFi4q`: 1.5 `agent`) and target chips (n22Gv `sWQ2b`).
 */
import { Icon } from "../lib/icons"
import { AgentSectionLayer } from "./AgentSectionCursor"
import type { AgentDomState, PromptView } from "./agent-canvas"
import "./agent-canvas.css"
import type { AgentCanvasProps } from "./contract"

export function AgentCanvasDom({
  dom,
  props,
}: {
  dom: AgentDomState
  props: AgentCanvasProps | null
}) {
  return (
    <div className="agent-canvas" data-testid="agent-canvas-dom">
      {dom.prompts.map((p) => (
        <PromptChrome key={p.id} view={p} props={props} />
      ))}
      <AgentSectionLayer cursors={dom.cursors} flashes={dom.flashes} />
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
