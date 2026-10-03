//! `PlatformErrorPayload { code, message, errno }`: the rejection shape of every command
//! (`packages/platform/src/errors.ts`). JS rethrows it as `PlatformError`.

use serde::Serialize;
use std::io;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errno: Option<String>,
}

pub type R<T> = Result<T, PlatformErrorPayload>;

impl PlatformErrorPayload {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            errno: None,
        }
    }
    pub fn with_errno(mut self, errno: Option<String>) -> Self {
        self.errno = errno;
        self
    }
}

impl std::fmt::Display for PlatformErrorPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

pub fn invalid(message: impl Into<String>) -> PlatformErrorPayload {
    PlatformErrorPayload::new("INVALID", message)
}
pub fn permission(message: impl Into<String>) -> PlatformErrorPayload {
    PlatformErrorPayload::new("PERMISSION", message)
}
pub fn not_found(message: impl Into<String>) -> PlatformErrorPayload {
    PlatformErrorPayload::new("NOT_FOUND", message).with_errno(Some("ENOENT".into()))
}
pub fn blocked(message: impl Into<String>) -> PlatformErrorPayload {
    PlatformErrorPayload::new("BLOCKED", message)
}
pub fn io_msg(message: impl Into<String>) -> PlatformErrorPayload {
    PlatformErrorPayload::new("IO", message)
}

/// The POSIX name of an OS error (`ENOSPC`, …), when known.
pub fn errno_name(e: &io::Error) -> Option<String> {
    #[cfg(unix)]
    if let Some(raw) = e.raw_os_error() {
        let name = match raw {
            libc::ENOENT => "ENOENT",
            libc::EACCES => "EACCES",
            libc::EPERM => "EPERM",
            libc::EROFS => "EROFS",
            libc::ENOSPC => "ENOSPC",
            libc::EDQUOT => "EDQUOT",
            libc::EEXIST => "EEXIST",
            libc::EISDIR => "EISDIR",
            libc::ENOTDIR => "ENOTDIR",
            libc::EBUSY => "EBUSY",
            libc::EIO => "EIO",
            libc::EMFILE => "EMFILE",
            libc::ENAMETOOLONG => "ENAMETOOLONG",
            libc::EXDEV => "EXDEV",
            libc::ENOTEMPTY => "ENOTEMPTY",
            _ => return Some(format!("E{raw}")),
        };
        return Some(name.into());
    }
    #[cfg(windows)]
    if let Some(raw) = e.raw_os_error() {
        // ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION,
        // ERROR_LOCK_VIOLATION, ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL, ERROR_WRITE_PROTECT.
        let name = match raw {
            2 | 3 => "ENOENT",
            5 | 32 | 33 => "EACCES",
            19 => "EROFS",
            39 | 112 => "ENOSPC",
            80 | 183 => "EEXIST",
            _ => return Some(format!("WIN{raw}")),
        };
        return Some(name.into());
    }
    match e.kind() {
        io::ErrorKind::NotFound => Some("ENOENT".into()),
        io::ErrorKind::PermissionDenied => Some("EACCES".into()),
        io::ErrorKind::AlreadyExists => Some("EEXIST".into()),
        _ => None,
    }
}

/// Maps an errno name to a platform code (mirrors `codeForErrno` in errors.ts).
pub fn code_for_errno(errno: Option<&str>) -> &'static str {
    match errno {
        Some("ENOENT") => "NOT_FOUND",
        Some("EACCES") | Some("EPERM") | Some("EROFS") => "PERMISSION",
        Some("ENOSPC") | Some("EDQUOT") => "DISK_FULL",
        _ => "IO",
    }
}

/// An I/O error about `what` (a path or an action).
pub fn io_err(e: io::Error, what: &str) -> PlatformErrorPayload {
    let errno = errno_name(&e);
    let code = code_for_errno(errno.as_deref());
    PlatformErrorPayload::new(code, format!("{what}: {e}")).with_errno(errno)
}

/// `.map_err(ctx("…"))` helper.
pub fn ctx<'a>(what: &'a str) -> impl FnOnce(io::Error) -> PlatformErrorPayload + 'a {
    move |e| io_err(e, what)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_camel_case_without_null_errno() {
        let e = PlatformErrorPayload::new("LOCKED", "held");
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"code":"LOCKED","message":"held"}"#
        );
        let e = io_err(io::Error::from(io::ErrorKind::NotFound), "/x");
        assert_eq!(e.code, "NOT_FOUND");
        assert_eq!(e.errno.as_deref(), Some("ENOENT"));
    }

    #[cfg(unix)]
    #[test]
    fn maps_disk_full() {
        let e = io_err(io::Error::from_raw_os_error(libc::ENOSPC), "/x");
        assert_eq!(e.code, "DISK_FULL");
        assert_eq!(e.errno.as_deref(), Some("ENOSPC"));
    }
}
