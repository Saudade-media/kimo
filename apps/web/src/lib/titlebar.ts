/**
 * macOS title bar double-click on the overlay chrome. Tauri's drag script maximizes on the
 * second mouseup, which ignores the system "Double-click a window's title bar to" setting. A
 * capture listener on `window` runs first, hands the click to the desktop shell (zoom,
 * minimize or nothing) and keeps Tauri's listener from toggling maximize as well.
 */
const ATTR = "data-tauri-drag-region"

const CLICKABLE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"])
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "option",
])

const OVERLAY_ROLES = new Set(["dialog", "alertdialog", "menu", "listbox", "tooltip"])

function isClickable(el: HTMLElement): boolean {
  const editable = el.getAttribute("contenteditable")
  const tabindex = el.getAttribute("tabindex")
  return (
    CLICKABLE_TAGS.has(el.tagName) ||
    (editable !== null && editable !== "false") ||
    (tabindex !== null && tabindex !== "-1") ||
    INTERACTIVE_ROLES.has(el.getAttribute("role") ?? "")
  )
}

/**
 * Same rule as Tauri's drag script, so a double-click zooms exactly where a press drags: a bare
 * region counts only for clicks on itself, `deep` for its whole subtree, and buttons, inputs and
 * other interactive children never count.
 */
export function isDragRegionPath(path: readonly EventTarget[]): boolean {
  for (const el of path) {
    if (!(el instanceof HTMLElement)) continue
    // Dialogs, menus and popovers are never window chrome, even when they render inside a
    // region (a portal-less dialog under a `deep` title bar).
    if (
      OVERLAY_ROLES.has(el.getAttribute("role") ?? "") ||
      el.getAttribute("data-kimo-overlay") !== null
    )
      return false
    const attr = el.getAttribute(ATTR)
    if (isClickable(el) && attr === null) return false
    if (attr === null) continue
    if (attr === "false") return false
    if (attr === "deep") return true
    if (attr === "" || attr === "true") return el === path[0]
  }
  return false
}

export function installTitlebarDoubleClick(onDoubleClick: () => void, root: Window = window) {
  let down: { x: number; y: number } | null = null
  const onDown = (e: MouseEvent) => {
    down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
  }
  const onUp = (e: MouseEvent) => {
    const start = down
    down = null
    if (e.button !== 0 || e.detail !== 2 || !start) return
    if (start.x !== e.clientX || start.y !== e.clientY) return
    if (!isDragRegionPath(e.composedPath())) return
    e.stopImmediatePropagation()
    onDoubleClick()
  }
  root.addEventListener("mousedown", onDown, true)
  root.addEventListener("mouseup", onUp, true)
  return () => {
    root.removeEventListener("mousedown", onDown, true)
    root.removeEventListener("mouseup", onUp, true)
  }
}
