/**
 * @kimo/desktop — the Tauri v2 shell. The Rust side (`src-tauri/`) implements the command
 * surface of `@kimo/platform/tauri` (ADR 0012 §5); this entry wires `@tauri-apps/api` into
 * `createTauriPlatform()` so the web app gets a `KimoPlatform` without importing Tauri itself.
 */
import { createTauriPlatform, type KimoPlatform, type TauriBridge } from "@kimo/platform"
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
