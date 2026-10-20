//! `notify` watchers (debounced) behind `kimo_fs_watch`, `kimo_lease_watch` and
//! `kimo_git_watch`. Files are watched through their parent directory, so atomic replaces
//! (rename over the file) keep being seen. Events go to the window that started the watch.

use crate::error::{io_msg, R};
use crate::git::{find_repo, state_of, GitTracker};
use crate::util::{now_ms, path_str};
use notify::event::{AccessKind, EventKind, MetadataKind, ModifyKind, RenameMode};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use serde_json::json;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

pub struct Watch {
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct WatchEvent {
    pub kind: &'static str,
    #[serde(rename = "ref")]
    pub file_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    pub at: u64,
}

/// What a watch covers: exact files (via their parent) and directories.
struct Targets {
    files: HashSet<PathBuf>,
    /// (original dir, canonical dir, recursive)
    dirs: Vec<(PathBuf, PathBuf, bool)>,
    /// canonical parent → original parent, for files
    parents: Vec<(PathBuf, PathBuf)>,
}

fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

impl Targets {
    /// Maps an event path back to the caller's spelling of it, when covered.
    fn map(&self, p: &Path) -> Option<PathBuf> {
        if self.files.contains(p) {
            return Some(p.to_path_buf());
        }
        for (canon, orig) in &self.parents {
            if p.parent() == Some(canon.as_path()) {
                let mapped = orig.join(p.file_name()?);
                if self.files.contains(&mapped) {
                    return Some(mapped);
                }
            }
        }
        for (orig, canon, recursive) in &self.dirs {
            for base in [orig, canon] {
                if let Ok(rest) = p.strip_prefix(base) {
                    if rest.as_os_str().is_empty() {
                        return Some(orig.clone());
                    }
                    if *recursive || rest.components().count() == 1 {
                        return Some(orig.join(rest));
                    }
                }
            }
        }
        None
    }
}

fn map_events(
    targets: &Targets,
    events: Vec<notify_debouncer_full::DebouncedEvent>,
) -> Vec<WatchEvent> {
    let at = now_ms();
    let mut out: Vec<WatchEvent> = Vec::new();
    let mut push = |kind: &'static str, p: PathBuf, to: Option<PathBuf>| {
        let e = WatchEvent {
            kind,
            file_ref: path_str(&p),
            to: to.map(|t| path_str(&t)),
            at,
        };
        if !out.contains(&e) {
            out.push(e);
        }
    };
    for de in events {
        let ev = &de.event;
        let paths = &ev.paths;
        match ev.kind {
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if paths.len() == 2 => {
                let (from, to) = (targets.map(&paths[0]), targets.map(&paths[1]));
                match (from, to) {
                    (Some(f), Some(t)) => push("renamed", f, Some(t)),
                    (Some(f), None) => push("removed", f, None),
                    // Something renamed onto a watched file: an atomic save by another app.
                    (None, Some(t)) => push("modified", t, None),
                    (None, None) => {}
                }
            }
            EventKind::Access(AccessKind::Close(_)) | EventKind::Access(_) => {}
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime)) => {}
            EventKind::Any | EventKind::Other => {}
            kind => {
                for p in paths {
                    let Some(mapped) = targets.map(p) else {
                        continue;
                    };
                    let k = match kind {
                        EventKind::Create(_) => "created",
                        EventKind::Remove(_) => "removed",
                        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => "removed",
                        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => "created",
                        EventKind::Modify(ModifyKind::Name(_)) => {
                            if p.exists() {
                                "created"
                            } else {
                                "removed"
                            }
                        }
                        _ => {
                            if p.exists() {
                                "modified"
                            } else {
                                "removed"
                            }
                        }
                    };
                    push(k, mapped, None);
                }
            }
        }
    }
    out
}

pub(crate) fn debouncer(
    ms: u64,
    handler: impl FnMut(DebounceEventResult) + Send + 'static,
) -> R<Debouncer<notify::RecommendedWatcher, RecommendedCache>> {
    new_debouncer(Duration::from_millis(ms.clamp(10, 10_000)), None, handler)
        .map_err(|e| io_msg(format!("Could not start a file watcher: {e}")))
}

pub(crate) fn watch_path(
    d: &mut Debouncer<notify::RecommendedWatcher, RecommendedCache>,
    p: &Path,
    mode: RecursiveMode,
) -> R<()> {
    d.watch(p, mode)
        .map_err(|e| io_msg(format!("Could not watch {}: {e}", path_str(p))))
}

