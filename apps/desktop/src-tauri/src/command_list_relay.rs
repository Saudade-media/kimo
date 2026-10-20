// The relay setup surface (board 42), mirrored from `TAURI_RELAY_COMMANDS`
// (packages/platform/src/relay-host.ts). Kept apart from the frozen `COMMANDS`; shared by
// `build.rs` (app manifest permissions) and the parity test in `lib.rs`. Keep the TS order.
pub const RELAY_COMMANDS: &[&str] = &[
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
];
