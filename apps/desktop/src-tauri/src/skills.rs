//! M6 user skills (ADR 0014 §10): `~/.kimo/skills/<dir>/SKILL.md`, listed, read and watched for
//! the built-in agent (`SkillsApi` in packages/platform/src/skills.ts). Rust only hands out text
//! of files that are:
//!
//! - `<root>/<dir>/SKILL.md` where `<dir>` is a plain folder name (`SKILL_DIR`: no dots,
//!   separators or leading dash; ≤ 64 chars);
//! - after canonicalization (symlinks resolved) still under the canonical root;
//! - regular files of at most `MAX_SKILL_BYTES`, valid UTF-8.
//!
//! Anything else is skipped by `list` and refused by `read`. A missing root lists as empty. The
//! agent parses the front matter and refuses user skills that shadow a built-in.

use crate::error::{invalid, io_msg, permission, R};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Skills root under the Kimo home (`~/.kimo/skills`).
pub const SKILLS_DIR: &str = "skills";
/// The one file read per skill folder.
pub const SKILL_FILE: &str = "SKILL.md";
/// Largest SKILL.md handed out (`USER_SKILL_MAX_BYTES`).
pub const MAX_SKILL_BYTES: u64 = 256 * 1024;
/// Event to the window that started a watch (`TauriSkillsEventMap`).
pub const EV_SKILLS_CHANGED: &str = "kimo://skills-changed";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SkillFile {
    pub path: String,
    pub text: String,
}

/// `SKILL_DIR_RE` = `^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$`.
pub fn valid_dir_name(name: &str) -> bool {
    let b = name.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0] != b'-'
        && b.iter()
            .all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'-')
}

/// Reads `<root>/<dir>/SKILL.md` under the confinement rules. `Ok(None)` when it does not exist.
fn read_confined(canon_root: &Path, dir: &str) -> R<Option<SkillFile>> {
    if !valid_dir_name(dir) {
        return Err(invalid(format!("Invalid skill folder name \"{dir}\"")));
    }
    let p = canon_root.join(dir).join(SKILL_FILE);
    let canon = match std::fs::canonicalize(&p) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_msg(format!("{dir}/{SKILL_FILE}: {e}"))),
    };
    if !canon.starts_with(canon_root) {
        return Err(permission(format!(
            "{dir}/{SKILL_FILE} resolves outside the skills folder"
        )));
    }
    let meta = std::fs::metadata(&canon).map_err(|e| io_msg(format!("{dir}/{SKILL_FILE}: {e}")))?;
    if !meta.is_file() {
        return Err(invalid(format!("{dir}/{SKILL_FILE} is not a file")));
    }
    if meta.len() > MAX_SKILL_BYTES {
        return Err(invalid(format!(
            "{dir}/{SKILL_FILE} is larger than {MAX_SKILL_BYTES} bytes"
        )));
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    std::fs::File::open(&canon)
        .and_then(|f| f.take(MAX_SKILL_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|e| io_msg(format!("{dir}/{SKILL_FILE}: {e}")))?;
    if bytes.len() as u64 > MAX_SKILL_BYTES {
        return Err(invalid(format!(
            "{dir}/{SKILL_FILE} is larger than {MAX_SKILL_BYTES} bytes"
        )));
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| invalid(format!("{dir}/{SKILL_FILE} is not UTF-8")))?;
    Ok(Some(SkillFile {
        // The caller's spelling of the root (not the canonical one), like the rest of the shell.
        path: crate::util::path_str(&p),
        text,
    }))
}

fn canonical_root(root: &Path) -> R<Option<PathBuf>> {
    match std::fs::canonicalize(root) {
        Ok(c) if c.is_dir() => Ok(Some(c)),
        Ok(_) => Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_msg(format!("skills folder: {e}"))),
    }
}

