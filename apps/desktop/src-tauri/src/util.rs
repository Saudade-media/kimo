//! Small helpers: hashing, clocks, path checks, process liveness, JSON files.

use crate::error::{ctx, invalid, R};
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// `sha256(path)[:16]`: lock and recovery file ids (ADR 0012 §3).
pub fn path_id(path: &str) -> String {
    sha256_hex(path.as_bytes())[..16].to_string()
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn system_time_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// ISO 8601 with milliseconds and `Z` (`2026-10-03T10:31:07.000Z`, like `Date#toISOString`).
pub fn iso_from_ms(ms: u64) -> String {
    let dt = time::OffsetDateTime::from_unix_timestamp_nanos(ms as i128 * 1_000_000)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        dt.year(),
        dt.month() as u8,
        dt.day(),
        dt.hour(),
        dt.minute(),
        dt.second(),
        dt.millisecond()
    )
}

pub fn hostname() -> String {
    gethostname::gethostname().to_string_lossy().into_owned()
}

/// Validates an absolute native path from the frontend: absolute, no `..`, no NUL. Returns it
/// lexically cleaned (`.` segments dropped).
pub fn clean_abs(p: &str) -> R<PathBuf> {
    if p.is_empty() || p.contains('\0') {
        return Err(invalid(format!("Invalid path: {p:?}")));
    }
    let path = Path::new(p);
    if !path.is_absolute() {
        return Err(invalid(format!("Not an absolute path: {p}")));
    }
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::ParentDir => return Err(invalid(format!("Path climbs with '..': {p}"))),
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    Ok(out)
}

pub fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

pub fn basename(p: &Path) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub fn is_kimo_path(p: &Path) -> bool {
    let lower = p.to_string_lossy().to_lowercase();
    lower.ends_with(".kimo") || lower.ends_with(".kimoz")
}

/// Whether `pid` is a running process on this machine.
pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    if pid == std::process::id() {
        return true;
    }
    #[cfg(unix)]
    {
        // SAFETY: kill with signal 0 only checks for existence/permission.
        let r = unsafe { libc::kill(pid as libc::pid_t, 0) };
        if r == 0 {
            return true;
        }
        std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        // SAFETY: plain Win32 calls on a handle we own and close.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return false;
            }
            let mut code: u32 = 0;
            let ok = GetExitCodeProcess(h, &mut code) != 0;
            CloseHandle(h);
            ok && code == STILL_ACTIVE as u32
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        true
    }
}

/// Reads a JSON file; `Ok(None)` when it does not exist.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> R<Option<T>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).ok()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(ctx(&path_str(path))(e)),
    }
}

/// Writes a JSON file atomically (pretty, trailing newline).
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> R<()> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|e| invalid(e.to_string()))?;
    bytes.push(b'\n');
    crate::fs_ops::write_atomic(path, &bytes, true)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_matches_js() {
        assert_eq!(iso_from_ms(1_759_487_467_000), "2025-10-03T10:31:07.000Z");
        assert_eq!(iso_from_ms(5), "1970-01-01T00:00:00.005Z");
    }

    #[test]
    fn path_id_is_16_hex() {
        let id = path_id("/Users/me/loom/marketing.kimo");
        assert_eq!(id.len(), 16);
        assert_eq!(id, sha256_hex(b"/Users/me/loom/marketing.kimo")[..16]);
    }

    #[cfg(unix)]
    #[test]
    fn clean_abs_rules() {
        assert!(clean_abs("relative/a.kimo").is_err());
        assert!(clean_abs("/a/../b.kimo").is_err());
        assert!(clean_abs("/a/\0b").is_err());
        assert_eq!(
            clean_abs("/a/./b.kimo").unwrap(),
            PathBuf::from("/a/b.kimo")
        );
    }

    #[test]
    fn own_pid_alive() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(0));
    }
}
