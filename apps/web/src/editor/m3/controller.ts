/**
 * M3 editor state for one open file (ADR 0011): linked libraries, the shared expanded view
 * (instances expanded with composite ids), the command runner (one `store.apply` / undo step
 * per gesture), toasts (board 15 placement and timing), confirm dialogs and the dialog/popover
 * switches of boards 11–15. Panels read it through {@link useM3}.
 */
import {
  createExpandedView,
  type ExpandedView,
  type KimoDocument,
  type Libraries,
  type NodeLookup,
  type PlanError,
  type PlanNote,
  type Theme,
} from "@kimo/core-schema"
import { applyCommand, type M3Command, type Op, planCommand } from "@kimo/editor-state"
import { createContext, useContext, useSyncExternalStore } from "react"
import type { CanvasHandle } from "../../canvas/contract"
import { M3_TOAST_COPY } from "../../canvas/contract"
import { currentHeader } from "../../lib/header"
import { type Bus, createBus } from "../../lib/hooks"
import type { FileSession, Gesture } from "../session"
import { LibraryManager } from "./libraries"
import { routeOps } from "./route"

/** A toast of board 15 (`FVd5q` danger, `qINpv` warning) or the M1 Toast (component / success). */
export interface ToastItem {
  id: number
  tone: "danger" | "warning" | "component" | "success"
  text: string
  action?: { label: string; run: () => void }
  /** ms before it fades (danger 6 s, warning 4 s, created-component 4 s). */
  duration: number
}

/** Confirm dialogs (board 15 `i8PfIC`, `ysXyK`, `fmB2B`). */
export interface ConfirmSpec {
  title: string
  desc: string
  icon: string
  tone: "component" | "danger"
  items: readonly { icon: string; accent?: boolean; text: string }[]
  confirm: string
  /** Shows the "Don't ask again" checkbox; the key remembers the choice for the session. */
  dontAskKey?: string
}

interface ConfirmState {
  spec: ConfirmSpec
  resolve(ok: boolean): void
}

/** Open dialogs / popovers of the shell (not document state). */
export interface M3Panels {
  variables: boolean
  libraryManager: boolean
  /** Alias whose "changed since last open" review is open. */
  libraryChanges: string | null
}

/** Result of {@link M3Controller.run} (refusals and rejections are already toasted). */
export type M3RunResult =
  | { ok: true; notes: readonly PlanNote[]; select?: string[] }
  | { ok: false; refused?: PlanError; rejected?: readonly { message: string }[] }

/** Commands whose planners read only the header (variables / themes), never nodes. */
const HEADER_ONLY_COMMANDS: ReadonlySet<M3Command["cmd"]> = new Set([
  "setCell",
  "setVariableValue",
  "updateVariable",
])

export class M3Controller {
  readonly libs: LibraryManager
  readonly toasts: Bus<readonly ToastItem[]>
  readonly confirmState: Bus<ConfirmState | null>
  readonly panels: Bus<M3Panels>
  /** Preview theme of the Variables tab/dialog (editor state, not in the file). */
  readonly previewTheme: Bus<Theme | null>
  /** Bumps when the expanded view may have changed (any document change, libraries). */
  readonly rev: Bus<number>
  /**
   * Bumps only when component structure may have changed: an instance, a component, a node
   * inside a component or an instance-owned node changed, or the libraries did. The layers tree
   * and Assets re-walk on it (not on every geometry edit; perf gate).
   */
  readonly compRev: Bus<number>
  private view_: ExpandedView
  private libVersion = -1
  private doc_: { rev: string; doc: KimoDocument } | null = null
  private dontAsk = new Set<string>()
  private announced = new Set<string>()
  private nextToast = 1
  private disposers: (() => void)[] = []

