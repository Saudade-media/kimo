/**
 * Inline text editor (board 30 "Rich text"): a contenteditable laid out exactly like the drawn
 * text so entering and leaving edit mode doesn't reflow it.
 *
 * Geometry. The editor is laid out in WORLD units (font sizes, widths, line heights as stored)
 * and scaled to the screen with `transform: scale(zoom)`, so wrapping is the same at every zoom.
 * - `grow: "auto"`: one line per paragraph (`white-space: pre`), width = the content.
 * - `"fixed-width"`: wraps at the node width (`pre-wrap`, long words break), height = content.
 * - `"fixed"`: wraps at the width inside a box of the node height, aligned by `valign`.
 * - Note / prompt bodies wrap inside the card's body box.
 *
 * Model. The DOM is rendered from the session's runs (one `<span data-i>` per run, styles from
 * each run's effective attributes) and read back after native edits (deletion, IME, spellcheck,
 * cut). Typing, line breaks and paste go through the model so the typed attributes are the
 * caret's (Figma: the character before the caret), paste is plain text, and undo is the
 * session's (a typing burst, a deletion burst, a paste, a style change per step).
 */
import { useEffect, useLayoutEffect, useRef } from "react"
import { matches } from "../../shortcuts/shortcuts"
import type { Attrs, Run } from "./model"
import type { RichTextSession, TextRange } from "./session"

/** What the overlay needs (world space; the host projects it). */
export interface RichEditGeometry {
  at: { x: number; y: number }
  box: { x: number; y: number; w: number; h: number } | null
  grow: "auto" | "fixed-width" | "fixed"
  valign: "top" | "middle" | "bottom"
  align: "left" | "center" | "right" | "justify"
  /** Note / prompt body (wraps at `box.w`). */
  kind?: "note" | "prompt"
}

/** Resolved CSS of one run (fonts, sizes and colors with bindings resolved). */
export interface RunCss {
  fontFamily: string
  fontSize: number
  fontWeight: number
  italic: boolean
  /** CSS line-height value (unitless multiplier, `npx` or `normal`). */
  lineHeight: string
  letterSpacing: number
  decoration: string
  textTransform: string
  fontFeatureSettings: string
  color: string
}

export interface RichTextEditorProps {
  session: RichTextSession
  geometry: RichEditGeometry
  viewport: { x: number; y: number; zoom: number }
  /** Resolves a run's attributes to CSS (the controller's resolver). */
  css: (attrs: Attrs) => RunCss
  onCommit(): void
}

/** Focus moving into these keeps the edit open (the panel edits the selected range). */
const KEEP_EDITING =
  ".right-panel, .kimo-popover, .kimo-menu, [role='dialog'], [role='menu'], [role='listbox']"

const HIGHLIGHT = "kimo-text-selection"

