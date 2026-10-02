/**
 * @kimo/desktop — the Tauri v2 shell lives in `src-tauri/` (Rust). This TS
 * entry exists so the workspace typecheck stays valid; desktop-specific JS
 * bridges (fs, dialog, deep links) land here at M4.
 */

/** Bundle identifier, mirrored from `src-tauri/tauri.conf.json`. */
export const APP_IDENTIFIER = "dev.kimo.app"

/** File extension the desktop app registers as the default handler for. */
export const KIMO_FILE_EXTENSION = "kimo"
