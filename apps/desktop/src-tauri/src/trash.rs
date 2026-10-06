//! Move to Trash with Restore (board 37 §3). Files go to the OS trash (macOS: `~/.Trash` through
//! `NSFileManager trashItemAtURL`, which reports where the item landed; Linux: the freedesktop
//! home trash; Windows: Kimo's own `~/.kimo/trash/<id>/` folder, since the Recycle Bin does not
//! say where an item went). `~/.kimo/trash.json` records each item Kimo moved, so the Trash view
//! can list it and Restore can put it back. Other items in the trash are never touched, and Kimo
//! never empties the trash on its own (`kimo_trash_empty` runs only from "Empty trash…").
//!
//! The index is only a pointer list: an entry whose item left the trash (emptied in Finder,
//! restored with Put Back) is dropped the next time it is listed.

use crate::error::{not_found, R};
use crate::fs_ops::rename_no_clobber;
use crate::util::{basename, now_ms, path_str, read_json, write_json};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// One file Kimo moved to the trash (`TrashedFile` in packages/platform/src/types.ts).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashedFile {
    pub id: String,
    pub original_ref: String,
    pub name: String,
    pub trashed_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    original_ref: String,
    name: String,
    trashed_at: u64,
    /// Where the item is now (inside the OS trash).
    trashed_ref: String,
}

impl Entry {
    fn public(&self) -> TrashedFile {
        TrashedFile {
            id: self.id.clone(),
            original_ref: self.original_ref.clone(),
            name: self.name.clone(),
            trashed_at: self.trashed_at,
        }
    }
    fn present(&self) -> bool {
        // `~/.Trash` can't be listed without Full Disk Access, but its items can be stat'ed.
        fs::symlink_metadata(&self.trashed_ref).is_ok()
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct IndexFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    entries: Vec<Entry>,
}

/// Moves `path` to the trash; returns where it landed. `own_dir` is the per-item folder for
/// hosts without a usable OS trash.
pub type TrashMover = fn(path: &Path, own_dir: &Path) -> R<PathBuf>;

pub struct Trash {
    index: PathBuf,
    /// `~/.kimo/trash`: the item folders of [`kimo_dir_trash`].
    own_dir: PathBuf,
    mover: TrashMover,
    lock: Mutex<()>,
}

impl Trash {
    pub fn new(kimo_home: &Path) -> Self {
        Self::with_mover(kimo_home, os_trash)
    }

    pub fn with_mover(kimo_home: &Path, mover: TrashMover) -> Self {
        Self {
            index: kimo_home.join("trash.json"),
            own_dir: kimo_home.join("trash"),
            mover,
            lock: Mutex::new(()),
        }
    }

    fn load(&self) -> IndexFile {
        read_json::<IndexFile>(&self.index)
            .ok()
            .flatten()
            .unwrap_or_default()
    }

    fn save(&self, mut data: IndexFile) -> R<()> {
        data.version = 1;
        write_json(&self.index, &data)
    }

    /// Moves a file to the trash and records it.
    pub fn move_to_trash(&self, path: &Path) -> R<TrashedFile> {
        let _g = self.lock.lock().unwrap();
        fs::symlink_metadata(path).map_err(crate::error::ctx(&path_str(path)))?;
        let id = uuid::Uuid::new_v4().simple().to_string();
        let landed = (self.mover)(path, &self.own_dir.join(&id))?;
        let entry = Entry {
            id,
            original_ref: path_str(path),
            name: basename(path),
            trashed_at: now_ms(),
            trashed_ref: path_str(&landed),
        };
        let mut data = self.load();
        data.entries.push(entry.clone());
        self.save(data)?;
        Ok(entry.public())
    }

    /// Entries still in the trash, newest first. Drops (and forgets) the others.
    pub fn list(&self) -> R<Vec<TrashedFile>> {
        let _g = self.lock.lock().unwrap();
        let mut data = self.load();
        let before = data.entries.len();
        data.entries.retain(Entry::present);
        let mut out: Vec<TrashedFile> = data.entries.iter().map(Entry::public).collect();
        if data.entries.len() != before {
            self.save(data)?;
        }
        out.sort_by(|a, b| b.trashed_at.cmp(&a.trashed_at).then(a.id.cmp(&b.id)));
        Ok(out)
    }

