//! Every `#[tauri::command]` of `TauriCommandMap` (packages/platform/src/tauri.ts). All are
//! async so nothing blocks the main thread; file, git and font work runs on the blocking pool.

use crate::error::{blocked, invalid, io_msg, R};
use crate::fonts::{CacheStats, FontCacheEntry, FontCacheMeta, LocalFontFamily};
use crate::fs_ops::{self, AtomicWriteResult, FileStat, ReadTextResult};
use crate::git::{self, GitState, MergeDriverStatus};
use crate::leases::{AcquireResult, LeaseHolder};
use crate::links::OpenRequest;
use crate::recents::{RecentFile, WatchedFolder};
use crate::recovery::{RecoveryEntry, RecoveryRead, RecoveryWriteInput};
use crate::state::AppState;
use crate::updater::{UpdateInfo, UpdaterStatus};
use crate::util::{clean_abs, path_str};
use crate::window::{self, WindowState};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::ipc::{InvokeResponseBody, Response};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

type St<'a> = State<'a, Arc<AppState>>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| io_msg(format!("Task failed: {e}")))?
}

fn bytes_response(bytes: Vec<u8>) -> Response {
    Response::new(bytes)
}

fn null_response() -> Response {
    Response::new(InvokeResponseBody::Json("null".into()))
}

fn decode_b64(s: &str) -> R<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| invalid(format!("Bad base64: {e}")))
}

fn watch_key(window: &WebviewWindow, watch_id: &str) -> R<String> {
    if watch_id.is_empty() || watch_id.len() > 128 {
        return Err(invalid("Invalid watch id"));
    }
    Ok(format!("{}:{watch_id}", window.label()))
}

fn recents_changed(app: &AppHandle) {
    let _ = app.emit("kimo://recents-changed", Value::Object(Map::new()));
}

// --- app ----------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    os: &'static str,
    arch: &'static str,
    host: String,
    pid: u32,
    kimo_home: String,
    window_label: String,
}

pub fn host_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

#[tauri::command]
pub async fn kimo_app_info(app: AppHandle, window: WebviewWindow, st: St<'_>) -> R<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        os: host_os(),
        arch: std::env::consts::ARCH,
        host: st.host.clone(),
        pid: std::process::id(),
        kimo_home: path_str(&st.kimo_home),
        window_label: window.label().to_string(),
    })
}

// --- files --------------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_fs_read_text(path: String, st: St<'_>) -> R<ReadTextResult> {
    let p = st.scope.check(&path)?;
    blocking(move || fs_ops::read_text(&p)).await
}

#[tauri::command]
pub async fn kimo_fs_read_bytes(path: String, st: St<'_>) -> R<Response> {
    let p = st.scope.check(&path)?;
    Ok(bytes_response(
        blocking(move || fs_ops::read_bytes(&p)).await?,
    ))
}

#[tauri::command]
pub async fn kimo_fs_write_text_atomic(
    path: String,
    text: String,
    mkdirs: bool,
    st: St<'_>,
) -> R<AtomicWriteResult> {
    let p = st.scope.check(&path)?;
    blocking(move || fs_ops::write_atomic(&p, text.as_bytes(), mkdirs)).await
}

#[tauri::command]
pub async fn kimo_fs_write_bytes_atomic(
    path: String,
    base64: String,
    mkdirs: bool,
    st: St<'_>,
) -> R<AtomicWriteResult> {
    let p = st.scope.check(&path)?;
    let bytes = decode_b64(&base64)?;
    blocking(move || fs_ops::write_atomic(&p, &bytes, mkdirs)).await
}

#[tauri::command]
pub async fn kimo_fs_remove(path: String, st: St<'_>) -> R<()> {
    let p = st.scope.check(&path)?;
    blocking(move || fs_ops::remove(&p)).await
}

#[tauri::command]
pub async fn kimo_fs_stat(path: String, st: St<'_>) -> R<Option<FileStat>> {
    let p = st.scope.check(&path)?;
    blocking(move || fs_ops::stat(&p)).await
}

