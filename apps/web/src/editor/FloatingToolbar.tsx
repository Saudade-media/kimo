/**
 * Board 03 "Floating Toolbar" (sFtrg): bg-app pill, 1px border, shadow 0 4 20 shadow-strong,
 * gap 2, padding 6, items centered; ToolButtons in CANVAS_TOOLS order, a 1 × 20 border divider,
 * then "Ask Kimo" (36 high, accent-soft pill, gap 6, padding [0, 12, 0, 10]: sparkles 16,
 * label 13/600 accent-text, Kbd ⌘K). Bottom-centered over the canvas, 24px from the bottom.
 *
 * M2 (board 10 #7 "Pen tool active", BacCm): Pen takes the active slot while the pen tool is
 * armed and the Tooltip/Hint pill (EW0tj → u0dQ1) floats 12px above the toolbar, centered,
 * fading out after the first anchor. Image shows active while an image placement is armed.
 *
 * M6 (board 22 cf2sC `FTOjQ`): Note (N) and Prompt (⇧P) after Component, their icons tinted
 * `note-text` / `agent` as in the design's Tool · Note / Tool · Prompt.
 */
import { Kbd, ToolButton, Tooltip } from "@kimo/ui"
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react"
import { activeToolId, CANVAS_TOOLS, type CanvasToolId, type UiStore } from "../canvas/contract"
import { HintPill } from "../canvas/hints"
import { useCanvasToolState } from "../canvas/tool-state"
import { useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"

/** desing.pen light values for the M6 tool tints until the tokens ship. */
const TINT_FALLBACK: Record<string, string> = { "note-text": "#3D3205", agent: "#0093A3" }

/** Board 10 #7 hint copy (Zlv3i). */
const PEN_HINT = "Click to add points · Drag to curve · Enter to finish"

export function FloatingToolbar({
  ui,
  onActivate,
  onAsk,
}: {
  ui: UiStore
  onActivate(id: CanvasToolId): void
  /** "Ask Kimo" (⌘K): opens the Agent tab (M6). Absent: the M5 disabled state. */
  onAsk?: () => void
}) {
  const tool = useUi(ui, (s) => s.tool)
  const { placement, penHint } = useCanvasToolState(ui)
  const active = activeToolId(tool, placement)
  const bar = useRef<HTMLDivElement | null>(null)
  const [barH, setBarH] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    setBarH(el.getBoundingClientRect().height)
    const ro = new ResizeObserver(() => setBarH(el.getBoundingClientRect().height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <>
      {tool === "path" && (
        <HintPill
          icon="pen-tool"
          className={`canvas-hint--toolbar${penHint ? "" : " canvas-hint--hidden"}`}
          aria-hidden={!penHint}
          style={
            barH === null ? undefined : ({ "--floating-toolbar-h": `${barH}px` } as CSSProperties)
          }
        >
          {PEN_HINT}
        </HintPill>
      )}
      <div ref={bar} className="floating-toolbar" role="toolbar" aria-label="Tools">
        {CANVAS_TOOLS.map((t) => {
          // M3: one-shot actions (Component, ⌥⌘K) are enabled even while the tool spec is not.
          const enabled = t.enabled || t.action !== undefined
          return (
            <Tooltip
              key={t.id}
              side="top"
              label={enabled ? t.label : `${t.label} · coming soon`}
              shortcut={enabled ? t.shortcut : undefined}
            >
              <ToolButton
                label={t.label}
                icon={
                  t.iconColor ? (
                    // M6 (board 22 cf2sC "Insert hint"): Note sticky-note `note-text`,
                    // Prompt sparkles `agent`.
                    <span
                      className="floating-toolbar__tinted"
                      style={{
                        display: "inline-flex",
                        color: `var(--kimo-${t.iconColor}, ${TINT_FALLBACK[t.iconColor] ?? "currentColor"})`,
                      }}
                    >
                      <Icon name={t.icon} size={18} />
                    </span>
                  ) : (
                    <Icon name={t.icon} size={18} />
                  )
                }
                active={active === t.id}
                disabled={!enabled}
                data-tool={t.id}
                onClick={() => onActivate(t.id)}
              />
            </Tooltip>
          )
        })}
        <span className="floating-toolbar__divider" aria-hidden="true" />
        {onAsk ? (
          <button type="button" className="floating-toolbar__ask" onClick={onAsk}>
            <span className="floating-toolbar__ask-icon">
              <Icon name="sparkles" size={16} />
            </span>
            <span className="floating-toolbar__ask-label">Ask Kimo</span>
            <Kbd>⌘K</Kbd>
          </button>
        ) : (
          <Tooltip side="top" label="Agent arrives in M6">
            <button type="button" className="floating-toolbar__ask" aria-disabled="true">
              <span className="floating-toolbar__ask-icon">
                <Icon name="sparkles" size={16} />
              </span>
              <span className="floating-toolbar__ask-label">Ask Kimo</span>
              <Kbd>⌘K</Kbd>
            </button>
          </Tooltip>
        )}
      </div>
    </>
  )
}