/// Every confined `<root>/<dir>/SKILL.md`, sorted by folder name. Unreadable or refused entries
/// are skipped; a missing root is empty.
pub fn list(root: &Path) -> R<Vec<SkillFile>> {
    let Some(canon_root) = canonical_root(root)? else {
        return Ok(Vec::new());
    };
    let mut dirs: Vec<String> = std::fs::read_dir(&canon_root)
        .map_err(|e| io_msg(format!("skills folder: {e}")))?
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| valid_dir_name(n))
        .collect();
    dirs.sort();
    let mut out = Vec::new();
    for d in dirs {
        if let Ok(Some(mut f)) = read_confined(&canon_root, &d) {
            f.path = crate::util::path_str(&root.join(&d).join(SKILL_FILE));
            out.push(f);
        }
    }
    Ok(out)
}

/// One folder's SKILL.md (`None` when missing); `INVALID` / `PERMISSION` when refused.
pub fn read(root: &Path, name: &str) -> R<Option<SkillFile>> {
    if !valid_dir_name(name) {
        return Err(invalid(format!("Invalid skill folder name \"{name}\"")));
    }
    let Some(canon_root) = canonical_root(root)? else {
        return Ok(None);
    };
    Ok(read_confined(&canon_root, name)?.map(|mut f| {
        f.path = crate::util::path_str(&root.join(name).join(SKILL_FILE));
        f
    }))
}

type Notify = Arc<dyn Fn(&str) + Send + Sync>;

/// The skills root plus its live watches (one debounced recursive watcher per watch id).
pub struct SkillsService {
    root: PathBuf,
    watches: Mutex<HashMap<String, Debouncer<notify::RecommendedWatcher, RecommendedCache>>>,
}