#[tauri::command]
pub async fn kimo_fs_list(
    dir: String,
    extensions: Option<Vec<String>>,
    st: St<'_>,
) -> R<Vec<FileStat>> {
    let p = st.scope.check(&dir)?;
    blocking(move || fs_ops::list(&p, extensions.as_deref())).await
}

#[tauri::command]
pub async fn kimo_fs_watch(
    app: AppHandle,
    window: WebviewWindow,
    watch_id: String,
    paths: Vec<String>,
    debounce_ms: u64,
    recursive: bool,
    st: St<'_>,
) -> R<()> {
    let key = watch_key(&window, &watch_id)?;
    let paths = paths
        .iter()
        .map(|p| st.scope.check(p))
        .collect::<R<Vec<PathBuf>>>()?;
    let label = window.label().to_string();
    let w = blocking(move || {
        crate::watch::fs_watch(app, label, watch_id, paths, debounce_ms, recursive)
    })
    .await?;
    st.watches.lock().unwrap().insert(key, w);
    Ok(())
}

#[tauri::command]
pub async fn kimo_fs_unwatch(window: WebviewWindow, watch_id: String, st: St<'_>) -> R<()> {
    let key = watch_key(&window, &watch_id)?;
    let w = st.watches.lock().unwrap().remove(&key);
    drop(w);
    Ok(())
}

#[tauri::command]
pub async fn kimo_fs_reveal(app: AppHandle, path: String, st: St<'_>) -> R<()> {
    let p = st.scope.check(&path)?;
    app.opener()
        .reveal_item_in_dir(&p)
        .map_err(|e| io_msg(format!("Could not reveal {}: {e}", path_str(&p))))
}

#[tauri::command]
pub async fn kimo_fs_open_default(app: AppHandle, path: String, st: St<'_>) -> R<()> {
    let p = st.scope.check(&path)?;
    app.opener()
        .open_path(path_str(&p), None::<&str>)
        .map_err(|e| io_msg(format!("Could not open {}: {e}", path_str(&p))))
}

#[tauri::command]
pub async fn kimo_open_url(app: AppHandle, url: String) -> R<()> {
    let u = url::Url::parse(&url).map_err(|_| invalid(format!("Not a URL: {url}")))?;
    if u.scheme() != "https" || u.host_str().is_none() {
        return Err(blocked(format!("Only https URLs can be opened: {url}")));
    }
    app.opener()
        .open_url(u.as_str(), None::<&str>)
        .map_err(|e| io_msg(format!("Could not open {url}: {e}")))
}

// --- dialogs ------------------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct FileFilter {
    name: String,
    extensions: Vec<String>,
}

fn dialog_builder(
    app: &AppHandle,
    window: &WebviewWindow,
    title: Option<String>,
    filters: &[FileFilter],
    default_dir: Option<String>,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let mut b = app.dialog().file().set_parent(window);
    if let Some(t) = title {
        b = b.set_title(t);
    }
    for f in filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        b = b.add_filter(&f.name, &exts);
    }
    if let Some(d) = default_dir.and_then(|d| clean_abs(&d).ok()) {
        b = b.set_directory(d);
    }
    b
}

fn picked(p: tauri_plugin_dialog::FilePath) -> Option<PathBuf> {
    p.into_path().ok()
}

#[tauri::command]
pub async fn kimo_dialog_open_file(
    app: AppHandle,
    window: WebviewWindow,
    title: Option<String>,
    filters: Vec<FileFilter>,
    multiple: bool,
    default_dir: Option<String>,
    st: St<'_>,
) -> R<Vec<String>> {
    let b = dialog_builder(&app, &window, title, &filters, default_dir);
    let paths: Vec<PathBuf> = blocking(move || {
        Ok(if multiple {
            b.blocking_pick_files()
                .unwrap_or_default()
                .into_iter()
                .filter_map(picked)
                .collect()
        } else {
            b.blocking_pick_file()
                .and_then(picked)
                .into_iter()
                .collect()
        })
    })
    .await?;
    for p in &paths {
        st.scope.allow_file(p);
    }
    Ok(paths.iter().map(|p| path_str(p)).collect())
}

