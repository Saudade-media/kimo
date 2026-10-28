//! Git state of the repository containing a file (ADR 0012 §3 "Git"). Repository layout is
//! read from `.git` directly (HEAD, refs, `*_HEAD`, `rebase-*`, `index.lock`), so branch, head
//! and operation work without a `git` binary; changed counts and file status shell out to
//! `git status` (with `--no-optional-locks`, so Kimo never takes `index.lock` itself) and fall
//! back to "clean, 0 changed" when git is not installed.

use crate::error::{ctx, invalid, R};
use crate::util::path_str;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The merge driver command written to the local git config.
pub const MERGE_DRIVER_COMMAND: &str = "kimo merge %O %A %B %P";
pub const MERGE_DRIVER_NAME: &str = "Kimo semantic three-way merge";
pub const GITATTRIBUTES_LINE: &str = "*.kimo merge=kimo diff=kimo";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repo {
    /// Work tree root.
    pub root: PathBuf,
    /// `.git` dir of this work tree (a worktree's private dir for linked worktrees).
    pub git_dir: PathBuf,
    /// Shared dir (refs, config, packed-refs).
    pub common_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitState {
    pub repo_root: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub operation: Option<&'static str>,
    pub index_locked: bool,
    pub file_status: &'static str,
    pub changed_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum GitChange {
    OperationStarted {
        operation: &'static str,
    },
    OperationFinished {
        operation: &'static str,
    },
    HeadChanged {
        from: Option<String>,
        to: Option<String>,
    },
    BranchChanged {
        from: Option<String>,
        to: Option<String>,
    },
    StatusChanged,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitSummary {
    pub branch: Option<String>,
    pub status: &'static str,
    pub conflicts: u64,
    pub operation: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeDriverStatus {
    pub gitattributes: bool,
    pub config: bool,
}

/// The repository containing `path` (a file, a missing file, or a directory).
pub fn find_repo(path: &Path) -> Option<Repo> {
    let start = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()?.to_path_buf()
    };
    let mut dir = Some(start.as_path());
    while let Some(d) = dir {
        let dotgit = d.join(".git");
        if dotgit.is_dir() {
            return Some(repo_from(d, dotgit));
        }
        if dotgit.is_file() {
            let text = fs::read_to_string(&dotgit).ok()?;
            let target = text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim();
            let gd = if Path::new(target).is_absolute() {
                PathBuf::from(target)
            } else {
                d.join(target)
            };
            return Some(repo_from(d, gd));
        }
        dir = d.parent();
    }
    None
}

fn repo_from(root: &Path, git_dir: PathBuf) -> Repo {
    let common_dir = fs::read_to_string(git_dir.join("commondir"))
        .ok()
        .map(|s| {
            let s = s.trim();
            if Path::new(s).is_absolute() {
                PathBuf::from(s)
            } else {
                git_dir.join(s)
            }
        })
        .unwrap_or_else(|| git_dir.clone());
    Repo {
        root: root.to_path_buf(),
        git_dir,
        common_dir,
    }
}

/// (branch, head sha). Branch is None when detached; head is None in an empty repo.
pub fn read_head(repo: &Repo) -> (Option<String>, Option<String>) {
    let Ok(head) = fs::read_to_string(repo.git_dir.join("HEAD")) else {
        return (None, None);
    };
    let head = head.trim();
    if let Some(r) = head.strip_prefix("ref:") {
        let r = r.trim();
        let branch = r.strip_prefix("refs/heads/").unwrap_or(r).to_string();
        (Some(branch), resolve_ref(repo, r))
    } else if head.len() >= 40 {
        (None, Some(head.to_string()))
    } else {
        (None, None)
    }
}

fn resolve_ref(repo: &Repo, r: &str) -> Option<String> {
    for base in [&repo.git_dir, &repo.common_dir] {
        if let Ok(s) = fs::read_to_string(base.join(r)) {
            let s = s.trim();
            if let Some(inner) = s.strip_prefix("ref:") {
                return resolve_ref(repo, inner.trim());
            }
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    let packed = fs::read_to_string(repo.common_dir.join("packed-refs")).ok()?;
    packed.lines().find_map(|l| {
        let (sha, name) = l.split_once(' ')?;
        (name.trim() == r && !sha.starts_with('#')).then(|| sha.to_string())
    })
}

/// rebase / merge / cherry-pick from the marker files; checkout is detected by the watcher.
pub fn file_operation(repo: &Repo) -> Option<&'static str> {
    let g = &repo.git_dir;
    if g.join("REBASE_HEAD").exists()
        || g.join("rebase-merge").is_dir()
        || g.join("rebase-apply").is_dir()
    {
        Some("rebase")
    } else if g.join("MERGE_HEAD").exists() {
        Some("merge")
    } else if g.join("CHERRY_PICK_HEAD").exists() {
        Some("cherry-pick")
    } else {
        None
    }
}

pub fn index_locked(repo: &Repo) -> bool {
    repo.git_dir.join("index.lock").exists()
}

/// `git status` entries: relative path (`/`-separated, dirs end with `/`) → XY code.
pub struct Status {
    pub entries: Vec<(String, String)>,
    pub changed_count: u64,
}

pub fn status(repo: &Repo) -> Status {
    let out = Command::new("git")
        .arg("-C")
        .arg(&repo.root)
        .args([
            "--no-optional-locks",
            "-c",
            "core.quotepath=off",
            "status",
            "--porcelain=v1",
            "-z",
            "--ignored=matching",
        ])
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output();
    let Ok(out) = out else {
        return Status {
            entries: vec![],
            changed_count: 0,
        };
    };
    if !out.status.success() {
        return Status {
            entries: vec![],
            changed_count: 0,
        };
    }
    parse_status(&out.stdout)
}

pub fn parse_status(raw: &[u8]) -> Status {
    let mut entries = Vec::new();
    let mut changed = 0;
    let mut parts = raw.split(|b| *b == 0).filter(|p| !p.is_empty());
    while let Some(p) = parts.next() {
        if p.len() < 4 {
            continue;
        }
        let xy = String::from_utf8_lossy(&p[..2]).into_owned();
        let path = String::from_utf8_lossy(&p[3..]).into_owned();
        if xy.contains('R') || xy.contains('C') {
            parts.next(); // the original path
        }
        if xy != "!!" {
            changed += 1;
        }
        entries.push((path, xy));
    }
    Status {
        entries,
        changed_count: changed,
    }
}

/// Status of one file from the entries (`clean` when absent).
pub fn file_status(repo: &Repo, st: &Status, file: &Path) -> &'static str {
    let Ok(rel) = file.strip_prefix(&repo.root) else {
        return "clean";
    };
    let rel = rel.to_string_lossy().replace('\\', "/");
    for (p, xy) in &st.entries {
        let hit = *p == rel || (p.ends_with('/') && rel.starts_with(p.as_str()));
        if !hit {
            continue;
        }
        let (x, y) = (xy.as_bytes()[0], xy.as_bytes()[1]);
        return match xy.as_str() {
            "??" => "untracked",
            "!!" => "ignored",
            "AA" | "DD" => "conflict",
            _ if x == b'U' || y == b'U' => "conflict",
            _ => "modified",
        };
    }
    "clean"
}

/// State for `path` (base operation only; [`GitTracker`] adds `checkout`).
pub fn state_of(repo: &Repo, path: &Path) -> GitState {
    let (branch, head) = read_head(repo);
    let st = status(repo);
    GitState {
        repo_root: path_str(&repo.root),
        branch,
        head,
        operation: file_operation(repo),
        index_locked: index_locked(repo),
        file_status: file_status(repo, &st, path),
        changed_count: st.changed_count,
    }
}

pub fn state(path: &Path) -> Option<GitState> {
    find_repo(path).map(|r| state_of(&r, path))
}

/// Unresolved conflicts stored in a `.kimo` (root `conflicts` table, ADR 0012 §1).
pub fn stored_conflicts(path: &Path) -> u64 {
    let Ok(meta) = fs::metadata(path) else {
        return 0;
    };
    if meta.len() > 64 * 1024 * 1024 {
        return 0;
    }
    let Ok(text) = fs::read_to_string(path) else {
        return 0;
    };
    if !text.contains("\"conflicts\"") {
        return 0;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return 0;
    };
    v.get("conflicts")
        .and_then(|c| c.as_object())
        .map(|m| {
            m.values()
                .filter(|e| e.get("resolved").and_then(|r| r.as_bool()) != Some(true))
                .count() as u64
        })
        .unwrap_or(0)
}

/// Repo, its status, branch and operation.
type RepoSnapshot = (Repo, Status, Option<String>, Option<&'static str>);

/// Per-repo cache for listing many files (Home).
#[derive(Default)]
pub struct SummaryCache {
    repos: HashMap<PathBuf, Option<RepoSnapshot>>,
}

impl SummaryCache {
    pub fn summary(&mut self, file: &Path) -> Option<GitSummary> {
        let repo = find_repo(file)?;
        let entry = self.repos.entry(repo.root.clone()).or_insert_with(|| {
            let (branch, _) = read_head(&repo);
            let op = file_operation(&repo);
            Some((repo.clone(), status(&repo), branch, op))
        });
        let (repo, st, branch, op) = entry.as_ref()?;
        let status = file_status(repo, st, file);
        let mut conflicts = stored_conflicts(file);
        if status == "conflict" && conflicts == 0 {
            conflicts = 1;
        }
        Some(GitSummary {
            branch: branch.clone(),
            status,
            conflicts,
            operation: *op,
        })
    }

    /// Branch + changed count of the repo containing (or at) `dir`.
    pub fn folder(&mut self, dir: &Path) -> Option<(Option<String>, u64)> {
        let repo = find_repo(dir)?;
        let entry = self.repos.entry(repo.root.clone()).or_insert_with(|| {
            let (branch, _) = read_head(&repo);
            let op = file_operation(&repo);
            Some((repo.clone(), status(&repo), branch, op))
        });
        let (_, st, branch, _) = entry.as_ref()?;
        Some((branch.clone(), st.changed_count))
    }
}

/// Turns successive states into {@link GitChange}s and detects checkouts ("a HEAD change
/// while `index.lock` exists").
#[derive(Default)]
pub struct GitTracker {
    pub prev: Option<GitState>,
    checkout: bool,
}

impl GitTracker {
    pub fn new(initial: Option<GitState>) -> Self {
        Self {
            prev: initial,
            checkout: false,
        }
    }

    /// `next` comes from [`state_of`]; `lock_touched` says whether the batch of fs events
    /// included `.git/index.lock` (it may already be gone when the batch is delivered).
    pub fn update(
        &mut self,
        next: Option<GitState>,
        lock_touched: bool,
    ) -> Vec<(Option<GitState>, GitChange)> {
        let mut out = Vec::new();
        let Some(mut next) = next else {
            if self.prev.is_some() {
                self.prev = None;
                self.checkout = false;
                out.push((None, GitChange::StatusChanged));
            }
            return out;
        };
        let prev = self.prev.clone();
        // The HEAD file itself changed (branch switch, or a detached HEAD moved). A commit on a
        // branch only moves `refs/heads/<branch>`, so it is never mistaken for a checkout even
        // though it also takes `index.lock`.
        let head_moved = prev.as_ref().is_some_and(|p| {
            p.branch != next.branch || (next.branch.is_none() && p.head != next.head)
        });
        let mut checkout_flash = false;
        if next.operation.is_none() {
            if self.checkout {
                if next.index_locked {
                    next.operation = Some("checkout");
                } else {
                    self.checkout = false;
                }
            } else if head_moved && (next.index_locked || lock_touched) {
                if next.index_locked {
                    self.checkout = true;
                    next.operation = Some("checkout");
                } else {
                    checkout_flash = true;
                }
            }
        } else {
            self.checkout = false;
        }

        let prev_op = prev.as_ref().and_then(|p| p.operation);
        if checkout_flash {
            let mut mid = next.clone();
            mid.operation = Some("checkout");
            out.push((
                Some(mid),
                GitChange::OperationStarted {
                    operation: "checkout",
                },
            ));
            out.push((
                Some(next.clone()),
                GitChange::OperationFinished {
                    operation: "checkout",
                },
            ));
        } else if prev_op != next.operation {
            if let Some(op) = prev_op {
                out.push((
                    Some(next.clone()),
                    GitChange::OperationFinished { operation: op },
                ));
            }
            if let Some(op) = next.operation {
                out.push((
                    Some(next.clone()),
                    GitChange::OperationStarted { operation: op },
                ));
            }
        }
        if let Some(p) = &prev {
            if p.branch != next.branch {
                out.push((
                    Some(next.clone()),
                    GitChange::BranchChanged {
                        from: p.branch.clone(),
                        to: next.branch.clone(),
                    },
                ));
            }
            if p.head != next.head {
                out.push((
                    Some(next.clone()),
                    GitChange::HeadChanged {
                        from: p.head.clone(),
                        to: next.head.clone(),
                    },
                ));
            }
            if out.is_empty()
                && (p.changed_count != next.changed_count
                    || p.file_status != next.file_status
                    || p.index_locked != next.index_locked)
            {
                out.push((Some(next.clone()), GitChange::StatusChanged));
            }
        }
        self.prev = Some(next);
        out
    }
}

// --- merge driver ------------------------------------------------------------------------------

fn attributes_has_driver(text: &str) -> bool {
    text.lines().any(|l| {
        let mut it = l.split_whitespace();
        it.next() == Some("*.kimo") && it.any(|a| a == "merge=kimo")
    })
}

/// Reads `merge.kimo.driver` from a git config file (local config only).
fn config_has_driver(text: &str) -> bool {
    let mut in_section = false;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with('[') {
            let inner = l.trim_start_matches('[').trim_end_matches(']').trim();
            in_section = inner == "merge \"kimo\"";
            continue;
        }
        if in_section {
            if let Some((k, v)) = l.split_once('=') {
                if k.trim().eq_ignore_ascii_case("driver") && !v.trim().is_empty() {
                    return true;
                }
            }
        }
    }
    false
}

pub fn merge_driver_status(root: &Path) -> R<MergeDriverStatus> {
    let repo = find_repo(root)
        .ok_or_else(|| invalid(format!("Not in a git repository: {}", path_str(root))))?;
    let attrs = fs::read_to_string(repo.root.join(".gitattributes")).unwrap_or_default();
    let config = fs::read_to_string(repo.common_dir.join("config")).unwrap_or_default();
    Ok(MergeDriverStatus {
        gitattributes: attributes_has_driver(&attrs),
        config: config_has_driver(&config),
    })
}

pub fn install_merge_driver(root: &Path) -> R<()> {
    let repo = find_repo(root)
        .ok_or_else(|| invalid(format!("Not in a git repository: {}", path_str(root))))?;
    let attrs_path = repo.root.join(".gitattributes");
    let attrs = match fs::read_to_string(&attrs_path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(ctx(&path_str(&attrs_path))(e)),
    };
    if !attributes_has_driver(&attrs) {
        let mut next = attrs.clone();
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str(GITATTRIBUTES_LINE);
        next.push('\n');
        crate::fs_ops::write_atomic(&attrs_path, next.as_bytes(), false)?;
    }
    let cfg_path = repo.common_dir.join("config");
    let cfg = fs::read_to_string(&cfg_path).unwrap_or_default();
    if !config_has_driver(&cfg) {
        let via_git = |key: &str, value: &str| {
            Command::new("git")
                .arg("-C")
                .arg(&repo.root)
                .args(["config", "--local", key, value])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        };
        let ok = via_git("merge.kimo.name", MERGE_DRIVER_NAME)
            && via_git("merge.kimo.driver", MERGE_DRIVER_COMMAND);
        if !ok {
            // No git binary: append the section ourselves.
            let mut next = cfg.clone();
            if !next.is_empty() && !next.ends_with('\n') {
                next.push('\n');
            }
            next.push_str(&format!(
                "[merge \"kimo\"]\n\tname = {MERGE_DRIVER_NAME}\n\tdriver = {MERGE_DRIVER_COMMAND}\n"
            ));
            crate::fs_ops::write_atomic(&cfg_path, next.as_bytes(), false)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(dir: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .arg("-C")
            .arg(dir)
            .args([
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "init.defaultBranch=main",
            ])
            .args(args)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    fn have_git() -> bool {
        Command::new("git").arg("--version").output().is_ok()
    }
    fn repo_with_commit() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        assert!(git(d.path(), &["init", "-q"]));
        fs::write(d.path().join("doc.kimo"), "{}\n").unwrap();
        assert!(git(d.path(), &["add", "."]));
        assert!(git(d.path(), &["commit", "-qm", "init"]));
        d
    }

    #[test]
    fn detects_operations_from_marker_files() {
        if !have_git() {
            return;
        }
        let d = repo_with_commit();
        let file = d.path().join("doc.kimo");
        let s = state(&file).unwrap();
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.head.as_ref().map(|h| h.len()), Some(40));
        assert_eq!(
            (s.operation, s.index_locked, s.file_status, s.changed_count),
            (None, false, "clean", 0)
        );
        let g = d.path().join(".git");
        for (marker, op) in [
            ("MERGE_HEAD", "merge"),
            ("CHERRY_PICK_HEAD", "cherry-pick"),
            ("REBASE_HEAD", "rebase"),
        ] {
            fs::write(g.join(marker), "0000000000000000000000000000000000000000\n").unwrap();
            assert_eq!(state(&file).unwrap().operation, Some(op), "{marker}");
            fs::remove_file(g.join(marker)).unwrap();
        }
        fs::create_dir(g.join("rebase-merge")).unwrap();
        assert_eq!(state(&file).unwrap().operation, Some("rebase"));
        fs::remove_dir(g.join("rebase-merge")).unwrap();
        fs::write(g.join("index.lock"), "").unwrap();
        let s = state(&file).unwrap();
        assert!(s.index_locked);
        assert_eq!(s.operation, None);
        fs::remove_file(g.join("index.lock")).unwrap();

        fs::write(&file, "{\"x\":1}\n").unwrap();
        fs::write(d.path().join("new.kimo"), "{}").unwrap();
        let s = state(&file).unwrap();
        assert_eq!((s.file_status, s.changed_count), ("modified", 2));
        assert_eq!(
            state(&d.path().join("new.kimo")).unwrap().file_status,
            "untracked"
        );
    }

    #[test]
    fn real_merge_conflict() {
        if !have_git() {
            return;
        }
        let d = repo_with_commit();
        let file = d.path().join("doc.kimo");
        assert!(git(d.path(), &["checkout", "-qb", "other"]));
        fs::write(&file, "{\"a\":2}\n").unwrap();
        assert!(git(d.path(), &["commit", "-qam", "other"]));
        assert!(git(d.path(), &["checkout", "-q", "main"]));
        fs::write(&file, "{\"a\":3}\n").unwrap();
        assert!(git(d.path(), &["commit", "-qam", "main"]));
        assert!(!git(d.path(), &["merge", "-q", "other"]));
        let s = state(&file).unwrap();
        assert_eq!((s.operation, s.file_status), (Some("merge"), "conflict"));
        let mut cache = SummaryCache::default();
        let sum = cache.summary(&file).unwrap();
        assert_eq!(
            (sum.status, sum.conflicts, sum.operation),
            ("conflict", 1, Some("merge"))
        );
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["operation"], "merge");
        assert_eq!(json["repoRoot"], path_str(d.path()));
    }

    #[test]
    fn detached_head_and_worktree() {
        if !have_git() {
            return;
        }
        let d = repo_with_commit();
        assert!(git(d.path(), &["checkout", "-q", "--detach"]));
        let s = state(&d.path().join("doc.kimo")).unwrap();
        assert_eq!(s.branch, None);
        assert!(s.head.is_some());
        let wt = d.path().join("wt");
        assert!(git(
            d.path(),
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "feat/x",
                wt.to_str().unwrap()
            ]
        ));
        let s = state(&wt.join("doc.kimo")).unwrap();
        assert_eq!(s.branch.as_deref(), Some("feat/x"));
        assert_eq!(s.repo_root, path_str(&wt));
        assert!(s.head.is_some());
    }

    #[test]
    fn tracker_detects_checkout() {
        let base = GitState {
            repo_root: "/r".into(),
            branch: Some("main".into()),
            head: Some("a".into()),
            operation: None,
            index_locked: false,
            file_status: "clean",
            changed_count: 0,
        };
        let mut t = GitTracker::new(Some(base.clone()));
        // Lock appears, HEAD moves to another branch while it is held.
        let mut s1 = base.clone();
        s1.index_locked = true;
        s1.branch = Some("feat".into());
        s1.head = Some("b".into());
        let ch = t.update(Some(s1.clone()), true);
        let kinds: Vec<_> = ch.iter().map(|(_, c)| c.clone()).collect();
        assert_eq!(
            kinds[0],
            GitChange::OperationStarted {
                operation: "checkout"
            }
        );
        assert!(kinds.contains(&GitChange::BranchChanged {
            from: Some("main".into()),
            to: Some("feat".into())
        }));
        assert_eq!(ch[0].0.as_ref().unwrap().operation, Some("checkout"));
        // Lock released: finished.
        let mut s2 = s1.clone();
        s2.index_locked = false;
        let ch = t.update(Some(s2), true);
        assert_eq!(
            ch[0].1,
            GitChange::OperationFinished {
                operation: "checkout"
            }
        );
        assert_eq!(ch[0].0.as_ref().unwrap().operation, None);
        // Both inside one debounce window: started + finished.
        let mut s3 = base.clone();
        s3.head = Some("c".into());
        let ch = t.update(Some(s3), true);
        assert_eq!(
            ch[0].1,
            GitChange::OperationStarted {
                operation: "checkout"
            }
        );
        assert_eq!(
            ch[1].1,
            GitChange::OperationFinished {
                operation: "checkout"
            }
        );
        // A commit (the branch ref moves under index.lock) is not a checkout.
        let mut s4 = t.prev.clone().unwrap();
        s4.head = Some("d".into());
        let ch = t.update(Some(s4), true);
        assert_eq!(ch.len(), 1);
        assert_eq!(
            ch[0].1,
            GitChange::HeadChanged {
                from: Some("c".into()),
                to: Some("d".into())
            }
        );
        // Lock alone: status-changed, operation stays null.
        let mut s5 = t.prev.clone().unwrap();
        s5.index_locked = true;
        let ch = t.update(Some(s5), true);
        assert_eq!(ch.len(), 1);
        assert_eq!(ch[0].1, GitChange::StatusChanged);
        assert_eq!(ch[0].0.as_ref().unwrap().operation, None);
        // Merge marker.
        let mut s6 = t.prev.clone().unwrap();
        s6.index_locked = false;
        s6.operation = Some("merge");
        let ch = t.update(Some(s6), false);
        assert_eq!(ch[0].1, GitChange::OperationStarted { operation: "merge" });
        assert_eq!(
            serde_json::to_value(&ch[0].1).unwrap(),
            serde_json::json!({"kind":"operation-started","operation":"merge"})
        );
    }

    #[test]
    fn merge_driver_install() {
        if !have_git() {
            return;
        }
        let d = repo_with_commit();
        assert_eq!(
            merge_driver_status(d.path()).unwrap(),
            MergeDriverStatus {
                gitattributes: false,
                config: false
            }
        );
        fs::write(d.path().join(".gitattributes"), "*.png binary").unwrap();
        install_merge_driver(d.path()).unwrap();
        install_merge_driver(d.path()).unwrap();
        assert_eq!(
            merge_driver_status(d.path()).unwrap(),
            MergeDriverStatus {
                gitattributes: true,
                config: true
            }
        );
        let attrs = fs::read_to_string(d.path().join(".gitattributes")).unwrap();
        assert_eq!(attrs, format!("*.png binary\n{GITATTRIBUTES_LINE}\n"));
        let out = Command::new("git")
            .arg("-C")
            .arg(d.path())
            .args(["config", "--get", "merge.kimo.driver"])
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            MERGE_DRIVER_COMMAND
        );
    }

    #[test]
    fn parses_porcelain_z() {
        let st = parse_status(
            b" M a.kimo\0R  new.kimo\0old.kimo\0?? dir/\0!! node_modules/\0UU c.kimo\0",
        );
        assert_eq!(st.changed_count, 4);
        assert_eq!(st.entries.len(), 5);
    }
}
