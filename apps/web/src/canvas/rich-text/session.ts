/**
 * The live state of one inline text edit (board 30 "Rich text"): runs, the selection, the typing
 * attributes, a local undo stack and the bridge to the right panel. The canvas overlay
 * (`RichTextEditor`) renders it into a contenteditable and reports typing back; the Design tab
 * reads the selection's attribute groups and applies panel edits to the selected range only.
 *
 * Nothing reaches the document while editing: the result is committed once (one undo step,
 * "Edit text") when editing ends. Undo inside the editor walks the local steps: a typing burst,
 * a deletion burst, a paste, a line break, a style change.
 */
import type { UiStore } from "../contract"
import {
  type AttrGroup,
  type AttrPatch,
  type Attrs,
  applyAttrs,
  attrsAt,
  cleanAttrs,
  groupsIn,
  lengthOf,
  type NodePatch,
  plainText,
  type Run,
  replaceText,
  same,
  type TextNodeLike,
  toNodePatch,
} from "./model"

export interface TextRange {
  /** Anchor and focus as character offsets (focus = caret). */
  anchor: number
  focus: number
}

type StepKind = "type" | "delete" | "style" | "other"

interface Snapshot {
  runs: Run[]
  sel: TextRange
}

/** Typing steps closer than this merge into one undo step (a word or a burst). */
const COALESCE_MS = 1000

export class RichTextSession {
  runs: Run[]
  sel: TextRange
  /** Attributes for the next typed character at a collapsed caret (⌘B with nothing selected). */
  typing: Attrs | null = null
  /** Bumped on every change (React subscribers). */
  version = 0
  /** True while the overlay has focus (the panel shows the live caret, not a stale one). */
  focused = true
  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []
  private lastKind: StepKind | null = null
  private lastAt = 0
  private readonly listeners = new Set<() => void>()
  /** The overlay re-renders its DOM from the model (style edits, undo, programmatic inserts). */
  private readonly renderers = new Set<() => void>()
  private readonly linkListeners = new Set<() => void>()

  constructor(
    /** Edited node id (null: a new text). */
    readonly nodeId: string | null,
    /** The node as editing began (paragraph style, base attributes). */
    readonly node: TextNodeLike,
    runs: Run[],
    /** False for note / prompt bodies: plain text only, style commands do nothing. */
    readonly rich: boolean,
  ) {
    this.runs = runs
    const n = lengthOf(runs)
    this.sel = { anchor: 0, focus: n }
  }

  // --- Reads ------------------------------------------------------------------------------

  get text(): string {
    return plainText(this.runs)
  }
  get length(): number {
    return lengthOf(this.runs)
  }
  get start(): number {
    return Math.min(this.sel.anchor, this.sel.focus)
  }
  get end(): number {
    return Math.max(this.sel.anchor, this.sel.focus)
  }
  get collapsed(): boolean {
    return this.sel.anchor === this.sel.focus
  }
  /** Attribute groups of the selection (collapsed: the typing attributes). */
  groups(): AttrGroup[] {
    return groupsIn(this.runs, this.start, this.end, this.typing ?? attrsAt(this.runs, this.start))
  }
  /** Attributes typed at the caret now. */
  typingAttrs(): Attrs {
    return this.typing ?? attrsAt(this.runs, this.start)
  }
  /** The node fields to commit. */
  result(node: TextNodeLike = this.node): NodePatch {
    return toNodePatch(this.runs, node)
  }

  // --- Subscriptions ----------------------------------------------------------------------

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  onRender(cb: () => void): () => void {
    this.renderers.add(cb)
    return () => this.renderers.delete(cb)
  }
  onLinkRequest(cb: () => void): () => void {
    this.linkListeners.add(cb)
    return () => this.linkListeners.delete(cb)
  }
  /** ⌘K while editing: the Text section opens its Link… popover for the selection. */
  requestLink(): void {
    for (const cb of this.linkListeners) cb()
  }
  private emit(render: boolean): void {
    this.version++
    if (render) for (const cb of this.renderers) cb()
    for (const cb of this.listeners) cb()
  }

  // --- Undo ---------------------------------------------------------------------------------