#[tauri::command]
pub async fn kimo_dialog_save_file(
    app: AppHandle,
    window: WebviewWindow,
    title: Option<String>,
    suggested_name: String,
    filters: Vec<FileFilter>,
    default_dir: Option<String>,
    st: St<'_>,
) -> R<Option<String>> {
    let b =
        dialog_builder(&app, &window, title, &filters, default_dir).set_file_name(suggested_name);
    let p = blocking(move || Ok(b.blocking_save_file().and_then(picked))).await?;
    if let Some(p) = &p {
        st.scope.allow_file(p);
    }
    Ok(p.map(|p| path_str(&p)))
}

#[tauri::command]
pub async fn kimo_dialog_pick_folder(
    app: AppHandle,
    window: WebviewWindow,
    title: Option<String>,
    default_dir: Option<String>,
    st: St<'_>,
) -> R<Option<String>> {
    let b = dialog_builder(&app, &window, title, &[], default_dir);
    let p = blocking(move || Ok(b.blocking_pick_folder().and_then(picked))).await?;
    if let Some(p) = &p {
        st.scope.allow_dir(p);
    }
    Ok(p.map(|p| path_str(&p)))
}

// --- recents ------------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_recents_list_files(limit: Option<usize>, st: St<'_>) -> R<Vec<RecentFile>> {
    let st = st.inner().clone();
    blocking(move || Ok(st.recents.list_files(limit))).await
}