/// `kimo_fs_watch`.
pub fn fs_watch<Rt: Runtime>(
    app: AppHandle<Rt>,
    label: String,
    watch_id: String,
    paths: Vec<PathBuf>,
    debounce_ms: u64,
    recursive: bool,
) -> R<Watch> {
    let mut targets = Targets {
        files: HashSet::new(),
        dirs: Vec::new(),
        parents: Vec::new(),
    };
    let mut roots: Vec<(PathBuf, RecursiveMode)> = Vec::new();
    for p in &paths {
        if p.is_dir() {
            targets.dirs.push((p.clone(), canonical(p), recursive));
            roots.push((
                p.clone(),
                if recursive {
                    RecursiveMode::Recursive
                } else {
                    RecursiveMode::NonRecursive
                },
            ));
        } else if let Some(parent) = p.parent() {
            targets.files.insert(p.clone());
            targets
                .parents
                .push((canonical(parent), parent.to_path_buf()));
            roots.push((parent.to_path_buf(), RecursiveMode::NonRecursive));
        }
    }
    let targets = Arc::new(targets);
    let t = targets.clone();
    let id = watch_id.clone();
    let mut d = debouncer(debounce_ms, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mapped = map_events(&t, events);
        if !mapped.is_empty() {
            let _ = app.emit_to(
                label.as_str(),
                "kimo://fs-watch",
                json!({ "watchId": id, "events": mapped }),
            );
        }
    })?;
    let mut seen = HashSet::new();
    for (root, mode) in roots {
        if seen.insert(root.clone()) {
            watch_path(&mut d, &root, mode)?;
        }
    }
    Ok(Watch { _debouncer: d })
}

/// `kimo_lease_watch`: the lock file of `path`.
pub fn lease_watch<Rt: Runtime>(
    app: AppHandle<Rt>,
    label: String,
    watch_id: String,
    path: String,
) -> R<Watch> {
    let st = crate::state::state(&app);
    let dir = st.leases.dir.clone();
    crate::fonts::ensure_dir(&dir)?;
    let lock = st.leases.lock_path(&path);
    let lock_name = lock.file_name().map(|s| s.to_os_string());
    let last = Mutex::new(
        serde_json::to_string(&st.leases.inspect(&path).ok().flatten()).unwrap_or_default(),
    );
    let mut d = debouncer(100, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        if !events.iter().any(|e| {
            e.event
                .paths
                .iter()
                .any(|p| p.file_name().map(|s| s.to_os_string()) == lock_name)
        }) {
            return;
        }
        let holder = st.leases.inspect(&path).ok().flatten();
        let ser = serde_json::to_string(&holder).unwrap_or_default();
        let mut g = last.lock().unwrap();
        if *g != ser {
            *g = ser;
            let _ = app.emit_to(
                label.as_str(),
                "kimo://lease-changed",
                json!({ "watchId": watch_id, "holder": holder }),
            );
        }
    })?;
    watch_path(&mut d, &dir, RecursiveMode::NonRecursive)?;
    Ok(Watch { _debouncer: d })
}