  private snapshot(): Snapshot {
    return { runs: this.runs.map((r) => ({ ...r })), sel: { ...this.sel } }
  }
  /** Records the state before a change; consecutive typing (or deleting) coalesces. */
  private record(kind: StepKind): void {
    const now = Date.now()
    const merge = kind !== "other" && kind === this.lastKind && now - this.lastAt < COALESCE_MS
    if (!merge) {
      this.undoStack.push(this.snapshot())
      if (this.undoStack.length > 200) this.undoStack.shift()
    }
    this.redoStack = []
    this.lastKind = kind
    this.lastAt = now
  }
  /** Ends the current typing burst (caret moved, focus changed): the next edit is a new step. */
  breakStep(): void {
    this.lastKind = null
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  undo(): boolean {
    const s = this.undoStack.pop()
    if (!s) return false
    this.redoStack.push(this.snapshot())
    this.runs = s.runs
    this.sel = s.sel
    this.typing = null
    this.lastKind = null
    this.emit(true)
    return true
  }
  redo(): boolean {
    const s = this.redoStack.pop()
    if (!s) return false
    this.undoStack.push(this.snapshot())
    this.runs = s.runs
    this.sel = s.sel
    this.typing = null
    this.lastKind = null
    this.emit(true)
    return true
  }

  // --- Edits --------------------------------------------------------------------------------

  /** The caret / selection moved (from the DOM). */
  select(sel: TextRange): void {
    if (sel.anchor === this.sel.anchor && sel.focus === this.sel.focus) return
    this.sel = { ...sel }
    this.typing = null
    this.breakStep()
    this.emit(false)
  }

  /** Inserts `text` over the selection (typing, a line break, a paste). */
  insert(text: string, kind: StepKind = "type"): void {
    const a = this.start
    const b = this.end
    const attrs = this.rich ? this.typingAttrs() : this.runs[0]?.attrs
    this.record(a === b ? kind : "other")
    this.runs = replaceText(this.runs, a, b, text, attrs)
    const caret = a + text.length
    this.sel = { anchor: caret, focus: caret }
    this.typing = null
    this.emit(true)
  }

  /**
   * The DOM changed by itself (native deletion, IME, spellcheck): adopt its runs and caret. No
   * re-render unless `render` (the DOM structure must be normalized).
   */
  adopt(runs: Run[], sel: TextRange, kind: StepKind, render = false): void {
    if (sameRuns(runs, this.runs)) {
      this.select(sel)
      return
    }
    this.record(kind)
    this.runs = runs
    this.sel = { ...sel }
    this.typing = null
    this.emit(render)
  }

  /**
   * Applies attributes to the selection, or to the typing attributes at a collapsed caret.
   * `patch` may be a function of each run's attributes (toggles, relative changes).
   */
  applyAttrs(patch: AttrPatch | ((attrs: Attrs) => AttrPatch)): void {
    if (!this.rich) return
    if (this.collapsed) {
      const base = this.typingAttrs()
      const p = typeof patch === "function" ? patch(base) : patch
      this.typing = cleanAttrs({ ...base, ...p })
      this.emit(false)
      return
    }
    this.record("other")
    this.runs = applyAttrs(this.runs, this.start, this.end, patch)
    this.emit(true)
  }

  /** Applies a patch to explicit ranges (the panel's per-group edits). */
  applyRanges(edits: { ranges: [number, number][]; patch: AttrPatch }[]): void {
    if (!this.rich || edits.length === 0) return
    if (this.collapsed) {
      let t = this.typingAttrs()
      for (const e of edits) t = cleanAttrs({ ...t, ...e.patch })
      this.typing = t
      this.emit(false)
      return
    }
    // A scrub sends many edits: they coalesce into one step like a typing burst.
    this.record("style")
    let runs = this.runs
    for (const e of edits)
      for (const [a, b] of e.ranges) if (b > a) runs = applyAttrs(runs, a, b, e.patch)
    this.runs = runs
    this.emit(true)
  }

  /**
   * ⌘B / ⌘I / ⌘U / ⌘⇧X: on when any selected character lacks it (Figma), off when all have it.
   */
  toggle(kind: "bold" | "italic" | "underline" | "strike"): void {
    if (!this.rich) return
    const groups = this.groups()
    const has = (a: Attrs): boolean => {
      if (kind === "bold") return typeof a.weight === "number" && a.weight >= 600
      if (kind === "italic") return a.italic === true
      const d = Array.isArray(a.decoration) ? a.decoration : []
      return d.includes(kind)
    }
    const on = !groups.every((g) => has(g.attrs))
    this.applyAttrs((a) => {
      if (kind === "bold") return { weight: on ? 700 : undefined }
      if (kind === "italic") return { italic: on ? true : undefined }
      const d = (Array.isArray(a.decoration) ? a.decoration : []).filter((x) => x !== kind)
      const next = on
        ? [...d, kind].sort((x, y) => (x === "underline" ? -1 : y === "underline" ? 1 : 0))
        : d
      return { decoration: next.length ? next : undefined }
    })
  }
}

function sameRuns(a: readonly Run[], b: readonly Run[]): boolean {
  return (
    a.length === b.length && a.every((r, i) => r.text === b[i]?.text && same(r.attrs, b[i]?.attrs))
  )
}

// --- Registry: the canvas publishes the live session, the Design tab reads it --------------------

type Bus = { session: RichTextSession | null; listeners: Set<() => void> }
const buses = new WeakMap<UiStore, Bus>()

function busOf(ui: UiStore): Bus {
  let b = buses.get(ui)
  if (!b) {
    b = { session: null, listeners: new Set() }
    buses.set(ui, b)
  }
  return b
}

/** Publishes (or clears) the live text edit of a canvas. */
export function publishTextSession(ui: UiStore, session: RichTextSession | null): void {
  const b = busOf(ui)
  if (b.session === session) return
  b.session = session
  for (const cb of b.listeners) cb()
}

export function currentTextSession(ui: UiStore): RichTextSession | null {
  return busOf(ui).session
}

export function subscribeTextSession(ui: UiStore, cb: () => void): () => void {
  const b = busOf(ui)
  b.listeners.add(cb)
  return () => b.listeners.delete(cb)
}
