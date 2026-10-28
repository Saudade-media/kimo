/**
 * The canvas context menu (board 25 §3 jWmmU) and "Set as target" pick mode (rule wabqA).
 *
 * Right-click selects what a click would select (unless it is already selected), then opens
 * `CanvasContextMenu` with the {@link canvasMenuModel} groups: agent items first, the standard
 * items, Delete. Pick mode: crosshair cursor, the frame under the pointer outlined in `$agent`,
 * click sets the prompt's target, a click on empty canvas clears it, Esc cancels.
 */

import { type KimoDocument, resolveVariable } from "@kimo/core-schema"
import type { LayoutResult } from "@kimo/layout"
import { AgentMark, CanvasContextMenu, type CanvasContextMenuItem } from "@kimo/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AgentPanelControllerExt } from "../agent-panel"
import { askKimoToFinish, placeholderSession, resumeAgentSession } from "../agent-panel/resume"
import { type DocReader, deleteOps, duplicateOps, pathOf } from "../canvas/commands"
import type { CanvasHandle, CanvasPointerInfo } from "../canvas/contract"
import { currentHeader } from "../lib/header"
import { Icon } from "../lib/icons"
import { shortcutLabel } from "../shortcuts"
import { requestBind } from "./bind"
import { detachAllFields, nodeHasBinding, pickerGroups, sharedRef } from "./bindings"
import { registerRowMenu } from "./clipboard/menu-bus"
import { commandsFor } from "./clipboard/useEditorCommands"
import type { StructureMenuState, VariableMenuState } from "./context-menu"
import {
  type CanvasMenuAction,
  type CanvasMenuModel,
  type CanvasMenuRow,
  canvasMenuModel,
  menuNodeName,
} from "./context-menu"
import { createComponent } from "./m3/actions"
import { openReplaceMain } from "./m3/ComponentDialogs"
import type { M3Controller } from "./m3/controller"
import type { FileSession } from "./session"
import "./canvas-menu.css"

interface CanvasMenuDeps {
  session: FileSession
  m3: M3Controller
  canvas: { current: CanvasHandle | null }
  /** The `<main>` canvas container (menu anchor + pick-mode listeners). */
  container: { current: HTMLElement | null }
  controller: AgentPanelControllerExt | null
  runPrompt(id: string): void
  openAgentTab(): void
  /** Board 41 section 9: a View link; the menu only offers Copy. */
  viewOnly?: boolean
}

interface Open {
  at: { x: number; y: number }
  model: CanvasMenuModel
}

