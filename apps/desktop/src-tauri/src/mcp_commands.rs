//! The 14 `kimo_mcp_*` commands of `TauriMcpCommandMap` (packages/platform/src/mcp.ts). The
//! relay's host side (`kimo_mcp_send`, `kimo_mcp_http_respond`, `kimo_mcp_host_ready`) only
//! answers the `document-host` window; the rest serve the editor UI and Settings › Agents.

use crate::error::{blocked, invalid, io_msg, permission, R};
use crate::mcp::{self, files, McpService, HOST_LABEL};
use base64::Engine;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
use tauri::{AppHandle, WebviewWindow};

fn svc(app: &AppHandle) -> R<Arc<McpService>> {
    mcp::service(app).ok_or_else(|| blocked("The MCP relay is not running"))
}

fn host_only(window: &WebviewWindow) -> R<()> {
    if window.label() != HOST_LABEL {
        return Err(permission(format!(
            "Only the document host may call this (caller: {})",
            window.label()
        )));
    }
    Ok(())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| io_msg(format!("Task failed: {e}")))?
}

#[tauri::command]
pub async fn kimo_mcp_status(app: AppHandle) -> R<Value> {
    Ok(svc(&app)?.hub.status())
}

#[tauri::command]
pub async fn kimo_mcp_connections(app: AppHandle) -> R<Vec<Value>> {
    Ok(svc(&app)?.hub.connections())
}

#[tauri::command]
pub async fn kimo_mcp_disconnect(app: AppHandle, connection_id: String) -> R<()> {
    if svc(&app)?.hub.disconnect(&connection_id) {
        Ok(())
    } else {
        Err(crate::error::PlatformErrorPayload::new(
            "NOT_FOUND",
            format!("No MCP connection {connection_id}"),
        ))
    }
}