export function RichTextEditor({
  session,
  geometry,
  viewport,
  css,
  onCommit,
}: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const committed = useRef(false)
  const cssRef = useRef(css)
  cssRef.current = css
  /** Attributes of each rendered `<span data-i>` (read back after native edits). */
  const rendered = useRef<Attrs[]>([])
  const composing = useRef(false)

  const commit = () => {
    if (committed.current) return
    committed.current = true
    onCommit()
  }

  // Render the model into the DOM (initial, and after model-driven changes).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const paint = () => {
      rendered.current = renderRuns(el, session.runs, cssRef.current)
      if (document.activeElement === el) setDomSelection(el, session.sel)
      else showHighlight(el, session)
    }
    paint()
    return session.onRender(paint)
  }, [session])

  // Focus + select all on open (like the previous textarea).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    setDomSelection(el, session.sel)
  }, [session])

  // Track the DOM selection (caret moves, drags, ⌘A) into the session.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onSel = () => {
      if (document.activeElement !== el || composing.current) return
      const r = readDomSelection(el)
      if (r) session.select(r)
    }
    document.addEventListener("selectionchange", onSel)
    return () => document.removeEventListener("selectionchange", onSel)
  }, [session])

  // Clear the unfocused highlight on unmount.
  useEffect(() => () => clearHighlight(), [])

  // Native `beforeinput` (React's onBeforeInput is the legacy keypress/textInput event and has
  // no inputType).
  const onBeforeInput = useRef<(e: InputEvent) => void>(() => {})
  onBeforeInput.current = (ne: InputEvent) => {
    const type = ne.inputType ?? ""
    if (composing.current || type === "insertCompositionText") return
    if (type === "insertText" || type === "insertReplacementText") {
      const data = ne.data ?? ne.dataTransfer?.getData("text/plain") ?? ""
      ne.preventDefault()
      syncSelection()
      session.insert(normalizeText(data), "type")
      return
    }
    if (type === "insertParagraph" || type === "insertLineBreak") {
      ne.preventDefault()
      syncSelection()
      session.insert("\n", "other")
      return
    }
    if (type === "insertFromPaste" || type === "insertFromDrop" || type === "insertFromYank") {
      ne.preventDefault()
      const text = ne.dataTransfer?.getData("text/plain") ?? ""
      if (type === "insertFromDrop" || !text) return
      syncSelection()
      session.insert(normalizeText(text), "other")
      return
    }
    if (type === "historyUndo" || type === "historyRedo" || type.startsWith("format")) {
      ne.preventDefault()
      if (type === "historyUndo") session.undo()
      if (type === "historyRedo") session.redo()
    }
  }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = (e: Event) => onBeforeInput.current(e as InputEvent)
    el.addEventListener("beforeinput", on)
    return () => el.removeEventListener("beforeinput", on)
  }, [])

  const readBack = (kind: "type" | "delete" | "other") => {
    const el = ref.current
    if (!el) return
    const runs = readRuns(el, rendered.current, session.runs[0]?.attrs ?? {})
    const sel = readDomSelection(el) ?? session.sel
    // A structure the browser invented (stray text nodes, <br>, wrappers) is re-rendered.
    const clean = isCanonical(el)
    session.adopt(runs, sel, kind, !clean)
    if (clean) rendered.current = spansAttrs(el, rendered.current)
  }

  const z = viewport.zoom
  const g = geometry
  const first = css(session.runs[0]?.attrs ?? {})
  const wraps = g.grow !== "auto" || g.kind !== undefined
  const width = g.box && wraps ? g.box.w : undefined
  const fixed = g.grow === "fixed" && !g.kind && g.box
  return (
    <div
      className="canvas-host__text-edit"
      data-canvas-overlay=""
      data-grow={g.kind ? "body" : g.grow}
      style={{
        left: (g.at.x - viewport.x) * z,
        top: (g.at.y - viewport.y) * z,
        transform: `scale(${z})`,
        width,
        minWidth: g.box && !wraps ? g.box.w : wraps ? undefined : 4,
        height: fixed ? g.box?.h : undefined,
        minHeight: g.box && !fixed ? g.box.h : undefined,
        justifyContent: fixed
          ? g.valign === "middle"
            ? "center"
            : g.valign === "bottom"
              ? "flex-end"
              : "flex-start"
          : undefined,
        // 1.5 screen px at any zoom: a spread shadow (outlines snap to whole device px under
        // the scale transform).
        boxShadow: `0 0 0 ${1.5 / z}px var(--kimo-selection)`,
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a rich-text field needs contenteditable */}
      <div
        ref={ref}
        role="textbox"
        tabIndex={0}
        aria-label="Edit text"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        className="canvas-host__text-editor"
        data-rich={session.rich ? "true" : "false"}
        style={{
          width,
          whiteSpace: wraps ? "pre-wrap" : "pre",
          overflowWrap: wraps ? "break-word" : undefined,
          textAlign: g.align,
          fontFamily: first.fontFamily,
          fontSize: first.fontSize,
          lineHeight: first.lineHeight,
          caretColor: first.color,
        }}
        onFocus={() => {
          session.focused = true
          clearHighlight()
          const el = ref.current
          if (el) setDomSelection(el, session.sel)
        }}
        onBlur={(e) => {
          const next = e.relatedTarget as HTMLElement | null
          session.breakStep()
          // The panel (and its popovers) edit the selected range: keep editing and show the
          // selection as a highlight. Anywhere else commits (the canvas commits on its own).
          if (!next || next.closest(KEEP_EDITING)) {
            session.focused = false
            const el = ref.current
            if (el) showHighlight(el, session)
            return
          }
          commit()
        }}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          readBack("type")
        }}
        onPaste={(e) => {
          // Plain text only (rich HTML from other apps is not kept).
          e.preventDefault()
          e.stopPropagation()
          const text = e.clipboardData.getData("text/plain")
          if (!text) return
          syncSelection()
          session.insert(normalizeText(text), "other")
        }}
        onDrop={(e) => e.preventDefault()}
        onInput={(e) => {
          if (composing.current) return
          const ne = e.nativeEvent as InputEvent
          readBack((ne.inputType ?? "").startsWith("delete") ? "delete" : "other")
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          // Escape / ⌘↵ commit and exit, like Figma (deliberate): there is no separate cancel. An
          // existing text emptied this way is deleted, as in Figma; ⌘Z restores it in one step.
          if (matches("finishText", e)) {
            e.preventDefault()
            commit()
            return
          }
          if (matches("undo", e)) {
            e.preventDefault()
            session.undo()
            return
          }
          if (matches("redo", e)) {
            e.preventDefault()
            session.redo()
            return
          }
          const style = matches("bold", e)
            ? "bold"
            : matches("italic", e)
              ? "italic"
              : matches("underline", e)
                ? "underline"
                : matches("strikethrough", e)
                  ? "strike"
                  : null
          if (style) {
            e.preventDefault()
            syncSelection()
            session.toggle(style)
            return
          }
          if (matches("link", e)) {
            e.preventDefault()
            syncSelection()
            session.requestLink()
          }
        }}
      />
    </div>
  )

  function syncSelection() {
    const el = ref.current
    if (!el) return
    const r = readDomSelection(el)
    if (r) session.select(r)
  }
}

