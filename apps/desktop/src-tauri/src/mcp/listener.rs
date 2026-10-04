//! The local endpoint (socket.md §1): `~/.kimo/socket/kimo.sock` (dir 0700, socket 0600, peer
//! uid checked) on macOS/Linux, the per-user named pipe on Windows (remote clients rejected).

use super::hub::Hub;
use std::sync::Arc;

/// Outcome of preparing the endpoint before the token is rotated.
pub enum Prepared {
    /// Ready to accept (a bound listener on Unix; the pipe name on Windows).
    #[cfg(unix)]
    Ready(std::os::unix::net::UnixListener),
    #[cfg(windows)]
    Ready(String),
    /// Another live Kimo owns the endpoint: do not rotate its token, do not listen.
    InUse,
    Failed(String),
}

#[cfg(unix)]
pub fn prepare(endpoint: &str) -> Prepared {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    let path = std::path::Path::new(endpoint);
    if let Some(dir) = path.parent() {
        if let Err(e) = super::files::ensure_private_dir(dir) {
            return Prepared::Failed(e.message);
        }
    }
    if path.exists() {
        if UnixStream::connect(path).is_ok() {
            return Prepared::InUse;
        }
        // Stale socket file (no listener).
        let _ = std::fs::remove_file(path);
    }
    match UnixListener::bind(path) {
        Ok(l) => {
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
            if let Err(e) = l.set_nonblocking(true) {
                return Prepared::Failed(e.to_string());
            }
            Prepared::Ready(l)
        }
        Err(e) => Prepared::Failed(e.to_string()),
    }
}

#[cfg(windows)]
pub fn prepare(endpoint: &str) -> Prepared {
    // A live pipe of this name means another Kimo is listening.
    if std::fs::metadata(endpoint).is_ok() {
        return Prepared::InUse;
    }
    Prepared::Ready(endpoint.to_string())
}

/// Accept loop; runs until `stop` turns true (Settings › Agents › Stop) or the process exits.
#[cfg(unix)]
pub async fn run(
    hub: Arc<Hub>,
    listener: std::os::unix::net::UnixListener,
    mut stop: tokio::sync::watch::Receiver<bool>,
) {
    let listener = match tokio::net::UnixListener::from_std(listener) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("kimo: MCP socket: {e}");
            hub.set_listening(false);
            return;
        }
    };
    hub.set_listening(true);
    // SAFETY: getuid has no preconditions.
    let me = unsafe { libc::getuid() };
    loop {
        let accepted = tokio::select! {
            _ = stop.changed() => break,
            a = listener.accept() => a,
        };
        match accepted {
            Ok((stream, _)) => {
                // Same user only (the 0600 socket already enforces it; belt and braces).
                if stream.peer_cred().map(|c| c.uid() != me).unwrap_or(true) {
                    continue;
                }
                tokio::spawn(hub.clone().serve(stream));
            }
            Err(e) => {
                eprintln!("kimo: MCP socket accept: {e}");
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
    }
    // Stopped: the service reports `listening: false` itself (a restart may already have
    // started the next loop).
}

#[cfg(windows)]
pub async fn run(hub: Arc<Hub>, name: String, mut stop: tokio::sync::watch::Receiver<bool>) {
    use tokio::net::windows::named_pipe::ServerOptions;
    let mut server = match ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(&name)
    {
        Ok(s) => s,
        Err(e) => {
            eprintln!("kimo: MCP pipe {name}: {e}");
            hub.set_listening(false);
            return;
        }
    };
    hub.set_listening(true);
    loop {
        let connected = tokio::select! {
            _ = stop.changed() => break,
            c = server.connect() => c,
        };
        if let Err(e) = connected {
            eprintln!("kimo: MCP pipe connect: {e}");
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            continue;
        }
        let next = match ServerOptions::new()
            .reject_remote_clients(true)
            .create(&name)
        {
            Ok(s) => s,
            Err(e) => {
                eprintln!("kimo: MCP pipe {name}: {e}");
                hub.set_listening(false);
                return;
            }
        };
        let connected = std::mem::replace(&mut server, next);
        tokio::spawn(hub.clone().serve(connected));
    }
    hub.set_listening(false);
}

/// Removes the socket file at quit (no-op for pipes).
pub fn cleanup(endpoint: &str) {
    if cfg!(unix) {
        let _ = std::fs::remove_file(endpoint);
    }
}
