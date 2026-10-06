//! Shared app state managed by Tauri (`Arc<AppState>`).

use crate::fonts::{FontCache, LocalFonts};
use crate::leases::{Identity, Leases};
use crate::links::OpenRequest;
use crate::recents::Recents;
use crate::recovery::RecoveryStore;
use crate::scope::Scope;
use crate::settings::SettingsStore;
use crate::trash::Trash;
use crate::updater::UpdaterState;
use crate::watch::Watch;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Default)]
pub struct LaunchQueue {
    /// The frontend called `kimo_launch_take_initial` once: later requests are emitted.
    pub ready: bool,
    pub pending: Vec<OpenRequest>,
}

pub struct AppState {
    pub kimo_home: PathBuf,
    pub host: String,
    pub scope: Scope,
    pub settings: SettingsStore,
    pub recents: Recents,
    pub leases: Leases,
    pub recovery: RecoveryStore,
    pub fonts: LocalFonts,
    pub font_cache: FontCache,
    /// Offline font pack (board 28): `<app data dir>/font-pack`, kept apart from the cache.
    pub font_pack: FontCache,
    pub updater: UpdaterState,
    /// `<window label>:<watchId>` → watcher (fs, lease and git watches).
    pub watches: Mutex<HashMap<String, Watch>>,
    pub launch: Mutex<LaunchQueue>,
    /// Close handshake: requestId → (window label, asked at).
    pub close_requests: Mutex<HashMap<String, (String, Instant)>>,
    /// Windows whose close was confirmed (the next CloseRequested goes through).
    pub close_allowed: Mutex<HashSet<String>>,
    /// Last fullscreen state per window (Resized events carry no fullscreen flag).
    pub fullscreen: Mutex<HashMap<String, bool>>,
    /// Board 37 §3: files Kimo moved to the OS trash (`~/.kimo/trash.json`).
    pub trash: Trash,
    /// What each editor window shows (`kimo_menu_set_context`); the menu bar follows focus.
    pub menu_context: Mutex<HashMap<String, crate::menu::MenuContext>>,
    /// Menu items chosen while no editor window was open (A6 / B9 / G3): `main` is reopened
    /// and they run once its page reports its context.
    pub pending_menu: Mutex<crate::menu::MenuQueue>,
}

impl AppState {
    pub fn new(
        kimo_home: PathBuf,
        config_dir: &Path,
        data_dir: &Path,
        app_version: String,
    ) -> Self {
        let me = Identity::desktop();
        let host = me.host.clone();
        let state = Self {
            scope: Scope::default(),
            settings: SettingsStore::new(config_dir.join("settings.json")),
            recents: Recents::new(data_dir.join("recents.json")),
            leases: Leases::new(kimo_home.join("locks"), me.clone()),
            recovery: RecoveryStore {
                dir: kimo_home.join("recovery"),
                pid: me.pid,
                host: me.host.clone(),
                app_version,
            },
            fonts: LocalFonts::default(),
            font_cache: FontCache::new(kimo_home.join("fonts")),
            font_pack: FontCache::new(data_dir.join("font-pack")),
            updater: UpdaterState::default(),
            watches: Mutex::new(HashMap::new()),
            launch: Mutex::new(LaunchQueue::default()),
            close_requests: Mutex::new(HashMap::new()),
            close_allowed: Mutex::new(HashSet::new()),
            fullscreen: Mutex::new(HashMap::new()),
            trash: Trash::new(&kimo_home),
            menu_context: Mutex::new(HashMap::new()),
            pending_menu: Mutex::new(crate::menu::MenuQueue::default()),
            host,
            kimo_home,
        };
        // Deny by default; Kimo's own dirs, then what the user granted in earlier sessions
        // (watched folders and the folders of recent files).
        state.scope.allow_dir(&state.kimo_home);
        state.scope.allow_dir(config_dir);
        state.scope.allow_dir(data_dir);
        // Kimo creates files in the new-files folder (Home composer, Templates, first save of
        // an untitled file), so it is granted like Kimo's own dirs (audit A4).
        if let Some(dir) = new_files_dir(&state.settings, home_dir().as_deref()) {
            state.scope.allow_dir(&dir);
        }
        let recents = state.recents.load();
        for f in &recents.folders {
            state.scope.allow_dir(Path::new(f));
        }
        for f in recents.files.keys() {
            state.scope.allow_file(Path::new(f));
        }
        state
    }

