/**
 * Board 21 "Agents & MCP" in the editor window (apps/web/src/agents/INTEGRATION.md): one
 * `AgentsController` per window over `platform.mcp`, plus the document host hooks
 * (host/INTEGRATION.md): kimo_focus → select / zoom, selection reports for
 * `kimo_get_state.selection`. Only files on disk with an MCP host get agents (desktop, memory
 * harnesses); untitled documents have no path, so no agent can target them.
 */
import type { LayoutResult } from "@kimo/layout"
import { type KimoPlatform, sha256Hex } from "@kimo/platform"
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import {
  AgentActivityPanel,
  AgentCanvasLayer,
  AgentPausedBanner,
  AgentPresence,
  type AgentsControllerExt,
  createAgentsController,
} from "../agents"
import type { CanvasHandle } from "../canvas/contract"
import type { HostClient } from "../host/client"
import { type Bus, createBus } from "../lib/hooks"
import type { FileDocumentSession } from "../platform/session"
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

export interface EditorAgents {
  controller: AgentsControllerExt | null
  /** Topbar drag region (before Save Status). */
  presence: ReactNode
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
  session,
  doc,
  canvas,
  layout,
  openSettings,
  onSaveCopy,
}: {
  platform: KimoPlatform
  hostClient: HostClient | null
  session: FileSession
  doc: FileDocumentSession | null
  canvas: { current: CanvasHandle | null }
  layout: Bus<LayoutResult | null>
  openSettings: (client?: string) => void
  onSaveCopy?: () => void
}): EditorAgents {
  const path = doc && !doc.untitled ? doc.ref : null
  const fileId = useFileId(path)
  const mcp = platform.mcp ?? null
  const openActivity = useMemo(() => createBus(0), [])
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
          })
        : null,
    [mcp, path, fileId, session.store, focus],
  )
  useEffect(() => () => controller?.dispose(), [controller])

  // kimo_focus: select and/or zoom in the window that shows the file.
  useEffect(() => {
    if (!hostClient || !path) return
    return hostClient.onFocus(({ ref, ids, select, zoom }) => {
      if (ref !== path) return
      if (select) session.ui.getState().select(ids)
      if (zoom === "fit") canvas.current?.zoomToFit(ids, 96)
      else if (zoom === "100") canvas.current?.zoomTo(1)
    })
  }, [hostClient, path, session, canvas])

  // kimo_get_state.selection: report the selection (debounced) while it changes.
  useEffect(() => {
    if (!hostClient || !path) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = session.ui.getState().selection
    hostClient.reportSelection(path, last)
    const off = session.ui.subscribe((s) => {
      if (s.selection === last) return
      last = s.selection
      clearTimeout(timer)
      timer = setTimeout(() => hostClient.reportSelection(path, last), 150)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [hostClient, path, session])

  if (!controller || !fileId)
    return {
      controller: null,
      presence: null,
      banner: null,
      canvasLayer: null,
      activity: null,
      openActivity,
    }
  return {
    controller,
    presence: (
      <AgentPresence
        controller={controller}
        onShowOnCanvas={focus}
        onOpenClientSettings={(client) => openSettings(client)}
      />
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
        onHighlight={(ids) => session.ui.getState().setHovered(ids?.[0] ?? null)}
      />
    ),
    openActivity,
  }
}

const noSubscribe = () => () => {}

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
    />
  )
}
