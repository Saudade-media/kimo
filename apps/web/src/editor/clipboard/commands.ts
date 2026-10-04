/**
 * Board 27 §2 "Clipboard & structure" (R8OJ3, g1jiG, rules F1FPb): the editor's copy / cut /
 * paste / paste in place / duplicate / group / wrap / ungroup / auto layout / arrange / select
 * all / copy & paste properties commands. One instance per open file; the key bindings, the DOM
 * clipboard events and the context menus all run these.
 */

import { isNodeType, listPages, nodeKeys } from "@kimo/core-schema"
import { generateId, type Op } from "@kimo/editor-state"
import { type DocReader, deleteOps, topLevel } from "../../canvas/commands"
import type { CanvasHandle } from "../../canvas/contract"
import type { AssetStore } from "../../lib/assets"
import { type DuplicateMainMode, duplicateMainOps, selectedMain } from "../m3/component-actions"
import type { M3Controller } from "../m3/controller"
import { activePageId, activeRoots } from "../pages/model"
import { nodeName } from "../props"
import type { FileSession } from "../session"
import {
  buildPayload,
  type ClipboardPayload,
  decodePayload,
  encodePayload,
  libraryAliasFor,
  pasteOps,
} from "./payload"
import { importRasterFiles, isRasterType } from "./raster"
import {
  addAutoLayoutOps,
  arrangeOps,
  type CopiedProperties,
  canUngroup,
  copyProperties,
  type DuplicateResult,
  duplicateNodesOps,
  groupNodesOps,
  insideInstance,
  pastePropertiesOps,
  removeAutoLayoutOps,
  repeatDelta,
  selectAllIds,
  selectInverseIds,
  ungroupOps,
  wrapInFrameOps,
} from "./structure"
import { canPasteInto, pasteTarget } from "./target"

/** Asset bytes of recent copies in this window (cross-file paste in one window). */
const copiedAssets = new Map<string, Uint8Array>()
/** The last payload copied in this window (when the system clipboard can't be read back). */
let lastCopy: ClipboardPayload | null = null
/** ⌥⌘C properties (app-wide, like Figma). */
let copiedProps: CopiedProperties | null = null

export interface CommandDeps {
  session: FileSession
  m3: M3Controller
  canvas: () => CanvasHandle | null
  assets: () => AssetStore | null
}

export type PasteMode = "smart" | "inPlace"

export class EditorCommands {
  private lastDuplicate: DuplicateResult | null = null

  constructor(private readonly d: CommandDeps) {}

  private get store() {
    return this.d.session.store
  }

  private get ui() {
    return this.d.session.ui
  }

  /** Real (non-virtual) selected ids. */
  private selection(): string[] {
    const view = this.d.m3.view()
    return this.ui
      .getState()
      .selection.filter((id) => this.store.hasNode(id) && !view.isVirtual(id))
  }

  private reader(): DocReader {
    return this.store
  }

  private layout() {
    return this.d.canvas()?.layout() ?? null
  }

  private apply(ops: readonly Op[], label: string): boolean {
    if (!ops.length) return false
    return this.d.session.apply(ops, label)
  }

  // --- availability (menus disable what doesn't apply) ------------------------------------------

  has(): boolean {
    return this.selection().length > 0
  }

  canGroup(): boolean {
    const sel = topLevel(this.reader(), this.selection())
    if (!sel.length) return false
    const p = this.store.getNode(sel[0] as string)?.parent ?? null
    return sel.every((id) => {
      const n = this.store.getNode(id)
      return n && n.parent === p && n.at === undefined && !insideInstance(this.reader(), id)
    })
  }

  canUngroup(): boolean {
    return this.selection().some((id) => canUngroup(this.reader(), id))
  }

  /** The single selected frame and whether it has auto layout (null: not a frame). */
  layoutState(): "add" | "remove" | null {
    const sel = this.selection()
    if (sel.length !== 1) return sel.length > 1 && this.canGroup() ? "add" : null
    const n = this.store.getNode(sel[0] as string)
    if (n?.type !== "frame" || insideInstance(this.reader(), sel[0] as string))
      return n && this.canGroup() ? "add" : null
    return typeof n.layout === "object" && n.layout !== null ? "remove" : "add"
  }

  // --- clipboard ---------------------------------------------------------------------------------

