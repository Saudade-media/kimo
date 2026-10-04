/**
 * @kimo/desktop — the Tauri v2 shell. The Rust side (`src-tauri/`) implements the command
 * surface of `@kimo/platform/tauri` (ADR 0012 §5); this entry wires `@tauri-apps/api` into
 * `createTauriPlatform()` so the web app gets a `KimoPlatform` without importing Tauri itself.
 */
import {
  type CliProcessHostLike,
  createRelayFetch,
  createTauriCliHost,
  createTauriPlatform,
  createTauriSecrets,
  type InvokeLike,
  type KimoPlatform,
  type ListenLike,
  PlatformError,
  type PlatformErrorCode,
  type RelayRoute,
  type SecretsApi,
  type TauriBridge,
} from "@kimo/platform"
import type { TypedInvoke, TypedListen } from "@kimo/platform/tauri"

/** Bundle identifier, mirrored from `src-tauri/tauri.conf.json`. */
export const APP_IDENTIFIER = "dev.kimo.app"

/** File extensions the desktop app registers as the default handler for. */
export const KIMO_FILE_EXTENSIONS = ["kimo", "kimoz"] as const

/** @deprecated Use {@link KIMO_FILE_EXTENSIONS}. */
export const KIMO_FILE_EXTENSION = "kimo"

/** True inside the Tauri webview. */
export function isTauri(): boolean {
  return typeof globalThis === "object" && "__TAURI_INTERNALS__" in globalThis
}

/**
 * The desktop {@link KimoPlatform}. Events are listened to on the current webview window, so
 * window-targeted events (`kimo://close-requested`, watch events) never reach other windows,
 * while broadcasts (`kimo://settings-changed`) reach all of them.
 */
export async function createDesktopPlatform(): Promise<KimoPlatform> {
  const [{ invoke }, { getCurrentWebviewWindow }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/webviewWindow"),
  ])
  const win = getCurrentWebviewWindow()
  const bridge: TauriBridge = {
    invoke: ((command: string, args: Record<string, unknown>) =>
      invoke(command, args)) as unknown as TypedInvoke,
    listen: ((event: string, handler: (payload: unknown) => void) =>
      win.listen(event, (e) => handler(e.payload))) as unknown as TypedListen,
  }
  return createTauriPlatform(bridge)
}

/** M6 desktop services (ADR 0014 §4, §11) over the `kimo_secret_*`, `kimo_ai_*` and
 * `kimo_cli_*` commands. Keys stay in the OS keychain: `relayFetch` is the adapters' `fetch`,
 * and Rust injects the key. Events are listened to on the current window (Rust emits the
 * relay and CLI streams to the window that started them). */
export interface DesktopAgentServices {
  secrets: SecretsApi
  relayFetch(route: RelayRoute): typeof fetch
  cliHost: CliProcessHostLike
}

/** Rethrows a command rejection (`PlatformErrorPayload`) as a {@link PlatformError}. */
function rethrow(e: unknown): never {
  if (e instanceof PlatformError) throw e
  if (e && typeof e === "object" && "code" in e) {
    const p = e as { code: unknown; message?: unknown; errno?: unknown }
    throw new PlatformError(
      String(p.code) as PlatformErrorCode,
      typeof p.message === "string" ? p.message : String(p.code),
      { ...(typeof p.errno === "string" ? { errno: p.errno } : {}), cause: e },
    )
  }
  throw new PlatformError("IO", typeof e === "string" ? e : String(e), { cause: e })
}

export async function createDesktopAgentServices(): Promise<DesktopAgentServices> {
  const [{ invoke }, { getCurrentWebviewWindow }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/webviewWindow"),
  ])
  const win = getCurrentWebviewWindow()
  const bridge: { invoke: InvokeLike; listen: ListenLike } = {
    invoke: (cmd, args) => invoke(cmd, args).catch(rethrow),
    listen: (event, handler) => win.listen(event, (e) => handler(e.payload)),
  }
  return {
    secrets: createTauriSecrets(bridge.invoke),
    relayFetch: (route) => createRelayFetch(bridge, route),
    cliHost: createTauriCliHost(bridge),
  }
}
