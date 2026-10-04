// The M5 MCP command surface (ADR 0013 §11), mirrored from `TAURI_MCP_COMMANDS` in
// `packages/platform/src/mcp.ts`. Kept apart from the frozen `COMMANDS` list; shared by
// `build.rs` (app manifest permissions) and the parity test in `lib.rs`. Keep the TS order.
pub const MCP_COMMANDS: &[&str] = &[
    "kimo_mcp_status",
    "kimo_mcp_connections",
    "kimo_mcp_disconnect",
    "kimo_mcp_send",
    "kimo_mcp_http_respond",
    "kimo_mcp_host_ready",
    "kimo_mcp_http_set_enabled",
    "kimo_mcp_http_token_rotate",
    "kimo_mcp_config_read",
    "kimo_mcp_config_write",
    "kimo_mcp_activity_append",
    "kimo_mcp_activity_read",
    "kimo_mcp_policies_get",
    "kimo_mcp_policies_set",
    "kimo_mcp_server_start",
    "kimo_mcp_server_stop",
    "kimo_mcp_server_restart",
    "kimo_mcp_server_settings_get",
    "kimo_mcp_server_settings_set",
    "kimo_mcp_port_check",
    "kimo_mcp_http_token_get",
    "kimo_mcp_log_info",
    "kimo_mcp_log_reveal",
    "kimo_mcp_scope_allow",
];

/// Commands only the hidden document host may call (the relay's host side).
pub const MCP_HOST_ONLY_COMMANDS: &[&str] = &[
    "kimo_mcp_send",
    "kimo_mcp_http_respond",
    "kimo_mcp_host_ready",
    "kimo_mcp_scope_allow",
];