    fn take(&self, data: &mut IndexFile, id: &str) -> R<Entry> {
        let i = data
            .entries
            .iter()
            .position(|e| e.id == id)
            .ok_or_else(|| not_found(format!("No file with id {id} in the Trash")))?;
        Ok(data.entries.remove(i))
    }

    /// Puts an item back at `to` (default: where it was). Never overwrites (`EXISTS`, the entry
    /// stays); `NOT_FOUND` when the item left the trash (the entry is dropped).
    pub fn restore(&self, id: &str, to: Option<&Path>) -> R<PathBuf> {
        let _g = self.lock.lock().unwrap();
        let mut data = self.load();
        let entry = self.take(&mut data, id)?;
        let target = to.map_or_else(|| PathBuf::from(&entry.original_ref), Path::to_path_buf);
        if !entry.present() {
            self.save(data)?;
            return Err(not_found(format!(
                "{} is no longer in the Trash",
                entry.name
            )));
        }
        rename_no_clobber(Path::new(&entry.trashed_ref), &target, true)?;
        forget_os_record(Path::new(&entry.trashed_ref));
        self.save(data)?;
        Ok(target)
    }

    /// Deletes one item for good and drops its entry (an item already gone just drops it).
    pub fn remove(&self, id: &str) -> R<()> {
        let _g = self.lock.lock().unwrap();
        let mut data = self.load();
        let entry = self.take(&mut data, id)?;
        delete_item(Path::new(&entry.trashed_ref))?;
        self.save(data)
    }

    /// Deletes every item Kimo moved to the trash; resolves to how many were still there.
    /// Items that fail to delete stay listed and the first error is returned.
    pub fn empty(&self) -> R<u64> {
        let _g = self.lock.lock().unwrap();
        let data = self.load();
        let mut kept = Vec::new();
        let mut count = 0;
        let mut first_err = None;
        for e in data.entries {
            if !e.present() {
                continue;
            }
            match delete_item(Path::new(&e.trashed_ref)) {
                Ok(()) => count += 1,
                Err(err) => {
                    first_err.get_or_insert(err);
                    kept.push(e);
                }
            }
        }
        self.save(IndexFile {
            version: 1,
            entries: kept,
        })?;
        match first_err {
            Some(e) => Err(e),
            None => Ok(count),
        }
    }
}

fn delete_item(p: &Path) -> R<()> {
    let r = match fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => fs::remove_dir_all(p),
        Ok(_) => fs::remove_file(p),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    };
    r.map_err(crate::error::ctx(&path_str(p)))?;
    forget_os_record(p);
    Ok(())
}

/// Kimo's own trash folder: `<own_dir>/<name>` (Windows, and the tests).
pub fn kimo_dir_trash(path: &Path, own_dir: &Path) -> R<PathBuf> {
    let to = own_dir.join(basename(path));
    rename_no_clobber(path, &to, true)?;
    Ok(to)
}

#[cfg(target_os = "macos")]
fn os_trash(path: &Path, _own_dir: &Path) -> R<PathBuf> {
    use objc2::rc::Retained;
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let what = path_str(path);
    let url = NSURL::fileURLWithPath(&NSString::from_str(&what));
    let fm = NSFileManager::defaultManager();
    let mut out: Option<Retained<NSURL>> = None;
    fm.trashItemAtURL_resultingItemURL_error(&url, Some(&mut out))
        .map_err(|e| {
            // NSCocoaErrorDomain: 4 / 260 no such file, 257 / 513 no permission, 640 out of space.
            let code = match e.code() {
                4 | 260 => "NOT_FOUND",
                257 | 513 => "PERMISSION",
                640 => "DISK_FULL",
                _ => "IO",
            };
            crate::error::PlatformErrorPayload::new(
                code,
                format!("{what}: {}", e.localizedDescription()),
            )
        })?;
    out.and_then(|u| u.path())
        .map(|p| PathBuf::from(p.to_string()))
        .ok_or_else(|| crate::error::io_msg(format!("{what}: the Trash did not say where it went")))
}