  constructor(
    readonly session: FileSession,
    readonly canvas: () => CanvasHandle | null,
  ) {
    this.libs = new LibraryManager(session.id)
    this.toasts = createBus<readonly ToastItem[]>([])
    this.confirmState = createBus<ConfirmState | null>(null)
    this.panels = createBus<M3Panels>({
      variables: false,
      libraryManager: false,
      libraryChanges: null,
    })
    this.previewTheme = createBus<Theme | null>(null)
    this.rev = createBus(0)
    this.compRev = createBus(0)
    this.view_ = this.makeView()
  }

  /**
   * Subscribes to the store, routes panel edits and surfaces rejected edits; returns the
   * detach function (React effect).
   */
  attach(): () => void {
    const session = this.session
    const store = session.store
    this.disposers.push(
      store.onChange((c) => {
        // Only `imports` (and a load) change what an expansion reads from the header: themes
        // and variables are read lazily (`theme()`), so a mode switch or a variable edit keeps
        // every expansion.
        let importsChanged = false
        if (c.header) {
          const key = JSON.stringify(this.imports())
          importsChanged = key !== this.importsKey
          this.importsKey = key
        }
        const all = c.cause === "load" || importsChanged
        this.view_.invalidate(all ? undefined : c.nodes)
        this.rev.set(this.rev.get() + 1)
        if (all || this.touchesComponents(c.nodes)) this.compRev.set(this.compRev.get() + 1)
        if (importsChanged) void this.libs.sync(this.imports())
        // Composite ids (not store nodes) leave the selection when their view node is gone.
        const ui = session.ui.getState()
        const kept = ui.selection.filter((id) => !id.includes("/") || this.view_.getNode(id))
        if (kept.length !== ui.selection.length) ui.select(kept)
      }),
      this.libs.subscribe(() => {
        // Board 15 Toast/Warning: a library changed since last open → Review.
        for (const e of this.libs.entries())
          if (e.status === "changed" && !this.announced.has(e.alias)) {
            this.announced.add(e.alias)
            this.toast({
              tone: "warning",
              text: `${e.name} changed since last open — ${e.changes.length} change${e.changes.length === 1 ? "" : "s"}`,
              action: { label: "Review", run: () => this.openPanel({ libraryChanges: e.alias }) },
            })
          }
        this.view_ = this.makeView()
        this.rev.set(this.rev.get() + 1)
        this.compRev.set(this.compRev.get() + 1)
      }),
    )
    // Panel edits on composite ids / instance roots become overrides (route.ts).
    session.route = (ops) => this.route(ops)
    this.disposers.push(() => {
      session.route = undefined
    })
    const onReject = (message: string) => this.toast({ tone: "danger", text: message })
    session.onReject.add(onReject)
    this.disposers.push(() => session.onReject.delete(onReject))
    this.importsKey = JSON.stringify(this.imports())
    void this.libs.sync(this.imports())
    return () => this.dispose()
  }

  dispose() {
    for (const d of this.disposers.splice(0)) d()
  }

  /** `imports` as last seen (header changes that leave it alone keep the expansions). */
  private importsKey = ""

  private touchesComponents(ids: ReadonlySet<string>): boolean {
    if (ids.size > 256) return true
    const store = this.session.store
    for (const id of ids) {
      let cur: string | null = id
      for (let depth = 0; cur !== null && depth < 64; depth++) {
        const n = store.getNode(cur)
        if (!n) {
          if (cur === id) return true // removed: may have been component content
          break
        }
        if (n.type === "instance" || n.component || typeof n.at === "string") return true
        cur = typeof n.parent === "string" ? n.parent : null
      }
    }
    return false
  }

  private imports(): Record<string, string> {
    return (currentHeader(this.session.store).imports ?? {}) as Record<string, string>
  }

  private makeView(): ExpandedView {
    this.libVersion = this.libs.version
    const store = this.session.store
    return createExpandedView(store as unknown as NodeLookup, {
      libraries: this.libs.libraries(),
      header: () => currentHeader(store),
    })
  }

  /** The shared expanded view (the canvas's when it exposes one). */
  view(): ExpandedView {
    const fromCanvas = this.canvas()?.expanded?.()
    if (fromCanvas) return fromCanvas
    if (this.libVersion !== this.libs.version) this.view_ = this.makeView()
    return this.view_
  }