#[tauri::command]
pub async fn kimo_mcp_send(
    app: AppHandle,
    window: WebviewWindow,
    connection_id: String,
    message: String,
) -> R<()> {
    host_only(&window)?;
    let s = svc(&app)?;
    s.hub
        .send(&connection_id, message)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn kimo_mcp_http_respond(
    app: AppHandle,
    window: WebviewWindow,
    request_id: String,
    status: Option<u16>,
    headers: Option<BTreeMap<String, String>>,
    chunk_base64: Option<String>,
    end: bool,
) -> R<()> {
    host_only(&window)?;
    let chunk = match chunk_base64 {
        Some(c) => Some(bytes::Bytes::from(
            base64::engine::general_purpose::STANDARD
                .decode(c)
                .map_err(|e| invalid(format!("Bad base64: {e}")))?,
        )),
        None => None,
    };
    let headers = headers.unwrap_or_default().into_iter().collect();
    svc(&app)?
        .hub
        .http_respond(&request_id, status, headers, chunk, end)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn kimo_mcp_host_ready(app: AppHandle, window: WebviewWindow, version: String) -> R<()> {
    host_only(&window)?;
    let _ = version;
    svc(&app)?.hub.host_ready();
    Ok(())
}

#[tauri::command]
pub async fn kimo_mcp_http_set_enabled(app: AppHandle, enabled: bool) -> R<Value> {
    svc(&app)?.set_http_enabled(enabled).await
}

#[tauri::command]
pub async fn kimo_mcp_http_token_rotate(app: AppHandle, client: String) -> R<String> {
    let s = svc(&app)?;
    blocking(move || s.rotate_token(&client)).await
}

#[tauri::command]
pub async fn kimo_mcp_config_read(app: AppHandle, path: String) -> R<Option<String>> {
    let s = svc(&app)?;
    blocking(move || {
        let home = kimo_mcp::paths::home_dir();
        let p = files::checked_config_path(&s.paths, home.as_deref(), &path)?;
        match std::fs::read_to_string(&p) {
            Ok(t) => Ok(Some(t)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(io_msg(format!("Could not read {path}: {e}"))),
        }
    })
    .await
}

#[tauri::command]
pub async fn kimo_mcp_config_write(app: AppHandle, path: String, text: String) -> R<()> {
    let s = svc(&app)?;
    blocking(move || {
        let home = kimo_mcp::paths::home_dir();
        let p = files::checked_config_path(&s.paths, home.as_deref(), &path)?;
        if p.parent() == Some(s.paths.backups().as_path()) {
            files::write_private(&p, text.as_bytes())
        } else {
            crate::fs_ops::write_atomic(&p, text.as_bytes(), true).map(|_| ())
        }
    })
    .await
}

#[tauri::command]
pub async fn kimo_mcp_activity_append(app: AppHandle, file_id: String, entry: Value) -> R<()> {
    let s = svc(&app)?;
    blocking(move || files::activity_append(&s.paths, &file_id, &entry)).await
}

#[tauri::command]
pub async fn kimo_mcp_activity_read(app: AppHandle, file_id: String, limit: f64) -> R<Vec<Value>> {
    let s = svc(&app)?;
    let limit = if limit.is_finite() && limit > 0.0 {
        limit as usize
    } else {
        files::ACTIVITY_KEEP
    };
    blocking(move || files::activity_read(&s.paths, &file_id, limit)).await
}

#[tauri::command]
pub async fn kimo_mcp_policies_get(app: AppHandle) -> R<Map<String, Value>> {
    let s = svc(&app)?;
    blocking(move || Ok(files::read_policies(&s.paths))).await
}

#[tauri::command]
pub async fn kimo_mcp_policies_set(app: AppHandle, client: String, policy: Option<Value>) -> R<()> {
    let s = svc(&app)?;
    blocking(move || files::set_policy(&s.paths, &client, policy.filter(|p| !p.is_null()))).await
}

// --- Server lifecycle and settings (Settings › Agents & MCP) -------------------------------------

#[tauri::command]
pub async fn kimo_mcp_server_start(app: AppHandle) -> R<Value> {
    svc(&app)?.start_server().await
}

#[tauri::command]
pub async fn kimo_mcp_server_stop(app: AppHandle) -> R<Value> {
    svc(&app)?.stop_server().await
}

#[tauri::command]
pub async fn kimo_mcp_server_restart(app: AppHandle) -> R<Value> {
    svc(&app)?.restart_server().await
}

#[tauri::command]
pub async fn kimo_mcp_server_settings_get(app: AppHandle) -> R<Value> {
    Ok(svc(&app)?.settings())
}

#[tauri::command]
pub async fn kimo_mcp_server_settings_set(
    app: AppHandle,
    start_on_launch: Option<bool>,
    http_port: Option<u16>,
) -> R<Value> {
    svc(&app)?.set_settings(start_on_launch, http_port).await
}

#[tauri::command]
pub async fn kimo_mcp_port_check(app: AppHandle, port: u16) -> R<bool> {
    Ok(svc(&app)?.port_free(port).await)
}

#[tauri::command]
pub async fn kimo_mcp_http_token_get(app: AppHandle, client: String) -> R<Option<String>> {
    svc(&app)?.token_of(&client)
}

#[tauri::command]
pub async fn kimo_mcp_log_info(app: AppHandle) -> R<Value> {
    Ok(svc(&app)?.log_info())
}

#[tauri::command]
pub async fn kimo_mcp_log_reveal(app: AppHandle) -> R<()> {
    use tauri_plugin_opener::OpenerExt;
    let s = svc(&app)?;
    let path = files::server_log_path(&s.paths);
    if !path.exists() {
        files::log_append(&s.paths, "log created");
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| io_msg(format!("Could not reveal {}: {e}", path.display())))
}

/// Document host only: widens the fs scope to a path an MCP call was authorized for (the
/// client's file allow-list or the user's approval, ADR 0013 §6) before the host reads, creates,
/// imports or exports it. `allow_file` also admits the parent directory (create / export).
#[tauri::command]
pub async fn kimo_mcp_scope_allow(
    window: WebviewWindow,
    path: String,
    st: tauri::State<'_, Arc<crate::state::AppState>>,
) -> R<()> {
    host_only(&window)?;
    let p = crate::util::clean_abs(&path)?;
    st.scope.allow_file(&p);
    Ok(())
}
