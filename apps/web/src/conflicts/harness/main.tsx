/**
 * Board 18 harness (e2e only, not part of the app bundle): the real canvas (CanvasHost +
 * CanvasKit + Yoga) with the conflict overlay, a layer list decorated with LayerRow/Conflict,
 * and the Conflicts panel, over a DocStore. Built by `apps/web/e2e/m4-merge.e2e.ts`;
 * `window.__kimoConflicts.load(text)` loads a `.kimo` (the board-18 fixture).
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../fonts.css"
import "../../app.css"
import { parse } from "@kimo/core-schema"
import { createDocStore, createUiStore, type NodeData } from "@kimo/editor-state"
import { createLayoutEngine, type LayoutResult } from "@kimo/layout"
import { createRenderer } from "@kimo/renderer/browser"
import { LayerRow, LayerRowConflict } from "@kimo/ui"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { CanvasHost } from "../../canvas/CanvasHost"
import type { CanvasHandle } from "../../canvas/contract"
import { nodeName, typeIcon } from "../../editor/props"
import { createBus } from "../../lib/hooks"
import { Icon } from "../../lib/icons"
import type { Toast } from "../../platform/contract"
import {
  CanvasConflictOverlay,
  ConflictsPanel,
  createConflictSession,
  type EditorConflictSession,
  useNextConflictShortcut,
  useOpenConflictNodes,
} from "../index"
import "./harness.css"

const store = createDocStore()
const ui = createUiStore()
const layout = createBus<LayoutResult | null>(null)
const sessionBus = createBus<EditorConflictSession | null>(null)
const saves: string[] = []
const toasts: Toast[] = []
const rejects: string[] = []
let mergeReady = false
let handle: CanvasHandle | null = null

function load(text: string): void {
  sessionBus.get()?.destroy()
  store.loadDocument(parse(text))
  store.clearHistory()
  const s = createConflictSession({
    store,
    fileName: "marketing.kimo",
    save: async () => {
      saves.push(JSON.stringify(store.toDocument()))
    },
    addToast: (t) => toasts.push(t),
    showMergeReady: (v = true) => {
      mergeReady = v
    },
    gitMerging: async () => true,
    onReject: (m) => rejects.push(m),
  })
  s.bindView({
    select: (id) => ui.getState().select([id]),
    reveal: (id) => handle?.zoomToFit([id], 96),
  })
  sessionBus.set(s)
  // Fit the document once laid out, so pills above top-level nodes are on screen.
  const fit = () =>
    handle?.layout() ? handle.zoomToFit(undefined, 64) : requestAnimationFrame(fit)
  requestAnimationFrame(fit)
}

Object.assign(window, {
  __kimoConflicts: {
    load,
    store,
    ui,
    session: () => sessionBus.get(),
    saves,
    toasts,
    rejects,
    mergeReady: () => mergeReady,
    canvas: () => handle,
  },
})

function useRevision() {
  return useSyncExternalStore(
    (cb) => store.onChange(cb),
    () => store.revision.seq + store.revision.epoch,
  )
}

function Layers({ session }: { session: EditorConflictSession | null }) {
  useRevision()
  const selection = useSyncExternalStore(ui.subscribe, () => ui.getState().selection)
  const open = useOpenConflictNodes(session)
  const rows: { id: string; depth: number; node: NodeData; leaf: boolean }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const id of store.children(parent)) {
      const node = store.getNode(id)
      if (!node) continue
      const kids = store.children(id)
      rows.push({ id, depth, node, leaf: kids.length === 0 })
      walk(id, depth + 1)
    }
  }
  walk(null, 0)
  return (
    <div className="mh-left" role="tree" aria-label="Layers">
      {rows.map(({ id, depth, node, leaf }) => {
        const common = {
          name: nodeName(node),
          icon: <Icon name={typeIcon(node)} size={14} />,
          depth,
          expanded: leaf ? undefined : true,
          selected: selection.includes(id),
          emphasized: depth === 0,
          onClick: () => ui.getState().select([id]),
          "data-node-id": id,
        }
        return open.has(id) ? (
          <LayerRowConflict key={id} {...common} />
        ) : (
          <LayerRow key={id} {...common} />
        )
      })}
    </div>
  )
}

function Harness() {
  const session = useSyncExternalStore(sessionBus.subscribe, sessionBus.get)
  const canvas = useRef<CanvasHandle | null>(null)
  const [, setReady] = useState(false)
  useNextConflictShortcut(session)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) store.redo("user")
        else store.undo("user")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return (
    <div className="mh-body">
      <Layers session={session} />
      <main className="editor__canvas" aria-label="Canvas">
        <CanvasHost
          ref={canvas}
          store={store}
          uiStore={ui}
          createRenderer={createRenderer}
          createLayoutEngine={createLayoutEngine}
          assets={{ load: async () => null }}
          overlayTheme={{
            selection: "#2F6BFF",
            handleFill: "#FFFFFF",
            onSelection: "#FFFFFF",
            monoFamily: "JetBrains Mono",
          }}
          onReady={(h) => {
            handle = h
            setReady(true)
          }}
          onLayout={layout.set}
        />
        {session && <CanvasConflictOverlay session={session} ui={ui} layout={layout} />}
      </main>
      <aside className="mh-right" aria-label="Conflicts">
        {session && <ConflictsPanel session={session} getNode={(id) => store.getNode(id)} />}
      </aside>
    </div>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<Harness />)