  /** The payload of the current selection (null when nothing copyable is selected). */
  payload(): ClipboardPayload | null {
    const sel = topLevel(this.reader(), this.selection())
    if (!sel.length) return null
    const s = this.store
    const ordered = [...sel].sort((a, b) => {
      const pa = s.getNode(a)?.parent ?? null
      const pb = s.getNode(b)?.parent ?? null
      if (pa !== pb) return 0
      const kids = s.children(pa)
      return kids.indexOf(a) - kids.indexOf(b)
    })
    return buildPayload(
      {
        doc: this.d.m3.doc(),
        docId: this.d.session.id,
        page: activePageId(s, this.ui.getState().page),
        getNode: (id) => s.getNode(id),
        children: (id, at) => s.children(id, at),
        layout: this.layout(),
      },
      ordered,
    )
  }

  /**
   * Writes the selection to `data` (a copy / cut event's clipboardData): the Kimo payload, the
   * same payload embedded in text/html and a plain-text fallback. Returns false when nothing is
   * selected (the browser's own copy runs).
   */
  copyTo(data: DataTransfer): boolean {
    const p = this.payload()
    if (!p) return false
    for (const [type, value] of Object.entries(encodePayload(p))) {
      try {
        data.setData(type, value)
      } catch {
        // A type the platform refuses (custom types on some WebViews): html/plain still carry it.
      }
    }
    this.remember(p)
    return true
  }