#[tauri::command]
pub async fn kimo_recents_note_opened(app: AppHandle, path: String, st: St<'_>) -> R<()> {
    let p = st.scope.check(&path)?;
    st.recents.note_opened(&p)?;
    recents_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn kimo_recents_remove_file(app: AppHandle, path: String, st: St<'_>) -> R<()> {
    st.recents.remove_file(&path)?;
    recents_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn kimo_recents_clear(app: AppHandle, st: St<'_>) -> R<()> {
    st.recents.clear()?;
    recents_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn kimo_recents_list_folders(st: St<'_>) -> R<Vec<WatchedFolder>> {
    let st = st.inner().clone();
    blocking(move || Ok(st.recents.list_folders())).await
}

#[tauri::command]
pub async fn kimo_recents_add_folder(app: AppHandle, path: String, st: St<'_>) -> R<()> {
    // Only folders the user already granted (picked with `pickFolder`) can be watched.
    let p = st.scope.check(&path)?;
    if !p.is_dir() {
        return Err(crate::error::not_found(format!(
            "No such folder: {}",
            path_str(&p)
        )));
    }
    st.recents.add_folder(&p)?;
    st.scope.allow_dir(&p);
    recents_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn kimo_recents_remove_folder(app: AppHandle, path: String, st: St<'_>) -> R<()> {
    st.recents.remove_folder(&path)?;
    recents_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn kimo_recents_scan_folder(path: String, st: St<'_>) -> R<Vec<RecentFile>> {
    let p = st.scope.check(&path)?;
    let st = st.inner().clone();
    blocking(move || Ok(st.recents.scan_folder(&p))).await
}

// --- leases -------------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_lease_acquire(path: String, reclaim_stale: bool, st: St<'_>) -> R<AcquireResult> {
    let p = path_str(&clean_abs(&path)?);
    let st = st.inner().clone();
    blocking(move || st.leases.acquire(&p, reclaim_stale)).await
}

#[tauri::command]
pub async fn kimo_lease_release(path: String, token: String, st: St<'_>) -> R<()> {
    let p = path_str(&clean_abs(&path)?);
    let st = st.inner().clone();
    blocking(move || st.leases.release(&p, &token)).await
}

#[tauri::command]
pub async fn kimo_lease_inspect(path: String, st: St<'_>) -> R<Option<LeaseHolder>> {
    let p = path_str(&clean_abs(&path)?);
    let st = st.inner().clone();
    blocking(move || st.leases.inspect(&p)).await
}

#[tauri::command]
pub async fn kimo_lease_watch(
    app: AppHandle,
    window: WebviewWindow,
    watch_id: String,
    path: String,
    st: St<'_>,
) -> R<()> {
    let key = watch_key(&window, &watch_id)?;
    let p = path_str(&clean_abs(&path)?);
    let label = window.label().to_string();
    let w = blocking(move || crate::watch::lease_watch(app, label, watch_id, p)).await?;
    st.watches.lock().unwrap().insert(key, w);
    Ok(())
}

#[tauri::command]
pub async fn kimo_lease_unwatch(window: WebviewWindow, watch_id: String, st: St<'_>) -> R<()> {
    kimo_fs_unwatch(window, watch_id, st).await
}

// --- recovery -----------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_recovery_dir(st: St<'_>) -> R<String> {
    Ok(path_str(&st.recovery.dir))
}

#[tauri::command]
pub async fn kimo_recovery_list(st: St<'_>) -> R<Vec<RecoveryEntry>> {
    let st = st.inner().clone();
    blocking(move || st.recovery.list()).await
}

#[tauri::command]
pub async fn kimo_recovery_write(input: RecoveryWriteInput, st: St<'_>) -> R<RecoveryEntry> {
    let st = st.inner().clone();
    blocking(move || st.recovery.write(input)).await
}

#[tauri::command]
pub async fn kimo_recovery_read(id: String, st: St<'_>) -> R<RecoveryRead> {
    let st = st.inner().clone();
    blocking(move || st.recovery.read(&id)).await
}

#[tauri::command]
pub async fn kimo_recovery_discard(id: String, st: St<'_>) -> R<()> {
    let st = st.inner().clone();
    blocking(move || st.recovery.discard(&id)).await
}

#[tauri::command]
pub async fn kimo_recovery_prune(max_age_ms: u64, st: St<'_>) -> R<u64> {
    let st = st.inner().clone();
    blocking(move || st.recovery.prune(max_age_ms)).await
}

// --- git ----------------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_git_state(path: String, st: St<'_>) -> R<Option<GitState>> {
    let p = st.scope.check(&path)?;
    blocking(move || Ok(git::state(&p))).await
}

#[tauri::command]
pub async fn kimo_git_watch(
    app: AppHandle,
    window: WebviewWindow,
    watch_id: String,
    path: String,
    st: St<'_>,
) -> R<()> {
    let key = watch_key(&window, &watch_id)?;
    let p = st.scope.check(&path)?;
    let label = window.label().to_string();
    if let Some(w) = blocking(move || crate::watch::git_watch(app, label, watch_id, p)).await? {
        st.watches.lock().unwrap().insert(key, w);
    }
    Ok(())
}

#[tauri::command]
pub async fn kimo_git_unwatch(window: WebviewWindow, watch_id: String, st: St<'_>) -> R<()> {
    kimo_fs_unwatch(window, watch_id, st).await
}

#[tauri::command]
pub async fn kimo_git_merge_driver_status(repo_root: String, st: St<'_>) -> R<MergeDriverStatus> {
    let p = st.scope.check_repo_root(&repo_root)?;
    blocking(move || git::merge_driver_status(&p)).await
}

#[tauri::command]
pub async fn kimo_git_install_merge_driver(repo_root: String, st: St<'_>) -> R<()> {
    let p = st.scope.check_repo_root(&repo_root)?;
    blocking(move || git::install_merge_driver(&p)).await
}

// --- fonts --------------------------------------------------------------------------------------

fn font_folders(st: &AppState, extra: Vec<String>) -> Vec<String> {
    let mut all = st.settings.extra_font_folders();
    for f in extra {
        if !all.contains(&f) {
            all.push(f);
        }
    }
    all.retain(|f| clean_abs(f).is_ok());
    all
}

#[tauri::command]
pub async fn kimo_fonts_list_local(
    extra_folders: Vec<String>,
    st: St<'_>,
) -> R<Vec<LocalFontFamily>> {
    let st = st.inner().clone();
    blocking(move || {
        let folders = font_folders(&st, extra_folders);
        Ok(st.fonts.list(&folders))
    })
    .await
}

#[tauri::command]
pub async fn kimo_fonts_load_local(postscript_name: String, st: St<'_>) -> R<Response> {
    let st = st.inner().clone();
    let bytes = blocking(move || {
        let folders = font_folders(&st, vec![]);
        st.fonts.load(&folders, &postscript_name)
    })
    .await?;
    Ok(bytes_response(bytes))
}

#[tauri::command]
pub async fn kimo_fonts_cache_get(key: String, st: St<'_>) -> R<Response> {
    let st = st.inner().clone();
    Ok(match blocking(move || st.font_cache.get(&key)).await? {
        Some(b) => bytes_response(b),
        None => null_response(),
    })
}

#[tauri::command]
pub async fn kimo_fonts_cache_put(
    meta: FontCacheMeta,
    base64: String,
    st: St<'_>,
) -> R<FontCacheEntry> {
    let bytes = decode_b64(&base64)?;
    let st = st.inner().clone();
    blocking(move || st.font_cache.put(meta, &bytes)).await
}

#[tauri::command]
pub async fn kimo_fonts_cache_list(st: St<'_>) -> R<Vec<FontCacheEntry>> {
    let st = st.inner().clone();
    blocking(move || Ok(st.font_cache.list())).await
}

#[tauri::command]
pub async fn kimo_fonts_cache_stats(st: St<'_>) -> R<CacheStats> {
    let st = st.inner().clone();
    blocking(move || Ok(st.font_cache.stats())).await
}

#[tauri::command]
pub async fn kimo_fonts_cache_clear(st: St<'_>) -> R<()> {
    let st = st.inner().clone();
    blocking(move || st.font_cache.clear()).await
}

#[tauri::command]
pub async fn kimo_fonts_pack_get(key: String, st: St<'_>) -> R<Response> {
    let st = st.inner().clone();
    Ok(match blocking(move || st.font_pack.get(&key)).await? {
        Some(b) => bytes_response(b),
        None => null_response(),
    })
}

#[tauri::command]
pub async fn kimo_fonts_pack_put(
    meta: FontCacheMeta,
    base64: String,
    st: St<'_>,
) -> R<FontCacheEntry> {
    let bytes = decode_b64(&base64)?;
    let st = st.inner().clone();
    blocking(move || st.font_pack.put(meta, &bytes)).await
}

#[tauri::command]
pub async fn kimo_fonts_pack_list(st: St<'_>) -> R<Vec<FontCacheEntry>> {
    let st = st.inner().clone();
    blocking(move || Ok(st.font_pack.list())).await
}

#[tauri::command]
pub async fn kimo_fonts_pack_stats(st: St<'_>) -> R<CacheStats> {
    let st = st.inner().clone();
    blocking(move || Ok(st.font_pack.stats())).await
}

#[tauri::command]
pub async fn kimo_fonts_pack_clear(st: St<'_>) -> R<()> {
    let st = st.inner().clone();
    blocking(move || st.font_pack.clear()).await
}

#[tauri::command]
pub async fn kimo_fonts_fetch_remote(url: String, st: St<'_>) -> R<Response> {
    if !st.settings.google_fonts_allowed() {
        return Err(blocked(
            "Remote fonts are off in Settings (No third-party fetch / Google Fonts)",
        ));
    }
    let u = crate::fonts::check_remote_url(&url)?;
    Ok(bytes_response(crate::fonts::fetch_remote(u).await?))
}

#[tauri::command]
pub async fn kimo_fonts_open_cache_folder(app: AppHandle, st: St<'_>) -> R<()> {
    crate::fonts::ensure_dir(&st.font_cache.dir)?;
    app.opener()
        .open_path(path_str(&st.font_cache.dir), None::<&str>)
        .map_err(|e| io_msg(format!("Could not open the font cache: {e}")))
}

/// Board 32 "Dock activity": one agent controller of this window started, still runs (re-sent
/// every 5 s) or ended a turn. The macOS Dock tile animates while any source works.
#[tauri::command]
pub async fn kimo_dock_agent_activity(
    window: WebviewWindow,
    source: String,
    working: bool,
) -> R<()> {
    if source.is_empty() || source.len() > 128 {
        return Err(invalid("source must be 1–128 characters"));
    }
    crate::dock_activity::report_agent(&format!("{}:{source}", window.label()), working);
    Ok(())
}

/// Board 25 §7 (b) "Show logs in Finder": reveals `~/.kimo/mcp/server.log` (Kimo's only log
/// file), or opens its folder when nothing has been logged yet.
#[tauri::command]
pub async fn kimo_help_show_logs(app: AppHandle, st: St<'_>) -> R<()> {
    show_logs(&app, &st.kimo_home)
}

pub fn show_logs<Rt: tauri::Runtime>(
    app: &tauri::AppHandle<Rt>,
    kimo_home: &std::path::Path,
) -> R<()> {
    let paths = kimo_mcp::paths::KimoPaths::new(kimo_home);
    let log = crate::mcp::files::server_log_path(&paths);
    if log.is_file() {
        return app
            .opener()
            .reveal_item_in_dir(&log)
            .map_err(|e| io_msg(format!("Could not reveal the logs: {e}")));
    }
    let dir = paths.mcp_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| io_msg(format!("Could not create {}: {e}", path_str(&dir))))?;
    app.opener()
        .open_path(path_str(&dir), None::<&str>)
        .map_err(|e| io_msg(format!("Could not open the logs folder: {e}")))
}

// --- updater ------------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_updater_status(st: St<'_>) -> R<UpdaterStatus> {
    Ok(st.updater.status())
}

