//! The runtime fs scope (ADR 0012 §5): deny by default; widened for files the user picked or
//! opened (association, deep link, argv: the file's folder, so `./assets` and sibling
//! libraries resolve), folders picked in dialogs, watched folders, `~/.kimo` and the app
//! config/data dirs. Every fs command checks it and rejects anything else with `PERMISSION`.

use crate::error::{permission, R};
use crate::util::{clean_abs, path_str};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

#[derive(Default)]
pub struct Scope {
    dirs: RwLock<Vec<PathBuf>>,
}

impl Scope {
    /// Allows `dir` and everything below it.
    pub fn allow_dir(&self, dir: &Path) {
        let mut g = self.dirs.write().unwrap();
        if g.iter().any(|d| dir.starts_with(d)) {
            return;
        }
        g.retain(|d| !d.starts_with(dir));
        g.push(dir.to_path_buf());
    }

    /// Allows a picked/opened file: its folder (assets and libraries resolve next to it).
    pub fn allow_file(&self, file: &Path) {
        if let Some(parent) = file.parent() {
            self.allow_dir(parent);
        }
    }

    pub fn allows(&self, p: &Path) -> bool {
        self.dirs.read().unwrap().iter().any(|d| p.starts_with(d))
    }

    /// Like [`Self::check`], but also accepts a repository root that contains a granted
    /// folder (the merge driver lives at the root of the repo of a file the user opened).
    pub fn check_repo_root(&self, raw: &str) -> R<PathBuf> {
        let p = clean_abs(raw)?;
        let contains_granted = self.dirs.read().unwrap().iter().any(|d| d.starts_with(&p));
        let is_root_of_granted =
            contains_granted && crate::git::find_repo(&p).is_some_and(|r| r.root == p);
        if is_root_of_granted {
            Ok(p)
        } else {
            self.check(raw)
        }
    }

    /// Validates a frontend path (absolute, no `..`) and checks the scope.
    pub fn check(&self, raw: &str) -> R<PathBuf> {
        let p = clean_abs(raw)?;
        if self.allows(&p) {
            Ok(p)
        } else {
            Err(permission(format!(
                "{} is outside the files Kimo was given access to (open it with Open… or add its folder)",
                path_str(&p)
            ))
            .with_errno(Some("EACCES".into())))
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn deny_by_default_then_widen() {
        let s = Scope::default();
        assert_eq!(s.check("/Users/me/a.kimo").unwrap_err().code, "PERMISSION");
        s.allow_file(Path::new("/Users/me/loom/a.kimo"));
        assert!(s.check("/Users/me/loom/a.kimo").is_ok());
        assert!(s.check("/Users/me/loom/assets/x.png").is_ok());
        assert!(s.check("/Users/me/other.kimo").is_err());
        assert_eq!(
            s.check("/Users/me/loom/../secret").unwrap_err().code,
            "INVALID"
        );
        assert!(s.check("/Users/me/loomx/a.kimo").is_err());
        s.allow_dir(Path::new("/Users/me"));
        assert!(s.check("/Users/me/other.kimo").is_ok());
        assert_eq!(s.dirs.read().unwrap().len(), 1);
    }
}
