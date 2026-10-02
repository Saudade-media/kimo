/**
 * Board 03 "Floating Toolbar" (sFtrg): bg-app pill, 1px border, shadow 0 4 20 shadow-strong,
 * gap 2, padding 6, items centered; ToolButtons in CANVAS_TOOLS order, a 1 × 20 border divider,
 * then "Ask Kimo" (36 high, accent-soft pill, gap 6, padding [0, 12, 0, 10]: sparkles 16,
 * label 13/600 accent-text, Kbd ⌘K). Bottom-centered over the canvas, 24px from the bottom.
 */
import { Kbd, ToolButton, Tooltip } from "@kimo/ui"
import { CANVAS_TOOLS, type CanvasToolId, toolIdFor, type UiStore } from "../canvas/contract"
import { useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"

export function FloatingToolbar({
  ui,
  onActivate,
}: {
  ui: UiStore
  onActivate(id: CanvasToolId): void
}) {
  const tool = useUi(ui, (s) => s.tool)
  const active = toolIdFor(tool)
  return (
    <div className="floating-toolbar" role="toolbar" aria-label="Tools">
      {CANVAS_TOOLS.map((t) => (
        <Tooltip
          key={t.id}
          side="top"
          label={t.enabled ? t.label : `${t.label} · coming soon`}
          shortcut={t.enabled ? t.shortcut : undefined}
        >
          <ToolButton
            label={t.label}
            icon={<Icon name={t.icon} size={18} />}
            active={active === t.id}
            disabled={!t.enabled}
            data-tool={t.id}
            onClick={() => onActivate(t.id)}
          />
        </Tooltip>
      ))}
      <span className="floating-toolbar__divider" aria-hidden="true" />
      <Tooltip side="top" label="Agent arrives in M6">
        <button type="button" className="floating-toolbar__ask" aria-disabled="true">
          <span className="floating-toolbar__ask-icon">
            <Icon name="sparkles" size={16} />
          </span>
          <span className="floating-toolbar__ask-label">Ask Kimo</span>
          <Kbd>⌘K</Kbd>
        </button>
      </Tooltip>
    </div>
  )
}
