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
import webPackage from "../../package.json"
import { conflictSessionFactory } from "../conflicts"
import type { HostClient } from "../host/client"
import { joinPath } from "../join/link"
import {
  type CloudLink,
  cloudLinkFromLocation,
  isCloudDeepLink,
  parseCloudDeepLink,
} from "../multiplayer/cloud/links"
import type { WorkspaceStore } from "../multiplayer/cloud/workspaces"
import type { LibraryShare } from "../multiplayer/library"
import type { MultiplayerModel } from "../multiplayer/model"
import { createWindowMultiplayer } from "../multiplayer/window"
import { isPairDeepLink, pairPath } from "../pair/link"
import { windowTabs } from "../tabs/controller"
import { takeLastWindow } from "./last-files"
import {
  createSessionManager,
  type FileDocumentSession,
  type FileSessionManager,
  type SessionManagerOptions,
} from "./session"

export interface AppRuntime {
  platform: KimoPlatform
  manager: FileSessionManager
  /**
   * Desktop: this window's document host client (kimo_focus, selection reports, agent undo).
   * Editor windows render before the host answers: it is set (with `platform.mcp`) before the
   * first open resolves, so the editor, which mounts on an open session, always sees it.
   */
  hostClient?: HostClient | null
  /** Multiplayer view model (board 41): share state, people, links, join, settings. */
  multiplayer?: MultiplayerModel
  /** Sharing of browser library files (`#/file/:id`): the editor registers the open file. */
  libraryShare?: LibraryShare
  /** Kimo Cloud workspaces (ADR 0019); null or absent when Kimo Cloud is hidden. */
  workspaces?: WorkspaceStore | null
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
  // The web build reports the release it was built from (the desktop host reads Tauri's).
  return createBrowserPlatform({ appVersion: webPackage.version })
}

/** Edits a conflict pick could not apply (logged; the shell toasts store rejections itself). */
const onConflictReject = (message: string) => console.warn("Kimo: conflict pick rejected", message)

/**
 * The window's session manager over `platform` (call once per window). With `createSession`
 * (M5 desktop: the document host's factory), sessions are replicas of the host's documents.
 */
