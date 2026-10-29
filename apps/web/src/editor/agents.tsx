/**
 * Board 21 "Agents & MCP" in the editor window (apps/web/src/agents/INTEGRATION.md): one
 * `AgentsController` per window over `platform.mcp`, plus the document host hooks
 * (host/INTEGRATION.md): kimo_focus → select / zoom, view reports for kimo_get_state
 * `selection` and `target` (#78). Only files on disk with an MCP host get agents (desktop,
 * memory harnesses); untitled documents have no path, so no agent can target them. A room joined
 * from a share link is an MCP document too (#79): focus and view reports use its room key. Every
 * editor still reports what it shows (library files with no ref), so the host never mistakes
 * another tab for the one in front.
 */
import type { LayoutResult } from "@kimo/layout"
import { isPlatformError, type KimoPlatform, sha256Hex } from "@kimo/platform"
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  AgentActivityPanel,
  AgentCanvasLayer,
  AgentPausedBanner,
  AgentStack,
  type AgentStackSlot,
  type AgentsControllerExt,
  type AgentsNotice,
  createAgentsController,
} from "../agents"
import type { CanvasHandle } from "../canvas/contract"
import type { HostClient } from "../host/client"
import { type Bus, createBus } from "../lib/hooks"
import { roomKeyOf } from "../multiplayer/backend"
import type { FileDocumentSession, FileSessionManager } from "../platform/session"
import { failureText } from "./errors"
import type { FileSession } from "./session"

/** `sha256(path)[:16]`: the activity / lease / recovery key of a file (ADR 0013 §6). */
export function useFileId(path: string | null): string | null {
  const [id, setId] = useState<{ path: string; id: string } | null>(null)
  useEffect(() => {
    if (!path) return
    let live = true
    void sha256Hex(path).then((h) => {
      if (live) setId({ path, id: h.slice(0, 16) })
    })
    return () => {
      live = false
    }
  }, [path])
  return path && id?.path === path ? id.id : null
}

interface EditorAgents {
  controller: AgentsControllerExt | null
  /**
   * Board 48: the right card's avatar stack with this window's agents; `render` draws the stack
   * and Share given them (no agents without an MCP host).
   */
  stack(render: (slot: AgentStackSlot) => ReactNode): ReactNode
  /** Under the topbar, with the other file banners. */
  banner: ReactNode
  /** Inside the canvas host, above the canvas, below the selection UI. */
  canvasLayer: ReactNode
  /** Right panel 4th tab body (null: no tab). */
  activity: ReactNode
  /** Bumped to open the Activity tab. */
  openActivity: Bus<number>
}

const NONE: ReadonlySet<string> = new Set()

