//! The M6 commands (ADR 0014 §4, §11): `TauriSecretsCommandMap` (packages/platform/src/secrets.ts)
//! and `TauriCliCommandMap` (packages/platform/src/cli-agents.ts). Kept out of the frozen
//! `TAURI_COMMANDS`; names mirrored in `command_list_ai.rs`.

use crate::ai::relay::{RelayAuth, RelayRequest};
use crate::ai::{self, secrets, AiServices, WindowSink};
use crate::error::{blocked, invalid, io_msg, R};
use base64::Engine;
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use tauri::{AppHandle, WebviewWindow};

fn svc(app: &AppHandle) -> R<Arc<AiServices>> {
    ai::services(app).ok_or_else(|| blocked("AI services are not running"))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| io_msg(format!("Task failed: {e}")))?
}

fn sink(app: &AppHandle, window: &WebviewWindow) -> Arc<dyn ai::EventSink> {
    Arc::new(WindowSink {
        app: app.clone(),
        label: window.label().to_string(),
    })
}

// --- Secrets ----------------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_secret_has(app: AppHandle, service: String, account: String) -> R<bool> {
    secrets::check_account(&service, &account)?;
    let s = svc(&app)?;
    blocking(move || s.secrets.has(&account)).await
}

#[tauri::command]
pub async fn kimo_secret_set(
    app: AppHandle,
    service: String,
    account: String,
    value: String,
) -> R<()> {
    secrets::check_account(&service, &account)?;
    let s = svc(&app)?;
    blocking(move || {
        s.secrets.set(&account, &value)?;
        // A new key may go to a new endpoint: drop the origin pin.
        s.relay.pins.clear(&account);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn kimo_secret_delete(app: AppHandle, service: String, account: String) -> R<()> {
    secrets::check_account(&service, &account)?;
    let s = svc(&app)?;
    blocking(move || {
        s.secrets.delete(&account)?;
        s.relay.pins.clear(&account);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn kimo_secret_list(app: AppHandle, service: String) -> R<Vec<String>> {
    if service != secrets::SERVICE {
        return Err(invalid(format!("Unknown keychain service \"{service}\"")));
    }
    let s = svc(&app)?;
    blocking(move || s.secrets.list()).await
}

#[tauri::command]
pub async fn kimo_secret_hint(
    app: AppHandle,
    service: String,
    account: String,
) -> R<Option<String>> {
    secrets::check_account(&service, &account)?;
    let s = svc(&app)?;
    blocking(move || s.secrets.hint(&account)).await
}

// --- Relay ------------------------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn kimo_ai_request(
    app: AppHandle,
    window: WebviewWindow,
    request_id: String,
    provider: String,
    method: String,
    url: String,
    headers: Option<BTreeMap<String, String>>,
    body_base64: Option<String>,
    auth: RelayAuth,
) -> R<()> {
    let body = match body_base64 {
        Some(b) => base64::engine::general_purpose::STANDARD
            .decode(b)
            .map_err(|e| invalid(format!("Bad base64 body: {e}")))?,
        None => Vec::new(),
    };
    let s = svc(&app)?;
    s.relay.start(
        RelayRequest {
            request_id,
            provider,
            method,
            url,
            headers: headers.unwrap_or_default(),
            body,
            auth,
        },
        sink(&app, &window),
    )
}

#[tauri::command]
pub async fn kimo_ai_abort(app: AppHandle, request_id: String) -> R<()> {
    svc(&app)?.relay.abort(&request_id);
    Ok(())
}

// --- CLI host -----------------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_cli_which(
    app: AppHandle,
    command: String,
    extra_dirs: Option<Vec<String>>,
) -> R<Option<String>> {
    let s = svc(&app)?;
    blocking(move || s.cli.which(&command, &extra_dirs.unwrap_or_default())).await
}

#[tauri::command]
pub async fn kimo_cli_exec(
    app: AppHandle,
    path: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
    env: Option<HashMap<String, String>>,
) -> R<ai::cli::ExecResult> {
    let s = svc(&app)?;
    blocking(move || {
        s.cli
            .exec(&path, &args, timeout_ms.unwrap_or(5_000), env.as_ref())
    })
    .await
}

#[tauri::command]
pub async fn kimo_cli_home_file_exists(app: AppHandle, rel_path: String) -> R<bool> {
    let s = svc(&app)?;
    blocking(move || s.cli.home_file_exists(&rel_path)).await
}

#[tauri::command]
pub async fn kimo_cli_has_env(app: AppHandle, name: String) -> R<bool> {
    let s = svc(&app)?;
    blocking(move || s.cli.has_env(&name)).await
}

#[derive(Deserialize)]
pub struct WorkspaceFile {
    path: String,
    text: String,
}

#[tauri::command]
pub async fn kimo_cli_prepare_workspace(
    app: AppHandle,
    session: String,
    files: Option<Vec<WorkspaceFile>>,
) -> R<String> {
    let s = svc(&app)?;
    let files: Vec<(String, String)> = files
        .unwrap_or_default()
        .into_iter()
        .map(|f| (f.path, f.text))
        .collect();
    blocking(move || s.cli.prepare_workspace(&session, &files)).await
}

#[tauri::command]
pub async fn kimo_cli_spawn(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
    args: Vec<String>,
    cwd: String,
    env: Option<HashMap<String, String>>,
) -> R<ai::cli::Spawned> {
    let s = svc(&app)?;
    let sink = sink(&app, &window);
    blocking(move || s.cli.spawn(&path, &args, &cwd, env.as_ref(), sink)).await
}

#[tauri::command]
pub async fn kimo_cli_write(app: AppHandle, process_id: String, data: String) -> R<()> {
    let s = svc(&app)?;
    blocking(move || s.cli.write(&process_id, &data)).await
}

#[tauri::command]
pub async fn kimo_cli_close_stdin(app: AppHandle, process_id: String) -> R<()> {
    let s = svc(&app)?;
    blocking(move || s.cli.close_stdin(&process_id)).await
}

#[tauri::command]
pub async fn kimo_cli_kill(app: AppHandle, process_id: String, signal: Option<String>) -> R<()> {
    let s = svc(&app)?;
    let signal = signal.unwrap_or_else(|| "SIGTERM".into());
    blocking(move || s.cli.kill(&process_id, &signal)).await
}

// --- User skills (ADR 0014 §10) -------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_skills_root(app: AppHandle) -> R<String> {
    let s = svc(&app)?;
    Ok(crate::util::path_str(s.skills.root()))
}

#[tauri::command]
pub async fn kimo_skills_list(app: AppHandle) -> R<Vec<crate::skills::SkillFile>> {
    let s = svc(&app)?;
    blocking(move || s.skills.list()).await
}

#[tauri::command]
pub async fn kimo_skills_read(app: AppHandle, name: String) -> R<Option<crate::skills::SkillFile>> {
    let s = svc(&app)?;
    blocking(move || s.skills.read(&name)).await
}

#[tauri::command]
pub async fn kimo_skills_watch(app: AppHandle, window: WebviewWindow, watch_id: String) -> R<()> {
    let s = svc(&app)?;
    let sink = sink(&app, &window);
    blocking(move || {
        s.skills.watch(
            &watch_id,
            std::time::Duration::from_millis(250),
            Arc::new(move |id: &str| {
                sink.emit(
                    crate::skills::EV_SKILLS_CHANGED,
                    crate::skills::changed_payload(id),
                )
            }),
        )
    })
    .await
}

#[tauri::command]
pub async fn kimo_skills_unwatch(app: AppHandle, watch_id: String) -> R<()> {
    let s = svc(&app)?;
    s.skills.unwatch(&watch_id);
    Ok(())
}
