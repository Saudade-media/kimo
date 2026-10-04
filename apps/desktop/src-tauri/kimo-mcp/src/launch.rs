//! `--launch`: start the Kimo app in the background (`--background`: no editor window, just the
//! document host) so the shim can attach. Opt-in; the shim never opens files itself (ADR 0008).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// macOS bundle identifier (`tauri.conf.json` `identifier`).
pub const BUNDLE_ID: &str = "dev.kimo.app";
/// The flag the app understands as "start without an editor window".
pub const BACKGROUND_FLAG: &str = "--background";

const SIBLINGS: &[&str] = &["Kimo", "kimo-desktop", "Kimo.exe", "kimo-desktop.exe"];

/// Starts the app; returns how. `KIMO_APP_PATH` (an executable or a `.app`) overrides discovery.
pub fn launch_app() -> Result<String, String> {
    if let Some(p) = std::env::var_os("KIMO_APP_PATH").filter(|p| !p.is_empty()) {
        return start(Path::new(&p));
    }
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(Path::to_path_buf))
    {
        if let Some(bundle) = mac_bundle_of(&dir) {
            return start(&bundle);
        }
        for name in SIBLINGS {
            let candidate = dir.join(name);
            if candidate.is_file()
                && Some(candidate.as_path()) != std::env::current_exe().ok().as_deref()
            {
                return start(&candidate);
            }
        }
    }
    if cfg!(target_os = "macos") {
        let status = Command::new("open")
            .args(["-g", "-j", "-b", BUNDLE_ID, "--args", BACKGROUND_FLAG])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| e.to_string())?;
        return if status.success() {
            Ok(format!("open -b {BUNDLE_ID}"))
        } else {
            Err("Kimo.app is not installed".into())
        };
    }
    if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            for name in ["Kimo.exe", "kimo-desktop.exe"] {
                let p = PathBuf::from(&local).join("Kimo").join(name);
                if p.is_file() {
                    return start(&p);
                }
            }
        }
    }
    spawn_detached(Path::new(if cfg!(windows) {
        "kimo-desktop.exe"
    } else {
        "kimo-desktop"
    }))
    .map_err(|e| format!("could not find the Kimo app: {e}"))
}

/// `…/Kimo.app/Contents/MacOS` → `…/Kimo.app`.
fn mac_bundle_of(dir: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") || !dir.ends_with("Contents/MacOS") {
        return None;
    }
    let bundle = dir.parent()?.parent()?;
    (bundle.extension().is_some_and(|e| e == "app")).then(|| bundle.to_path_buf())
}

fn start(p: &Path) -> Result<String, String> {
    if p.extension().is_some_and(|e| e == "app") {
        let status = Command::new("open")
            .arg("-g")
            .arg("-j")
            .arg("-a")
            .arg(p)
            .args(["--args", BACKGROUND_FLAG])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| e.to_string())?;
        return if status.success() {
            Ok(format!("open -a {}", p.display()))
        } else {
            Err(format!("open -a {} failed", p.display()))
        };
    }
    spawn_detached(p).map_err(|e| format!("{}: {e}", p.display()))
}

fn spawn_detached(p: &Path) -> std::io::Result<String> {
    let mut cmd = Command::new(p);
    cmd.arg(BACKGROUND_FLAG)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group: the agent host's signals to our group never reach the app.
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn()?;
    Ok(p.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_enclosing_bundle() {
        let b = mac_bundle_of(Path::new("/Applications/Kimo.app/Contents/MacOS"));
        if cfg!(target_os = "macos") {
            assert_eq!(b, Some(PathBuf::from("/Applications/Kimo.app")));
        } else {
            assert_eq!(b, None);
        }
        assert_eq!(mac_bundle_of(Path::new("/usr/local/bin")), None);
    }
}
