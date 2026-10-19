//! File operations without Tauri types (unit-tested): the atomic write with read-back
//! (ADR 0012 §3), reads, stat and list.

use crate::error::{ctx, io_err, PlatformErrorPayload, R};
use crate::util::{basename, path_str, sha256_hex, system_time_ms};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AtomicWriteResult {
    pub bytes: u64,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextResult {
    pub text: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    #[serde(rename = "ref")]
    pub file_ref: String,
    pub name: String,
    pub kind: &'static str,
    pub size: u64,
    pub mtime_ms: u64,
    pub read_only: bool,
}

/// temp file in the same directory → fsync → rename → fsync dir → read back → SHA-256
/// compare (`READ_BACK_MISMATCH`). The original is untouched when anything before the rename
/// fails; the temp file is removed.
pub fn write_atomic(path: &Path, bytes: &[u8], mkdirs: bool) -> R<AtomicWriteResult> {
    write_atomic_with(path, bytes, mkdirs, |_| {})
}

/// [`write_atomic`] with a hook that runs between the rename and the read-back (tests use it
/// to simulate a sync client or antivirus rewriting the file).
pub fn write_atomic_with(
    path: &Path,
    bytes: &[u8],
    mkdirs: bool,
    after_rename: impl FnOnce(&Path),
) -> R<AtomicWriteResult> {
    write_atomic_opts(path, bytes, mkdirs, false, after_rename)
}

/// [`write_atomic`] for secrets (the multiplayer room registry holds owner keys as JWK): on Unix
/// the file is created 0600 (never readable by others, not even the temp file) and its parent
/// directory is set to 0700. An existing file's looser mode is tightened on the next write.
pub fn write_atomic_owner_only(path: &Path, bytes: &[u8], mkdirs: bool) -> R<AtomicWriteResult> {
    write_atomic_opts(path, bytes, mkdirs, true, |_| {})
}

fn write_atomic_opts(
    path: &Path,
    bytes: &[u8],
    mkdirs: bool,
    owner_only: bool,
    after_rename: impl FnOnce(&Path),
) -> R<AtomicWriteResult> {
    let what = path_str(path);
    let dir = path
        .parent()
        .ok_or_else(|| crate::error::invalid(format!("No parent directory: {what}")))?;
    if mkdirs {
        fs::create_dir_all(dir).map_err(ctx(&path_str(dir)))?;
    } else if !dir.is_dir() {
        return Err(io_err(
            io::Error::from(io::ErrorKind::NotFound),
            &format!("No directory for {what}"),
        ));
    }
    let existing = fs::metadata(path).ok();
    if let Some(m) = &existing {
        if m.is_dir() {
            return Err(PlatformErrorPayload::new(
                "INVALID",
                format!("{what} is a directory"),
            ));
        }
        if !writable(path, m) {
            return Err(
                PlatformErrorPayload::new("PERMISSION", format!("{what} is read-only"))
                    .with_errno(Some("EACCES".into())),
            );
        }
    }
    let hash = sha256_hex(bytes);
    let tmp = temp_path(dir, path);
    #[cfg(unix)]
    if owner_only {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(ctx(&path_str(dir)))?;
    }
    let staged = (|| -> io::Result<()> {
        let mut open = OpenOptions::new();
        open.write(true).create_new(true);
        #[cfg(unix)]
        if owner_only {
            use std::os::unix::fs::OpenOptionsExt;
            open.mode(0o600);
        }
        let mut f = open.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        #[cfg(unix)]
        if owner_only {
            use std::os::unix::fs::PermissionsExt;
            // `mode` above is masked by the umask; set it explicitly as well.
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        } else if let Some(m) = &existing {
            fs::set_permissions(&tmp, m.permissions())?;
        }
        drop(f);
        fs::rename(&tmp, path)
    })();
    if let Err(e) = staged {
        let _ = fs::remove_file(&tmp);
        return Err(io_err(e, &what));
    }
    sync_dir(dir);
    after_rename(path);
    let back = fs::read(path).map_err(ctx(&what))?;
    let back_hash = sha256_hex(&back);
    if back_hash != hash {
        return Err(PlatformErrorPayload::new(
            "READ_BACK_MISMATCH",
            format!("Read-back of {what} did not match what was written"),
        ));
    }
    Ok(AtomicWriteResult {
        bytes: bytes.len() as u64,
        hash,
    })
}

fn temp_path(dir: &Path, path: &Path) -> PathBuf {
    let name = basename(path);
    let rand = &uuid::Uuid::new_v4().simple().to_string()[..8];
    dir.join(format!(".{name}.kimo-tmp-{}-{rand}", std::process::id()))
}

fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

fn writable(path: &Path, m: &fs::Metadata) -> bool {
    if m.permissions().readonly() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let Ok(c) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
            return false;
        };
        // SAFETY: access() reads a NUL-terminated path.
        unsafe { libc::access(c.as_ptr(), libc::W_OK) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        true
    }
}

