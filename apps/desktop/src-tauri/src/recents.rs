//! Recent files and watched folders (Home, board 16), persisted in `<app data>/recents.json`.

use crate::error::R;
use crate::git::{GitSummary, SummaryCache};
use crate::util::{
    basename, is_kimo_path, now_ms, path_str, read_json, system_time_ms, write_json,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_RECENTS: usize = 50;
const SCAN_MAX_DEPTH: usize = 12;
const SCAN_MAX_FILES: usize = 2000;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentsFile {
    #[serde(default)]
    pub version: u32,
    /// path → openedAt.
    #[serde(default)]
    pub files: BTreeMap<String, u64>,
    #[serde(default)]
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    #[serde(rename = "ref")]
    pub file_ref: String,
    pub name: String,
    pub folder: String,
    pub modified_at: u64,
    pub opened_at: Option<u64>,
    pub git: Option<GitSummary>,
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderGit {
    pub branch: Option<String>,
    pub changed_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolder {
    #[serde(rename = "ref")]
    pub file_ref: String,
    pub label: String,
    pub git: Option<FolderGit>,
    pub file_count: u64,
}

pub struct Recents {
    path: PathBuf,
    lock: Mutex<()>,
}

/// `.kimo` / `.kimoz` files under `dir` (recursive; skips `node_modules` and dot dirs).
pub fn scan(dir: &Path) -> Vec<PathBuf> {
    fn walk(d: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > SCAN_MAX_DEPTH || out.len() >= SCAN_MAX_FILES {
            return;
        }
        let Ok(rd) = fs::read_dir(d) else { return };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if name.starts_with('.') || name == "node_modules" || name == "target" {
                    continue;
                }
                walk(&e.path(), depth + 1, out);
            } else if is_kimo_path(&e.path()) && !name.starts_with('.') {
                out.push(e.path());
                if out.len() >= SCAN_MAX_FILES {
                    return;
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, 0, &mut out);
    out
}

fn recent_of(p: &Path, opened_at: Option<u64>, git: &mut SummaryCache) -> RecentFile {
    let meta = fs::metadata(p).ok();
    RecentFile {
        file_ref: path_str(p),
        name: basename(p),
        folder: p.parent().map(path_str).unwrap_or_default(),
        modified_at: meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(system_time_ms)
            .unwrap_or(0),
        opened_at,
        git: if meta.is_some() { git.summary(p) } else { None },
        missing: meta.is_none(),
    }
}

impl Recents {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    pub fn load(&self) -> RecentsFile {
        read_json::<RecentsFile>(&self.path)
            .ok()
            .flatten()
            .unwrap_or_default()
    }

    fn update(&self, f: impl FnOnce(&mut RecentsFile)) -> R<()> {
        let _g = self.lock.lock().unwrap();
        let mut data = self.load();
        data.version = 1;
        f(&mut data);
        write_json(&self.path, &data)
    }

    pub fn list_files(&self, limit: Option<usize>) -> Vec<RecentFile> {
        let data = self.load();
        let mut git = SummaryCache::default();
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for (p, opened) in &data.files {
            if seen.insert(p.clone()) {
                out.push(recent_of(Path::new(p), Some(*opened), &mut git));
            }
        }
        for folder in &data.folders {
            for p in scan(Path::new(folder)) {
                let s = path_str(&p);
                if seen.insert(s) {
                    out.push(recent_of(&p, None, &mut git));
                }
            }
        }
        out.sort_by(|a, b| {
            b.modified_at
                .cmp(&a.modified_at)
                .then_with(|| a.file_ref.cmp(&b.file_ref))
        });
        if let Some(n) = limit {
            out.truncate(n);
        }
        out
    }

    pub fn note_opened(&self, path: &Path) -> R<()> {
        let key = path_str(path);
        self.update(|d| {
            d.files.insert(key, now_ms());
            if d.files.len() > MAX_RECENTS {
                let mut by_age: Vec<_> = d.files.iter().map(|(k, v)| (*v, k.clone())).collect();
                by_age.sort();
                for (_, k) in by_age.into_iter().take(d.files.len() - MAX_RECENTS) {
                    d.files.remove(&k);
                }
            }
        })
    }

    pub fn remove_file(&self, path: &str) -> R<()> {
        self.update(|d| {
            d.files.remove(path);
        })
    }

    pub fn clear(&self) -> R<()> {
        self.update(|d| d.files.clear())
    }

    pub fn add_folder(&self, path: &Path) -> R<()> {
        let key = path_str(path);
        self.update(|d| {
            if !d.folders.contains(&key) {
                d.folders.push(key);
            }
        })
    }

    pub fn remove_folder(&self, path: &str) -> R<()> {
        self.update(|d| d.folders.retain(|f| f != path))
    }

    pub fn list_folders(&self) -> Vec<WatchedFolder> {
        let mut git = SummaryCache::default();
        self.load()
            .folders
            .iter()
            .map(|f| {
                let p = Path::new(f);
                WatchedFolder {
                    file_ref: f.clone(),
                    label: basename(p),
                    git: git.folder(p).map(|(branch, changed_count)| FolderGit {
                        branch,
                        changed_count,
                    }),
                    file_count: scan(p).len() as u64,
                }
            })
            .collect()
    }

    pub fn scan_folder(&self, dir: &Path) -> Vec<RecentFile> {
        let data = self.load();
        let mut git = SummaryCache::default();
        scan(dir)
            .iter()
            .map(|p| recent_of(p, data.files.get(&path_str(p)).copied(), &mut git))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recents_and_folders() {
        let d = tempfile::tempdir().unwrap();
        let r = Recents::new(d.path().join("data/recents.json"));
        let proj = d.path().join("proj");
        fs::create_dir_all(proj.join("design")).unwrap();
        fs::create_dir_all(proj.join("node_modules/x")).unwrap();
        fs::create_dir_all(proj.join(".hidden")).unwrap();
        fs::write(proj.join("design/a.kimo"), "{}").unwrap();
        fs::write(proj.join("b.kimoz"), "zip").unwrap();
        fs::write(proj.join("node_modules/x/c.kimo"), "{}").unwrap();
        fs::write(proj.join(".hidden/d.kimo"), "{}").unwrap();
        fs::write(proj.join("notes.md"), "").unwrap();

        let other = d.path().join("elsewhere.kimo");
        fs::write(&other, "{}").unwrap();
        r.note_opened(&other).unwrap();
        r.add_folder(&proj).unwrap();
        r.add_folder(&proj).unwrap();

        let folders = r.list_folders();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].file_count, 2);
        assert_eq!(folders[0].label, "proj");

        let files = r.list_files(None);
        assert_eq!(files.len(), 3);
        let o = files
            .iter()
            .find(|f| f.file_ref == path_str(&other))
            .unwrap();
        assert!(o.opened_at.is_some() && !o.missing);
        let json = serde_json::to_value(o).unwrap();
        assert_eq!(json["name"], "elsewhere.kimo");
        assert!(json.get("ref").is_some() && json.get("modifiedAt").is_some());
        assert_eq!(r.list_files(Some(1)).len(), 1);

        fs::remove_file(&other).unwrap();
        assert!(r.list_files(None).iter().any(|f| f.missing));
        r.remove_file(&path_str(&other)).unwrap();
        r.remove_folder(&path_str(&proj)).unwrap();
        assert!(r.list_files(None).is_empty());
        assert_eq!(r.scan_folder(&proj).len(), 2);
    }
}
