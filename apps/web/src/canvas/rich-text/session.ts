/**
 * The live state of one inline text edit (board 30 "Rich text"): runs, the selection, the typing
 * attributes, the undo steps and the bridge to the right panel. The canvas overlay
 * (`RichTextEditor`) renders it into a contenteditable and reports typing back; the Design tab
 * reads the selection's attribute groups and applies panel edits to the selected range only.
 *
 * Undo inside the editor walks the person's own steps: a typing burst, a deletion burst, a paste,
 * a line break, a style change.
 *
 * Two modes:
 * - Live (a text layer of the document, ADR 0016 item 17, see `live.ts`): edits reach the
 *   document as they happen (typing batched {@link LIVE_BATCH_MS}, style changes at once) and
 *   changes by anyone else are applied to the runs while the person types, the caret and
 *   selection moved through them. During an IME composition they wait and are applied at its end.
 *   The steps are the document's own (only this person's edits are undone); after editing ends,
 *   the whole edit is one "Edit text" step.
 * - Local (a new text, a note or prompt body, text inside an instance): nothing reaches the
 *   document while editing; the result is committed once when editing ends, and the steps are
 *   snapshots of the runs.
 */
import { changedRegion, type TextDelta, transformOffset } from "@kimo/editor-state"
import type { UiStore } from "../contract"
import { caretAfter, type LiveTextLink } from "./live"
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
/** Live typing reaches the document (and other people) at most this long after a keystroke. */
export const LIVE_BATCH_MS = 50

export class RichTextSession {
  runs: Run[]
  sel: TextRange
  /** Attributes for the next typed character at a collapsed caret (⌘B with nothing selected). */
  typing: Attrs | null = null
  /** Bumped on every change (React subscribers). */
  version = 0
  /** True while the overlay has focus (the panel shows the live caret, not a stale one). */
  focused = true
  /** Live mode: the link to the document (null: local mode). */
  private link: LiveTextLink | null = null
  private linkOffs: (() => void)[] = []
  /** Live mode: local edits not written yet, and the timer that writes them. */
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** An IME composition is in progress: remote changes wait (their deltas queue here). */
  private composing = false
  private queued: TextDelta[] = []
  private queuedReplace = false
  /** Reads the DOM selection into the session before a remote change moves it. */
  private selectionReader: (() => void) | null = null
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
    /** The node (paragraph style, base attributes): as editing began, live: as it is now. */
    public node: TextNodeLike,
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

  // --- Live mode ------------------------------------------------------------------------------

  /** True when edits reach the document as they happen. */
  get live(): boolean {
    return this.link !== null
  }

  /**
   * Turns on live mode over `link` (the runs become the document's). Remote changes are applied
   * from now on; {@link dispose} ends it.
   */
  attach(link: LiveTextLink): void {
    if (this.link) return
    this.link = link
    const now = link.read()
    if (now) {
      this.runs = now.runs
      this.node = now.node
      this.sel = clampSel(this.sel, this.length)
    }
    this.linkOffs.push(
      link.onRemote((deltas) => this.remote(deltas)),
      link.onBeforeChange(() => this.flush()),
    )
  }

  /** The overlay's DOM selection reader (called before remote changes move the caret). */
  setSelectionReader(read: (() => void) | null): void {
    this.selectionReader = read
  }

  /** Writes pending live edits now (no-op in local mode or mid-composition). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.link || !this.dirty || this.composing) return
    this.dirty = false
    if (!this.link.write(this.runs, this.sel.focus)) this.resync()
  }

  /** Ends live mode: pending edits are written and the edit closes as one undo step. */
  dispose(): void {
    if (!this.link) return
    this.composing = false
    this.flush()
    for (const off of this.linkOffs) off()
    this.linkOffs = []
    this.link.end()
    this.link = null
  }

  /** A local change of the runs in live mode: typing waits for the batch, the rest goes now. */
  private changed(kind: StepKind): void {
    if (!this.link) return
    this.dirty = true
    if (kind === "type" || kind === "delete") {
      if (!this.timer) this.timer = setTimeout(() => this.flush(), LIVE_BATCH_MS)
    } else this.flush()
  }

  /** Re-reads the runs from the document (a refused write, a replaced content). */
  private resync(): void {
    const now = this.link?.read()
    if (!now) return
    this.runs = now.runs
    this.node = now.node
    this.sel = clampSel(this.sel, this.length)
    this.emit(true)
  }