impl SkillsService {
    pub fn new(kimo_home: &Path) -> Self {
        Self {
            root: kimo_home.join(SKILLS_DIR),
            watches: Mutex::new(HashMap::new()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn list(&self) -> R<Vec<SkillFile>> {
        list(&self.root)
    }

    pub fn read(&self, name: &str) -> R<Option<SkillFile>> {
        read(&self.root, name)
    }

    /// Watches the root (created when missing, so a first skill is seen). `notify(watch_id)`
    /// fires once per debounced batch.
    pub fn watch(&self, watch_id: &str, debounce: Duration, notify: Notify) -> R<()> {
        if watch_id.is_empty() || watch_id.len() > 128 {
            return Err(invalid("Invalid watch id"));
        }
        std::fs::create_dir_all(&self.root).map_err(|e| io_msg(format!("skills folder: {e}")))?;
        let id = watch_id.to_string();
        let mut debouncer = new_debouncer(debounce, None, move |res: DebounceEventResult| {
            if let Ok(events) = res {
                if !events.is_empty() {
                    notify(&id);
                }
            }
        })
        .map_err(|e| io_msg(format!("watch skills: {e}")))?;
        debouncer
            .watch(&self.root, RecursiveMode::Recursive)
            .map_err(|e| io_msg(format!("watch skills: {e}")))?;
        self.watches
            .lock()
            .unwrap()
            .insert(watch_id.to_string(), debouncer);
        Ok(())
    }

    pub fn unwatch(&self, watch_id: &str) {
        self.watches.lock().unwrap().remove(watch_id);
    }

    pub fn watch_count(&self) -> usize {
        self.watches.lock().unwrap().len()
    }
}

/// Payload of `EV_SKILLS_CHANGED`.
pub fn changed_payload(watch_id: &str) -> serde_json::Value {
    json!({ "watchId": watch_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SKILL: &str = "---\nname: brand\ndescription: Brand voice\n---\nBody\n";

    fn write(p: &Path, text: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn lists_skill_folders_sorted_and_skips_the_rest() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("skills");
        write(&root.join("zeta/SKILL.md"), SKILL);
        write(&root.join("brand/SKILL.md"), SKILL);
        write(&root.join("notes/README.md"), "x"); // no SKILL.md
        write(&root.join(".hidden/SKILL.md"), SKILL); // not a plain name
        write(&root.join("loose.md"), "x"); // a file, not a folder
        std::fs::create_dir_all(root.join("dir-skill/SKILL.md")).unwrap(); // a directory
        write(
            &root.join("huge/SKILL.md"),
            &"a".repeat(MAX_SKILL_BYTES as usize + 1),
        );
        let got = list(&root).unwrap();
        let names: Vec<_> = got
            .iter()
            .map(|f| {
                Path::new(&f.path)
                    .parent()
                    .unwrap()
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["brand", "zeta"]);
        assert_eq!(got[0].text, SKILL);
        // Component-wise, so it holds with Windows separators too.
        assert!(Path::new(&got[0].path).ends_with("skills/brand/SKILL.md"));
    }

    #[test]
    fn read_refuses_dotdot_and_separators() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("skills");
        write(&t.path().join("SKILL.md"), SKILL);
        write(&root.join("ok/SKILL.md"), SKILL);
        for bad in ["..", "../x", "a/b", "a\\b", ".git", "", "-x", "/etc"] {
            assert_eq!(read(&root, bad).unwrap_err().code, "INVALID", "{bad}");
        }
        assert_eq!(read(&root, "ok").unwrap().unwrap().text, SKILL);
        assert_eq!(read(&root, "missing").unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escapes_are_refused() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("skills");
        let outside = t.path().join("outside");
        write(&outside.join("SKILL.md"), SKILL);
        write(&outside.join("secret.txt"), "secret");
        std::fs::create_dir_all(&root).unwrap();
        // A skill folder that is a symlink to a folder outside the root.
        std::os::unix::fs::symlink(&outside, root.join("escape-dir")).unwrap();
        // A SKILL.md that is a symlink to a file outside the root.
        std::fs::create_dir_all(root.join("escape-file")).unwrap();
        std::os::unix::fs::symlink(
            outside.join("secret.txt"),
            root.join("escape-file/SKILL.md"),
        )
        .unwrap();
        // A symlink that stays inside the root is fine.
        write(&root.join("real/SKILL.md"), SKILL);
        std::os::unix::fs::symlink(root.join("real"), root.join("alias")).unwrap();

        assert_eq!(read(&root, "escape-dir").unwrap_err().code, "PERMISSION");
        assert_eq!(read(&root, "escape-file").unwrap_err().code, "PERMISSION");
        assert_eq!(read(&root, "alias").unwrap().unwrap().text, SKILL);
        let listed: Vec<_> = list(&root).unwrap().into_iter().map(|f| f.path).collect();
        assert_eq!(listed.len(), 2, "{listed:?}");
        assert!(listed.iter().all(|p| !p.contains("escape")));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_root_is_followed_once() {
        // `~/.kimo/skills` itself may be a symlink (dotfiles repos); files under its target count.
        let t = tempfile::tempdir().unwrap();
        let target = t.path().join("dotfiles/skills");
        write(&target.join("brand/SKILL.md"), SKILL);
        std::fs::create_dir_all(t.path().join("home")).unwrap();
        let root = t.path().join("home/skills");
        std::os::unix::fs::symlink(&target, &root).unwrap();
        assert_eq!(list(&root).unwrap().len(), 1);
    }

    #[test]
    fn watch_reports_changes_and_unwatch_stops() {
        let t = tempfile::tempdir().unwrap();
        let svc = SkillsService::new(t.path());
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let tx = Mutex::new(tx);
        svc.watch(
            "w1",
            Duration::from_millis(50),
            Arc::new(move |id| {
                let _ = tx.lock().unwrap().send(id.to_string());
            }),
        )
        .unwrap();
        assert!(svc.root().is_dir(), "the root is created for the watch");
        std::thread::sleep(Duration::from_millis(200));
        write(&svc.root().join("brand/SKILL.md"), SKILL);
        let id = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("change event");
        assert_eq!(id, "w1");
        assert_eq!(svc.list().unwrap().len(), 1);
        svc.unwatch("w1");
        assert_eq!(svc.watch_count(), 0);
        assert_eq!(
            svc.watch("", Duration::from_millis(50), Arc::new(|_| {}))
                .unwrap_err()
                .code,
            "INVALID"
        );
    }
}
