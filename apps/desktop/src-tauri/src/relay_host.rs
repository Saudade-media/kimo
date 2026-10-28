//! Relay setup (board 42): the desktop side of the wizard. Kimo runs no server of its own; this
//! runs what the person chose, on their computer, with their tools:
//!
//! - **This computer**: apps/server's relay (bundled as `relay/kimo-relay.js`) with the person's
//!   installed Bun, its data in `<app data>/relay/data`; the official bun.sh installer after the
//!   wizard's confirm; the person's `cloudflared` for a quick or named tunnel.
//! - **Fly.io**: the person's `flyctl` for login, apps create, secrets import, volumes create
//!   and deploy with the fly.toml Kimo writes.
//! - **The device key** (ADR 0017) in the OS keychain: service `kimo`, account
//!   `relay.device-key`, the install's Ed25519 private key as PKCS#8 (base64url). Its public half is
//!   what Kimo's setup paths pass as `KIMO_OWNER_KEY`.
//!
//! Rust is the gate: only those four programs run, each with arguments checked here (the
//! relay's environment takes four names; variables for flyctl go through stdin, never argv), in
//! their own process group, output streamed as `kimo://relay-output` lines (never
//! logged) and `kimo://relay-exit`. Every process stops when Kimo quits.

use crate::ai::cli::{
    blocked_env, expand, is_executable, read_login_env, signal_group, Sig, Utf8Chunker,
};
use crate::ai::secrets::{KeyringStore, MemoryStore, SecretStore, SERVICE};
use crate::ai::EventSink;
use crate::error::{invalid, io_msg, not_found, permission, R};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::{TcpListener, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const EV_RELAY_OUTPUT: &str = "kimo://relay-output";
pub const EV_RELAY_EXIT: &str = "kimo://relay-exit";

/// Keychain account of the device key (service [`SERVICE`] = `kimo`).
pub const DEVICE_KEY_ACCOUNT: &str = "relay.device-key";

/// Longest stored device key: an Ed25519 PKCS#8 is 48 bytes (64 base64url characters).
const MAX_DEVICE_KEY: usize = 256;

/// The official installer (board 42 E shows exactly this before it runs).
pub const BUN_INSTALL_UNIX: &str = "curl -fsSL https://bun.sh/install | bash";
pub const BUN_INSTALL_WINDOWS: &str = "irm bun.sh/install.ps1 | iex";

/// The relay's environment names Kimo may set (apps/server/src/config.ts); `KIMO_DATA_DIR` is
/// always Kimo's own directory.
pub const RELAY_ENV: &[&str] = &["PORT", "HOST", "KIMO_OWNER_KEY", "KIMO_ALLOWED_ORIGINS"];

const TAIL_LINES: usize = 50;
const MAX_LINE: usize = 4096;
const MAX_STDIN: usize = 16 * 1024;
const MAX_FLY_CONFIG: usize = 16 * 1024;
const KILL_GRACE: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProcKind {
    Relay,
    BunInstall,
    Cloudflared,
    Flyctl,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub id: String,
    pub kind: ProcKind,
    pub args: Vec<String>,
    pub started_at: u64,
    pub tail: Vec<String>,
}

struct Proc {
    pid: u32,
    kind: ProcKind,
    args: Vec<String>,
    started_at: u64,
    tail: Mutex<VecDeque<String>>,
    exited: AtomicBool,
}

#[derive(Clone)]
pub struct RelayHostConfig {
    pub home: PathBuf,
    /// `<app data>/relay`: the relay's data and the fly.toml Kimo writes.
    pub dir: PathBuf,
    /// The bundled relay (`relay/kimo-relay.js`), or apps/server/src/main.ts in a dev build.
    pub relay_entry: Option<PathBuf>,
    pub login_shell_env: bool,
    pub search_process_path: bool,
    /// Extra dirs searched first (tests).
    pub extra_dirs: Vec<PathBuf>,
}

pub struct RelayHost {
    cfg: RelayHostConfig,
    secrets: Box<dyn SecretStore>,
    procs: Arc<Mutex<HashMap<String, Arc<Proc>>>>,
    login_env: OnceLock<HashMap<String, String>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The keychain, or memory with `KIMO_SECRETS_BACKEND=memory` (automated runs).
pub fn default_secret_store() -> Box<dyn SecretStore> {
    if std::env::var("KIMO_SECRETS_BACKEND").as_deref() == Ok("memory") {
        Box::new(MemoryStore::default())
    } else {
        Box::new(KeyringStore::new(SERVICE))
    }
}

// --- Argument checks ---------------------------------------------------------------------------------

fn fly_app(s: &str) -> bool {
    let b = s.as_bytes();
    (3..=63).contains(&b.len())
        && b[0].is_ascii_lowercase()
        && b[b.len() - 1] != b'-'
        && !s.contains("--")
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

fn fly_region(s: &str) -> bool {
    s.len() == 3 && s.bytes().all(|c| c.is_ascii_lowercase())
}

fn tunnel_name(s: &str) -> bool {
    s.starts_with("kimo-relay-")
        && s.len() <= 63
        && s.bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn hostname(s: &str) -> bool {
    s.len() <= 253
        && s.split('.').count() >= 2
        && s.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        })
}

fn local_url(s: &str) -> bool {
    s.strip_prefix("http://localhost:")
        .and_then(|p| p.parse::<u16>().ok())
        .is_some_and(|p| p > 0)
}

/// cloudflared: the quick tunnel, login, and create / route dns / run of a `kimo-relay-*` tunnel.
pub fn check_cloudflared_args(args: &[String]) -> R<()> {
    let a: Vec<&str> = args.iter().map(String::as_str).collect();
    let ok = match a.as_slice() {
        ["tunnel", "--no-autoupdate", "--url", u] => local_url(u),
        ["tunnel", "login"] => true,
        ["tunnel", "create", n] => tunnel_name(n),
        ["tunnel", "route", "dns", "--overwrite-dns", n, h] => tunnel_name(n) && hostname(h),
        ["tunnel", "--no-autoupdate", "run", "--url", u, n] => local_url(u) && tunnel_name(n),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(permission(
            "cloudflared arguments are not ones the relay setup runs",
        ))
    }
}

/// flyctl: login, whoami, and the deploy steps of board 42 section 5 for one app.
pub fn check_flyctl_args(args: &[String], fly_config: &Path) -> R<()> {
    let a: Vec<&str> = args.iter().map(String::as_str).collect();
    let config = crate::util::path_str(fly_config);
    let ok = match a.as_slice() {
        ["auth", "login"] | ["auth", "whoami"] => true,
        ["apps", "create", app] => fly_app(app),
        ["secrets", "import", "--app", app] | ["secrets", "import", "--app", app, "--stage"] => {
            fly_app(app)
        }
        ["volumes", "create", "kimo_data", "--size", "1", "--app", app, "--region", r, "--yes"] => {
            fly_app(app) && fly_region(r)
        }
        ["deploy", "--config", c, "--app", app, "--ha=false", "--yes"] => {
            *c == config && fly_app(app)
        }
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(permission(
            "flyctl arguments are not ones the relay setup runs",
        ))
    }
}

/// The relay's environment: only [`RELAY_ENV`] names, with plain values.
pub fn check_relay_env(env: &HashMap<String, String>) -> R<()> {
    for (k, v) in env {
        if !RELAY_ENV.contains(&k.as_str()) {
            return Err(permission(format!("The relay setup cannot set {k}")));
        }
        if v.len() > 4096 || v.contains('\0') || v.contains('\n') {
            return Err(invalid(format!("Bad value for {k}")));
        }
    }
    Ok(())
}

/// A version number from `--version` output.
pub fn parse_version(out: &str) -> Option<String> {
    let start = out.find(|c: char| c.is_ascii_digit())?;
    let v: String = out[start..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let v = v.trim_end_matches('.');
    (v.contains('.')).then(|| v.to_string())
}

/// Splits output into lines on `\n` and `\r` (progress bars), dropping empty ones.
#[derive(Default)]
pub struct LineSplitter {
    buf: String,
}

impl LineSplitter {
    pub fn push(&mut self, text: &str) -> Vec<String> {
        self.buf.push_str(text);
        let mut out = Vec::new();
        while let Some(i) = self.buf.find(['\n', '\r']) {
            let line: String = self.buf[..i].trim_end().chars().take(MAX_LINE).collect();
            self.buf.drain(..=i);
            if !line.is_empty() {
                out.push(line);
            }
        }
        if self.buf.len() > MAX_LINE * 4 {
            let line: String = self.buf.chars().take(MAX_LINE).collect();
            self.buf.clear();
            out.push(line);
        }
        out
    }
    pub fn flush(&mut self) -> Option<String> {
        let line = self.buf.trim_end().to_string();
        self.buf.clear();
        (!line.is_empty()).then_some(line)
    }
}

/// The installer's progress bar (`#####  42.0%`): not a step, not worth a line.
fn noise(kind: ProcKind, line: &str) -> bool {
    kind == ProcKind::BunInstall
        && line
            .chars()
            .all(|c| c == '#' || c == '%' || c == '.' || c.is_ascii_digit() || c.is_whitespace())
}

/// `Mayas-MacBook-Pro.lan` → `mayas-macbook-pro.local`; None for a name that is not a DNS label.
pub fn local_name(host: &str) -> Option<String> {
    let label = host.trim().split('.').next()?.to_ascii_lowercase();
    let ok = !label.is_empty()
        && label.len() <= 63
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        && label != "localhost";
    ok.then(|| format!("{label}.local"))
}

/// The source address of a route to a documentation address (no packet is sent), when it is a
/// private IPv4 address.
fn lan_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:9").ok()?;
    match s.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if ip.is_private() => Some(ip.to_string()),
        _ => None,
    }
}

// --- Host ---------------------------------------------------------------------------------------------

impl RelayHost {
    pub fn new(cfg: RelayHostConfig, secrets: Box<dyn SecretStore>) -> Self {
        Self {
            cfg,
            secrets,
            procs: Arc::new(Mutex::new(HashMap::new())),
            login_env: OnceLock::new(),
        }
    }

    pub fn fly_config_path(&self) -> PathBuf {
        self.cfg.dir.join("fly.toml")
    }

    pub fn data_dir(&self) -> PathBuf {
        self.cfg.dir.join("data")
    }

    // Device key -------------------------------------------------------------------------------

    pub fn device_key_get(&self) -> R<Option<String>> {
        Ok(self
            .secrets
            .get(DEVICE_KEY_ACCOUNT)?
            .map(|s| s.expose().to_string()))
    }

    /// Stores the device key once: a second window that made its own key keeps the first one
    /// (the caller reads it back), so every window signs as the same device.
    pub fn device_key_set(&self, value: &str) -> R<()> {
        let ok = !value.is_empty()
            && value.len() <= MAX_DEVICE_KEY
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if !ok {
            return Err(invalid("A device key is base64url of up to 256 characters"));
        }
        if self.secrets.get(DEVICE_KEY_ACCOUNT)?.is_some() {
            return Ok(());
        }
        self.secrets.set(DEVICE_KEY_ACCOUNT, value)
    }

    // Tools ---------------------------------------------------------------------------------------

    fn login_env(&self) -> &HashMap<String, String> {
        self.login_env.get_or_init(|| {
            if self.cfg.login_shell_env {
                read_login_env().unwrap_or_default()
            } else {
                HashMap::new()
            }
        })
    }

    fn search_dirs(&self) -> Vec<PathBuf> {
        let h = &self.cfg.home;
        let mut dirs: Vec<PathBuf> = self.cfg.extra_dirs.clone();
        let sep = if cfg!(windows) { ';' } else { ':' };
        if self.cfg.search_process_path {
            if let Some(p) = std::env::var_os("PATH") {
                dirs.extend(std::env::split_paths(&p));
            }
        }
        if let Some(p) = self.login_env().get("PATH") {
            dirs.extend(p.split(sep).filter(|s| !s.is_empty()).map(PathBuf::from));
        }
        dirs.extend(
            [
                "~/.bun/bin",
                "~/.fly/bin",
                "~/.local/bin",
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
            ]
            .iter()
            .map(|p| expand(p, h)),
        );
        let mut seen = std::collections::HashSet::new();
        dirs.retain(|d| d.is_absolute() && seen.insert(d.clone()));
        dirs
    }

    fn resolve(&self, names: &[&str]) -> Option<PathBuf> {
        let exts: &[&str] = if cfg!(windows) {
            &[".exe", ".cmd", ""]
        } else {
            &[""]
        };
        for d in self.search_dirs() {
            for n in names {
                for e in exts {
                    let p = d.join(format!("{n}{e}"));
                    if is_executable(&p) {
                        return Some(p);
                    }
                }
            }
        }
        None
    }

    fn tool_names(tool: &str) -> R<&'static [&'static str]> {
        match tool {
            "bun" => Ok(&["bun"]),
            "cloudflared" => Ok(&["cloudflared"]),
            "flyctl" => Ok(&["flyctl", "fly"]),
            _ => Err(invalid(format!("Unknown tool {tool}"))),
        }
    }

    /// Finds the tool and reads its version (`--version`, 5 s at most).
    pub fn find_tool(&self, tool: &str) -> R<Option<ToolInfo>> {
        let Some(path) = self.resolve(Self::tool_names(tool)?) else {
            return Ok(None);
        };
        let version = self.version_of(&path);
        Ok(Some(ToolInfo {
            path: crate::util::path_str(&path),
            version,
        }))
    }

    fn version_of(&self, bin: &Path) -> Option<String> {
        let mut child = Command::new(bin)
            .arg("--version")
            .env_clear()
            .envs(self.env_for(bin, &HashMap::new()))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .ok()?;
        let mut out = child.stdout.take()?;
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if start.elapsed() > Duration::from_secs(5) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(_) => return None,
            }
        }
        let mut s = String::new();
        let _ = out.by_ref().take(64 * 1024).read_to_string(&mut s);
        parse_version(&s)
    }

    fn env_for(&self, bin: &Path, extra: &HashMap<String, String>) -> Vec<(String, String)> {
        let mut env: HashMap<String, String> = HashMap::new();
        for (k, v) in self.login_env() {
            env.insert(k.clone(), v.clone());
        }
        for (k, v) in std::env::vars() {
            env.insert(k, v);
        }
        env.retain(|k, _| !blocked_env(k) && !k.starts_with("KIMO_"));
        let mut path: Vec<PathBuf> = Vec::new();
        if let Some(d) = bin.parent() {
            path.push(d.to_path_buf());
        }
        path.extend(self.search_dirs());
        if let Ok(joined) = std::env::join_paths(path.iter().filter(|p| p.is_dir())) {
            env.insert("PATH".into(), joined.to_string_lossy().into_owned());
        }
        for (k, v) in extra {
            env.insert(k.clone(), v.clone());
        }
        let mut v: Vec<_> = env.into_iter().collect();
        v.sort();
        v
    }

    // Network ---------------------------------------------------------------------------------------

    pub fn port_free(port: u16) -> bool {
        port > 0
            && TcpListener::bind(("0.0.0.0", port)).is_ok()
            && TcpListener::bind(("127.0.0.1", port)).is_ok()
    }

    /// This computer's name on the local network: `<host>.local` (Bonjour / mDNS). The desktop
    /// webview's CSP lets plain `ws://` reach only localhost, 127.0.0.1 and `*.local`, so the
    /// same-network address is the `.local` name; the private IPv4 address only when the host
    /// name can't make one.
    pub fn lan_address() -> Option<String> {
        local_name(&gethostname::gethostname().to_string_lossy()).or_else(lan_ip)
    }

    pub fn cloudflared_logged_in(&self) -> bool {
        self.cfg
            .home
            .join(".cloudflared")
            .join("cert.pem")
            .is_file()
    }

    pub fn write_fly_config(&self, content: &str) -> R<String> {
        if content.len() > MAX_FLY_CONFIG || content.contains('\0') || !content.contains("app = ") {
            return Err(invalid("Not a Kimo relay fly.toml"));
        }
        std::fs::create_dir_all(&self.cfg.dir).map_err(crate::error::ctx("relay dir"))?;
        let p = self.fly_config_path();
        std::fs::write(&p, content).map_err(crate::error::ctx("fly.toml"))?;
        Ok(crate::util::path_str(&p))
    }

    // Processes ---------------------------------------------------------------------------------------

    /// Starts one of the four programs; output and exit arrive through `sink`.
    pub fn spawn(
        &self,
        kind: ProcKind,
        args: &[String],
        env: &HashMap<String, String>,
        stdin: Option<&str>,
        sink: Arc<dyn EventSink>,
    ) -> R<String> {
        if stdin.is_some_and(|s| s.len() > MAX_STDIN) {
            return Err(invalid("stdin too large"));
        }
        let (bin, argv, extra_env): (PathBuf, Vec<String>, HashMap<String, String>) = match kind {
            ProcKind::Relay => {
                if !args.is_empty() || stdin.is_some() {
                    return Err(invalid("The relay takes no arguments"));
                }
                check_relay_env(env)?;
                if self
                    .procs
                    .lock()
                    .unwrap()
                    .values()
                    .any(|p| p.kind == ProcKind::Relay && !p.exited.load(Ordering::SeqCst))
                {
                    return Err(invalid("A relay is already running on this computer"));
                }
                let entry = self
                    .cfg
                    .relay_entry
                    .clone()
                    .filter(|p| p.is_file())
                    .ok_or_else(|| not_found("The relay is not bundled with this build"))?;
                let bun = self
                    .resolve(&["bun"])
                    .ok_or_else(|| not_found("Bun is not installed"))?;
                let data = self.data_dir();
                std::fs::create_dir_all(&data).map_err(crate::error::ctx("relay data"))?;
                let mut e = env.clone();
                e.insert("KIMO_DATA_DIR".into(), crate::util::path_str(&data));
                (bun, vec![crate::util::path_str(&entry)], e)
            }
            ProcKind::BunInstall => {
                if !args.is_empty() || stdin.is_some() || !env.is_empty() {
                    return Err(invalid("The installer takes no arguments"));
                }
                if cfg!(windows) {
                    (
                        PathBuf::from("powershell"),
                        vec![
                            "-NoProfile".into(),
                            "-Command".into(),
                            BUN_INSTALL_WINDOWS.into(),
                        ],
                        HashMap::new(),
                    )
                } else {
                    (
                        PathBuf::from("/bin/sh"),
                        vec!["-c".into(), BUN_INSTALL_UNIX.into()],
                        HashMap::new(),
                    )
                }
            }
            ProcKind::Cloudflared => {
                check_cloudflared_args(args)?;
                if !env.is_empty() || stdin.is_some() {
                    return Err(invalid("cloudflared takes no environment"));
                }
                let bin = self
                    .resolve(&["cloudflared"])
                    .ok_or_else(|| not_found("cloudflared is not installed"))?;
                (bin, args.to_vec(), HashMap::new())
            }
            ProcKind::Flyctl => {
                check_flyctl_args(args, &self.fly_config_path())?;
                if !env.is_empty() {
                    return Err(invalid("flyctl takes no environment"));
                }
                let bin = self
                    .resolve(&["flyctl", "fly"])
                    .ok_or_else(|| not_found("flyctl is not installed"))?;
                (bin, args.to_vec(), HashMap::new())
            }
        };
        let cwd = self.cfg.dir.clone();
        std::fs::create_dir_all(&cwd).map_err(crate::error::ctx("relay dir"))?;
        let mut c = Command::new(&bin);
        c.args(&argv)
            .current_dir(&cwd)
            .env_clear()
            .envs(self.env_for(&bin, &extra_env))
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            c.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0000_0200 | 0x0800_0000);
        }
        let mut child = c
            .spawn()
            .map_err(|e| io_msg(format!("Could not start {}: {e}", bin.display())))?;
        if let (Some(text), Some(mut w)) = (stdin, child.stdin.take()) {
            let text = text.to_string();
            std::thread::spawn(move || {
                let _ = w.write_all(text.as_bytes());
            });
        }
        let id = format!("r_{}", uuid::Uuid::new_v4().simple());
        let proc = Arc::new(Proc {
            pid: child.id(),
            kind,
            args: if kind == ProcKind::Relay {
                vec![]
            } else {
                args.to_vec()
            },
            started_at: now_ms(),
            tail: Mutex::new(VecDeque::new()),
            exited: AtomicBool::new(false),
        });
        self.procs.lock().unwrap().insert(id.clone(), proc.clone());
        let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
        for (stream, reader) in [
            (
                "stdout",
                Box::new(child.stdout.take().unwrap()) as Box<dyn Read + Send>,
            ),
            ("stderr", Box::new(child.stderr.take().unwrap())),
        ] {
            let sink = sink.clone();
            let id = id.clone();
            let proc = proc.clone();
            let done = done_tx.clone();
            std::thread::spawn(move || {
                pump(reader, stream, &id, &proc, sink.as_ref());
                let _ = done.send(());
            });
        }
        drop(done_tx);
        let procs = Arc::downgrade(&self.procs);
        let wait_id = id.clone();
        std::thread::spawn(move || {
            let status = child.wait();
            proc.exited.store(true, Ordering::SeqCst);
            let deadline = Instant::now() + Duration::from_secs(2);
            for _ in 0..2 {
                if done_rx
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .is_err()
                {
                    break;
                }
            }
            let code = status.ok().and_then(|s| s.code());
            sink.emit(EV_RELAY_EXIT, json!({ "procId": wait_id, "code": code }));
            if let Some(p) = procs.upgrade() {
                p.lock().unwrap().remove(&wait_id);
            }
        });
        Ok(id)
    }

    /// SIGTERM to the process group, SIGKILL after 3 s. Unknown or finished: Ok.
    pub fn kill(&self, id: &str) -> R<()> {
        let Some(p) = self.procs.lock().unwrap().get(id).cloned() else {
            return Ok(());
        };
        terminate(p);
        Ok(())
    }

    pub fn running(&self) -> Vec<ProcInfo> {
        let mut v: Vec<ProcInfo> = self
            .procs
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, p)| !p.exited.load(Ordering::SeqCst))
            .map(|(id, p)| ProcInfo {
                id: id.clone(),
                kind: p.kind,
                args: p.args.clone(),
                started_at: p.started_at,
                tail: p.tail.lock().unwrap().iter().cloned().collect(),
            })
            .collect();
        v.sort_by_key(|p| p.started_at);
        v
    }

    /// App exit: SIGTERM every group, then SIGKILL shortly after.
    pub fn shutdown(&self) {
        let live: Vec<Arc<Proc>> = self.procs.lock().unwrap().values().cloned().collect();
        for p in &live {
            if !p.exited.load(Ordering::SeqCst) {
                signal_group(p.pid, Sig::Term);
            }
        }
        if live.is_empty() {
            return;
        }
        std::thread::sleep(Duration::from_millis(300));
        for p in &live {
            if !p.exited.load(Ordering::SeqCst) {
                signal_group(p.pid, Sig::Kill);
            }
        }
    }
}