  /** Someone else changed the text: apply it to the runs, moving the selection through it. */
  private remote(deltas: TextDelta[] | null): void {
    if (this.composing) {
      if (deltas === null) this.queuedReplace = true
      else this.queued.push(...deltas)
      return
    }
    this.selectionReader?.()
    const now = this.link?.read()
    if (!now) return
    if (deltas) this.sel = moveSel(this.sel, deltas)
    this.runs = now.runs
    this.node = now.node
    this.sel = clampSel(this.sel, this.length)
    this.emit(true)
  }

  /** An IME composition starts: pending edits go out, remote changes wait until it ends. */
  compositionStart(): void {
    this.flush()
    this.composing = true
  }

  /**
   * The composition ended with the DOM holding `runs` (the composed text in place) and `sel`.
   * Changes that arrived meanwhile are applied first, then the composed text is typed at its
   * place in the updated text.
   */
  compositionEnd(runs: Run[], sel: TextRange, render = false): void {
    this.composing = false
    const deltas = this.queued
    const replaced = this.queuedReplace
    this.queued = []
    this.queuedReplace = false
    if (!this.link || (deltas.length === 0 && !replaced)) {
      this.adopt(runs, sel, "type", render)
      return
    }
    // What the composition did, in the text as it was before it.
    const before = this.text
    const after = plainText(runs)
    const { prefix, suffix } = changedRegion(before, after, sel.focus)
    const inserted = after.slice(prefix, after.length - suffix)
    let a = prefix
    let b = before.length - suffix
    if (!replaced) {
      // A composition at a caret sticks to the character before it, like the caret does.
      const assoc = a === b ? -1 : 1
      a = deltas.reduce((p, d) => transformOffset(p, d, assoc), a)
      b = Math.max(
        a,
        deltas.reduce((p, d) => transformOffset(p, d, -1), b),
      )
    }
    const now = this.link.read()
    if (now) {
      this.runs = now.runs
      this.node = now.node
    }
    const n = this.length
    this.sel = { anchor: Math.min(a, n), focus: Math.min(b, n) }
    this.typing = null
    if (inserted || a !== b) this.insert(inserted, "type")
    else this.emit(true)
  }

  // --- Undo ---------------------------------------------------------------------------------

  private snapshot(): Snapshot {
    return { runs: this.runs.map((r) => ({ ...r })), sel: { ...this.sel } }
  }
  /** Records the state before a change; consecutive typing (or deleting) coalesces. */
  private record(kind: StepKind): void {
    const now = Date.now()
    const merge = kind !== "other" && kind === this.lastKind && now - this.lastAt < COALESCE_MS
    if (this.link) {
      // Live: the document's own undo steps; a new step writes what is pending first.
      if (!merge) {
        this.flush()
        this.link.breakStep()
      }
    } else if (!merge) {
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
    if (this.link) return this.dirty || this.link.canUndo
    return this.undoStack.length > 0
  }
  /** Live undo / redo: the person's own latest step, the caret after what it changed. */
  private replayLive(kind: "undo" | "redo"): boolean {
    const link = this.link as LiveTextLink
    this.flush()
    const deltas = kind === "undo" ? link.undo() : link.redo()
    if (!deltas) return false
    const now = link.read()
    if (now) {
      this.runs = now.runs
      this.node = now.node
    }
    const caret = Math.min(caretAfter(deltas, this.sel.focus), this.length)
    this.sel = { anchor: caret, focus: caret }
    this.typing = null
    this.lastKind = null
    this.emit(true)
    return true
  }
  undo(): boolean {
    if (this.link) return this.replayLive("undo")
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
    if (this.link) return this.replayLive("redo")
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
    this.changed(a === b ? kind : "other")
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
    this.changed(kind)
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
    this.changed("other")
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
    this.changed("style")
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

function clampSel(sel: TextRange, n: number): TextRange {
  return {
    anchor: Math.min(Math.max(0, sel.anchor), n),
    focus: Math.min(Math.max(0, sel.focus), n),
  }
}

/**
 * The selection moved through remote deltas. A caret sticks to the character before it, so text
 * someone types at the same place lands after it and does not carry the caret along; a range
 * keeps text inserted at its edges outside.
 */
function moveSel(sel: TextRange, deltas: readonly TextDelta[]): TextRange {
  const collapsed = sel.anchor === sel.focus
  const forward = sel.anchor <= sel.focus
  let { anchor, focus } = sel
  for (const d of deltas) {
    if (collapsed) {
      anchor = transformOffset(anchor, d, -1)
      focus = anchor
    } else {
      anchor = transformOffset(anchor, d, forward ? 1 : -1)
      focus = transformOffset(focus, d, forward ? -1 : 1)
    }
  }
  if (!collapsed && (forward ? anchor > focus : focus > anchor)) anchor = focus
  return { anchor, focus }
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
