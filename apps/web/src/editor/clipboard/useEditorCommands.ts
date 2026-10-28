/**
 * Board 27 §1–§2 key bindings and clipboard events of one editor window: ⌘C / ⌘X / ⌘V / ⇧⌘V
 * (system clipboard: `copy` / `cut` / `paste` DOM events, with an async-Clipboard-API fallback
 * where the WebView fires none outside editable fields), ⌥⌘C / ⌥⌘V, ⌘D, ⌘G / ⌥⌘G / ⇧⌘G,
 * ⇧A / ⌥⇧A, ⌘] / ⌘[, ⌘A / ⇧⌘A and ⌘P (page switcher). Handlers run in the capture phase so the
 * canvas controller's older ⌘D / ⌘G bindings never run twice.
 */
import { createElement, type ReactNode, useEffect, useMemo } from "react"
import type { CanvasHandle } from "../../canvas/contract"
import type { AssetStore } from "../../lib/assets"
import { isTyping } from "../../lib/hooks"
import { matches } from "../../shortcuts/shortcuts"
import type { M3Controller } from "../m3/controller"
import { PageSwitcher, pageSwitcherBus } from "../pages/PageSwitcher"
import type { FileSession } from "../session"
import { EditorCommands, type PasteMode } from "./commands"
import { isFigmaClipboard } from "./figma"
import { isRasterType } from "./raster"

const registry = new WeakMap<FileSession, EditorCommands>()

/** The commands of `session`'s editor (menus run them), when it is mounted. */
export function commandsFor(session: FileSession): EditorCommands | null {
  return registry.get(session) ?? null
}

/** How long a key press waits for its clipboard event before the API fallback runs. */
const CLIPBOARD_EVENT_WAIT_MS = 120

interface EditorCommandDeps {
  session: FileSession
  m3: M3Controller
  canvas: { current: CanvasHandle | null }
  assets: AssetStore | null
}

/** True when a DOM text selection outside fields exists (then ⌘C copies that text). */
function hasTextSelection(): boolean {
  const s = document.getSelection()
  return !!s && !s.isCollapsed && s.toString().trim() !== ""
}

/** True while focus sits in a dialog / menu / popover (their own keys win). */
function inOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('[role="dialog"], [role="menu"], [role="listbox"], .kimo-popover')
  )
}

