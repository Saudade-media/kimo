//! Relay setup commands (board 42), `TAURI_RELAY_COMMANDS` in packages/platform/src/relay-host.ts
//! and mirrored in `command_list_relay.rs`. The work is in [`crate::relay_host`].

use crate::error::{blocked, io_msg, R};
use crate::relay_host::{ProcInfo, ProcKind, RelayHost, ToolInfo};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

fn host(app: &AppHandle) -> R<Arc<RelayHost>> {
    service(app).ok_or_else(|| blocked("The relay setup is not available"))
}

pub fn service<Rt: Runtime>(app: &AppHandle<Rt>) -> Option<Arc<RelayHost>> {
    app.try_state::<Arc<RelayHost>>().map(|s| s.inner().clone())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| io_msg(format!("Task failed: {e}")))?
}

/// Relay output goes to every window: Settings and the Share popover show a relay the wizard
/// started in another window.
struct BroadcastSink<Rt: Runtime>(AppHandle<Rt>);

impl<Rt: Runtime> crate::ai::EventSink for BroadcastSink<Rt> {
    fn emit(&self, event: &str, payload: Value) {
        let _ = self.0.emit(event, payload);
    }
}

/// ADR 0017: the device key's PKCS#8 (base64url), or None before the first use. Every window
/// and the document host read it; the web app imports it as a non-extractable key.
#[tauri::command]
pub async fn kimo_device_key_get(app: AppHandle) -> R<Option<String>> {
    let h = host(&app)?;
    blocking(move || h.device_key_get()).await
}

/// Stores the device key made on first use; a key already stored is kept.
#[tauri::command]
pub async fn kimo_device_key_set(app: AppHandle, value: String) -> R<()> {
    let h = host(&app)?;
    blocking(move || h.device_key_set(&value)).await
}

#[tauri::command]
pub async fn kimo_relay_find_tool(app: AppHandle, tool: String) -> R<Option<ToolInfo>> {
    let h = host(&app)?;
    blocking(move || h.find_tool(&tool)).await
}

#[tauri::command]
pub async fn kimo_relay_port_free(port: u16) -> R<bool> {
    blocking(move || Ok(RelayHost::port_free(port))).await
}

#[tauri::command]
pub async fn kimo_relay_lan_address() -> R<Option<String>> {
    blocking(|| Ok(RelayHost::lan_address())).await
}

/// The Fly.io region nearest this computer: the `fly-region` header of Fly's debug app (the
/// edge that answered). Null when it does not answer within 4 s.
#[tauri::command]
pub async fn kimo_relay_fly_region() -> R<Option<String>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| io_msg(format!("HTTP client: {e}")))?;
    let Ok(res) = client.head("https://debug.fly.dev").send().await else {
        return Ok(None);
    };
    Ok(res
        .headers()
        .get("fly-region")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| s.len() == 3 && s.bytes().all(|c| c.is_ascii_lowercase())))
}

#[tauri::command]
pub async fn kimo_relay_cloudflared_logged_in(app: AppHandle) -> R<bool> {
    Ok(host(&app)?.cloudflared_logged_in())
}

#[tauri::command]
pub async fn kimo_relay_write_fly_config(app: AppHandle, content: String) -> R<String> {
    let h = host(&app)?;
    blocking(move || h.write_fly_config(&content)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnedRelayProc {
    proc_id: String,
}

#[tauri::command]
pub async fn kimo_relay_spawn(
    app: AppHandle,
    kind: ProcKind,
    args: Vec<String>,
    env: HashMap<String, String>,
    stdin: Option<String>,
) -> R<SpawnedRelayProc> {
    let h = host(&app)?;
    let sink: Arc<dyn crate::ai::EventSink> = Arc::new(BroadcastSink(app.clone()));
    blocking(move || {
        h.spawn(kind, &args, &env, stdin.as_deref(), sink)
            .map(|proc_id| SpawnedRelayProc { proc_id })
    })
    .await
}

#[tauri::command]
pub async fn kimo_relay_kill(app: AppHandle, proc_id: String) -> R<()> {
    host(&app)?.kill(&proc_id)
}

#[tauri::command]
pub async fn kimo_relay_running(app: AppHandle) -> R<Vec<ProcInfo>> {
    Ok(host(&app)?.running())
}
