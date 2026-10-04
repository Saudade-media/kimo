/**
 * The window's runtime (ADR 0012 §3/§4): one {@link KimoPlatform} and one
 * {@link FileSessionManager} per window, created before the first render.
 *
 * - Inside the Tauri webview: `createDesktopPlatform()` from `@kimo/desktop` (a lazy chunk, so
 *   the web bundle never loads `@tauri-apps/api`).
 * - Everywhere else: `createBrowserPlatform()` (File System Access, IndexedDB, Web Locks).
 * - Tests and harnesses build their own memory platform and never call this.
 */
import { threeWayMerge } from "@kimo/core-schema"
import type { KimoPlatform, OpenRequest, SettingsPane } from "@kimo/platform"
import { createBrowserPlatform } from "@kimo/platform/browser"
import { createContext, useContext } from "react"
import { conflictSessionFactory } from "../conflicts"
import type { HostClient } from "../host/client"
import {
  createSessionManager,
  type FileDocumentSession,
  type FileSessionManager,
  type SessionManagerOptions,
} from "./session"

export interface AppRuntime {
  platform: KimoPlatform
  manager: FileSessionManager
  /** Desktop: this window's document host client (kimo_focus, selection reports, agent undo). */
  hostClient?: HostClient | null
}

/** True inside the Tauri webview (same test as `@kimo/desktop` `isTauri`). */
export function inTauri(): boolean {
  return typeof globalThis === "object" && "__TAURI_INTERNALS__" in globalThis
}

/** The host for this window. */
export async function createAppPlatform(): Promise<KimoPlatform> {
  if (inTauri()) {
    const { createDesktopPlatform } = await import("@kimo/desktop")
    return createDesktopPlatform()
  }
  return createBrowserPlatform()
}

/** Edits a conflict pick could not apply (logged; the shell toasts store rejections itself). */
const onConflictReject = (message: string) => console.warn("Kimo: conflict pick rejected", message)

/**
 * The window's session manager over `platform` (call once per window). With `createSession`
 * (M5 desktop: the document host's factory), sessions are replicas of the host's documents.
 */
export function createAppSessionManager(
  platform: KimoPlatform,
  createSession?: SessionManagerOptions["createSession"],
): FileSessionManager {
  return createSessionManager({
    platform,
    merge: threeWayMerge,
    createConflictSession: conflictSessionFactory({ onReject: onConflictReject }) as never,
    ...(createSession ? { createSession } : {}),
  })
}

/**
 * Creates the runtime, installs flush-before-close and launch requests, and opens the files the
 * window was started with (argv, file association, deep link). `onOpened` navigates to them.
 */
export async function createAppRuntime(
  onOpened: (session: FileDocumentSession, request: OpenRequest) => void,
): Promise<AppRuntime> {
  const platform = await createAppPlatform()
  // Settings drive the theme and autosave: read them before the first render.
  await platform.settings.ready.catch(() => undefined)
  // M5: the hidden document host (`#/host`, ADR 0002 Option A) holds every open document and
  // serves MCP. It renders nothing and never takes launch requests: the promise never settles.
  if (inTauri() && /^#\/host\/?$/.test(location.hash)) {
    const { startHostRoute } = await import("../host")
    await startHostRoute(platform)
    return new Promise<AppRuntime>(() => {})
  }
  // Desktop editor windows are clients of the document host when one answers; otherwise (an
  // older shell, the browser) sessions stay local to the window as in M4.
  let createSession: SessionManagerOptions["createSession"]
  let hostClient: HostClient | null = null
  if (inTauri()) {
    const settingsWindow = /^#\/settings(\/|$)/.test(location.hash)
    const host = await import("../host")
    // The Settings window only needs the host for Agents & MCP (prompts, pause); it waits less.
    const client = await host
      .connectWindowToHost(undefined, settingsWindow ? 3000 : undefined)
      .catch(() => null)
    hostClient = client
    if (client && !settingsWindow) createSession = host.hostedSessionFactory(client)
    // M5: the window's `platform.mcp` (Rust relay + document host).
    const mcp = await host
      .createDesktopMcpHost({ bridge: host.tauriBridge(), client, os: platform.os })
      .catch((e: unknown) => {
        console.warn("Kimo: MCP surface unavailable", e)
        return null
      })
    if (mcp) Object.defineProperty(platform, "mcp", { value: mcp, enumerable: true })
  }
  const manager = createAppSessionManager(platform, createSession)
  // The desktop Settings window (`#/settings/<pane>`) edits settings only: it never opens files.
  if (/^#\/settings(\/|$)/.test(location.hash)) return { platform, manager, hostClient }
  manager.install(onOpened)
  void (async () => {
    const requests = await platform.launch.takeInitialRequests().catch(() => [] as OpenRequest[])
    for (const request of requests) {
      await manager.handleOpenRequest(request).catch((e: unknown) => {
        console.warn("Kimo: could not open", request.refs, e)
      })
      const first = request.refs[0]
      const session = first ? manager.get(first) : undefined
      if (session) onOpened(session, request)
    }
  })()
  return { platform, manager, hostClient }
}

export const RuntimeContext = createContext<AppRuntime | null>(null)

/** The window's runtime (provided by `main.tsx`). */
export function useRuntime(): AppRuntime {
  const r = useContext(RuntimeContext)
  if (!r) throw new Error("Kimo: no runtime (RuntimeContext missing)")
  return r
}

/** The runtime when one is mounted (components shared with harnesses). */
export function useOptionalRuntime(): AppRuntime | null {
  return useContext(RuntimeContext)
}

/** Opens Settings (desktop: its window; web: the in-app dialog the App root hosts). */
export const SettingsOpenerContext = createContext<(pane?: SettingsPane) => void>(() => {})

export function useOpenSettings(): (pane?: SettingsPane) => void {
  return useContext(SettingsOpenerContext)
}