fn terminate(p: Arc<Proc>) {
    if p.exited.load(Ordering::SeqCst) {
        return;
    }
    signal_group(p.pid, Sig::Term);
    std::thread::spawn(move || {
        std::thread::sleep(KILL_GRACE);
        if !p.exited.load(Ordering::SeqCst) {
            signal_group(p.pid, Sig::Kill);
        }
    });
}

fn pump(mut r: Box<dyn Read + Send>, stream: &str, id: &str, proc: &Proc, sink: &dyn EventSink) {
    let mut buf = vec![0u8; 16 * 1024];
    let mut dec = Utf8Chunker::default();
    let mut lines = LineSplitter::default();
    let emit = |line: String| {
        if noise(proc.kind, &line) {
            return;
        }
        {
            let mut t = proc.tail.lock().unwrap();
            t.push_back(line.clone());
            while t.len() > TAIL_LINES {
                t.pop_front();
            }
        }
        sink.emit(
            EV_RELAY_OUTPUT,
            json!({ "procId": id, "stream": stream, "line": line }),
        );
    };
    loop {
        match r.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                for line in lines.push(&dec.push(&buf[..n])) {
                    emit(line);
                }
            }
        }
    }
    for line in lines.push(&dec.flush()) {
        emit(line);
    }
    if let Some(line) = lines.flush() {
        emit(line);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::ai::tests_support::ChannelSink;
    use serde_json::Value;

    struct Fixture {
        _dir: tempfile::TempDir,
        bin: PathBuf,
        host: RelayHost,
    }

    fn fixture(relay_entry: Option<&str>) -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let entry = relay_entry.map(|body| {
            let p = dir.path().join("kimo-relay.js");
            std::fs::write(&p, body).unwrap();
            p
        });
        let host = RelayHost::new(
            RelayHostConfig {
                home: dir.path().join("home"),
                dir: dir.path().join("relay"),
                relay_entry: entry,
                login_shell_env: false,
                search_process_path: false,
                extra_dirs: vec![bin.clone()],
            },
            Box::new(MemoryStore::default()),
        );
        Fixture {
            _dir: dir,
            bin,
            host,
        }
    }

    fn script(dir: &Path, name: &str, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join(name);
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    async fn until_exit(
        mut rx: tokio::sync::mpsc::UnboundedReceiver<Value>,
        id: &str,
    ) -> Vec<Value> {
        let mut out = Vec::new();
        loop {
            let e = tokio::time::timeout(Duration::from_secs(10), rx.recv())
                .await
                .expect("event within 10 s")
                .expect("channel open");
            let end = e["procId"] == id && e.get("code").is_some();
            out.push(e);
            if end {
                return out;
            }
        }
    }

    #[test]
    fn cloudflared_arguments_are_checked() {
        for ok in [
            s(&[
                "tunnel",
                "--no-autoupdate",
                "--url",
                "http://localhost:8787",
            ]),
            s(&["tunnel", "login"]),
            s(&["tunnel", "create", "kimo-relay-kimo-maya-studio"]),
            s(&[
                "tunnel",
                "route",
                "dns",
                "--overwrite-dns",
                "kimo-relay-kimo-maya-studio",
                "kimo.maya.studio",
            ]),
            s(&[
                "tunnel",
                "--no-autoupdate",
                "run",
                "--url",
                "http://localhost:8788",
                "kimo-relay-x",
            ]),
        ] {
            assert!(check_cloudflared_args(&ok).is_ok(), "{ok:?}");
        }
        for bad in [
            s(&["tunnel", "--url", "http://evil.example:80"]),
            s(&[
                "tunnel",
                "--no-autoupdate",
                "--url",
                "http://evil.example:80",
            ]),
            s(&["tunnel", "delete", "kimo-relay-x"]),
            s(&["tunnel", "create", "other"]),
            s(&["access", "login"]),
            s(&[]),
        ] {
            assert_eq!(check_cloudflared_args(&bad).unwrap_err().code, "PERMISSION");
        }
    }

    #[test]
    fn flyctl_arguments_are_checked() {
        let cfg = PathBuf::from("/data/relay/fly.toml");
        for ok in [
            s(&["auth", "login"]),
            s(&["auth", "whoami"]),
            s(&["apps", "create", "kimo-relay-maya"]),
            s(&["secrets", "import", "--app", "kimo-relay-maya", "--stage"]),
            s(&["secrets", "import", "--app", "kimo-relay-maya"]),
            s(&[
                "volumes",
                "create",
                "kimo_data",
                "--size",
                "1",
                "--app",
                "kimo-relay-maya",
                "--region",
                "ams",
                "--yes",
            ]),
            s(&[
                "deploy",
                "--config",
                "/data/relay/fly.toml",
                "--app",
                "kimo-relay-maya",
                "--ha=false",
                "--yes",
            ]),
        ] {
            assert!(check_flyctl_args(&ok, &cfg).is_ok(), "{ok:?}");
        }
        for bad in [
            s(&["ssh", "console"]),
            s(&["apps", "destroy", "kimo-relay-maya"]),
            s(&["apps", "create", "Bad_Name"]),
            s(&[
                "secrets",
                "set",
                "KIMO_OWNER_KEY=x",
                "--app",
                "kimo-relay-maya",
            ]),
            s(&[
                "deploy",
                "--config",
                "/etc/other.toml",
                "--app",
                "a-b-c",
                "--ha=false",
                "--yes",
            ]),
            s(&[
                "volumes",
                "create",
                "kimo_data",
                "--size",
                "100",
                "--app",
                "kimo-relay-maya",
                "--region",
                "ams",
                "--yes",
            ]),
        ] {
            assert_eq!(
                check_flyctl_args(&bad, &cfg).unwrap_err().code,
                "PERMISSION"
            );
        }
    }

    #[test]
    fn relay_env_takes_four_names() {
        let mut env = HashMap::new();
        env.insert("PORT".to_string(), "8787".to_string());
        env.insert("KIMO_OWNER_KEY".to_string(), "3eO8zsfzpmoRF".to_string());
        assert!(check_relay_env(&env).is_ok());
        let mut old = HashMap::new();
        old.insert("KIMO_CREATE_SECRET".to_string(), "x".to_string());
        assert_eq!(check_relay_env(&old).unwrap_err().code, "PERMISSION");
        env.insert("KIMO_DATA_DIR".to_string(), "/".to_string());
        assert_eq!(check_relay_env(&env).unwrap_err().code, "PERMISSION");
        let mut nl = HashMap::new();
        nl.insert("HOST".to_string(), "a\nb".to_string());
        assert_eq!(check_relay_env(&nl).unwrap_err().code, "INVALID");
    }

    #[test]
    fn device_key_in_the_store_and_fly_config() {
        let f = fixture(None);
        assert_eq!(f.host.device_key_get().unwrap(), None);
        f.host.device_key_set("MC4CAQAwBQYDK2VwBCIEIA").unwrap();
        assert_eq!(
            f.host.device_key_get().unwrap().as_deref(),
            Some("MC4CAQAwBQYDK2VwBCIEIA")
        );
        // The first key stays: a second window's key does not replace it.
        f.host.device_key_set("other").unwrap();
        assert_eq!(
            f.host.device_key_get().unwrap().as_deref(),
            Some("MC4CAQAwBQYDK2VwBCIEIA")
        );
        assert_eq!(f.host.device_key_set("a\nb").unwrap_err().code, "INVALID");
        assert_eq!(f.host.device_key_set("").unwrap_err().code, "INVALID");
        let p = f.host.write_fly_config("app = \"x\"\n").unwrap();
        assert!(p.ends_with("fly.toml"));
        assert_eq!(
            f.host.write_fly_config("rm -rf").unwrap_err().code,
            "INVALID"
        );
    }

    #[test]
    fn ports_and_tools() {
        let l = TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        assert!(!RelayHost::port_free(port));
        drop(l);
        let f = fixture(None);
        assert_eq!(f.host.find_tool("bun").unwrap(), None);
        script(&f.bin, "bun", "echo 1.2.19");
        script(&f.bin, "fly", "echo 'flyctl v0.3.172 darwin/arm64'");
        let bun = f.host.find_tool("bun").unwrap().unwrap();
        assert_eq!(bun.version.as_deref(), Some("1.2.19"));
        assert!(bun.path.ends_with("/bin/bun"));
        let fly = f.host.find_tool("flyctl").unwrap().unwrap();
        assert_eq!(fly.version.as_deref(), Some("0.3.172"));
        assert_eq!(f.host.find_tool("sh").unwrap_err().code, "INVALID");
    }

    #[tokio::test]
    async fn relay_runs_with_bun_its_env_and_data_dir() {
        let f = fixture(Some("// relay"));
        // A fake bun: prints what it was given, like the relay's listening line.
        script(
            &f.bin,
            "bun",
            "echo \"@kimo/server listening on http://0.0.0.0:$PORT/ (data: $KIMO_DATA_DIR)\"; \
             echo \"entry=$1 owner=${KIMO_OWNER_KEY:+set}\"",
        );
        let mut env = HashMap::new();
        env.insert("PORT".to_string(), "8799".to_string());
        env.insert("KIMO_OWNER_KEY".to_string(), "kimo_owner_x".to_string());
        let (sink, rx) = ChannelSink::pair();
        let id = f
            .host
            .spawn(ProcKind::Relay, &[], &env, None, sink)
            .unwrap();
        let events = until_exit(rx, &id).await;
        let lines: Vec<&str> = events.iter().filter_map(|e| e["line"].as_str()).collect();
        assert!(lines[0].starts_with("@kimo/server listening on http://0.0.0.0:8799/"));
        assert!(lines[0].contains("/relay/data"), "{lines:?}");
        assert!(lines[1].ends_with("kimo-relay.js owner=set"), "{lines:?}");
        assert!(!lines.iter().any(|l| l.contains("kimo_owner_x")));
        assert_eq!(events.last().unwrap()["code"], 0);
        assert!(f.host.running().is_empty());
        // Arguments and other env names are refused.
        let (sink, _rx) = ChannelSink::pair();
        assert!(f
            .host
            .spawn(ProcKind::Relay, &s(&["x"]), &HashMap::new(), None, sink)
            .is_err());
    }

    #[tokio::test]
    async fn flyctl_reads_secrets_from_stdin_and_kill_stops_a_tunnel() {
        let f = fixture(None);
        script(
            &f.bin,
            "flyctl",
            "while IFS= read -r l; do echo \"got ${l%%=*}\"; done",
        );
        script(
            &f.bin,
            "cloudflared",
            "echo 'INF |  https://quiet-otter-lime.trycloudflare.com  |'; while true; do sleep 1; done",
        );
        let (sink, rx) = ChannelSink::pair();
        let id = f
            .host
            .spawn(
                ProcKind::Flyctl,
                &s(&["secrets", "import", "--app", "kimo-relay-maya", "--stage"]),
                &HashMap::new(),
                Some("KIMO_OWNER_KEY=kimo_owner_x\n"),
                sink,
            )
            .unwrap();
        let events = until_exit(rx, &id).await;
        let lines: Vec<&str> = events.iter().filter_map(|e| e["line"].as_str()).collect();
        assert_eq!(lines, vec!["got KIMO_OWNER_KEY"]);

        let (sink, mut rx) = ChannelSink::pair();
        let id = f
            .host
            .spawn(
                ProcKind::Cloudflared,
                &s(&[
                    "tunnel",
                    "--no-autoupdate",
                    "--url",
                    "http://localhost:8787",
                ]),
                &HashMap::new(),
                None,
                sink,
            )
            .unwrap();
        let first = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(first["line"]
            .as_str()
            .unwrap()
            .contains("trycloudflare.com"));
        let running = f.host.running();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].kind, ProcKind::Cloudflared);
        assert_eq!(running[0].tail.len(), 1);
        f.host.kill(&id).unwrap();
        let events = until_exit(rx, &id).await;
        assert_eq!(events.last().unwrap()["code"], Value::Null);
        assert!(f.host.running().is_empty());
    }
}