/** `\r\n` and `\r` → `\n`; tabs stay (the renderer replaces them). */
function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, "\n")
}

// --- DOM rendering --------------------------------------------------------------------------

function applyRunCss(span: HTMLElement, c: RunCss): void {
  const s = span.style
  s.fontFamily = c.fontFamily
  s.fontSize = `${c.fontSize}px`
  s.fontWeight = String(c.fontWeight)
  s.fontStyle = c.italic ? "italic" : "normal"
  s.lineHeight = c.lineHeight
  s.letterSpacing = c.letterSpacing ? `${c.letterSpacing}px` : ""
  s.textDecorationLine = c.decoration
  s.textTransform = c.textTransform
  s.fontFeatureSettings = c.fontFeatureSettings
  s.color = c.color
}

/** Renders `runs` into `el`; returns the attributes of each span. */
function renderRuns(el: HTMLElement, runs: readonly Run[], css: (a: Attrs) => RunCss): Attrs[] {
  const attrs: Attrs[] = []
  const frag = document.createDocumentFragment()
  runs.forEach((r) => {
    if (!r.text) return
    const span = document.createElement("span")
    span.dataset.i = String(attrs.length)
    applyRunCss(span, css(r.attrs))
    span.textContent = r.text
    attrs.push(r.attrs)
    frag.appendChild(span)
  })
  // A trailing line break (or an empty text) needs a line box for the caret.
  const text = runs.map((r) => r.text).join("")
  if (text === "" || text.endsWith("\n")) {
    const br = document.createElement("br")
    br.dataset.sentinel = ""
    frag.appendChild(br)
  }
  el.replaceChildren(frag)
  return attrs
}

/** True when `el` has only our spans (one text node each) and the sentinel `<br>`. */
function isCanonical(el: HTMLElement): boolean {
  const kids = [...el.childNodes]
  return kids.every((n, i) => {
    if (n instanceof HTMLBRElement) return n.dataset.sentinel !== undefined && i === kids.length - 1
    if (!(n instanceof HTMLSpanElement) || n.dataset.i === undefined) return false
    return n.childNodes.length === 1 && n.firstChild instanceof Text && n.firstChild.data.length > 0
  })
}

function spansAttrs(el: HTMLElement, prev: readonly Attrs[]): Attrs[] {
  return [...el.querySelectorAll<HTMLElement>("span[data-i]")].map(
    (s) => prev[Number(s.dataset.i)] ?? {},
  )
}

/** Reads runs back from the DOM (spans keep the attributes they were rendered with). */
function readRuns(el: HTMLElement, attrsOf: readonly Attrs[], fallback: Attrs): Run[] {
  const runs: Run[] = []
  let current: Attrs = attrsOf[0] ?? fallback
  const visit = (n: Node, inherited: Attrs | null) => {
    if (n instanceof Text) {
      if (n.data) runs.push({ text: n.data, attrs: inherited ?? current })
      return
    }
    if (!(n instanceof HTMLElement)) return
    if (n instanceof HTMLBRElement) {
      if (n.dataset.sentinel === undefined) runs.push({ text: "\n", attrs: inherited ?? current })
      return
    }
    let own = inherited
    if (n.dataset.i !== undefined) {
      own = attrsOf[Number(n.dataset.i)] ?? current
      current = own
    }
    // A block the browser inserted is a line break before its content.
    if (n !== el && (n.tagName === "DIV" || n.tagName === "P") && runs.length)
      runs.push({ text: "\n", attrs: own ?? current })
    for (const c of n.childNodes) visit(c, own)
  }
  for (const c of el.childNodes) visit(c, null)
  const merged: Run[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && last.attrs === r.attrs) last.text += r.text
    else merged.push({ ...r })
  }
  return merged.length ? merged : [{ text: "", attrs: fallback }]
}