#[tauri::command]
pub async fn kimo_updater_check(
    app: AppHandle,
    channel: String,
    st: St<'_>,
) -> R<Option<UpdateInfo>> {
    let st = st.inner().clone();
    st.updater.check(&app, &channel).await
}

#[tauri::command]
pub async fn kimo_updater_download(app: AppHandle, st: St<'_>) -> R<()> {
    let st = st.inner().clone();
    st.updater.download(&app).await
}

#[tauri::command]
pub async fn kimo_updater_restart(app: AppHandle, st: St<'_>) -> R<()> {
    st.updater.restart(&app)
}

// --- window -------------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_window_state(window: WebviewWindow) -> R<WindowState> {
    Ok(window::window_state(&window))
}

/// Title bar double-click on the overlay chrome: the system's zoom / minimize / none setting
/// on macOS, toggle maximize elsewhere.
#[tauri::command]
pub async fn kimo_window_titlebar_double_click(window: WebviewWindow) -> R<()> {
    window::titlebar_double_click(&window)
}

#[tauri::command]
pub async fn kimo_window_set_title(window: WebviewWindow, title: String) -> R<()> {
    window
        .set_title(&title)
        .map_err(|e| io_msg(e.to_string()))?;
    // AppKit relays out the title bar when the title changes.
    window::align_lights(&window);
    Ok(())
}

