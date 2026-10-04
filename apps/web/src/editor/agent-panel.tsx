/**
 * The M6 built-in agent in the editor window (apps/web/src/agent-panel/INTEGRATION.md): one
 * Agent tab controller per window over the window's AI providers (`getAiProviders`) and the
 * in-window tool host, the canvas selection → attachment chips, the canvas surfaces
 * (`agentCanvasProps`), prompt-node runs (canvas footer Run + LayerRow/Prompt play), the
 * side-by-side placement on free canvas and the Home hand-off. The canvas context menu lives in
 * `CanvasMenu.tsx` (board 25 §3).
 *
 * Tools ({@link agentToolsFor}): on desktop, when the window's document is hosted by the document
 * host, the agent's calls run there through the host RPC `agentCall` (`createHostTools`) under
 * its `agent:kimo.<session>.<n>` identity — host presence + activity log next to MCP clients,
 * the window's scope checked per op in the host, approvals forwarded to the in-thread card. With
 * no host (web, older shell) or an untitled document, the M5 registry runs in process over the
 * window's own store (`createInWindowTools`). See agent-panel/INTEGRATION.md.
 */
import { type NoteView, type PromptNodeView, shimLaunch } from "@kimo/ai-agent"
import type { LayoutResult } from "@kimo/layout"
import type { KimoPlatform } from "@kimo/platform"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  AgentPanel,
  type AgentPanelControllerExt,
  type AgentPanelViewState,
  agentCanvasProps,
  createAgentPanelController,
  createHostTools,
  createInWindowTools,
  createPlatformAgentRuntime,
  hasHomeHandoff,
  modelLabel,
  useHomeHandoff,
} from "../agent-panel"
import { useAiProviders } from "../ai-settings"
import { SIDE_BY_SIDE_GAP, sideBySideAnchor } from "../canvas/agent-canvas"
import type { AgentCanvasProps, CanvasHandle } from "../canvas/contract"
import { type HostClient, HostedDocumentSession } from "../host/client"
import type { Bus } from "../lib/hooks"
import type { FileDocumentSession } from "../platform/session"
import { useFileId } from "./agents"
import type { PromptRowStatus } from "./LeftPanel"
import type { FileSession } from "./session"

type Box = { x: number; y: number; w: number; h: number }

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

export interface EditorAgentPanel {
  controller: AgentPanelControllerExt | null
  /** The Agent tab body (null: no AI controller). */
  panel: React.ReactNode
  /** `CanvasHost agentCanvas`. */
  canvas: AgentCanvasProps | undefined
  /** `CanvasHost noteAuthor`. */
  noteAuthor: string | undefined
  /** LeftPanel LayerRow/Prompt trailing state + play. */
  promptRun(id: string): PromptRowStatus | undefined
  runPrompt(id: string): void
  /** Opens the Agent tab first when Home left a hand-off for this file. */
  initialAgentTab: boolean
  /** "<Agent> editing" (window / tab title) while a turn runs. */
  editingAgent: string | null
}