/// `kimo_git_watch`: the `.git` dir of the repo containing `file` (HEAD, index.lock,
/// `*_HEAD`, rebase dirs, refs). `None` when the file is not in a repository.
pub fn git_watch<Rt: Runtime>(
    app: AppHandle<Rt>,
    label: String,
    watch_id: String,
    file: PathBuf,
) -> R<Option<Watch>> {
    let Some(repo) = find_repo(&file) else {
        return Ok(None);
    };
    let tracker = Mutex::new(GitTracker::new(Some(state_of(&repo, &file))));
    let git_dir = repo.git_dir.clone();
    let git_dir_canon = canonical(&git_dir);
    let common = repo.common_dir.clone();
    let r = repo.clone();
    let mut d = debouncer(150, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let relevant = |p: &Path| {
            let rest = p
                .strip_prefix(&r.git_dir)
                .or_else(|_| p.strip_prefix(&git_dir_canon))
                .or_else(|_| p.strip_prefix(&r.common_dir));
            match rest {
                Ok(rest) => {
                    let first = rest
                        .components()
                        .next()
                        .map(|c| c.as_os_str().to_string_lossy().into_owned());
                    !matches!(
                        first.as_deref(),
                        Some("objects") | Some("logs") | Some("hooks") | Some("lfs")
                    )
                }
                Err(_) => false,
            }
        };
        let paths: Vec<&PathBuf> = events
            .iter()
            .flat_map(|e| e.event.paths.iter())
            .filter(|p| relevant(p))
            .collect();
        if paths.is_empty() {
            return;
        }
        let lock_touched = paths
            .iter()
            .any(|p| p.file_name().is_some_and(|n| n == "index.lock"));
        let next = find_repo(&file).map(|repo| state_of(&repo, &file));
        let changes = tracker.lock().unwrap().update(next, lock_touched);
        for (state, change) in changes {
            let _ = app.emit_to(
                label.as_str(),
                "kimo://git-changed",
                json!({ "watchId": watch_id, "state": state, "change": change }),
            );
        }
        if !paths.is_empty() {
            let _ = app.emit("kimo://recents-changed", json!({}));
        }
    })?;
    watch_path(&mut d, &git_dir, RecursiveMode::Recursive)?;
    if common != git_dir {
        let refs = common.join("refs");
        if refs.is_dir() {
            watch_path(&mut d, &refs, RecursiveMode::Recursive)?;
        }
    }
    Ok(Some(Watch { _debouncer: d }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use notify::event::{CreateKind, DataChange, RemoveKind};
    #[cfg(unix)]
    use notify_debouncer_full::DebouncedEvent;
    #[cfg(unix)]
    use std::time::Instant;

    #[cfg(unix)]
    fn ev(kind: EventKind, paths: &[&str]) -> DebouncedEvent {
        let mut e = notify::Event::new(kind);
        for p in paths {
            e = e.add_path(PathBuf::from(p));
        }
        DebouncedEvent::new(e, Instant::now())
    }

    #[cfg(unix)]
    #[test]
    fn maps_and_filters_events() {
        let t = Targets {
            files: [PathBuf::from("/w/doc.kimo")].into_iter().collect(),
            dirs: vec![(
                PathBuf::from("/w/assets"),
                PathBuf::from("/w/assets"),
                false,
            )],
            parents: vec![(PathBuf::from("/w"), PathBuf::from("/w"))],
        };
        let out = map_events(
            &t,
            vec![
                ev(
                    EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                    &["/w/doc.kimo"],
                ),
                ev(
                    EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                    &["/w/doc.kimo"],
                ),
                ev(EventKind::Create(CreateKind::File), &["/w/other.txt"]),
                ev(
                    EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                    &["/w/.doc.kimo.tmp", "/w/doc.kimo"],
                ),
                ev(EventKind::Create(CreateKind::File), &["/w/assets/a.png"]),
                ev(
                    EventKind::Create(CreateKind::File),
                    &["/w/assets/deep/b.png"],
                ),
                ev(EventKind::Remove(RemoveKind::File), &["/w/assets/c.png"]),
            ],
        );
        let kinds: Vec<_> = out.iter().map(|e| (e.kind, e.file_ref.as_str())).collect();
        // The file does not exist on disk in this test, so content modifications read as removed.
        assert_eq!(
            kinds,
            [
                ("removed", "/w/doc.kimo"),
                ("modified", "/w/doc.kimo"),
                ("created", "/w/assets/a.png"),
                ("removed", "/w/assets/c.png")
            ]
        );
        let json = serde_json::to_value(&out[1]).unwrap();
        assert!(json.get("to").is_none() && json.get("ref").is_some());
    }

    #[test]
    fn real_watcher_sees_atomic_write() {
        let d = tempfile::tempdir().unwrap();
        let file = d.path().join("doc.kimo");
        std::fs::write(&file, "a").unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let targets = Arc::new(Targets {
            files: [file.clone()].into_iter().collect(),
            dirs: vec![],
            parents: vec![(canonical(d.path()), d.path().to_path_buf())],
        });
        let t = targets.clone();
        let mut deb = debouncer(50, move |res: DebounceEventResult| {
            if let Ok(evs) = res {
                let m = map_events(&t, evs);
                if !m.is_empty() {
                    let _ = tx.send(m);
                }
            }
        })
        .unwrap();
        watch_path(&mut deb, d.path(), RecursiveMode::NonRecursive).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        crate::fs_ops::write_atomic(&file, b"b", false).unwrap();
        let got = rx.recv_timeout(Duration::from_secs(5)).expect("an event");
        assert!(got.iter().all(|e| e.file_ref == path_str(&file)), "{got:?}");
        assert!(
            got.iter()
                .any(|e| e.kind == "modified" || e.kind == "created"),
            "{got:?}"
        );
    }
}
