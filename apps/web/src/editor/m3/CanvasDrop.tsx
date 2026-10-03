/**
 * Component drag & drop onto the canvas (board 13 `A3eub` / `CTfcw` / `orZ62` drop hints, drag
 * chip `oz00b`): the Assets tab sets an `application/x-kimo-component` payload; while it is over
 * the canvas the hint pill follows the pointer, and the drop runs ONE command (createInstance /
 * slot insert / replace). The canvas builder may take over with `armComponentDrag`.
 */
import { useRef, useState } from "react"
import type { ComponentDropTarget } from "../../canvas/contract"
import { Icon } from "../../lib/icons"
import { COMPONENT_MIME } from "./AssetsTab"
import { insertIntoSlot, replaceWithComponent } from "./actions"
import type { M3Controller } from "./controller"
import { resolveComponentDrop } from "./drop"

interface Hover {
  x: number
  y: number
  target: ComponentDropTarget | null
}

/** Props to spread on the canvas container. */
export function useCanvasDrop(m3: M3Controller) {
  const [hover, setHover] = useState<Hover | null>(null)
  const last = useRef(0)
  const target = (el: HTMLElement, clientX: number, clientY: number, alt: boolean) => {
    const r = el.getBoundingClientRect()
    const p = { x: clientX - r.left, y: clientY - r.top }
    const canvas = m3.canvas()
    const hits = canvas?.renderer?.hitTest(p, { tolerance: 2 }) ?? []
    return { p, target: resolveComponentDrop(m3.view(), hits, alt) }
  }
  const handlers = {
    onDragOver(e: React.DragEvent<HTMLElement>) {
      if (!e.dataTransfer.types.includes(COMPONENT_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
      const now = performance.now()
      if (now - last.current < 32) return
      last.current = now
      const { p, target: t } = target(e.currentTarget, e.clientX, e.clientY, e.altKey)
      setHover({ x: p.x, y: p.y, target: t })
      m3.canvas()?.previewComponentDrop?.(t)
    },
    onDragLeave(e: React.DragEvent<HTMLElement>) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setHover(null)
        m3.canvas()?.previewComponentDrop?.(null)
      }
    },
    onDrop(e: React.DragEvent<HTMLElement>) {
      const raw = e.dataTransfer.getData(COMPONENT_MIME)
      setHover(null)
      m3.canvas()?.previewComponentDrop?.(null)
      if (!raw) return
      e.preventDefault()
      let drag: { of: string; name: string }
      try {
        drag = JSON.parse(raw)
      } catch {
        return
      }
      const { p, target: t } = target(e.currentTarget, e.clientX, e.clientY, e.altKey)
      dropComponent(m3, drag, t, p)
    },
  }
  const hint = hover?.target ? (
    <div
      className={`m3-drop-hint${hover.target.kind === "frame" ? "" : " m3-drop-hint--component"}`}
      style={{ left: hover.x + 14, top: hover.y + 18 }}
      data-testid="drop-hint"
    >
      <span className="m3-drop-hint__icon">
        <Icon name={hover.target.kind === "replace" ? "replace" : "corner-down-right"} size={12} />
      </span>
      <span className="m3-drop-hint__label">{hover.target.label}</span>
    </div>
  ) : null
  return { handlers, hint }
}

/** Runs the drop (one undo step). */
export function dropComponent(
  m3: M3Controller,
  drag: { of: string; name: string },
  t: ComponentDropTarget | null,
  screen: { x: number; y: number },
): boolean {
  if (!t) return false
  if (t.kind === "slot") return insertIntoSlot(m3, `${t.instance}/${t.path}`, drag.of)
  if (t.kind === "replace") return replaceWithComponent(m3, `${t.instance}/${t.path}`, drag.of)
  const canvas = m3.canvas()
  const world = canvas ? canvas.screenToWorld(screen) : screen
  let x = world.x
  let y = world.y
  if (t.parent) {
    const box = canvas?.layout()?.nodes.get(t.parent)?.world
    if (box) {
      x -= box.x
      y -= box.y
    }
  }
  return m3.run(
    {
      cmd: "createInstance",
      of: drag.of,
      placement: { parent: t.parent, x: Math.round(x), y: Math.round(y), name: drag.name },
    },
    "Insert instance",
  ).ok
}