export function useEditorAgentPanel({
  platform,
  hostClient,
  session,
  doc,
  canvas,
  layout,
  openSettings,
  openAgentTab,
}: {
  platform: KimoPlatform
  hostClient: HostClient | null
  session: FileSession
  doc: FileDocumentSession | null
  canvas: { current: CanvasHandle | null }
  layout: Bus<LayoutResult | null>
  openSettings: (pane: "ai-providers") => void
  /** Switches the right panel to the Agent tab. */
  openAgentTab: () => void
}): EditorAgentPanel {
  const ai = useAiProviders(platform)
  const path = doc && !doc.untitled ? doc.ref : null
  const hashed = useFileId(path)
  // Same key as leases / recovery / activity: sha256(path)[:16], `untitled-<docId>`, or the
  // browser library's file id.
  const fileId = path ? hashed : (doc?.untitledRecoveryId ?? session.id)
  const toolPath = doc ? doc.ref : `library:${session.id}`
  // Home hand-off key: the desktop FileRef or the web library file id.
  const handoffPath = doc ? doc.ref : session.id
  const [initialAgentTab] = useState(() => hasHomeHandoff(handoffPath))

  // MCP status (desktop): the bundled shim CLIs launch, and the OS user (note author).
  const [mcp, setMcp] = useState<{ shim: string | null; user: string | undefined }>({
    shim: null,
    user: undefined,
  })
  useEffect(() => {
    let live = true
    void platform.mcp
      ?.status()
      .then((s) => {
        if (!live) return
        const user =
          s.home
            ?.replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() || undefined
        setMcp({ shim: s.shimPath || null, user })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [platform])

  const tools = useMemo(
    () =>
      agentToolsFor({
        hostClient,
        doc,
        store: session.store,
        path: toolPath,
        selection: () => [...session.ui.getState().selection],
        onFocus: (ids) => {
          if (ids.length === 0) return
          session.ui.getState().select(ids)
          canvas.current?.zoomToFit(ids, 96)
        },
        version: platform.appVersion,
      }),
    [hostClient, doc, session, toolPath, canvas, platform],
  )
  useEffect(() => () => tools.dispose?.(), [tools])

  const boxOf = (id: string): Box | null => {
    const b = layout.get()?.nodes.get(id)?.world
    if (b) return { x: b.x, y: b.y, w: b.w, h: b.h }
    const n = session.store.getNode(id) as Record<string, unknown> | undefined
    if (!n) return null
    const num = (v: unknown) => (typeof v === "number" ? v : 0)
    return { x: num(n.x), y: num(n.y), w: num(n.w), h: num(n.h) }
  }
  const boxRef = useRef(boxOf)
  boxRef.current = boxOf

  // Read at call time: the controller lives for the file, not for these values.
  const latest = useRef({ shim: mcp.shim, openSettings, fileName: "" })
  latest.current = {
    shim: mcp.shim,
    openSettings,
    fileName: doc ? doc.fileName : session.meta.name,
  }
  const store = session.store
  const controller = useMemo(() => {
    if (!ai || !fileId) return null
    return createAgentPanelController({
      runtime: createPlatformAgentRuntime(platform, ai, tools.factory, {
        mcpLaunch: (cli) => shimLaunch(latest.current.shim ?? "kimo-mcp", cli),
        openSettings: () => latest.current.openSettings("ai-providers"),
        openLink: (url) => void platform.files.openExternalUrl(url).catch(() => {}),
        // Desktop: ~/.kimo/skills (listed, read and watched by Rust); absent on the web.
        ...(platform.skills ? { skills: platform.skills } : {}),
      }),
      fileId,
      fileName: latest.current.fileName,
      docId: () => tools.docId(),
      nodeName: (id) => {
        const n = store.getNode(id) as { name?: unknown } | undefined
        return n ? (str(n.name) ?? id) : undefined
      },
      // Side by side: the original's box, moved down when the row of `n` variants would land
      // on other root frames (`sideBySideAnchor`, board ZFOQf `agblr`).
      frameBox: (id, n = 1) => {
        const node = store.getNode(id) as { name?: unknown } | undefined
        const box = boxRef.current(id)
        if (!node || !box) return null
        const roots = store
          .children(null)
          .filter((r) => r !== id)
          .map((r) => boxRef.current(r))
          .filter((b): b is Box => b !== null)
        return sideBySideAnchor({ id, name: str(node.name) ?? id, ...box }, roots, n)
      },
      sideBySideGap: SIDE_BY_SIDE_GAP,
    })
  }, [ai, fileId, tools, platform, store])
  useEffect(() => () => controller?.dispose(), [controller])

  // Canvas selection → removable attachment chips (the scope of Single mode).
  useEffect(() => {
    if (!controller) return
    const push = (ids: readonly string[]) =>
      controller.setSelection(
        ids.map((id) => {
          const n = session.store.getNode(id) as { name?: unknown; type?: string } | undefined
          return { id, name: str(n?.name) ?? id, ...(n?.type ? { type: n.type } : {}) }
        }),
      )
    let last = session.ui.getState().selection
    push(last)
    return session.ui.subscribe((s) => {
      if (s.selection === last) return
      last = s.selection
      push(last)
    })
  }, [controller, session])

  // Home → Agent tab: take the hand-off once and start (origin "home", Single, scope page).
  useHomeHandoff(controller, handoffPath, openAgentTab)

  const agent = useAgentSlice(controller, ai ? (p) => ai.labelOf(p) : undefined)
  const runPrompt = (id: string) => {
    if (!controller) return
    const input = promptInput(session, id, boxRef.current)
    if (input) void controller.runPrompt(input)
  }
  const runRef = useRef(runPrompt)
  runRef.current = runPrompt

  const canvasProps = useMemo((): AgentCanvasProps | undefined => {
    if (!controller || !agent) return undefined
    return agentCanvasProps({ canvas: agent.canvas } as AgentPanelViewState, controller, {
      promptRun: (id) => agent.promptRuns[id],
      modelLabel: (m) =>
        m && typeof m === "object"
          ? modelLabel(m as { provider: string; model: string }, ai?.clis() ?? [])
          : String(m ?? ""),
      onRunPrompt: (id) => runRef.current(id),
      onStopPrompt: (id) => controller.stopPrompt(id),
      onReviewPlaceholder: () => openAgentTab(),
    })
  }, [controller, agent, ai, openAgentTab])

  const panel =
    controller && ai ? (
      <AgentPanel
        controller={controller}
        fileName={doc ? doc.fileName : session.meta.name}
        clis={ai.clis()}
        onOpenSettings={() => openSettings("ai-providers")}
      />
    ) : null

  return {
    controller,
    panel,
    canvas: canvasProps,
    noteAuthor: mcp.user,
    promptRun: (id) => agent?.promptRuns[id]?.status,
    runPrompt,
    initialAgentTab,
    editingAgent: agent?.editing ?? null,
  }
}

/**
 * The agent's tool host for this window: the document host's (`agentCall`) when the window's
 * document is hosted, else the in-window registry over the window's store.
 */
export function agentToolsFor(
  o: Parameters<typeof createInWindowTools>[0] & {
    hostClient: HostClient | null
    doc: FileDocumentSession | null
  },
): {
  kind: "host" | "in-window"
  factory: ReturnType<typeof createInWindowTools>["factory"]
  docId(): string
  dispose?(): void
} {
  const { hostClient, doc, ...inWindow } = o
  if (hostClient && doc instanceof HostedDocumentSession && doc.hosted) {
    const t = createHostTools({ client: hostClient, ref: doc.ref })
    return { kind: "host", factory: t.factory, docId: t.docId, dispose: t.dispose }
  }
  const t = createInWindowTools(inWindow)
  return { kind: "in-window", factory: t.factory, docId: t.docId }
}

/** The slice of the panel state the canvas / layers / title need (stable between tokens). */
interface AgentSlice {
  canvas: AgentPanelViewState["canvas"]
  promptRuns: AgentPanelViewState["promptRuns"]
  editing: string | null
}

const noSub = () => () => {}

function useAgentSlice(
  controller: AgentPanelControllerExt | null,
  labelOf?: (provider: string) => string,
): AgentSlice | null {
  const cache = useRef<{ key: string; value: AgentSlice } | null>(null)
  return useSyncExternalStore(controller ? (l) => controller.subscribe(l) : noSub, () => {
    if (!controller) return null
    const s = controller.state
    // "<Agent> editing": a local CLI by its name ("Claude Code"), else Kimo's own agent.
    const sel = s.composer.model
    const editing =
      s.busy && s.canvas.live.length
        ? sel?.provider.startsWith("cli:")
          ? (labelOf?.(sel.provider) ?? "Kimo")
          : "Kimo"
        : null
    const key = JSON.stringify([s.canvas, s.promptRuns, editing])
    if (cache.current?.key !== key)
      cache.current = { key, value: { canvas: s.canvas, promptRuns: s.promptRuns, editing } }
    return cache.current.value
  })
}

/** The document side of a prompt-node run (`PromptRunInput`). */
function promptInput(session: FileSession, id: string, boxOf: (id: string) => Box | null) {
  const n = session.store.getNode(id) as Record<string, unknown> | undefined
  if (n?.type !== "prompt") return null
  const box = boxOf(id) ?? { x: 0, y: 0, w: 0, h: 0 }
  const prompt: PromptNodeView = {
    id,
    content: str(n.content) ?? "",
    box,
    ...(str(n.name) ? { name: str(n.name) } : {}),
    ...(n.model !== undefined ? { model: n.model as PromptNodeView["model"] } : {}),
    ...(str(n.target) ? { target: str(n.target) } : {}),
  }
  const notes: NoteView[] = []
  for (const nid of session.store.nodeIds()) {
    const x = session.store.getNode(nid) as Record<string, unknown> | undefined
    if (x?.type !== "note") continue
    notes.push({
      id: nid,
      content: str(x.content) ?? "",
      ...(str(x.author) ? { author: str(x.author) } : {}),
      parent: str(x.parent) ?? null,
      box: boxOf(nid) ?? { x: 0, y: 0, w: 0, h: 0 },
    })
  }
  return {
    prompt,
    notes,
    frame: (fid: string) => {
      const f = session.store.getNode(fid) as Record<string, unknown> | undefined
      const b = f?.type === "frame" ? boxOf(fid) : null
      return b ? { id: fid, ...(str(f?.name) ? { name: str(f?.name) } : {}), box: b } : null
    },
  }
}
