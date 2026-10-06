/**
 * M5 document host (ADR 0002 Option A, ADR 0012 §2, ADR 0013 §7, §12 item 2). Mount points:
 *
 * - `#/host` (hidden `document-host` webview): {@link startHostRoute} — holds every open
 *   document, serves relayed MCP connections; renders no UI.
 * - Editor windows: {@link connectWindowToHost} (called by `createAppRuntime` in Tauri), then
 *   sessions are {@link HostedDocumentSession}s; {@link getHostClient} gives the editor
 *   `onFocus` (kimo_focus) and `reportSelection`. See INTEGRATION.md.
 */
import type { KimoPlatform } from "@kimo/platform"
import type { FontSource } from "@kimo/renderer"
import { createFontSystem, type FontSystem } from "../fonts/font-system"
import { DEFAULT_SVG_OPTIONS, importSvgAsVectors } from "../svg-import/convert"
import { serveFlushRequests } from "../updater/restart-broadcast"
import { type HostBridge, tauriBridge } from "./bridge"
import { HostClient } from "./client"
import { type DocumentHostService, startDocumentHostService } from "./document-host"

export * from "./bridge"
export * from "./client"
export * from "./document-host"
export * from "./mcp-api"

/** True for the hidden document host's route. */
export function isHostRoute(hash: string): boolean {
  return /^#\/host\/?$/.test(hash)
}

/** The browser CanvasKit raster (bundled wasm URL) for renders in the host webview. */
export const browserScene = {
  createRenderer: async () => {
    const { createRenderer } = await import("@kimo/renderer/browser")
    const r = createRenderer()
    await r.init({ offlineFonts: true })
    return r
  },
}

/** SVG vector import for `kimo_import kind=svg` (the editor's svg-import, board 19). */
export const svgImporter = (
  text: string,
  t: {
    parent: string | null
    x: number
    y: number
    name?: string
    newId: () => string
    colorVariables: Record<string, string>
  },
) => {
  const r = importSvgAsVectors(text, DEFAULT_SVG_OPTIONS, {
    name: t.name ?? "SVG",
    newId: t.newId,
    colorVariables: t.colorVariables,
    at: { x: t.x, y: t.y },
    parent: t.parent,
  })
  return { ops: r.ops, rootId: r.rootId }
}

/** The platform font sources (local → cache → Google per settings) for the host's scene. */
function hostFontSources(platform: KimoPlatform): () => readonly FontSource[] {
  let fonts: FontSystem | null = null
  return () => {
    fonts ??= createFontSystem({ platform })
    return fonts.sources
  }
}

let service: DocumentHostService | null = null

/**
 * Starts the document host in this webview (the `#/host` route). Never calls
 * `kimo_launch_take_initial` and never renders. Resolves with the running service.
 */
export async function startHostRoute(
  platform: KimoPlatform,
  bridge: HostBridge = tauriBridge(),
): Promise<DocumentHostService> {
  service ??= await startDocumentHostService({
    platform,
    bridge,
    version: platform.appVersion,
    svgImport: svgImporter,
    // SVG / PDF exports and renders measure text with the canvas's fonts: bundled, the
    // document's font assets (scene), then the platform's local fonts and font cache (Google
    // is skipped: the host's renderer is offline).
    scene: { ...browserScene, fontSources: hostFontSources(platform) },
  })
  // Settings › Updates › Restart to update: documents open only in the host (an agent opened
  // them, no editor window shows them) are saved before the restart too.
  if (!stopFlushServer) {
    const manager = service.manager
    stopFlushServer = serveFlushRequests("document-host", () => manager.flushAll())
  }
  return service
}

let stopFlushServer: (() => void) | null = null

/** The running host service in this webview (host route only). */
export function getHostService(): DocumentHostService | null {
  return service
}

let client: HostClient | null = null

/** Connects an editor window to the document host; null when none answers (falls back to local sessions). */
export async function connectWindowToHost(
  bridge: HostBridge = tauriBridge(),
  timeoutMs?: number,
): Promise<HostClient | null> {
  client ??= await HostClient.connect(bridge, timeoutMs ?? 10_000)
  return client
}

/** This window's host client, when the window is a host client. */
export function getHostClient(): HostClient | null {
  return client
}