/** `onContextMenu` for `<CanvasHost>` plus the menu / pick-mode elements to render in the canvas. */
export function useCanvasMenu(d: CanvasMenuDeps): {
  onContextMenu(info: CanvasPointerInfo): void
  element: React.ReactNode
  /** The prompt in pick mode, or null. */
  picking: string | null
} {
  const [open, setOpen] = useState<Open | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const deps = useRef(d)
  deps.current = d

  const onContextMenu = useCallback((info: CanvasPointerInfo) => {
    const { session, m3, controller, container } = deps.current
    setPick(null)
    const ui = session.ui.getState()
    const target = info.target ?? info.hit
    if (target && !ui.selection.includes(target)) ui.select([target])
    const selection = session.ui.getState().selection
    if (!target && selection.length === 0) return
    const view = m3.view()
    const model = canvasMenuModel({
      doc: session.store,
      selection,
      live: new Set(controller?.state.canvas.live ?? []),
      agent: controller !== null,
      inInstance: (id) => view.isVirtual(id) || !!view.origin(id)?.top,
      ownerSession: (owner) => (controller ? placeholderSession(controller, owner) : null),
      kbd: (id) => shortcutLabel(id),
      structure: structureState(session),
      variables: variableState(session, m3),
      viewOnly: deps.current.viewOnly === true,
    })
    const host = container.current?.getBoundingClientRect()
    if (model && host)
      setOpen({ at: { x: host.left + info.screen.x, y: host.top + info.screen.y }, model })
  }, [])

  // Board 27 §2: layer rows open this menu too (same commands, same order).
  useEffect(
    () =>
      registerRowMenu(d.session.store, (x, y) => {
        const { session, m3, controller } = deps.current
        setPick(null)
        const view = m3.view()
        const model = canvasMenuModel({
          doc: session.store,
          selection: session.ui.getState().selection,
          live: new Set(controller?.state.canvas.live ?? []),
          agent: controller !== null,
          inInstance: (id) => view.isVirtual(id) || !!view.origin(id)?.top,
          ownerSession: (owner) => (controller ? placeholderSession(controller, owner) : null),
          kbd: (id) => shortcutLabel(id),
          structure: structureState(session),
          variables: variableState(session, m3),
          viewOnly: deps.current.viewOnly === true,
        })
        if (model) setOpen({ at: { x, y }, model })
      }),
    [d.session.store],
  )

  const run = useCallback((a: CanvasMenuAction) => {
    const { session, m3, canvas, controller, runPrompt, openAgentTab } = deps.current
    const c = canvas.current
    const ui = session.ui.getState()
    switch (a.kind) {
      case "convert":
        for (const id of a.ids) c?.convertNoteToPrompt?.(id)
        return
      case "run":
        for (const id of a.ids) runPrompt(id)
        return
      case "target":
        setPick(a.prompt)
        return
      case "clear":
        for (const id of a.ids) c?.clearPlaceholder?.(id)
        return
      case "resume": {
        if (!controller) return
        const name = menuNodeName(session.store, a.frame) ?? "the frame"
        openAgentTab()
        void resumeAgentSession(controller, a.sessionId, name).then((ok) => {
          if (!ok) askKimoToFinish(controller, name)
        })
        return
      }
      case "ask":
        if (!controller) return
        openAgentTab()
        askKimoToFinish(controller, menuNodeName(session.store, a.frame) ?? "the frame")
        return
      case "copy":
        void commandsFor(session)?.copy()
        return
      case "pasteHere":
        void commandsFor(session)?.pasteFromClipboard("smart")
        return
      case "group":
        commandsFor(session)?.group()
        return
      case "ungroup":
        commandsFor(session)?.ungroup()
        return
      case "wrap":
        commandsFor(session)?.wrap()
        return
      case "addLayout":
        commandsFor(session)?.addAutoLayout()
        return
      case "removeLayout":
        commandsFor(session)?.removeAutoLayout()
        return
      case "createComponent":
        createComponent(m3, ui.selection, c?.layout() ?? null)
        return
      case "replaceMain":
        openReplaceMain(m3, a.main)
        return
      case "back":
        commandsFor(session)?.arrange("back")
        return
      case "duplicate": {
        const cmds = commandsFor(session)
        if (cmds) {
          cmds.duplicate()
          return
        }
        const layout = c?.layout()
        if (!layout || !ui.selection.length) return
        const { ops, created } = duplicateOps(viewReader(session, m3), layout, ui.selection)
        if (session.apply(ops, "Duplicate")) ui.select(created)
        return
      }
      case "front": {
        const ops = a.ids.flatMap((id) => {
          const n = session.store.getNode(id)
          if (!n) return []
          const parent = typeof n.parent === "string" ? n.parent : null
          return [
            {
              op: "move" as const,
              id,
              parent,
              ...(typeof n.at === "string" ? { at: n.at } : {}),
            },
          ]
        })
        if (ops.length) session.apply(ops, "Bring to front")
        return
      }
      case "lock":
        if (a.ids.length)
          session.apply(
            a.ids.map((id) =>
              a.lock
                ? { op: "update" as const, id, set: { locked: true } }
                : { op: "update" as const, id, unset: ["locked"] },
            ),
            a.lock ? "Lock" : "Unlock",
          )
        return
      case "bindVariable":
        // Board 27 §7: the Design tab shows the field's row and opens its picker.
        requestBind(a.field)
        return
      case "detachVariables": {
        const header = currentHeader(session.store)
        const libs = m3.libraries()
        const view = m3.view()
        const ops = a.ids.flatMap((id) => {
          const n = session.store.getNode(id)
          if (!n) return []
          const theme = view.theme(id)
          const set = detachAllFields(n as Record<string, unknown>, (ref) => {
            const r = resolveVariable(header as unknown as KimoDocument, ref, theme, libs)
            return r.ok ? r.value : undefined
          })
          return Object.keys(set).length ? [{ op: "update" as const, id, set }] : []
        })
        if (ops.length) session.apply(ops, "Detach all variables")
        return
      }
      case "delete": {
        const ops = deleteOps(viewReader(session, m3), ui.selection)
        if (ops.length && session.apply(ops, "Delete")) ui.select([])
        return
      }
    }
  }, [])

  const items = useMemo(
    () =>
      open
        ? [open.model.agent, open.model.standard, ...open.model.structure, open.model.danger].map(
            (g) => g.map((r) => toItem(r, run)),
          )
        : [],
    [open, run],
  )

  const element = (
    <>
      {open && (
        <CanvasContextMenu
          groups={items}
          anchor={{ x: open.at.x, y: open.at.y, width: 0, height: 0 }}
          onClose={() => setOpen(null)}
          data-testid="canvas-context-menu"
        />
      )}
      {pick && (
        <TargetPick
          prompt={pick}
          session={d.session}
          canvas={d.canvas}
          container={d.container}
          onDone={() => setPick(null)}
        />
      )}
    </>
  )
  return { onContextMenu, element, picking: pick }
}