// --- Offsets ↔ DOM positions -------------------------------------------------------------------

/** Character offset of a DOM position inside `el`. */
function offsetOf(el: HTMLElement, node: Node, offset: number): number {
  let total = 0
  let found = -1
  const walk = (n: Node): boolean => {
    if (n === node) {
      if (n instanceof Text) {
        found = total + offset
        return true
      }
      // An element position: the characters of its first `offset` children.
      let t = total
      const kids = [...n.childNodes]
      for (let i = 0; i < offset && i < kids.length; i++) t += textLength(kids[i] as Node)
      found = t
      return true
    }
    if (n instanceof Text) {
      total += n.data.length
      return false
    }
    if (n instanceof HTMLBRElement) {
      if (n.dataset.sentinel === undefined) total += 1
      return false
    }
    for (const c of n.childNodes) if (walk(c)) return true
    return false
  }
  for (const c of el.childNodes) if (walk(c)) break
  if (node === el) {
    let t = 0
    const kids = [...el.childNodes]
    for (let i = 0; i < offset && i < kids.length; i++) t += textLength(kids[i] as Node)
    return t
  }
  return found < 0 ? total : found
}

function textLength(n: Node): number {
  if (n instanceof Text) return n.data.length
  if (n instanceof HTMLBRElement) return n.dataset.sentinel === undefined ? 1 : 0
  let t = 0
  for (const c of n.childNodes) t += textLength(c)
  return t
}

/** DOM position of a character offset (the end of the run before it, Figma's affinity). */
function positionOf(el: HTMLElement, offset: number): { node: Node; offset: number } {
  let pos = 0
  const texts: Text[] = []
  const collect = (n: Node) => {
    if (n instanceof Text) texts.push(n)
    else for (const c of n.childNodes) collect(c)
  }
  collect(el)
  for (const t of texts) {
    const end = pos + t.data.length
    if (offset < end) return { node: t, offset: offset - pos }
    // At a run's end the caret stays in that run (the character before decides the style),
    // except after a line break, where it belongs to the next line.
    if (offset === end && !t.data.endsWith("\n")) return { node: t, offset: t.data.length }
    pos = end
  }
  const sentinel = el.querySelector("br[data-sentinel]")
  if (sentinel) return { node: el, offset: [...el.childNodes].indexOf(sentinel) }
  const last = texts[texts.length - 1]
  return last ? { node: last, offset: last.data.length } : { node: el, offset: 0 }
}

function readDomSelection(el: HTMLElement): TextRange | null {
  const s = el.ownerDocument.getSelection()
  if (!s || s.rangeCount === 0 || !s.anchorNode || !s.focusNode) return null
  if (!el.contains(s.anchorNode) || !el.contains(s.focusNode)) return null
  return {
    anchor: offsetOf(el, s.anchorNode, s.anchorOffset),
    focus: offsetOf(el, s.focusNode, s.focusOffset),
  }
}

function setDomSelection(el: HTMLElement, sel: TextRange): void {
  const s = el.ownerDocument.getSelection()
  if (!s) return
  const a = positionOf(el, sel.anchor)
  const f = positionOf(el, sel.focus)
  try {
    s.setBaseAndExtent(a.node, a.offset, f.node, f.offset)
  } catch {
    // A position outside the (re-rendered) DOM: leave the browser's selection.
  }
}

// --- Unfocused selection highlight (CSS Custom Highlight API) -----------------------------------

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void }
const highlights = (): HighlightRegistry | null =>
  (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights ?? null

function showHighlight(el: HTMLElement, session: RichTextSession): void {
  const reg = highlights()
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (!reg || !H || session.collapsed) {
    clearHighlight()
    return
  }
  const a = positionOf(el, session.start)
  const b = positionOf(el, session.end)
  const range = el.ownerDocument.createRange()
  try {
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset)
    reg.set(HIGHLIGHT, new H(range))
  } catch {
    clearHighlight()
  }
}

function clearHighlight(): void {
  highlights()?.delete(HIGHLIGHT)
}