function createAppSessionManager(
  platform: KimoPlatform,
  createSession?: SessionManagerOptions["createSession"],
  sessionFactory?: SessionManagerOptions["sessionFactory"],
): FileSessionManager {
  return createSessionManager({
    platform,
    merge: threeWayMerge,
    createConflictSession: conflictSessionFactory({ onReject: onConflictReject }) as never,
    ...(createSession ? { createSession } : {}),
    ...(sessionFactory ? { sessionFactory } : {}),
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
  if (!inTauri()) {
    const manager = createAppSessionManager(platform)
    const { model, library, workspaces } = createWindowMultiplayer({ platform, manager })
    return finishRuntime(
      { platform, manager, multiplayer: model, libraryShare: library, workspaces },
      onOpened,
    )
  }
  const host = await import("../host")
  // M5: the window's `platform.mcp` (Rust relay + document host).
  const attach = async (client: HostClient | null) => {
    const mcp = await host
      .createDesktopMcpHost({ bridge: host.tauriBridge(), client, os: platform.os })
      .catch((e: unknown) => {
        console.warn("Kimo: MCP surface unavailable", e)
        return null
      })
    if (mcp) Object.defineProperty(platform, "mcp", { value: mcp, enumerable: true })
  }
  // The Settings window only needs the host for Agents & MCP (prompts, pause): it waits (less)
  // before its first render and never opens files.
  if (settingsRoute()) {
    const hostClient = await host.connectWindowToHost(undefined, 3000).catch(() => null)
    await attach(hostClient)
    const manager = createAppSessionManager(platform)
    // Settings › Multiplayer only reads settings and tests relays: no share backend is needed.
    const { model } = createWindowMultiplayer({
      platform,
      manager,
      hostBackend: async (local) =>
        hostClient ? host.createHostShareBackend(hostClient, { local }) : null,
    })
    return { platform, manager, hostClient, multiplayer: model }
  }
  // Editor windows render right away (the host webview starts in parallel and may still be
  // loading). Opens wait for the host's answer, so files go to the host-backed session whenever
  // a host runs (ADR 0002 Option A, ADR 0013 §12 item 2); the editor only mounts after an open.
  const factory: SessionManagerOptions["sessionFactory"] = host
    .connectWindowToHost()
    .catch(() => null)
    .then(async (client) => {
      runtime.hostClient = client
      await attach(client)
      return client ? host.hostedSessionFactory(client) : undefined
    })
  const manager = createAppSessionManager(platform, undefined, factory)
  const { model, library, workspaces } = createWindowMultiplayer({
    platform,
    manager,
    hostBackend: async (local) => {
      await factory
      const client = runtime.hostClient
      return client ? host.createHostShareBackend(client, { local }) : null
    },
  })
  const runtime: AppRuntime = {
    platform,
    manager,
    hostClient: null,
    multiplayer: model,
    libraryShare: library,
    workspaces,
  }
  return finishRuntime(runtime, onOpened)
}

/**
 * A Kimo Cloud link reached the app: an invite opens its "Join <workspace>?" state, a transfer or
 * the sign-in page's Open Kimo refreshes the account (the workspace summary names a transfer).
 * The workspace store holds the result for the UI (`multiplayer/cloud/README.md`).
 */
function openCloudLink(workspaces: WorkspaceStore | null | undefined, link: CloudLink | null) {
  if (!workspaces || !link) return
  if (link.action === "invite") void workspaces.openInviteLink(link.token)
  else void workspaces.openTransferLink().catch(() => undefined)
}

function settingsRoute(): boolean {
  return /^#\/settings(\/|$)/.test(location.hash)
}

/** Installs launch requests and opens the files the window was started with. */
function finishRuntime(
  runtime: AppRuntime,
  onOpened: (session: FileDocumentSession, request: OpenRequest) => void,
): AppRuntime {
  const { platform, manager } = runtime
  // The desktop Settings window (`#/settings/<pane>`) edits settings only: it never opens files.
  if (settingsRoute()) return runtime
  manager.install(onOpened)
  // Board 41 section 5: a `kimo://join#...` link (running app) opens the join route, and a
  // `kimo://pair#...` link the pairing route (ADR 0017).
  const linkRoute = (link: string) => (isPairDeepLink(link) ? pairPath(link) : joinPath(link))
  const openLink = (link: string) => {
    if (isCloudDeepLink(link)) openCloudLink(runtime.workspaces, parseCloudDeepLink(link))
    else location.hash = `#${linkRoute(link)}`
  }
  platform.launch.onOpenRequest((request) => {
    if (request.join) openLink(request.join)
  })
  // Web: an invite opened at `<app>/invite#<token>`. The token leaves the address bar at once.
  if (platform.kind === "browser") {
    const link = cloudLinkFromLocation(location)
    if (link) {
      history.replaceState(null, "", `${new URL(".", location.href).href}#/`)
      openCloudLink(runtime.workspaces, link)
    }
  }
  void (async () => {
    const requests = await platform.launch.takeInitialRequests().catch(() => [] as OpenRequest[])
    // General › On launch: with nothing else to open, the main window reopens the tabs that were
    // open when Kimo quit, in order, the focused one in front (board 44 §5 "Restore"; desktop,
    // the web keeps the open file in the URL). Only the focused file opens now; the others open
    // when their tab is shown.
    const last =
      platform.kind !== "browser" && platform.window.label === "main" ? takeLastWindow() : null
    if (
      !requests.length &&
      platform.window.label === "main" &&
      platform.settings.get("general.onLaunch") === "last-files" &&
      last &&
      /^#?\/?$/.test(location.hash)
    ) {
      windowTabs().seed(last.tabs)
      if (last.active) requests.push({ source: "argv", refs: [last.active] })
    }
    for (const request of requests) {
      if (request.join) {
        openLink(request.join)
        continue
      }
      await manager.handleOpenRequest(request).catch((e: unknown) => {
        console.warn("Kimo: could not open", request.refs, e)
      })
      const first = request.refs[0]
      const session = first ? manager.get(first) : undefined
      if (session) onOpened(session, request)
    }
  })()
  return runtime
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
/** Opens Settings at `pane`; `focus` is an MCP client to expand or `usage` (AI providers). */
export type SettingsOpener = (pane?: SettingsPane, focus?: string | null) => void

export const SettingsOpenerContext = createContext<SettingsOpener>(() => {})

export function useOpenSettings(): SettingsOpener {
  return useContext(SettingsOpenerContext)
}
