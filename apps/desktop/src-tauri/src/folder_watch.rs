//! Watched folders on Home (audit B12): a debounced, recursive watcher per folder that emits
//! `kimo://recents-changed` when a `.kimo` file appears, disappears or is renamed under it, so
//! Home re-lists files an agent or a terminal wrote while Kimo is in front.

use crate::watch::{debouncer, watch_path};
use notify::event::EventKind;
use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache};
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

type D = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

/// Folder path → its watcher (dropping a watcher stops it).
#[derive(Default)]
pub struct FolderWatch(Mutex<HashMap<String, D>>);

/// True for events Home cares about: a `.kimo` file or a folder created, removed or renamed.
pub fn relevant(kind: &EventKind, path: &Path) -> bool {
    let kimo = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("kimo") || e.eq_ignore_ascii_case("kimoz"));
    match kind {
        EventKind::Create(_) | EventKind::Remove(_) => kimo || path.extension().is_none(),
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => true,
        _ => false,
    }
}

/// Starts watchers for new folders and stops those no longer listed.
pub fn sync<Rt: Runtime>(app: &AppHandle<Rt>, folders: &[String]) {
    let Some(w) = app.try_state::<FolderWatch>() else {
        return;
    };
    let mut map = w.0.lock().unwrap();
    map.retain(|k, _| folders.contains(k));
    for f in folders {
        if map.contains_key(f) || !Path::new(f).is_dir() {
            continue;
        }
        let handle = app.clone();
        let made = debouncer(500, move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            let hit = events
                .iter()
                .any(|e| e.event.paths.iter().any(|p| relevant(&e.event.kind, p)));
            if hit {
                let _ = handle.emit("kimo://recents-changed", json!({}));
            }
        });
        let Ok(mut d) = made else { continue };
        if watch_path(&mut d, Path::new(f), RecursiveMode::Recursive).is_ok() {
            map.insert(f.clone(), d);
        }
    }
}
