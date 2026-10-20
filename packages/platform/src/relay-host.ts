/**
 * Board 42 relay setup: the desktop commands and events behind the wizard's one-click parts
 * (apps/desktop/src-tauri/src/relay_host.rs, mirrored in `command_list_relay.rs`). The web app
 * wraps them (apps/web/src/multiplayer/relay-setup/host.ts); a browser has none of them.
 * Kept out of `TAURI_COMMANDS` (frozen by ADR 0012), like the M5 and M6 surfaces.
 */
export const TAURI_RELAY_COMMANDS = [
  "kimo_relay_secret_get",
  "kimo_relay_secret_set",
  "kimo_relay_secret_delete",
  "kimo_relay_find_tool",
  "kimo_relay_port_free",
  "kimo_relay_lan_address",
  "kimo_relay_fly_region",
  "kimo_relay_cloudflared_logged_in",
  "kimo_relay_write_fly_config",
  "kimo_relay_spawn",
  "kimo_relay_kill",
  "kimo_relay_running",
] as const

export type TauriRelayCommand = (typeof TAURI_RELAY_COMMANDS)[number]

export const TAURI_RELAY_EVENTS = ["kimo://relay-output", "kimo://relay-exit"] as const