export function useEditorCommands(d: EditorCommandDeps): {
  commands: EditorCommands
  element: ReactNode
} {
  const { session, m3, canvas, assets } = d
  const commands = useMemo(
    () =>
      new EditorCommands({
        session,
        m3,
        canvas: () => canvas.current,
        assets: () => assets,
      }),
    [session, m3, canvas, assets],
  )

  useEffect(() => {
    registry.set(session, commands)
    return () => {
      if (registry.get(session) === commands) registry.delete(session)
    }
  }, [session, commands])

  useEffect(() => {
    let pendingPaste: PasteMode | null = null
    let pasteTimer: ReturnType<typeof setTimeout> | null = null
    let copyTimer: ReturnType<typeof setTimeout> | null = null
    let copyKind: "copy" | "cut" | null = null

    const gesturing = () => canvas.current?.isGesturing() ?? false

    /** The paste fallback when no `paste` event arrived (non-editable focus in WebKit). */
    const fallbackPaste = (mode: PasteMode) => commands.pasteFromClipboard(mode)

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || inOverlay(e.target)) return
      const run = (fn: () => unknown) => {
        e.preventDefault()
        e.stopPropagation()
        if (gesturing()) return
        fn()
      }
      if (matches("pageSwitcher", e)) return run(() => pageSwitcherBus(session).set(true))
      // Clipboard keys: the browser fires copy / cut / paste events (handled below); when it
      // doesn't (WebKit outside editable fields), the async Clipboard API runs instead.
      if (matches("copy", e) || matches("cut", e)) {
        if (hasTextSelection() || !commands.has()) return
        copyKind = matches("cut", e) ? "cut" : "copy"
        if (copyTimer) clearTimeout(copyTimer)
        copyTimer = setTimeout(() => {
          copyTimer = null
          const kind = copyKind
          copyKind = null
          if (kind === "cut") commands.cutTo(null)
          else if (kind === "copy") void commands.copy()
        }, CLIPBOARD_EVENT_WAIT_MS)
        return
      }
      if (matches("paste", e) || matches("pasteInPlace", e)) {
        pendingPaste = matches("pasteInPlace", e) ? "inPlace" : "smart"
        if (pasteTimer) clearTimeout(pasteTimer)
        const mode = pendingPaste
        pasteTimer = setTimeout(() => {
          pasteTimer = null
          if (pendingPaste === null) return
          pendingPaste = null
          void fallbackPaste(mode)
        }, CLIPBOARD_EVENT_WAIT_MS)
        return
      }
      if (matches("copyProperties", e)) return run(() => commands.copyProperties())
      if (matches("pasteProperties", e)) return run(() => commands.pasteProperties())
      if (matches("duplicate", e) && commands.has()) return run(() => commands.duplicate())
      if (matches("group", e) && commands.has()) return run(() => commands.group())
      if (matches("ungroup", e) && commands.has()) return run(() => commands.ungroup())
      if (matches("wrapInFrame", e) && commands.has()) return run(() => commands.wrap())
      if (matches("addAutoLayout", e) && commands.has()) return run(() => commands.addAutoLayout())
      if (matches("removeAutoLayout", e) && commands.has())
        return run(() => commands.removeAutoLayout())
      if (matches("bringToFront", e) && commands.has()) return run(() => commands.arrange("front"))
      if (matches("sendToBack", e) && commands.has()) return run(() => commands.arrange("back"))
      if (matches("selectAll", e)) return run(() => commands.selectAll())
      if (matches("selectInverse", e)) return run(() => commands.selectInverse())
    }

    const onCopy = (e: ClipboardEvent) => {
      const kind = copyKind ?? (e.type === "cut" ? "cut" : "copy")
      copyKind = null
      if (copyTimer) {
        clearTimeout(copyTimer)
        copyTimer = null
      }
      if (e.defaultPrevented || isTyping(e.target) || hasTextSelection() || !e.clipboardData) return
      const ok = kind === "cut" ? commands.cutTo(e.clipboardData) : commands.copyTo(e.clipboardData)
      if (ok) e.preventDefault()
    }

    const onPaste = (e: ClipboardEvent) => {
      const mode = pendingPaste ?? "smart"
      pendingPaste = null
      if (pasteTimer) {
        clearTimeout(pasteTimer)
        pasteTimer = null
      }
      if (e.defaultPrevented || isTyping(e.target) || inOverlay(e.target)) return
      const data = e.clipboardData
      const payload = EditorCommands.decode(data)
      if (payload) {
        e.preventDefault()
        void commands.paste(payload, mode)
        return
      }
      const html = data?.getData("text/html") ?? ""
      if (isFigmaClipboard(html)) {
        e.preventDefault()
        void commands.pasteFigma(html, mode)
        return
      }
      // Image data / files: the raster import (board 27 §3) handles them.
      if (data && (data.files.length > 0 || [...data.types].some((t) => isRasterType(t)))) return
      const text = data?.getData("text/plain") ?? ""
      if (text.trim()) {
        e.preventDefault()
        commands.pasteText(text)
      }
    }

    window.addEventListener("keydown", onKey, true)
    document.addEventListener("copy", onCopy)
    document.addEventListener("cut", onCopy)
    document.addEventListener("paste", onPaste)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      document.removeEventListener("copy", onCopy)
      document.removeEventListener("cut", onCopy)
      document.removeEventListener("paste", onPaste)
      if (pasteTimer) clearTimeout(pasteTimer)
      if (copyTimer) clearTimeout(copyTimer)
    }
  }, [session, canvas, commands])

  const element = useMemo(() => createElement(PageSwitcher, { session, m3 }), [session, m3])
  return { commands, element }
}
