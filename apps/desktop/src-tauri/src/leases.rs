//! Per-file leases (ADR 0012 §3): `~/.kimo/locks/<sha256(path)[:16]>.lock`, created with
//! O_EXCL, JSON body `{version, path, pid, app, appLabel, host, sinceIso, socket?, token}`
//! shared with the CLI and headless MCP. A holder whose pid is dead on the same host is
//! reclaimed on acquire.

use crate::error::{ctx, io_err, PlatformErrorPayload, R};
use crate::util::{hostname, iso_from_ms, now_ms, path_id, path_str, pid_alive};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// The lock file body.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LockBody {
    pub version: u32,
    pub path: String,
    pub pid: u32,
    pub app: String,
    pub app_label: String,
    pub host: String,
    pub since_iso: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub socket: Option<String>,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LeaseHolder {
    pub pid: u32,
    pub app: String,
    pub app_label: String,
    pub host: String,
    pub since_iso: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub socket: Option<String>,
    pub lock_path: String,
    pub alive: bool,
    #[serde(rename = "self")]
    pub is_self: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Lease {
    #[serde(rename = "ref")]
    pub file_ref: String,
    pub token: String,
    pub holder: LeaseHolder,
}

/// `{ ok: true, lease, reclaimed? } | { ok: false, holder }`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum AcquireResult {
    Acquired {
        ok: True,
        lease: Lease,
        #[serde(skip_serializing_if = "Option::is_none")]
        reclaimed: Option<LeaseHolder>,
    },
    Held {
        ok: False,
        holder: LeaseHolder,
    },
}

/// Serializes as `true`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct True;
impl Serialize for True {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(true)
    }
}
/// Serializes as `false`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct False;
impl Serialize for False {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(false)
    }
}

/// Who this process is, as written into lock files.
#[derive(Debug, Clone)]
pub struct Identity {
    pub pid: u32,
    pub host: String,
    pub app: String,
    pub app_label: String,
}

impl Identity {
    pub fn desktop() -> Self {
        Self {
            pid: std::process::id(),
            host: hostname(),
            app: "kimo-desktop".into(),
            app_label: "Kimo".into(),
        }
    }
}

pub struct Leases {
    pub dir: PathBuf,
    pub me: Identity,
}

impl Leases {
    pub fn new(dir: PathBuf, me: Identity) -> Self {
        Self { dir, me }
    }

    pub fn lock_path(&self, path: &str) -> PathBuf {
        self.dir.join(format!("{}.lock", path_id(path)))
    }

    fn view(&self, body: &LockBody, lock: &Path) -> LeaseHolder {
        let same_host = body.host == self.me.host;
        LeaseHolder {
            pid: body.pid,
            app: body.app.clone(),
            app_label: body.app_label.clone(),
            host: body.host.clone(),
            since_iso: body.since_iso.clone(),
            socket: body.socket.clone(),
            lock_path: path_str(lock),
            alive: !same_host || pid_alive(body.pid),
            is_self: same_host && body.pid == self.me.pid,
        }
    }

