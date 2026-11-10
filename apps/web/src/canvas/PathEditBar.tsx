/**
 * Board 27 §5 (c) "Path edit toolbar" (J5Vng › LirqJ), shown 12 px above the edited path's
 * bounds while in path edit, replacing the floating toolbar. Row, gap 2, padding 4, center,
 * bg-app pill, stroke 1 border, shadow 0 4 12 shadow. Children in node order:
 *   Select anchors (ToolButton/Active 32 × 32, mouse-pointer-2 16) · Add / pen (pen-tool) ·
 *   Bend (spline) · Divider 1 × 20 border · Anchor type (SegmentedText Sharp | Smooth) ·
 *   Divider · Cut at anchor (scissors) · Delete segment (eraser) · Divider ·
 *   Done (Button/Primary h 28, padding [0, 12], label text-sm, no icon).
 * Cut Cue (NsORT) next to a selected segment: text-primary pill, gap 4, padding [2, 6],
 * eraser 10 text-inverse + "⌫ deletes segment" sans 11 text-inverse.
 */
import { Button, SegmentedText, ToolButton, Tooltip } from "@kimo/ui"
import { useLayoutEffect, useRef, useState } from "react"
import { t } from "../lib/i18n"
import { Icon } from "../lib/icons"
import type { UiStore } from "./contract"
import { type PathEditBarState, useCanvasToolState } from "./tool-state"
import "./path-edit-bar.css"

export type PathEditCommand =
  | "select"
  | "add"
  | "bend"
  | "sharp"
  | "smooth"
  | "cut"
  | "deleteSegment"
  | "done"

/** Bar bottom → path bounds top (rule aKwqB: "12 px above the path's bounds"). */
const PATH_EDIT_BAR_GAP = 12

const MODES = [
  { mode: "select", label: "ui.path.selectAnchors", icon: "mouse-pointer-2", pen: "K4tXoR" },
  { mode: "add", label: "ui.path.addAnchor", icon: "pen-tool", pen: "CS881" },
  { mode: "bend", label: "ui.path.bend", icon: "spline", pen: "B7DQfS" },
] as const

export function PathEditBar({ ui, run }: { ui: UiStore; run(command: PathEditCommand): void }) {
  const { pathEdit } = useCanvasToolState(ui)
  if (!pathEdit) return null
  return <Bar state={pathEdit} run={run} />
}

function Bar({ state, run }: { state: PathEditBarState; run(c: PathEditCommand): void }) {
  const bar = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 40 })
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width !== size.w || r.height !== size.h) setSize({ w: r.width, h: r.height })
  })
  const left = state.box.x + state.box.w / 2 - size.w / 2
  const top = state.box.y - PATH_EDIT_BAR_GAP - size.h
  return (
    <>
      <div
        ref={bar}
        className="path-edit-bar"
        role="toolbar"
        aria-label={t("ui.canvas.patheditbar.6")}
        data-canvas-overlay=""
        data-pen="LirqJ"
        style={{ left: Math.round(left), top: Math.round(top) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {MODES.map((m) => (
          <Tooltip key={m.mode} side="top" label={t(m.label)}>
            <ToolButton
              className="path-edit-bar__tool"
              label={t(m.label)}
              icon={<Icon name={m.icon} size={16} />}
              active={state.mode === m.mode}
              data-pen={m.pen}
              data-mode={m.mode}
              onClick={() => run(m.mode)}
            />
          </Tooltip>
        ))}
        <span className="path-edit-bar__divider" aria-hidden="true" />
        <SegmentedText
          className="path-edit-bar__kind"
          label={t("ui.canvas.patheditbar.5")}
          data-pen="t1kP6a"
          options={[
            { value: "sharp", label: t("ui.canvas.patheditbar.sharp"), disabled: !state.canCut },
            { value: "smooth", label: t("ui.canvas.patheditbar.smooth"), disabled: !state.canCut },
          ]}
          value={state.anchorKind}
          onChange={(v) => run(v)}
        />
        <span className="path-edit-bar__divider" aria-hidden="true" />
        <Tooltip side="top" label={t("ui.canvas.patheditbar.4")}>
          <ToolButton
            className="path-edit-bar__tool"
            label={t("ui.canvas.patheditbar.3")}
            icon={<Icon name="scissors" size={16} />}
            disabled={!state.canCut}
            data-pen="qDGrD"
            onClick={() => run("cut")}
          />
        </Tooltip>
        <Tooltip side="top" label={t("ui.canvas.patheditbar.2")} shortcut="⌫">
          <ToolButton
            className="path-edit-bar__tool"
            label={t("ui.canvas.patheditbar.1")}
            icon={<Icon name="eraser" size={16} />}
            disabled={!state.segmentSelected}
            data-pen="X7yF0a"
            onClick={() => run("deleteSegment")}
          />
        </Tooltip>
        <span className="path-edit-bar__divider" aria-hidden="true" />
        <Button
          variant="primary"
          size="sm"
          className="path-edit-bar__done"
          data-pen="SsIpQ"
          onClick={() => run("done")}
        >
          {t("ui.canvas.patheditbar.7")}
        </Button>
      </div>
      {state.cue && (
        <div
          className="path-edit-cue"
          data-canvas-overlay=""
          data-pen="NsORT"
          style={{ left: Math.round(state.cue.x), top: Math.round(state.cue.y) }}
        >
          <span className="path-edit-cue__icon">
            <Icon name="eraser" size={10} />
          </span>
          <span className="path-edit-cue__label">{t("ui.canvas.patheditbar.deleteSegment")}</span>
        </div>
      )}
    </>
  )
}