  libraries(): Libraries {
    return this.libs.libraries()
  }

  /** The current document (copied once per revision). */
  doc(): KimoDocument {
    const r = this.session.store.revision
    const key = `${r.epoch}:${r.seq}`
    if (this.doc_?.rev !== key) this.doc_ = { rev: key, doc: this.session.store.toDocument() }
    return this.doc_.doc
  }

  private route(ops: readonly Op[]): readonly Op[] | null {
    const store = this.session.store
    const r = routeOps(this.view(), (id) => store.getNode(id), ops)
    if (!r.ok) {
      this.toast({ tone: "danger", text: r.message })
      return null
    }
    for (const n of r.notices)
      this.toast({
        tone: "danger",
        text: M3_TOAST_COPY.HIDDEN_INSTEAD.replace("{name}", n.name),
        action: { label: "Undo", run: () => store.undo("user") },
      })
    return r.ops
  }

  /** Runs an M3 command as one undo step; refusals and notes become toasts. */
  private gesture: Gesture | null = null

  /**
   * Starts a continuous gesture (color drag, scrub): every {@link run} until {@link endGesture}
   * collapses into ONE undo step (each step replaces the previous; plans are absolute).
   */
  beginGesture() {
    this.endGesture()
    this.gesture = this.session.gesture()
  }

  endGesture() {
    this.gesture?.end()
    this.gesture = null
  }

  run(command: M3Command, label: string, options: { quiet?: boolean } = {}): M3RunResult {
    if (this.gesture && !this.gesture.done) {
      // Value gestures (color drag, scrub) need the variables only: plan against the header
      // instead of copying the whole document on every pointer move.
      const doc = HEADER_ONLY_COMMANDS.has(command.cmd)
        ? ({ ...this.session.store.toHeader(), nodes: {} } as KimoDocument)
        : this.doc()
      const plan = planCommand(doc, command, { libraries: this.libraries() })
      if (!plan.ok) {
        if (!options.quiet) this.toastRefusal(plan.error, command)
        return { ok: false, refused: plan.error }
      }
      if (!this.gesture.apply(plan.ops as unknown as Op[], label)) return { ok: false }
      return { ok: true, notes: plan.notes }
    }
    const handle = this.canvas()
    const r = handle?.runCommand
      ? handle.runCommand(command, label)
      : applyCommand(this.session.store, command, {
          origin: "user",
          label,
          libraries: this.libraries(),
        })
    if (handle?.runCommand) return r.ok ? { ok: true, notes: r.notes, select: r.select } : r
    if (!r.ok) {
      if (!options.quiet) {
        if ("refused" in r) this.toastRefusal(r.refused, command)
        else this.toastRejected(label, r.rejected)
      }
      return r
    }
    if (r.select) this.session.ui.getState().select(r.select)
    this.toastNotes(r.notes)
    return r
  }

  /** Plans without applying (confirm dialogs list the notes first). */
  plan(command: M3Command) {
    return planCommand(this.doc(), command, { libraries: this.libraries() })
  }

  toastRefusal(error: PlanError, command?: M3Command) {
    const name = commandName(this, command)
    let text: string = error.message
    if (error.code === "LIBRARY_READ_ONLY")
      text = M3_TOAST_COPY.LIBRARY_READ_ONLY.replace("{name}", name)
    else if (error.code === "CYCLE" && command?.cmd === "updateVariable")
      text = M3_TOAST_COPY.ALIAS_CYCLE.replace("{name}", name)
    else if (error.code === "CYCLE" && command?.cmd === "setVariableValue")
      text = M3_TOAST_COPY.ALIAS_CYCLE.replace("{name}", name)
    else if (error.code === "CYCLE" && command?.cmd === "setCell")
      text = M3_TOAST_COPY.ALIAS_CYCLE.replace("{name}", name)
    else if (error.code === "CYCLE") text = M3_TOAST_COPY.CYCLE
    this.toast({ tone: "danger", text })
  }

