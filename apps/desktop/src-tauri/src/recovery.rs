//! Recovery store (ADR 0012 §3): `~/.kimo/recovery/<id>.kimo` (the document) +
//! `<id>.meta.json` (the entry without `bytes`/`hash`/`ownerAlive`). id = `sha256(path)[:16]`
//! or `untitled-<docId>`.

use crate::error::{ctx, invalid, not_found, R};
use crate::fs_ops::write_atomic;
use crate::util::{now_ms, path_str, pid_alive, read_json, sha256_hex, system_time_ms, write_json};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const REASONS: &[&str] = &[
    "snapshot",
    "upgrade-pending",
    "git-stash",
    "save-failed",
    "read-back-mismatch",
    "untitled",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryWriteInput {
    pub id: String,
    pub source_ref: Option<String>,
    pub name: String,
    pub reason: String,
    pub text: String,
    pub edits: u64,
    #[serde(default)]
    pub last_autosave_at: Option<u64>,
    #[serde(default)]
    pub layers: Option<u64>,
}

/// `<id>.meta.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryMeta {
    pub id: String,
    pub source_ref: Option<String>,
    pub name: String,
    pub reason: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub edits: u64,
    pub last_autosave_at: Option<u64>,
    /// As of the write; recomputed from the source file's mtime on read.
    #[serde(default)]
    pub source_changed_since: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layers: Option<u64>,
    pub owner_pid: u32,
    #[serde(default)]
    pub owner_exited_at: Option<u64>,
    pub app_version: String,
    /// Host of the owner (extra key; entries from another host never count as alive here).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_host: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub id: String,
    pub source_ref: Option<String>,
    pub name: String,
    pub reason: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub edits: u64,
    pub last_autosave_at: Option<u64>,
    pub source_changed_since: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layers: Option<u64>,
    pub bytes: u64,
    pub hash: String,
    pub owner_pid: u32,
    pub owner_alive: bool,
    pub owner_exited_at: Option<u64>,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryRead {
    pub entry: RecoveryEntry,
    pub text: String,
}

pub struct RecoveryStore {
    pub dir: PathBuf,
    pub pid: u32,
    pub host: String,
    pub app_version: String,
}

/// `<16 hex>` or `untitled-<docId>`: never a path.
pub fn valid_id(id: &str) -> bool {
    let hex16 = id.len() == 16
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
    let untitled = id.strip_prefix("untitled-").is_some_and(|rest| {
        !rest.is_empty()
            && rest.len() <= 64
            && rest
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    });
    hex16 || untitled
}

impl RecoveryStore {
    fn doc_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.kimo"))
    }
    fn meta_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.meta.json"))
    }
    fn check(id: &str) -> R<()> {
        if valid_id(id) {
            Ok(())
        } else {
            Err(invalid(format!("Invalid recovery id {id:?}")))
        }
    }

    fn entry(&self, meta: RecoveryMeta, bytes: &[u8]) -> RecoveryEntry {
        let same_host = meta.owner_host.as_deref().map_or(true, |h| h == self.host);
        let owner_alive = same_host && pid_alive(meta.owner_pid);
        // A dead owner without a recorded exit "quit unexpectedly" after its last write.
        let owner_exited_at = match (owner_alive, meta.owner_exited_at) {
            (false, None) => Some(meta.updated_at),
            (_, t) => t,
        };
        let source_changed_since = match &meta.source_ref {
            Some(src) => fs::metadata(src)
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| system_time_ms(t) > meta.updated_at),
            None => None,
        };
        RecoveryEntry {
            id: meta.id,
            source_ref: meta.source_ref,
            name: meta.name,
            reason: meta.reason,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
            edits: meta.edits,
            last_autosave_at: meta.last_autosave_at,
            source_changed_since,
            layers: meta.layers,
            bytes: bytes.len() as u64,
            hash: sha256_hex(bytes),
            owner_pid: meta.owner_pid,
            owner_alive,
            owner_exited_at,
            app_version: meta.app_version,
        }
    }

    fn load(&self, id: &str) -> R<Option<(RecoveryMeta, Vec<u8>)>> {
        let Some(meta) = read_json::<RecoveryMeta>(&self.meta_path(id))? else {
            return Ok(None);
        };
        match fs::read(self.doc_path(id)) {
            Ok(bytes) => Ok(Some((meta, bytes))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(ctx(&path_str(&self.doc_path(id)))(e)),
        }
    }

    /// Newest `updatedAt` first.
    pub fn list(&self) -> R<Vec<RecoveryEntry>> {
        let mut out = Vec::new();
        let rd = match fs::read_dir(&self.dir) {
            Ok(rd) => rd,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(ctx(&path_str(&self.dir))(e)),
        };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let Some(id) = name.strip_suffix(".meta.json") else {
                continue;
            };
            if !valid_id(id) {
                continue;
            }
            if let Some((meta, bytes)) = self.load(id)? {
                out.push(self.entry(meta, &bytes));
            }
        }
        out.sort_by_key(|a| std::cmp::Reverse(a.updated_at));
        Ok(out)
    }

    pub fn write(&self, input: RecoveryWriteInput) -> R<RecoveryEntry> {
        Self::check(&input.id)?;
        if !REASONS.contains(&input.reason.as_str()) {
            return Err(invalid(format!(
                "Unknown recovery reason {:?}",
                input.reason
            )));
        }
        let prev = read_json::<RecoveryMeta>(&self.meta_path(&input.id))?;
        let now = now_ms();
        let meta = RecoveryMeta {
            id: input.id.clone(),
            source_ref: input.source_ref,
            name: input.name,
            reason: input.reason,
            created_at: prev.as_ref().map(|p| p.created_at).unwrap_or(now),
            updated_at: now,
            edits: input.edits,
            last_autosave_at: input.last_autosave_at,
            source_changed_since: None,
            layers: input.layers,
            owner_pid: self.pid,
            owner_exited_at: None,
            app_version: self.app_version.clone(),
            owner_host: Some(self.host.clone()),
        };
        // Document first, then the meta that makes it visible to `list`.
        write_atomic(&self.doc_path(&input.id), input.text.as_bytes(), true)?;
        write_json(&self.meta_path(&input.id), &meta)?;
        Ok(self.entry(meta, input.text.as_bytes()))
    }

    pub fn read(&self, id: &str) -> R<RecoveryRead> {
        Self::check(id)?;
        let Some((meta, bytes)) = self.load(id)? else {
            return Err(not_found(format!("No recovery entry {id}")));
        };
        let text = String::from_utf8_lossy(&bytes).into_owned();
        Ok(RecoveryRead {
            entry: self.entry(meta, &bytes),
            text,
        })
    }

    pub fn discard(&self, id: &str) -> R<()> {
        Self::check(id)?;
        crate::fs_ops::remove(&self.meta_path(id))?;
        crate::fs_ops::remove(&self.doc_path(id))?;
        Ok(())
    }

    /// Removes entries whose `updatedAt` is older than `max_age_ms`, plus orphan `.kimo`
    /// files of that age. Returns the number of entries removed.
    pub fn prune(&self, max_age_ms: u64) -> R<u64> {
        let now = now_ms();
        let mut n = 0;
        for e in self.list()? {
            if now.saturating_sub(e.updated_at) > max_age_ms {
                self.discard(&e.id)?;
                n += 1;
            }
        }
        if let Ok(rd) = fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                let Some(id) = name.strip_suffix(".kimo") else {
                    continue;
                };
                if !valid_id(id) || self.meta_path(id).exists() {
                    continue;
                }
                let old = e
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .is_some_and(|t| now.saturating_sub(system_time_ms(t)) > max_age_ms);
                if old {
                    let _ = fs::remove_file(e.path());
                }
            }
        }
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &std::path::Path, pid: u32) -> RecoveryStore {
        RecoveryStore {
            dir: dir.join("recovery"),
            pid,
            host: crate::util::hostname(),
            app_version: "0.4.2".into(),
        }
    }
    fn input(id: &str, text: &str) -> RecoveryWriteInput {
        RecoveryWriteInput {
            id: id.into(),
            source_ref: Some("/nonexistent/marketing.kimo".into()),
            name: "marketing.kimo".into(),
            reason: "snapshot".into(),
            text: text.into(),
            edits: 14,
            last_autosave_at: Some(5),
            layers: None,
        }
    }

    #[test]
    fn write_list_read_discard() {
        let d = tempfile::tempdir().unwrap();
        let s = store(d.path(), std::process::id());
        let id = crate::util::path_id("/nonexistent/marketing.kimo");
        let e = s.write(input(&id, "{\"v\":1}")).unwrap();
        assert!(e.owner_alive);
        assert_eq!(e.owner_exited_at, None);
        assert_eq!(e.bytes, 7);
        assert_eq!(e.hash, sha256_hex(b"{\"v\":1}"));
        assert!(s.dir.join(format!("{id}.kimo")).exists());
        let meta: serde_json::Value =
            serde_json::from_slice(&fs::read(s.dir.join(format!("{id}.meta.json"))).unwrap())
                .unwrap();
        assert!(
            meta.get("bytes").is_none()
                && meta.get("hash").is_none()
                && meta.get("ownerAlive").is_none()
        );
        assert_eq!(meta["sourceRef"], "/nonexistent/marketing.kimo");

        let created = e.created_at;
        std::thread::sleep(std::time::Duration::from_millis(5));
        let e2 = s.write(input(&id, "{\"v\":2}")).unwrap();
        assert_eq!(e2.created_at, created);
        assert!(e2.updated_at >= created);

        let list = s.list().unwrap();
        assert_eq!(list.len(), 1);
        let json = serde_json::to_value(&list[0]).unwrap();
        assert_eq!(json["sourceChangedSince"], serde_json::Value::Null);
        assert_eq!(json["ownerAlive"], true);
        assert!(json.get("layers").is_none());

        let r = s.read(&id).unwrap();
        assert_eq!(r.text, "{\"v\":2}");
        s.discard(&id).unwrap();
        assert!(s.list().unwrap().is_empty());
        assert_eq!(s.read(&id).unwrap_err().code, "NOT_FOUND");
    }

    #[test]
    fn dead_owner_and_source_changed() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("doc.kimo");
        fs::write(&src, b"old").unwrap();
        let s = store(d.path(), 9_999_999);
        let mut i = input("untitled-Abc123", "{}");
        i.source_ref = Some(path_str(&src));
        i.layers = Some(22);
        s.write(i).unwrap();
        let e = &s.list().unwrap()[0];
        assert!(!e.owner_alive);
        assert_eq!(e.owner_exited_at, Some(e.updated_at));
        assert_eq!(e.source_changed_since, Some(false));
        assert_eq!(e.layers, Some(22));
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&src, b"newer").unwrap();
        assert_eq!(s.list().unwrap()[0].source_changed_since, Some(true));
    }

    #[test]
    fn prune_and_ids() {
        let d = tempfile::tempdir().unwrap();
        let s = store(d.path(), std::process::id());
        s.write(input("0123456789abcdef", "a")).unwrap();
        assert_eq!(s.prune(60_000).unwrap(), 0);
        std::thread::sleep(std::time::Duration::from_millis(10));
        assert_eq!(s.prune(1).unwrap(), 1);
        assert!(s.list().unwrap().is_empty());
        for bad in [
            "../x",
            "0123456789ABCDEF",
            "untitled-",
            "untitled-a/b",
            "abc",
        ] {
            assert_eq!(
                s.write(input(bad, "x")).unwrap_err().code,
                "INVALID",
                "{bad}"
            );
        }
        let mut i = input("0123456789abcdef", "x");
        i.reason = "nope".into();
        assert_eq!(s.write(i).unwrap_err().code, "INVALID");
    }
}