#[cfg(target_os = "linux")]
fn os_trash(path: &Path, _own_dir: &Path) -> R<PathBuf> {
    freedesktop::trash(path)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn os_trash(path: &Path, own_dir: &Path) -> R<PathBuf> {
    kimo_dir_trash(path, own_dir)
}

/// Drops the OS's own record of a trashed item (freedesktop `.trashinfo`); no-op elsewhere.
fn forget_os_record(trashed: &Path) {
    #[cfg(target_os = "linux")]
    freedesktop::forget(trashed);
    #[cfg(not(target_os = "linux"))]
    let _ = trashed;
}

/// The freedesktop.org home trash (`$XDG_DATA_HOME/Trash/{files,info}`).
#[cfg(target_os = "linux")]
mod freedesktop {
    use super::*;

    fn root() -> R<PathBuf> {
        if let Some(d) = std::env::var_os("XDG_DATA_HOME").filter(|d| !d.is_empty()) {
            return Ok(PathBuf::from(d).join("Trash"));
        }
        std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join(".local/share/Trash"))
            .ok_or_else(|| crate::error::io_msg("No home folder for the Trash"))
    }

    pub fn trash(path: &Path) -> R<PathBuf> {
        let root = root()?;
        let (files, info) = (root.join("files"), root.join("info"));
        fs::create_dir_all(&files).map_err(crate::error::ctx(&path_str(&files)))?;
        fs::create_dir_all(&info).map_err(crate::error::ctx(&path_str(&info)))?;
        let name = basename(path);
        for n in 1..10_000 {
            let candidate = if n == 1 {
                name.clone()
            } else {
                format!("{name}.{n}")
            };
            let info_path = info.join(format!("{candidate}.trashinfo"));
            let body = format!(
                "[Trash Info]\nPath={}\nDeletionDate={}\n",
                encode_path(&path_str(path)),
                &crate::util::iso_from_ms(now_ms())[..19]
            );
            // The .trashinfo is created exclusively first: it reserves the name.
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&info_path)
            {
                Ok(mut f) => {
                    use std::io::Write;
                    f.write_all(body.as_bytes())
                        .map_err(crate::error::ctx(&path_str(&info_path)))?;
                    let to = files.join(&candidate);
                    if let Err(e) = rename_no_clobber(path, &to, false) {
                        let _ = fs::remove_file(&info_path);
                        return Err(e);
                    }
                    return Ok(to);
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(crate::error::io_err(e, &path_str(&info_path))),
            }
        }
        Err(crate::error::io_msg(format!(
            "No free name in the Trash for {name}"
        )))
    }

    /// RFC 2396 escaping of the `Path=` key (`/` and unreserved characters stay).
    fn encode_path(p: &str) -> String {
        p.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => {
                    (b as char).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect()
    }

    pub fn forget(trashed: &Path) {
        let Some(files) = trashed.parent() else {
            return;
        };
        if files.file_name().is_some_and(|n| n == "files") {
            if let Some(root) = files.parent() {
                let info = root
                    .join("info")
                    .join(format!("{}.trashinfo", basename(trashed)));
                let _ = fs::remove_file(info);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Trash, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let t = Trash::with_mover(&d.path().join(".kimo"), kimo_dir_trash);
        let work = d.path().join("work");
        fs::create_dir_all(&work).unwrap();
        (d, t, work)
    }

    #[test]
    fn move_list_restore() {
        let (_d, t, work) = setup();
        let a = work.join("home.kimo");
        fs::write(&a, b"A").unwrap();
        let e = t.move_to_trash(&a).unwrap();
        assert!(!a.exists());
        assert_eq!(e.name, "home.kimo");
        assert_eq!(e.original_ref, path_str(&a));
        let json = serde_json::to_value(&e).unwrap();
        assert!(json.get("originalRef").is_some() && json.get("trashedAt").is_some());
        assert!(json.get("trashedRef").is_none());
        assert_eq!(t.list().unwrap(), vec![e.clone()]);

        // A file now at the original path: never overwritten, the entry stays.
        fs::write(&a, b"new").unwrap();
        assert_eq!(t.restore(&e.id, None).unwrap_err().code, "EXISTS");
        assert_eq!(fs::read(&a).unwrap(), b"new");
        assert_eq!(t.list().unwrap().len(), 1);
        // Restore as copy.
        let copy = work.join("sub/home 2.kimo");
        assert_eq!(t.restore(&e.id, Some(&copy)).unwrap(), copy);
        assert_eq!(fs::read(&copy).unwrap(), b"A");
        assert!(t.list().unwrap().is_empty());
        assert_eq!(t.restore(&e.id, None).unwrap_err().code, "NOT_FOUND");
    }

    #[test]
    fn restore_to_original_and_missing_items() {
        let (_d, t, work) = setup();
        let a = work.join("a.kimo");
        fs::write(&a, b"A").unwrap();
        let e = t.move_to_trash(&a).unwrap();
        assert_eq!(t.restore(&e.id, None).unwrap(), a);
        assert_eq!(fs::read(&a).unwrap(), b"A");

        // Emptied elsewhere: dropped from the list, Restore says NOT_FOUND.
        let e = t.move_to_trash(&a).unwrap();
        fs::remove_dir_all(t.own_dir.join(&e.id)).unwrap();
        assert!(t.list().unwrap().is_empty());
        let e2 = {
            fs::write(&a, b"A2").unwrap();
            t.move_to_trash(&a).unwrap()
        };
        fs::remove_dir_all(t.own_dir.join(&e2.id)).unwrap();
        assert_eq!(t.restore(&e2.id, None).unwrap_err().code, "NOT_FOUND");
        assert_eq!(
            t.move_to_trash(&work.join("none.kimo")).unwrap_err().code,
            "NOT_FOUND"
        );
    }

    #[test]
    fn remove_and_empty_only_touch_kimo_items() {
        let (d, t, work) = setup();
        let other = t.own_dir.join("someone-else.txt");
        fs::create_dir_all(&t.own_dir).unwrap();
        fs::write(&other, b"keep").unwrap();
        let mut ids = vec![];
        for n in ["a.kimo", "b.kimo", "c.kimo"] {
            fs::write(work.join(n), n).unwrap();
            ids.push(t.move_to_trash(&work.join(n)).unwrap().id);
        }
        t.remove(&ids[0]).unwrap();
        assert_eq!(t.list().unwrap().len(), 2);
        assert_eq!(t.remove(&ids[0]).unwrap_err().code, "NOT_FOUND");
        assert_eq!(t.empty().unwrap(), 2);
        assert!(t.list().unwrap().is_empty());
        assert_eq!(t.empty().unwrap(), 0);
        assert_eq!(fs::read(&other).unwrap(), b"keep");
        let index: serde_json::Value =
            serde_json::from_slice(&fs::read(d.path().join(".kimo/trash.json")).unwrap()).unwrap();
        assert_eq!(index["entries"].as_array().unwrap().len(), 0);
    }

    /// The real OS trash (touches `~/.Trash`; restores what it moved). Run with
    /// `cargo test -- --ignored os_trash_round_trip`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn os_trash_round_trip() {
        let d = tempfile::tempdir().unwrap();
        let t = Trash::new(&d.path().join(".kimo"));
        let a = d
            .path()
            .join(format!("kimo-trash-test-{}.kimo", std::process::id()));
        fs::write(&a, b"A").unwrap();
        let e = t.move_to_trash(&a).unwrap();
        assert!(!a.exists());
        assert_eq!(t.list().unwrap(), vec![e.clone()]);
        assert_eq!(t.restore(&e.id, None).unwrap(), a);
        assert_eq!(fs::read(&a).unwrap(), b"A");
        let e = t.move_to_trash(&a).unwrap();
        t.remove(&e.id).unwrap();
        assert!(t.list().unwrap().is_empty());
    }

    #[test]
    fn list_is_newest_first() {
        let (_d, t, work) = setup();
        for n in ["a.kimo", "b.kimo"] {
            fs::write(work.join(n), n).unwrap();
            t.move_to_trash(&work.join(n)).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(3));
        }
        let names: Vec<_> = t.list().unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["b.kimo", "a.kimo"]);
    }
}
