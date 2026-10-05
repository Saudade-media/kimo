//! Shared app state managed by Tauri (`Arc<AppState>`).

use crate::fonts::{FontCache, LocalFonts};
use crate::leases::{Identity, Leases};
use crate::links::OpenRequest;
use crate::recents::Recents;
use crate::recovery::RecoveryStore;
use crate::scope::Scope;
use crate::settings::SettingsStore;
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
            host,
            kimo_home,
        };
        // Deny by default; Kimo's own dirs, then what the user granted in earlier sessions
        // (watched folders and the folders of recent files).
        state.scope.allow_dir(&state.kimo_home);
        state.scope.allow_dir(config_dir);
        state.scope.allow_dir(data_dir);
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

pub fn state<Rt: Runtime>(app: &AppHandle<Rt>) -> std::sync::Arc<AppState> {
    app.state::<std::sync::Arc<AppState>>().inner().clone()
}