pub fn read_text(path: &Path) -> R<ReadTextResult> {
    let what = path_str(path);
    let bytes = fs::read(path).map_err(ctx(&what))?;
    let hash = sha256_hex(&bytes);
    let text = String::from_utf8(bytes)
        .map_err(|_| PlatformErrorPayload::new("INVALID", format!("{what} is not UTF-8 text")))?;
    Ok(ReadTextResult { text, hash })
}

pub fn read_bytes(path: &Path) -> R<Vec<u8>> {
    fs::read(path).map_err(ctx(&path_str(path)))
}

pub fn remove(path: &Path) -> R<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_err(e, &path_str(path))),
    }
}

/// `EXISTS` when something is at `to` (rename, copy and restore never overwrite).
fn ensure_free(to: &Path) -> R<()> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(crate::error::exists(format!(
            "{} already exists",
            path_str(to)
        )));
    }
    Ok(())
}

/// True when both paths name the same existing file (same device and inode on Unix, same
/// canonical path elsewhere).
fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::metadata(a), fs::metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        match (fs::canonicalize(a), fs::canonicalize(b)) {
            (Ok(x), Ok(y)) => x == y,
            _ => false,
        }
    }
}

/// Moves `from` to `to` without overwriting (`EXISTS`), creating `to`'s folder when `mkdirs`.
/// Falls back to copy + remove across volumes.
pub fn rename_no_clobber(from: &Path, to: &Path, mkdirs: bool) -> R<()> {
    let what = path_str(from);
    fs::symlink_metadata(from).map_err(ctx(&what))?;
    // A case-only rename (home.kimo -> Home.kimo) on a case-insensitive volume: `to` resolves to
    // `from` itself, so it is not taken.
    if !same_file(from, to) {
        ensure_free(to)?;
    }
    if mkdirs {
        if let Some(dir) = to.parent() {
            fs::create_dir_all(dir).map_err(ctx(&path_str(dir)))?;
        }
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if is_cross_device(&e) => {
            copy_no_clobber(from, to)?;
            fs::remove_file(from).map_err(ctx(&what))
        }
        Err(e) => Err(io_err(e, &format!("{what} → {}", path_str(to)))),
    }
}

fn is_cross_device(e: &io::Error) -> bool {
    // EXDEV; Windows ERROR_NOT_SAME_DEVICE (17).
    crate::error::errno_name(e).as_deref() == Some("EXDEV")
        || (cfg!(windows) && e.raw_os_error() == Some(17))
}

/// Copies `from` to a new file at `to` (`EXISTS` when taken; the new file is created
/// exclusively, so a racing writer is never overwritten). A failed copy leaves nothing behind.
pub fn copy_no_clobber(from: &Path, to: &Path) -> R<()> {
    let what = path_str(from);
    let target = path_str(to);
    let mut src = File::open(from).map_err(ctx(&what))?;
    let perms = src.metadata().map_err(ctx(&what))?.permissions();
    let mut dst = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(|e| {
            if e.kind() == io::ErrorKind::AlreadyExists {
                crate::error::exists(format!("{target} already exists"))
            } else {
                io_err(e, &target)
            }
        })?;
    let copied = io::copy(&mut src, &mut dst)
        .and_then(|_| dst.sync_all())
        .and_then(|_| fs::set_permissions(to, perms));
    if let Err(e) = copied {
        drop(dst);
        let _ = fs::remove_file(to);
        return Err(io_err(e, &target));
    }
    Ok(())
}

pub fn stat(path: &Path) -> R<Option<FileStat>> {
    match fs::metadata(path) {
        Ok(m) => Ok(Some(stat_of(path, &m))),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_err(e, &path_str(path))),
    }
}

pub fn stat_of(path: &Path, m: &fs::Metadata) -> FileStat {
    let dir = m.is_dir();
    FileStat {
        file_ref: path_str(path),
        name: basename(path),
        kind: if dir { "directory" } else { "file" },
        size: if dir { 0 } else { m.len() },
        mtime_ms: m.modified().map(system_time_ms).unwrap_or(0),
        read_only: !writable(path, m),
    }
}