/** The expanded view as a `DocReader` (the canvas controller's `vdoc`: instance children too). */
function viewReader(session: FileSession, m3: M3Controller): DocReader {
  const v = m3.view()
  return {
    getNode: (id: string) => v.getNode(id),
    children: (parent: string | null) => v.children(parent),
    hasNode: (id: string) => v.getNode(id) !== undefined,
    nodeIds: () => session.store.nodeIds(),
  } as DocReader
}

function toItem(r: CanvasMenuRow, run: (a: CanvasMenuAction) => void): CanvasContextMenuItem {
  return {
    id: r.id,
    label: r.label,
    ...(r.icon === "agent-mark"
      ? { icon: <AgentMark size={12} state="idle" /> }
      : r.icon
        ? { icon: <Icon name={r.icon} size={14} /> }
        : {}),
    ...(r.meta !== undefined ? { meta: r.meta } : {}),
    ...(r.metaFont ? { metaFont: r.metaFont } : {}),
    ...(r.tone ? { tone: r.tone } : {}),
    ...(r.disabled ? { disabled: true } : {}),
    onSelect: () => run(r.action),
  }
}

// --- Pick mode -----------------------------------------------------------------------------------

/**
 * The deepest visible frame under world point `p` (paint order breaks ties: the later sibling
 * is on top), never `exclude` itself.
 */
function frameAt(
  layout: LayoutResult,
  doc: FileSession["store"],
  p: { x: number; y: number },
  exclude: string,
): string | null {
  let best: { id: string; depth: number; index: number } | null = null
  let index = 0
  for (const [id, l] of layout.nodes) {
    index++
    if (id === exclude || !l.visible) continue
    if (doc.getNode(id)?.type !== "frame") continue
    const w = l.world
    if (p.x < w.x || p.y < w.y || p.x > w.x + w.w || p.y > w.y + w.h) continue
    const depth = pathOf(doc, id).length
    if (!best || depth > best.depth || (depth === best.depth && index > best.index))
      best = { id, depth, index }
  }
  return best?.id ?? null
}