    /// Reads a lock body. A file that is still being written (empty or partial JSON) is retried
    /// briefly; a body that never parses counts as a dead holder.
    fn read_body(&self, lock: &Path) -> io::Result<Option<LockBody>> {
        for attempt in 0..5 {
            match fs::read(lock) {
                Ok(bytes) => {
                    if let Ok(b) = serde_json::from_slice::<LockBody>(&bytes) {
                        return Ok(Some(b));
                    }
                    if attempt < 4 {
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
                Err(e) => return Err(e),
            }
        }
        Ok(Some(LockBody {
            version: 1,
            path: String::new(),
            pid: 0,
            app: "unknown".into(),
            app_label: "Unknown app".into(),
            host: self.me.host.clone(),
            since_iso: iso_from_ms(0),
            socket: None,
            token: String::new(),
        }))
    }

    pub fn inspect(&self, path: &str) -> R<Option<LeaseHolder>> {
        let lock = self.lock_path(path);
        Ok(self
            .read_body(&lock)
            .map_err(ctx(&path_str(&lock)))?
            .map(|b| self.view(&b, &lock)))
    }

    pub fn acquire(&self, path: &str, reclaim_stale: bool) -> R<AcquireResult> {
        fs::create_dir_all(&self.dir).map_err(ctx(&path_str(&self.dir)))?;
        let lock = self.lock_path(path);
        let mut reclaimed: Option<LeaseHolder> = None;
        for _ in 0..3 {
            let token = uuid::Uuid::new_v4().simple().to_string();
            let body = LockBody {
                version: 1,
                path: path.to_string(),
                pid: self.me.pid,
                app: self.me.app.clone(),
                app_label: self.me.app_label.clone(),
                host: self.me.host.clone(),
                since_iso: iso_from_ms(now_ms()),
                socket: None,
                token: token.clone(),
            };
            match OpenOptions::new().write(true).create_new(true).open(&lock) {
                Ok(mut f) => {
                    let json = serde_json::to_vec(&body).expect("lock body serializes");
                    let written = f.write_all(&json).and_then(|_| f.sync_all());
                    if let Err(e) = written {
                        drop(f);
                        let _ = fs::remove_file(&lock);
                        return Err(io_err(e, &path_str(&lock)));
                    }
                    let holder = self.view(&body, &lock);
                    return Ok(AcquireResult::Acquired {
                        ok: True,
                        lease: Lease {
                            file_ref: path.to_string(),
                            token,
                            holder,
                        },
                        reclaimed,
                    });
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                    let Some(existing) = self.read_body(&lock).map_err(ctx(&path_str(&lock)))?
                    else {
                        continue; // released in between: retry
                    };
                    let view = self.view(&existing, &lock);
                    if view.is_self {
                        // Re-entrant: this process already holds it.
                        return Ok(AcquireResult::Acquired {
                            ok: True,
                            lease: Lease {
                                file_ref: path.to_string(),
                                token: existing.token,
                                holder: view,
                            },
                            reclaimed: None,
                        });
                    }
                    if view.alive || !reclaim_stale {
                        return Ok(AcquireResult::Held {
                            ok: False,
                            holder: view,
                        });
                    }
                    match fs::remove_file(&lock) {
                        Ok(()) => {}
                        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                        Err(e) => return Err(io_err(e, &path_str(&lock))),
                    }
                    reclaimed = Some(view);
                }
                Err(e) => return Err(io_err(e, &path_str(&lock))),
            }
        }
        Err(PlatformErrorPayload::new(
            "LOCKED",
            format!("Could not take the lease of {path}"),
        ))
    }

    /// Removes the lock when `token` matches; a no-op otherwise (it was reclaimed or released).
    pub fn release(&self, path: &str, token: &str) -> R<()> {
        let lock = self.lock_path(path);
        if let Some(b) = self.read_body(&lock).map_err(ctx(&path_str(&lock)))? {
            if b.token == token {
                match fs::remove_file(&lock) {
                    Ok(()) => {}
                    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                    Err(e) => return Err(io_err(e, &path_str(&lock))),
                }
            }
        }
        Ok(())
    }

    /// Removes every lock this process holds (clean exit).
    pub fn release_all_own(&self) {
        let Ok(rd) = fs::read_dir(&self.dir) else {
            return;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("lock") {
                continue;
            }
            if let Ok(Some(b)) = self.read_body(&p) {
                if b.pid == self.me.pid && b.host == self.me.host {
                    let _ = fs::remove_file(&p);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leases(dir: &Path, pid: u32) -> Leases {
        Leases::new(
            dir.to_path_buf(),
            Identity {
                pid,
                host: hostname(),
                app: "kimo-desktop".into(),
                app_label: "Kimo".into(),
            },
        )
    }

    #[test]
    fn acquire_inspect_release() {
        let d = tempfile::tempdir().unwrap();
        let l = leases(d.path(), std::process::id());
        let AcquireResult::Acquired {
            lease, reclaimed, ..
        } = l.acquire("/a/doc.kimo", true).unwrap()
        else {
            panic!("expected acquired")
        };
        assert!(reclaimed.is_none());
        assert!(lease.holder.is_self && lease.holder.alive);
        let lock = l.lock_path("/a/doc.kimo");
        assert_eq!(lock.file_name().unwrap().to_string_lossy().len(), 16 + 5);
        let body: serde_json::Value = serde_json::from_slice(&fs::read(&lock).unwrap()).unwrap();
        assert_eq!(body["version"], 1);
        assert_eq!(body["path"], "/a/doc.kimo");
        assert_eq!(body["appLabel"], "Kimo");
        assert!(body.get("socket").is_none());
        // JSON shape of the result.
        let json = serde_json::to_value(l.acquire("/a/doc.kimo", true).unwrap()).unwrap();
        assert_eq!(json["ok"], true);
        assert_eq!(json["lease"]["token"], lease.token.as_str());
        assert_eq!(json["lease"]["holder"]["self"], true);
        // Wrong token: no-op.
        l.release("/a/doc.kimo", "nope").unwrap();
        assert!(l.inspect("/a/doc.kimo").unwrap().is_some());
        l.release("/a/doc.kimo", &lease.token).unwrap();
        assert!(l.inspect("/a/doc.kimo").unwrap().is_none());
    }

    #[test]
    fn live_foreign_holder_blocks() {
        let d = tempfile::tempdir().unwrap();
        // "Another process": a different pid that is alive (our parent).
        #[cfg(unix)]
        let other = unsafe { libc::getppid() } as u32;
        #[cfg(not(unix))]
        let other = 4;
        let them = leases(d.path(), other);
        assert!(matches!(
            them.acquire("/a/doc.kimo", true).unwrap(),
            AcquireResult::Acquired { .. }
        ));
        let me = leases(d.path(), std::process::id());
        let r = me.acquire("/a/doc.kimo", true).unwrap();
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["ok"], false);
        assert_eq!(json["holder"]["pid"], other);
        assert_eq!(json["holder"]["alive"], true);
        assert_eq!(json["holder"]["self"], false);
    }

    #[test]
    fn stale_holder_is_reclaimed() {
        let d = tempfile::tempdir().unwrap();
        let dead_pid = 9_999_999; // beyond pid_max on macOS and default Linux
        let dead = leases(d.path(), dead_pid);
        dead.acquire("/a/doc.kimo", true).unwrap();
        let me = leases(d.path(), std::process::id());
        // Without reclaim: reported as held by a dead holder.
        let AcquireResult::Held { holder, .. } = me.acquire("/a/doc.kimo", false).unwrap() else {
            panic!("expected held")
        };
        assert!(!holder.alive);
        let AcquireResult::Acquired {
            lease, reclaimed, ..
        } = me.acquire("/a/doc.kimo", true).unwrap()
        else {
            panic!("expected reclaimed")
        };
        assert_eq!(reclaimed.unwrap().pid, dead_pid);
        assert_eq!(lease.holder.pid, std::process::id());
        assert_eq!(
            me.inspect("/a/doc.kimo").unwrap().unwrap().pid,
            std::process::id()
        );
    }

    #[test]
    fn foreign_host_counts_as_alive() {
        let d = tempfile::tempdir().unwrap();
        let other = Leases::new(
            d.path().to_path_buf(),
            Identity {
                pid: 9_999_999,
                host: "elsewhere".into(),
                app: "kimo-cli".into(),
                app_label: "kimo".into(),
            },
        );
        other.acquire("/a/doc.kimo", true).unwrap();
        let me = leases(d.path(), std::process::id());
        assert!(matches!(
            me.acquire("/a/doc.kimo", true).unwrap(),
            AcquireResult::Held { .. }
        ));
    }

    #[test]
    fn garbage_lock_is_stale() {
        let d = tempfile::tempdir().unwrap();
        let me = leases(d.path(), std::process::id());
        fs::write(me.lock_path("/a/doc.kimo"), b"{not json").unwrap();
        let r = me.acquire("/a/doc.kimo", true).unwrap();
        assert!(matches!(
            r,
            AcquireResult::Acquired {
                reclaimed: Some(_),
                ..
            }
        ));
    }
}