export function useEditorAgents({
  platform,
  hostClient,
  manager,
  session,
  doc,
  canvas,
  container,
  layout,
  openSettings,
  onSaveCopy,
  onError,
}: {
  platform: KimoPlatform
  hostClient: HostClient | null
  /** A closing window reports its tab gone (React cleanup does not run when it closes). */
  manager: Pick<FileSessionManager, "addCloseHook">
  session: FileSession
  doc: FileDocumentSession | null
  canvas: { current: CanvasHandle | null }
  /** The canvas element: its size gives the view rectangle the host reports (#78). */
  container: { current: HTMLElement | null }
  layout: Bus<LayoutResult | null>
  openSettings: (client?: string) => void
  onSaveCopy?: () => void
  /** A failed agent action or export: Toast/Danger ("Couldn't …" + the cause). */
  onError: (notice: AgentsNotice) => void
}): EditorAgents {
  const path = doc && !doc.untitled ? doc.ref : null
  /** The document's ref in the host: a file's path, or a joined room's key. */
  const hostRef = path ?? (session.shared ? roomKeyOf(session.shared.room) : null)
  const fileId = useFileId(path)
  const mcp = platform.mcp ?? null
  const openActivity = useMemo(() => createBus(0), [])
  // Stable across renders so the controller is not rebuilt when the caller's closure changes.
  const errorRef = useRef(onError)
  errorRef.current = onError
  const focus = useMemo(
    () => (ids: readonly string[]) => {
      if (ids.length === 0) return
      session.ui.getState().select(ids)
      canvas.current?.zoomToFit(ids, 96)
    },
    [session, canvas],
  )
  const controller = useMemo(
    () =>
      mcp && path && fileId
        ? createAgentsController({
            host: mcp,
            fileId,
            filePath: path,
            store: session.store,
            onFocus: (ids) => focus(ids),
            onError: (n) => errorRef.current(n),
          })
        : null,
    [mcp, path, fileId, session.store, focus],
  )
  useEffect(() => () => controller?.dispose(), [controller])

  // kimo_focus: select and/or zoom in the window that shows the file. Its selection is the
  // agent's, never the person pointing at a frame (#78).
  const agentSelecting = useRef(false)
  useEffect(() => {
    if (!hostClient || !hostRef) return
    return hostClient.onFocus(({ ref, ids, select, zoom }) => {
      if (ref !== hostRef) return
      if (select) {
        agentSelecting.current = true
        try {
          session.ui.getState().select(ids)
        } finally {
          agentSelecting.current = false
        }
      }
      if (zoom === "fit") canvas.current?.zoomToFit(ids, 96)
      else if (zoom === "100") canvas.current?.zoomTo(1)
    })
  }, [hostClient, hostRef, session, canvas])

  // #78: what this tab shows (kimo_get_state `selection` and `target`). Reported on mount
  // (the tab is active), on a selection change (150 ms), on a page change or when a pan or
  // zoom ends (300 ms), on window focus gain, and `active: false` on unmount or window close.
  const kind = session.shared ? "room" : doc ? "disk" : "library"
  useEffect(() => {
    if (!hostClient) return
    let by: "person" | "agent" = "person"
    let focused = typeof document !== "undefined" && document.hasFocus()
    const rect = () => {
      const v = session.ui.getState().viewport
      const el = container.current
      // Before the first layout the canvas has no size: no view yet, not an empty one.
      if (!el || !(v.zoom > 0) || el.clientWidth <= 0 || el.clientHeight <= 0) return null
      return { x: v.x, y: v.y, w: el.clientWidth / v.zoom, h: el.clientHeight / v.zoom }
    }
    const send = (active = true) => {
      const s = session.ui.getState()
      hostClient.reportView(hostRef, {
        kind,
        active,
        focused,
        selection: s.selection,
        selectionBy: by,
        page: s.page,
        view: rect(),
      })
    }
    send()
    let selectionTimer: ReturnType<typeof setTimeout> | undefined
    let viewTimer: ReturnType<typeof setTimeout> | undefined
    const off = session.ui.subscribe((s, prev) => {
      if (s.selection !== prev.selection) {
        by = agentSelecting.current ? "agent" : "person"
        clearTimeout(selectionTimer)
        selectionTimer = setTimeout(send, 150)
      }
      if (s.page !== prev.page || s.viewport !== prev.viewport) {
        clearTimeout(viewTimer)
        viewTimer = setTimeout(send, 300)
      }
    })
    const offFocus = platform.window.onFocusChange((f) => {
      focused = f
      send()
    })
    // A window that stays open after all (a save failed) reports again on its next change.
    const offClose = manager.addCloseHook(() => send(false))
    return () => {
      clearTimeout(selectionTimer)
      clearTimeout(viewTimer)
      off()
      offFocus()
      offClose()
      send(false)
    }
  }, [hostClient, hostRef, kind, session, platform, container, manager])

  if (!controller || !fileId)
    return {
      controller: null,
      stack: (render) => <AgentStack controller={null}>{render}</AgentStack>,
      banner: null,
      canvasLayer: null,
      activity: null,
      openActivity,
    }
  return {
    controller,
    stack: (render) => (
      <AgentStack
        controller={controller}
        onShowOnCanvas={focus}
        onOpenClientSettings={(client) => openSettings(client)}
      >
        {render}
      </AgentStack>
    ),
    banner: (
      <AgentPausedBanner
        controller={controller}
        onShowOps={() => openActivity.set(openActivity.get() + 1)}
        {...(onSaveCopy ? { onSaveCopy } : {})}
      />
    ),
    canvasLayer: <AgentCanvasHost controller={controller} session={session} layout={layout} />,
    activity: (
      <AgentActivityPanel
        controller={controller}
        fileId={fileId}
        onHighlight={(ids) => controller.setHighlight(ids)}
        onConnectAgent={() => openSettings()}
        onExport={(json, name) => {
          // WKWebView ignores anchor downloads: the platform saves the file (or downloads it).
          platform.files
            .download(name, new TextEncoder().encode(json), "application/json")
            .catch((e: unknown) => {
              // Cancel in the save dialog is the user's choice, not a failure.
              if (isPlatformError(e, "CANCELLED")) return
              errorRef.current({ text: failureText("export the activity log", e) })
            })
        }}
      />
    ),
    openActivity,
  }
}