  /**
   * The store refused a planned command (validation): the store's messages are developer
   * messages, so they go to the console and the toast names the gesture only.
   */
  toastRejected(label: string, rejected: readonly { message: string }[]) {
    console.warn(`Kimo: "${label}" rejected:`, rejected.map((e) => e.message).join("; "))
    this.toast({
      tone: "danger",
      text: `${label} wasn't applied — it would leave the file invalid`,
    })
  }

  toastNotes(notes: readonly PlanNote[]) {
    const hidden = notes.find((n) => n.code === "HIDDEN_INSTEAD")
    if (hidden)
      this.toast({
        tone: "danger",
        text: hidden.message,
        action: { label: "Undo", run: () => this.session.store.undo("user") },
      })
    const dropped = notes.filter((n) => n.code === "ARG_DROPPED" || n.code === "OVERRIDE_DROPPED")
    if (dropped.length)
      this.toast({
        tone: "warning",
        text: `${dropped.length} override${dropped.length === 1 ? "" : "s"} dropped`,
      })
  }

  /** Board 15: newest at the bottom, max 3; danger 6 s, warning 4 s. */
  toast(t: Omit<ToastItem, "id" | "duration"> & { duration?: number }) {
    const item: ToastItem = {
      ...t,
      id: this.nextToast++,
      duration: t.duration ?? (t.tone === "danger" ? 6000 : 4000),
    }
    this.toasts.set([...this.toasts.get(), item].slice(-3))
  }

  dismissToast(id: number) {
    this.toasts.set(this.toasts.get().filter((t) => t.id !== id))
  }

  /** Shows a confirm dialog; resolves true on confirm. Skipped when "Don't ask again" was set. */
  confirm(spec: ConfirmSpec): Promise<boolean> {
    if (spec.dontAskKey && this.dontAsk.has(spec.dontAskKey)) return Promise.resolve(true)
    return new Promise((resolve) => {
      this.confirmState.set({
        spec,
        resolve: (ok) => {
          this.confirmState.set(null)
          resolve(ok)
        },
      })
    })
  }

  rememberDontAsk(key: string) {
    this.dontAsk.add(key)
  }

  openPanel(patch: Partial<M3Panels>) {
    this.panels.set({ ...this.panels.get(), ...patch })
  }
}

function commandName(m3: M3Controller, command?: M3Command): string {
  if (!command) return "This"
  const n = (id: string) => {
    const node = m3.view().getNode(id)
    return typeof node?.name === "string" ? node.name : id
  }
  switch (command.cmd) {
    case "setOverride":
    case "resetOverride":
    case "hideInInstance":
    case "setArgs":
    case "swapInstance":
    case "resetAllOverrides":
      return n(command.instance)
    case "declareProp":
    case "updateProp":
    case "removeProp":
    case "reorderProp":
    case "setComponentDescription":
      return n(command.component)
    case "updateVariable":
    case "setVariableValue":
    case "setCell":
    case "deleteVariable":
      return command.name
    default:
      return "This"
  }
}

export const M3Context = createContext<M3Controller | null>(null)

export function useM3(): M3Controller {
  const m = useContext(M3Context)
  if (!m) throw new Error("useM3 outside the editor")
  return m
}

/** Re-renders when the expanded view may have changed; returns the view. */
export function useView(m3: M3Controller): ExpandedView {
  useSyncExternalStore(m3.rev.subscribe, m3.rev.get)
  return m3.view()
}

export function useBusValue<T>(bus: Bus<T>): T {
  return useSyncExternalStore(bus.subscribe, bus.get)
}

/** Library entries, kept current. */
export function useLibraries(m3: M3Controller) {
  return useSyncExternalStore(m3.libs.subscribe, m3.libs.entries)
}

/** Re-renders only on component-structure changes ({@link M3Controller.compRev}). */
export function useComponentRev(m3: M3Controller): number {
  return useSyncExternalStore(m3.compRev.subscribe, m3.compRev.get)
}