function TargetPick({
  prompt,
  session,
  canvas,
  container,
  onDone,
}: {
  prompt: string
  session: FileSession
  canvas: { current: CanvasHandle | null }
  container: { current: HTMLElement | null }
  onDone(): void
}) {
  const [hover, setHover] = useState<{
    id: string
    rect: { x: number; y: number; w: number; h: number }
  } | null>(null)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const el = container.current
    if (!el) return
    el.classList.add("editor__canvas--picking")
    const local = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const frameUnder = (e: MouseEvent) => {
      const c = canvas.current
      const layout = c?.layout()
      if (!c || !layout) return null
      const id = frameAt(layout, session.store, c.screenToWorld(local(e)), prompt)
      const w = id ? layout.nodes.get(id)?.world : undefined
      if (!id || !w) return null
      const a = c.worldToScreen({ x: w.x, y: w.y })
      const b = c.worldToScreen({ x: w.x + w.w, y: w.y + w.h })
      return { id, rect: { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } }
    }
    // Capture on the container: the canvas never sees the pointer while picking (no selection,
    // no drag), but wheel / pinch still pan and zoom.
    const block = (e: Event) => {
      e.stopPropagation()
      e.preventDefault()
    }
    const onMove = (e: PointerEvent) => {
      block(e)
      setHover(frameUnder(e))
    }
    const onDown = (e: PointerEvent) => {
      block(e)
      if (e.button !== 0) return
      const hit = frameUnder(e)
      canvas.current?.setPromptTarget?.(prompt, hit?.id ?? null)
      done.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopImmediatePropagation()
      done.current()
    }
    const onContext = (e: MouseEvent) => {
      block(e)
      done.current()
    }
    el.addEventListener("pointermove", onMove, true)
    el.addEventListener("pointerdown", onDown, true)
    el.addEventListener("pointerup", block, true)
    el.addEventListener("click", block, true)
    el.addEventListener("dblclick", block, true)
    el.addEventListener("contextmenu", onContext, true)
    window.addEventListener("keydown", onKey, true)
    return () => {
      el.classList.remove("editor__canvas--picking")
      el.removeEventListener("pointermove", onMove, true)
      el.removeEventListener("pointerdown", onDown, true)
      el.removeEventListener("pointerup", block, true)
      el.removeEventListener("click", block, true)
      el.removeEventListener("dblclick", block, true)
      el.removeEventListener("contextmenu", onContext, true)
      window.removeEventListener("keydown", onKey, true)
    }
  }, [container, canvas, session, prompt])

  return hover ? (
    <div
      className="editor__pick-outline"
      data-testid="target-pick-outline"
      data-node-id={hover.id}
      style={{ left: hover.rect.x, top: hover.rect.y, width: hover.rect.w, height: hover.rect.h }}
    />
  ) : null
}

/** Board 27 §8 (b): the main of a "1 main + 1 other non-instance node" selection. */
function replaceMainOf(session: FileSession, sel: readonly string[]): string | null {
  if (sel.length !== 2) return null
  const isMain = (id: string) => {
    const n = session.store.getNode(id)
    return !!n && n.type !== "instance" && n.component !== undefined && n.component !== false
  }
  const mains = sel.filter(isMain)
  if (mains.length !== 1) return null
  const other = session.store.getNode(sel.find((id) => id !== mains[0]) as string)
  if (!other || other.type === "instance") return null
  return mains[0] as string
}

/** Board 27 §2: what the structure items can do for the current selection. */
function structureState(session: FileSession): StructureMenuState | undefined {
  const cmds = commandsFor(session)
  if (!cmds) return undefined
  const sel = session.ui.getState().selection
  return {
    canPaste: true,
    canGroup: cmds.canGroup(),
    canUngroup: cmds.canUngroup(),
    layout: cmds.layoutState(),
    canCreateComponent:
      sel.length > 0 && sel.every((id) => session.store.getNode(id)?.type !== "instance"),
    replaceMain: replaceMainOf(session, sel),
  }
}

/** Board 27 §7: which variable items the menu shows for the selection. */
function variableState(session: FileSession, m3: M3Controller): VariableMenuState {
  const ids = session.ui.getState().selection
  const nodes = ids.map((id) => session.store.getNode(id)).filter((n) => !!n)
  if (!nodes.length || nodes.length !== ids.length)
    return { bound: false, bindVisible: false, bindText: false }
  const header = currentHeader(session.store)
  const libs = m3.libraries()
  const any = (type: "boolean" | "string") => pickerGroups(header, libs, type, {}).length > 0
  return {
    bound: nodes.some((n) => nodeHasBinding(n as Record<string, unknown>)),
    bindVisible: sharedRef(nodes.map((n) => n.visible)) === null && any("boolean"),
    bindText:
      nodes.every((n) => n.type === "text") &&
      sharedRef(nodes.map((n) => n.content)) === null &&
      any("string"),
  }
}