const noSubscribe = () => () => {}

/** Origins of the MCP clients connected now (stable while the set does not change). */
export function useConnectedOrigins(controller: AgentsControllerExt | null): ReadonlySet<string> {
  const cache = useRef<ReadonlySet<string>>(NONE)
  return useSyncExternalStore(controller ? controller.subscribe : noSubscribe, () => {
    const next = controller?.state.connections.map((c) => c.origin) ?? []
    const prev = cache.current
    if (next.length === prev.size && next.every((o) => prev.has(o))) return prev
    cache.current = next.length ? new Set(next) : NONE
    return cache.current
  })
}

/** Board 48 §5: the Agent tab's dot. */
export type AgentTabActivity = "working" | "waiting" | null

/** The part of the Agent tab controller {@link useAgentTabActivity} reads. */
interface AgentMarkSource {
  readonly state: { mark: string }
  subscribe(listener: () => void): () => void
}

/**
 * Board 48 §5: "waiting" while an agent waits for you (the built-in agent's approval, or an MCP
 * client's), else "working" while one works, else null.
 */
export function useAgentTabActivity(
  panel: AgentMarkSource | null,
  mcp: AgentsControllerExt | null,
): AgentTabActivity {
  const subscribe = useMemo(
    () => (listener: () => void) => {
      const offPanel = panel?.subscribe(listener)
      const offMcp = mcp?.subscribe(listener)
      return () => {
        offPanel?.()
        offMcp?.()
      }
    },
    [panel, mcp],
  )
  return useSyncExternalStore(subscribe, () => {
    const mark = panel?.state.mark
    const chips = mcp?.state.chips ?? []
    if (mark === "waiting" || chips.some((c) => c.presence === "waiting")) return "waiting"
    if (mark === "working" || chips.some((c) => c.presence === "editing" && c.state === "editing"))
      return "working"
    return null
  })
}

/** Layer dots: the controller's touched set (stable while it does not change). */
export function useAgentTouched(controller: AgentsControllerExt | null): ReadonlySet<string> {
  return useSyncExternalStore(
    controller ? controller.subscribe : noSubscribe,
    () => controller?.state.touched ?? NONE,
  )
}

/** The canvas layer, re-projected on viewport and layout changes (own subscriptions). */
function AgentCanvasHost({
  controller,
  session,
  layout,
}: {
  controller: AgentsControllerExt
  session: FileSession
  layout: Bus<LayoutResult | null>
}) {
  const viewport = useSyncExternalStore(session.ui.subscribe, () => session.ui.getState().viewport)
  const layoutNow = useSyncExternalStore(layout.subscribe, layout.get)
  return (
    <AgentCanvasLayer
      controller={controller}
      project={(id) => {
        const b = layoutNow?.nodes.get(id)?.world
        if (!b) return null
        const z = viewport.zoom
        const n = session.store.getNode(id) as { radius?: unknown } | undefined
        const r = typeof n?.radius === "number" ? n.radius : 0
        return {
          x: (b.x - viewport.x) * z,
          y: (b.y - viewport.y) * z,
          w: b.w * z,
          h: b.h * z,
          radius: r * z,
        }
      }}
      viewportKey={layoutNow ? `${viewport.zoom}:${viewport.x}:${viewport.y}` : "none"}
      parentOf={(id) => {
        const p = (session.store.getNode(id) as { parent?: unknown } | undefined)?.parent
        return typeof p === "string" && p ? p : null
      }}
      world={(id) => layoutNow?.nodes.get(id)?.world ?? null}
      toLayer={(p) => ({
        x: (p.x - viewport.x) * viewport.zoom,
        y: (p.y - viewport.y) * viewport.zoom,
      })}
    />
  )
}