#[tauri::command]
pub async fn kimo_window_set_document_edited(window: WebviewWindow, edited: bool) -> R<()> {
    window::set_document_edited(&window, edited)
}

#[tauri::command]
pub async fn kimo_window_open_settings(app: AppHandle, pane: Option<String>) -> R<()> {
    window::open_settings(&app, pane.as_deref())
}

#[tauri::command]
pub async fn kimo_window_confirm_close(app: AppHandle, request_id: String, allow: bool) -> R<()> {
    window::confirm_close(&app, &request_id, allow)
}

#[tauri::command]
pub async fn kimo_window_close(window: WebviewWindow) -> R<()> {
    window::close_confirmed(&window)
}

// --- settings -----------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_settings_get_all(st: St<'_>) -> R<Map<String, Value>> {
    Ok(st.settings.all())
}

#[tauri::command]
pub async fn kimo_settings_set(app: AppHandle, key: String, value: Value, st: St<'_>) -> R<()> {
    st.settings.set(&key, value.clone())?;
    if key == "fonts.extraFolders" {
        st.fonts.invalidate();
    }
    let _ = app.emit(
        "kimo://settings-changed",
        serde_json::json!({ "key": key, "value": value }),
    );
    Ok(())
}

// --- launch -------------------------------------------------------------------------------------

#[tauri::command]
pub async fn kimo_launch_take_initial(st: St<'_>) -> R<Vec<OpenRequest>> {
    Ok(st.take_initial())
}