pub fn list(dir: &Path, extensions: Option<&[String]>) -> R<Vec<FileStat>> {
    let what = path_str(dir);
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(ctx(&what))? {
        let Ok(entry) = entry else { continue };
        let p = entry.path();
        let Ok(m) = fs::metadata(&p) else { continue };
        if m.is_file() {
            if let Some(exts) = extensions {
                let name = basename(&p);
                if !exts.iter().any(|e| name.ends_with(&format!(".{e}"))) {
                    continue;
                }
            }
        }
        out.push(stat_of(&p, &m));
    }
    out.sort_by(|a, b| a.file_ref.cmp(&b.file_ref));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("doc.kimo");
        let r = write_atomic(&p, b"{\"a\":1}", false).unwrap();
        assert_eq!(r.bytes, 7);
        assert_eq!(r.hash, sha256_hex(b"{\"a\":1}"));
        let t = read_text(&p).unwrap();
        assert_eq!(t.text, "{\"a\":1}");
        assert_eq!(t.hash, r.hash);
        // Overwrite; no temp files left behind.
        write_atomic(&p, b"two", false).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"two");
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn owner_only_write_is_0600_in_a_0700_directory() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("multiplayer");
        let p = dir.join("rooms.json");
        write_atomic_owner_only(&p, b"{}", true).unwrap();
        let mode = |q: &Path| fs::metadata(q).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&p), 0o600);
        assert_eq!(mode(&dir), 0o700);
        // A file left world-readable by an older build is tightened on the next write.
        fs::set_permissions(&p, fs::Permissions::from_mode(0o644)).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        write_atomic_owner_only(&p, b"{\"owned\":{}}", true).unwrap();
        assert_eq!(mode(&p), 0o600);
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(fs::read(&p).unwrap(), b"{\"owned\":{}}");
        // A plain write keeps the existing mode (documents are not secrets).
        let doc = root.path().join("doc.kimo");
        fs::write(&doc, b"a").unwrap();
        fs::set_permissions(&doc, fs::Permissions::from_mode(0o644)).unwrap();
        write_atomic(&doc, b"b", false).unwrap();
        assert_eq!(mode(&doc), 0o644);
    }

    #[test]
    fn rename_never_clobbers_but_allows_a_case_only_change() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("home.kimo");
        let b = dir.path().join("other.kimo");
        fs::write(&a, b"a").unwrap();
        fs::write(&b, b"b").unwrap();
        let e = rename_no_clobber(&a, &b, false).unwrap_err();
        assert_eq!(e.code, "EXISTS");
        let upper = dir.path().join("Home.kimo");
        rename_no_clobber(&a, &upper, false).unwrap();
        assert_eq!(fs::read(&upper).unwrap(), b"a");
        assert_eq!(fs::read(&b).unwrap(), b"b");
    }

    #[test]
    fn read_back_mismatch_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("doc.kimo");
        let e = write_atomic_with(&p, b"mine", false, |p| {
            fs::write(p, b"someone else").unwrap()
        })
        .unwrap_err();
        assert_eq!(e.code, "READ_BACK_MISMATCH");
    }

    #[test]
    fn missing_dir_without_mkdirs() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a/b/doc.kimo");
        let e = write_atomic(&p, b"x", false).unwrap_err();
        assert_eq!(e.code, "NOT_FOUND");
        write_atomic(&p, b"x", true).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"x");
    }

    #[cfg(unix)]
    #[test]
    fn read_only_file_is_untouched() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("doc.kimo");
        fs::write(&p, b"orig").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o444)).unwrap();
        let e = write_atomic(&p, b"new", false).unwrap_err();
        assert_eq!(e.code, "PERMISSION");
        assert_eq!(fs::read(&p).unwrap(), b"orig");
        assert!(stat(&p).unwrap().unwrap().read_only);
    }

    #[test]
    fn rename_and_copy_never_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.kimo");
        let b = dir.path().join("b.kimo");
        fs::write(&a, b"A").unwrap();
        fs::write(&b, b"B").unwrap();
        assert_eq!(rename_no_clobber(&a, &b, false).unwrap_err().code, "EXISTS");
        assert_eq!(copy_no_clobber(&a, &b).unwrap_err().code, "EXISTS");
        assert_eq!(fs::read(&b).unwrap(), b"B");
        let c = dir.path().join("sub/c.kimo");
        copy_no_clobber(&a, &dir.path().join("copy.kimo")).unwrap();
        assert_eq!(fs::read(dir.path().join("copy.kimo")).unwrap(), b"A");
        rename_no_clobber(&a, &c, true).unwrap();
        assert!(!a.exists());
        assert_eq!(fs::read(&c).unwrap(), b"A");
        let gone = dir.path().join("gone.kimo");
        assert_eq!(
            rename_no_clobber(&gone, &a, false).unwrap_err().code,
            "NOT_FOUND"
        );
        assert_eq!(copy_no_clobber(&gone, &a).unwrap_err().code, "NOT_FOUND");
    }

    #[test]
    fn stat_list_remove() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.kimo"), b"1").unwrap();
        fs::write(dir.path().join("b.txt"), b"22").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let all = list(dir.path(), None).unwrap();
        assert_eq!(all.len(), 3);
        let only = list(dir.path(), Some(&["kimo".to_string()])).unwrap();
        assert_eq!(
            only.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["a.kimo", "sub"]
        );
        let s = stat(&dir.path().join("b.txt")).unwrap().unwrap();
        assert_eq!((s.kind, s.size), ("file", 2));
        assert!(stat(&dir.path().join("nope")).unwrap().is_none());
        remove(&dir.path().join("b.txt")).unwrap();
        remove(&dir.path().join("b.txt")).unwrap();
        assert!(read_text(&dir.path().join("b.txt")).unwrap_err().code == "NOT_FOUND");
    }
}
