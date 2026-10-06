/**
 * Glue for the desktop menu bar (menu.rs, board 37 / audit A6, B9, E5, G2). Items arrive as
 * `platform.menu.onAction`; each window reports what it shows with `menu.setContext`, so the
 * document items (Back to files, Export…, Copy selection as PNG, Preview) are disabled on Home.
 *
 * Edit › Undo / Redo / Select All go to the focused text field first (`execCommand`), then to
 * the document. Home runs New file / Open… and ⌘N / ⌘O (the browser and Windows / Linux have no
 * native menu, so Home binds the keys itself).
 */
import type { EditorMenuAction, KimoPlatform, MenuContext } from "@kimo/platform"
import { useEffect, useRef } from "react"
import { matches } from "../shortcuts/shortcuts"
import { isTyping } from "./hooks"

const TEXT_COMMANDS: Partial<Record<EditorMenuAction, string>> = {
  undo: "undo",
  redo: "redo",
  "select-all": "selectAll",
}

/**
 * Runs an Edit item on the focused text field (input, textarea, contenteditable); false when
 * no text field has focus, so the caller runs it on the document.
 */
export function runTextEdit(action: EditorMenuAction, doc: Document = document): boolean {
  const command = TEXT_COMMANDS[action]
  if (!command || !isTyping(doc.activeElement)) return false
  doc.execCommand(command)
  return true
}

/** Tells the native menu what this window shows while the component is mounted. */
export function useMenuContext(platform: KimoPlatform, context: MenuContext): void {
  useEffect(() => {
    platform.menu?.setContext(context).catch((e: unknown) => {
      // Not a user action: the menu keeps its previous enabled state.
      console.warn("Kimo: couldn't update the menu bar", e)
    })
  }, [platform, context])
}

export interface HomeCommands {
  newFile(): void
  openFile(): void
}

/**
 * Home's menu-bar and keyboard commands (B9): File › New file / Open… and ⌘N / ⌘O. Edit items
 * act on Home's text fields (search, composer).
 */
export function useHomeCommands(platform: KimoPlatform, commands: HomeCommands): void {
  const latest = useRef(commands)
  latest.current = commands
  useMenuContext(platform, "home")
  useEffect(() => {
    const offMenu = platform.menu?.onAction((a) => {
      if (runTextEdit(a)) return
      if (a === "new-file") latest.current.newFile()
      else if (a === "open-file") latest.current.openFile()
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      // ⌘N / ⌘O mean nothing in a text field, so they work from the search box too.
      if (matches("newFile", e)) {
        e.preventDefault()
        latest.current.newFile()
      } else if (matches("openFile", e)) {
        e.preventDefault()
        latest.current.openFile()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      offMenu?.()
      window.removeEventListener("keydown", onKey)
    }
  }, [platform])
}