  /** Copy without a clipboard event (menus): the async Clipboard API, else this window only. */
  async copy(): Promise<boolean> {
    const p = this.payload()
    if (!p) return false
    this.remember(p)
    const enc = encodePayload(p)
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([enc["text/html"] as string], { type: "text/html" }),
          "text/plain": new Blob([enc["text/plain"] as string], { type: "text/plain" }),
        }),
      ])
    } catch {
      // Denied (no user activation / permission): the in-window copy still pastes.
    }
    return true
  }

  /** ⌘X: copy + delete (one undo step for the delete). */
  cutTo(data: DataTransfer | null): boolean {
    let ok: boolean
    if (data) ok = this.copyTo(data)
    else {
      ok = this.has()
      void this.copy()
    }
    if (!ok) return false
    const ops = deleteOps(this.reader(), this.selection())
    if (this.apply(ops, "Cut")) this.ui.getState().clearSelection()
    return true
  }

  private remember(p: ClipboardPayload) {
    lastCopy = p
    // Asset bytes for a paste into another file of this window.
    const store = this.d.assets()
    if (!store || !p.assets) return
    for (const key of Object.keys(p.assets))
      void store.bytes(key).then((b) => {
        if (b) copiedAssets.set(key, b)
      })
  }

  /** Reads a payload from a paste event's data, or the last in-window copy when asked. */
  static decode(data: DataTransfer | null): ClipboardPayload | null {
    if (!data) return null
    return decodePayload((t) => {
      try {
        return data.getData(t)
      } catch {
        return ""
      }
    })
  }

  /** The last payload copied in this window. */
  static last(): ClipboardPayload | null {
    return lastCopy
  }

  /**
   * Pastes `p`: ⌘V into the selected frame / at the pointer / at the viewport centre; ⇧⌘V in
   * place. Selects the pasted nodes, flashes the parent and toasts "Pasted “X” into Y" with Undo.
   */
  async paste(p: ClipboardPayload, mode: PasteMode): Promise<string[]> {
    const { session, m3 } = this.d
    const canvas = this.d.canvas()
    const layout = this.layout()
    const view = m3.view()
    const target = pasteTarget(this.store, this.ui, canvas, {
      isVirtual: (id) => view.isVirtual(id),
      layout,
    })
    const parentNode = target.parent ? this.store.getNode(target.parent) : undefined
    const header = this.store.toHeader()
    const r = pasteOps(
      p,
      {
        getNode: (id) => this.store.getNode(id),
        children: (id, at) => this.store.children(id, at),
        header,
        doc: () => m3.doc(),
        docId: session.id,
        libraryAlias: (sourceDoc, id) =>
          libraryAliasFor(session.id, header, m3.libraries(), sourceDoc, id),
      },
      {
        mode,
        parent: target.parent,
        center: target.center,
        parentFlows: typeof parentNode?.layout === "object" && parentNode.layout !== null,
      },
    )
    // Asset bytes the target lacks (copied from another file of this window).
    const store = this.d.assets()
    if (store && r.assets.length) {
      const have = new Set(await store.keys().catch(() => [] as string[]))
      for (const key of r.assets) {
        if (have.has(key)) continue
        const bytes = copiedAssets.get(key)
        const entry = p.assets?.[key]
        if (bytes) await store.putKey(key, bytes, entry as never).catch(() => null)
      }
    }
    if (!session.apply(r.ops, mode === "inPlace" ? "Paste in place" : "Paste")) return []
    this.ui.getState().select(r.roots)
    if (r.parent) canvas?.flash?.(r.parent)
    const first = p.roots[0] ? p.nodes[p.roots[0]] : undefined
    const what =
      p.roots.length === 1 && first ? nodeName(first as never) : `${p.roots.length} layers`
    const where = r.parent
      ? nodeName(this.store.getNode(r.parent) as never)
      : (listPages({ pages: this.store.toHeader().pages }).find(
          (pg) => pg.id === activePageId(this.store, this.ui.getState().page),
        )?.name ?? "Page 1")
    m3.toast({
      tone: "component",
      icon: "clipboard-check",
      text: `Pasted “${what}” into ${where}`,
      action: { label: "Undo", run: () => session.store.undo("user") },
    })
    if (r.detached)
      m3.toast({
        tone: "warning",
        text:
          r.detached === 1
            ? "1 instance was pasted detached: its main component isn't in this file"
            : `${r.detached} instances were pasted detached: their main components aren't in this file`,
      })
    return r.roots
  }

  /**
   * Paste without a clipboard event (menus, WebKit outside fields): the async Clipboard API — a
   * Kimo payload, else image data (raster import), else text — else this window's last copy.
   */
  async pasteFromClipboard(mode: PasteMode): Promise<void> {
    try {
      const items = await navigator.clipboard.read()
      const blobs: Blob[] = []
      let html = ""
      let text = ""
      for (const item of items)
        for (const type of item.types) {
          if (type === "text/html") html = await (await item.getType(type)).text()
          else if (type === "text/plain") text = await (await item.getType(type)).text()
          else if (isRasterType(type)) blobs.push(await item.getType(type))
        }
      const payload = decodePayload((t) => (t === "text/html" ? html : ""))
      if (payload) return void (await this.paste(payload, mode))
      if (blobs.length) {
        const { session, m3, canvas } = this.d
        await importRasterFiles({ session, m3, canvas }, blobs, { kind: "paste" })
        return
      }
      if (text.trim()) {
        this.pasteText(text)
        return
      }
    } catch {
      // Unavailable or denied: fall through to the in-window copy.
    }
    if (lastCopy) await this.paste(lastCopy, mode)
  }

  /** Plain text (no Kimo payload, no image): a new text layer at the paste target. */
  pasteText(text: string): string | null {
    const content = text.replace(/\r\n?/g, "\n")
    if (!content.trim()) return null
    const layout = this.layout()
    const view = this.d.m3.view()
    const t = pasteTarget(this.store, this.ui, this.d.canvas(), {
      isVirtual: (id) => view.isVirtual(id),
      layout,
    })
    const id = generateId()
    const parentBox = t.parent ? layout?.nodes.get(t.parent)?.world : null
    const node: Record<string, unknown> = {
      type: "text",
      name: content.split("\n")[0]?.slice(0, 40) || "Text",
      content,
      style: { font: "Inter", size: 16 },
    }
    if (t.parent && parentBox) {
      node.x = 16
      node.y = 16
    } else {
      node.x = Math.round(t.center.x)
      node.y = Math.round(t.center.y)
    }
    if (!this.apply([{ op: "insert", id, parent: t.parent, node }], "Paste text")) return null
    this.ui.getState().select([id])
    if (t.parent) this.d.canvas()?.flash?.(t.parent)
    return id
  }

  // --- structure ---------------------------------------------------------------------------------

  /** ⌘D: +16/+16 (a repeat right after moving the copy reuses that offset); flow → next sibling. */
  duplicate(): boolean {
    const sel = this.selection()
    if (!sel.length) return false
    // Board 27 §8 (d): a main in the selection asks (or follows the remembered choice).
    const main = selectedMain(this.reader(), sel)
    if (main) {
      const pref = this.d.m3.prefs?.duplicateMain() ?? "ask"
      if (pref === "ask") {
        this.d.m3.componentDialog.set({ kind: "duplicateMain", ids: sel, main })
        return true
      }
      return this.duplicateMain(pref, sel)
    }
    const delta = repeatDelta(this.reader(), this.lastDuplicate, sel)
    const r = duplicateNodesOps(this.reader(), sel, delta)
    if (!this.apply(r.ops, "Duplicate")) return false
    this.lastDuplicate = r
    this.ui.getState().select(r.created)
    return true
  }

  /**
   * Board 27 §8 (d): duplicate a selection holding a main as an instance of it (default) or as a
   * new component "<name> 2" (props copied). One undo step; selects the copies.
   */
  duplicateMain(mode: DuplicateMainMode, ids: readonly string[] = this.selection()): boolean {
    const sel = ids.filter((id) => this.store.getNode(id))
    if (!sel.length) return false
    const names = new Set<string>()
    for (const n of Object.values(this.d.m3.doc().nodes as Record<string, { name?: unknown }>))
      if (typeof n?.name === "string") names.add(n.name)
    const delta = repeatDelta(this.reader(), this.lastDuplicate, sel)
    const r = duplicateMainOps(this.reader(), sel, mode, names, () => generateId(), delta)
    if (!this.apply(r.ops, "Duplicate")) return false
    this.lastDuplicate = r
    this.ui.getState().select(r.created)
    return true
  }

  /** ⌘G: a group node around the selection. */
  group(): boolean {
    const layout = this.layout()
    const sel = this.selection()
    if (!layout || !sel.length) return false
    const id = generateId()
    const ops = groupNodesOps(this.reader(), layout, sel, id)
    if (!ops) {
      this.d.m3.toast({ tone: "warning", text: "Select layers that share a parent to group them" })
      return false
    }
    if (this.apply(ops, "Group")) this.ui.getState().select([id])
    return true
  }

  /** ⌥⌘G: a frame sized to the selection bounds. */
  wrap(): boolean {
    const layout = this.layout()
    const sel = this.selection()
    if (!layout || !sel.length) return false
    const id = generateId()
    const ops = wrapInFrameOps(this.reader(), layout, sel, id)
    if (!ops) {
      this.d.m3.toast({ tone: "warning", text: "Select layers that share a parent to wrap them" })
      return false
    }
    if (this.apply(ops, "Wrap in frame")) this.ui.getState().select([id])
    return true
  }

  /** ⇧⌘G: groups and plain frames release their children (canvas position kept). */
  ungroup(): boolean {
    const layout = this.layout()
    if (!layout) return false
    const r = ungroupOps(this.reader(), layout, this.selection())
    if (!r) return false
    if (this.apply(r.ops, "Ungroup")) this.ui.getState().select(r.freed)
    return true
  }

  /** ⇧A: auto layout on the selected frame (several siblings: wrapped in one first). */
  addAutoLayout(): boolean {
    const layout = this.layout()
    const sel = this.selection()
    if (!layout || !sel.length) return false
    const n = sel.length === 1 ? this.store.getNode(sel[0] as string) : undefined
    if (n?.type === "frame" && !(typeof n.layout === "object" && n.layout !== null)) {
      return this.apply(
        addAutoLayoutOps(this.reader(), layout, sel[0] as string),
        "Add auto layout",
      )
    }
    // Several nodes (or a non-frame): wrap, then lay the new frame out.
    if (!this.wrap()) return false
    const wrapped = this.ui.getState().selection[0]
    const after = this.layout()
    if (!wrapped || !after) return true
    return this.apply(addAutoLayoutOps(this.reader(), after, wrapped), "Add auto layout")
  }

  /** ⌥⇧A: children frozen at their current x/y; the frame keeps its size. */
  removeAutoLayout(): boolean {
    const layout = this.layout()
    const sel = this.selection()
    if (!layout || sel.length !== 1) return false
    return this.apply(
      removeAutoLayoutOps(this.reader(), layout, sel[0] as string),
      "Remove auto layout",
    )
  }

  arrange(to: "front" | "back"): boolean {
    return this.apply(
      arrangeOps(this.reader(), this.selection(), to),
      to === "front" ? "Bring to front" : "Send to back",
    )
  }

  delete(): boolean {
    const ops = deleteOps(this.reader(), this.selection())
    if (!this.apply(ops, "Delete")) return false
    this.ui.getState().clearSelection()
    return true
  }

  selectAll(): void {
    const roots = activeRoots(this.store, this.ui.getState().page)
    this.ui.getState().select(selectAllIds(this.reader(), this.ui.getState().selection, roots))
  }

  selectInverse(): void {
    const roots = activeRoots(this.store, this.ui.getState().page)
    this.ui.getState().select(selectInverseIds(this.reader(), this.ui.getState().selection, roots))
  }

  copyProperties(): boolean {
    const id = this.selection()[0]
    const props = id ? copyProperties(this.reader(), id) : null
    if (!props) return false
    copiedProps = props
    return true
  }

  pasteProperties(): boolean {
    if (!copiedProps) return false
    const ops = pastePropertiesOps(this.reader(), this.selection(), copiedProps, (t) =>
      isNodeType(t) ? nodeKeys(t) : new Set<string>(),
    )
    return this.apply(ops, "Paste properties")
  }

  /** True when ⌥⌘V has something to paste. */
  static hasProperties(): boolean {
    return copiedProps !== null
  }

  /** True when the selection can receive a paste "here" (a frame / group, not an instance). */
  canPasteHere(): boolean {
    const sel = this.selection()
    const view = this.d.m3.view()
    return (
      sel.length === 1 && canPasteInto(this.store, sel[0] as string, (id) => view.isVirtual(id))
    )
  }
}