    /// Widens the scope for the files of a request, then queues it (cold start) or emits it
    /// to the main editor window.
    pub fn open_request<Rt: Runtime>(&self, app: &AppHandle<Rt>, req: OpenRequest) {
        if req.refs.is_empty() {
            return;
        }
        for r in &req.refs {
            if let Ok(p) = crate::util::clean_abs(r) {
                self.scope.allow_file(&p);
            }
        }
        {
            let mut q = self.launch.lock().unwrap();
            if !q.ready {
                q.pending.push(req);
                return;
            }
        }
        let target = crate::window::primary_editor(app);
        match target {
            Some(w) => {
                let _ = w.unminimize();
                let _ = w.set_focus();
                let _ = app.emit_to(w.label(), "kimo://open-request", req);
            }
            None => {
                // Every editor window is closed (macOS keeps running): reopen main and queue.
                self.launch.lock().unwrap().pending.push(req);
                self.launch.lock().unwrap().ready = false;
                let _ = crate::window::create_editor_window(app, "main");
            }
        }
    }

    pub fn take_initial(&self) -> Vec<OpenRequest> {
        let mut q = self.launch.lock().unwrap();
        q.ready = true;
        std::mem::take(&mut q.pending)
    }

    /// Drops every watcher owned by a window (it was destroyed).
    pub fn drop_window_watches(&self, label: &str) {
        let prefix = format!("{label}:");
        self.watches
            .lock()
            .unwrap()
            .retain(|k, _| !k.starts_with(&prefix));
    }
}

/// The user's home folder (`HOME`, `USERPROFILE` on Windows).
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
}

/// Settings › Files › "New files go to" (`files.newFilesDir`), else `~/Documents/Kimo` (the
/// default `defaultNewFilesDir` in apps/web/src/home/submit.ts uses).
pub fn new_files_dir(settings: &SettingsStore, home: Option<&Path>) -> Option<PathBuf> {
    if let Some(set) = settings.get("files.newFilesDir").as_str() {
        if let Ok(p) = crate::util::clean_abs(set) {
            return Some(p);
        }
    }
    home.map(|h| h.join("Documents").join("Kimo"))
}

pub fn state<Rt: Runtime>(app: &AppHandle<Rt>) -> std::sync::Arc<AppState> {
    app.state::<std::sync::Arc<AppState>>().inner().clone()
}

/// Open requests that arrive before `setup` has managed the state: macOS delivers the files of
/// a cold launch from Finder ("Open With", double-click) through `RunEvent::Opened`, which can
/// run before `setup`. They are queued here and handed over by [`take_early_opens`].
static EARLY_OPENS: std::sync::Mutex<Vec<OpenRequest>> = std::sync::Mutex::new(Vec::new());

/// Routes an open request to the state, or queues it until the state exists.
pub fn open_or_defer<Rt: Runtime>(app: &AppHandle<Rt>, req: OpenRequest) {
    match app.try_state::<std::sync::Arc<AppState>>() {
        Some(st) => st.inner().clone().open_request(app, req),
        None => EARLY_OPENS.lock().unwrap().push(req),
    }
}

/// The requests queued by [`open_or_defer`] before the state was managed.
pub fn take_early_opens() -> Vec<OpenRequest> {
    std::mem::take(&mut *EARLY_OPENS.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn new_files_dir_is_granted_at_startup() {
        let d = tempfile::tempdir().unwrap();
        let settings = SettingsStore::new(d.path().join("settings.json"));
        let home = d.path().join("me");
        assert_eq!(
            new_files_dir(&settings, Some(&home)),
            Some(home.join("Documents/Kimo"))
        );
        settings
            .set(
                "files.newFilesDir",
                serde_json::json!("/Volumes/Work/designs"),
            )
            .unwrap();
        assert_eq!(
            new_files_dir(&settings, Some(&home)),
            Some(PathBuf::from("/Volumes/Work/designs"))
        );
        assert_eq!(
            new_files_dir(&SettingsStore::new(d.path().join("none.json")), None),
            None
        );
    }
}
