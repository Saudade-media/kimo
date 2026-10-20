//! Local agent CLI host (ADR 0014 §11): resolve, probe and run the user's installed Claude Code,
//! Codex, Gemini CLI (and generic CLIs they added in Settings) for the in-app agent.
//!
//! Security rules (Rust is the gate; JS only asks):
//! - Only command names from the allow-list resolve (`claude`, `codex`, `gemini`, plus the
//!   generic CLIs in `<kimo home>/ai/clis.json`, minus shells/interpreters/system tools), and only
//!   paths this host resolved can be executed or spawned. Binaries under `~/.kimo` or the temp
//!   dir never resolve (JS can write files there).
//! - Search: PATH, the login shell's PATH (GUI apps on macOS start with a minimal one), the
//!   common install dirs (`~/.local/bin`, Homebrew, `/usr/local/bin`, npm-global, bun, volta,
//!   nvm, fnm, asdf, mise, pnpm) and `extraDirs` that are known dirs or under $HOME (not ~/.kimo).
//! - Spawned processes run only in `~/.kimo/cli-workspaces/<session>/…`, in their own process
//!   group, with piped stdio streamed as `kimo://cli-output` and `kimo://cli-exit` events.
//!   Kill: SIGINT → SIGTERM after 3 s → SIGKILL after 6 s (to the group); SIGTERM → SIGKILL 3 s.
//! - Env: values are never returned; `has_env` answers presence. Loader/injection variables
//!   (`LD_*`, `DYLD_*`, `NODE_OPTIONS`, …) are scrubbed from the inherited env and refused from JS.
//! - File probes answer only for an allow-list of auth-cache files.
//! - MCP attribution: the shim the CLI starts inherits the workspace cwd (and its ppid is the
//!   spawned pid); [`agent_session_for`] maps either back to the agent session, and the MCP hub
//!   adds it to connection info as `agentSession`.

use super::EventSink;
use crate::error::{invalid, io_msg, not_found, permission, R};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const EV_CLI_OUTPUT: &str = "kimo://cli-output";
pub const EV_CLI_EXIT: &str = "kimo://cli-exit";

/// `ALLOWED_CLI_COMMANDS` (cli-agents.ts).
pub const BUILTIN_COMMANDS: &[&str] = &["claude", "codex", "gemini"];

/// Auth-cache files `kimo_cli_home_file_exists` answers for (⊇ `CLI_AUTH_FILES`).
pub const AUTH_FILES: &[&str] = &[
    ".gemini/oauth_creds.json",
    ".claude/.credentials.json",
    ".codex/auth.json",
];

/// Under the Kimo home (`CLI_WORKSPACES_DIR` = `.kimo/cli-workspaces`).
pub const WORKSPACES_DIR: &str = "cli-workspaces";

/// Generic CLIs never allowed, whatever the settings say.
const DENIED_COMMANDS: &[&str] = &[
    "sh",
    "bash",
    "zsh",
    "fish",
    "dash",
    "ksh",
    "csh",
    "tcsh",
    "nu",
    "pwsh",
    "powershell",
    "cmd",
    "node",
    "nodejs",
    "bun",
    "bunx",
    "deno",
    "npx",
    "npm",
    "pnpm",
    "yarn",
    "python",
    "python3",
    "perl",
    "ruby",
    "php",
    "lua",
    "osascript",
    "env",
    "sudo",
    "su",
    "doas",
    "rm",
    "mv",
    "cp",
    "dd",
    "curl",
    "wget",
    "nc",
    "ncat",
    "ssh",
    "scp",
    "rsync",
    "open",
    "xdg-open",
    "launchctl",
    "systemctl",
    "chmod",
    "chown",
    "kill",
    "pkill",
    "killall",
    "git",
    "xargs",
    "find",
    "awk",
    "sed",
    "tee",
    "kimo",
    "kimo-mcp",
];

const MAX_OUTPUT: usize = 1024 * 1024;
const MAX_FILES: usize = 64;
const MAX_FILE_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub struct CliConfig {
    pub home: PathBuf,
    pub kimo_home: PathBuf,
    /// The bundled MCP shim, written into each workspace marker for the adapters.
    pub shim_path: String,
    /// Read the login shell's env (PATH and presence of vars) once; off in tests.
    pub login_shell_env: bool,
    /// SIGINT → SIGTERM delay, and SIGTERM → SIGKILL delay.
    pub term_grace: Duration,
    pub kill_grace: Duration,
    /// Binaries under these never resolve (default: the Kimo home and the temp dir).
    pub forbidden_roots: Vec<PathBuf>,
    /// Search the app's own PATH (off in tests so a real install doesn't shadow fixtures).
    pub search_process_path: bool,
}

impl CliConfig {
    pub fn new(home: PathBuf, kimo_home: PathBuf, shim_path: String) -> Self {
        Self {
            home,
            forbidden_roots: vec![kimo_home.clone(), std::env::temp_dir()],
            search_process_path: true,
            kimo_home,
            shim_path,
            login_shell_env: true,
            term_grace: Duration::from_secs(3),
            kill_grace: Duration::from_secs(3),
        }
    }
    pub fn workspaces_root(&self) -> PathBuf {
        self.kimo_home.join(WORKSPACES_DIR)
    }
}

// --- Session attribution (MCP hub) -----------------------------------------------------------------

#[derive(Default)]
pub struct SessionRegistry {
    root: Mutex<Option<PathBuf>>,
    pids: Mutex<HashMap<u32, String>>,
}

impl SessionRegistry {
    fn set_root(&self, root: &Path) {
        let _ = std::fs::create_dir_all(root);
        let canon = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        *self.root.lock().unwrap() = Some(canon);
    }

    /// The agent session for an MCP hello (`cwd` inside a workspace, or `ppid` = a spawned CLI).
    pub fn session_for(&self, cwd: Option<&str>, ppid: u32) -> Option<String> {
        if let Some(cwd) = cwd {
            if let Some(root) = self.root.lock().unwrap().clone() {
                let p = std::fs::canonicalize(cwd).unwrap_or_else(|_| PathBuf::from(cwd));
                if let Ok(rel) = p.strip_prefix(&root) {
                    if let Some(Component::Normal(s)) = rel.components().next() {
                        let s = s.to_string_lossy().into_owned();
                        if valid_session(&s) {
                            return Some(s);
                        }
                    }
                }
            }
        }
        if ppid != 0 {
            return self.pids.lock().unwrap().get(&ppid).cloned();
        }
        None
    }
}

static GLOBAL_SESSIONS: OnceLock<Arc<SessionRegistry>> = OnceLock::new();

/// Used by the MCP hub to add `agentSession` to connection info.
pub fn agent_session_for(cwd: Option<&str>, ppid: u32) -> Option<String> {
    GLOBAL_SESSIONS.get()?.session_for(cwd, ppid)
}

// --- Helpers ----------------------------------------------------------------------------------------

pub fn valid_session(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn valid_command_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

pub(crate) fn valid_env_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Variables that inject code into the child (or Kimo internals); scrubbed and refused.
pub fn blocked_env(name: &str) -> bool {
    let u = name.to_ascii_uppercase();
    u == "PATH"
        || u.starts_with("LD_")
        || u.starts_with("DYLD_")
        || u.starts_with("TAURI_")
        || matches!(
            u.as_str(),
            "NODE_OPTIONS"
                | "NODE_PATH"
                | "ELECTRON_RUN_AS_NODE"
                | "BASH_ENV"
                | "ENV"
                | "ZDOTDIR"
                | "PYTHONSTARTUP"
                | "PYTHONPATH"
                | "PERL5OPT"
                | "PERL5LIB"
                | "RUBYOPT"
                | "GIT_SSH_COMMAND"
        )
}

pub(crate) fn expand(p: &str, home: &Path) -> PathBuf {
    if p == "~" {
        home.to_path_buf()
    } else if let Some(r) = p.strip_prefix("~/") {
        home.join(r)
    } else {
        PathBuf::from(p)
    }
}

pub(crate) fn is_executable(p: &Path) -> bool {
    let Ok(m) = std::fs::metadata(p) else {
        return false;
    };
    if !m.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        m.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn exts() -> &'static [&'static str] {
    if cfg!(windows) {
        &[".exe", ".cmd", ".bat", ""]
    } else {
        &[""]
    }
}

/// UTF-8 text from byte chunks, holding back an incomplete trailing sequence.
#[derive(Default)]
pub struct Utf8Chunker {
    pending: Vec<u8>,
}

impl Utf8Chunker {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let n = self.pending.len();
        let mut keep = 0;
        // Find a lead byte in the last 3 bytes whose sequence is incomplete.
        for back in 1..=3.min(n) {
            let b = self.pending[n - back];
            if b & 0xC0 == 0x80 {
                continue; // continuation
            }
            let width = if b >= 0xF0 {
                4
            } else if b >= 0xE0 {
                3
            } else if b >= 0xC0 {
                2
            } else {
                1
            };
            if width > back {
                keep = back;
            }
            break;
        }
        let tail = self.pending.split_off(n - keep);
        let text = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending = tail;
        text
    }
    pub fn flush(&mut self) -> String {
        let t = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        t
    }
}

// --- Process bookkeeping ---------------------------------------------------------------------------

struct Proc {
    pid: u32,
    stdin: Mutex<Option<ChildStdin>>,
    exited: AtomicBool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Spawned {
    pub process_id: String,
    pub pid: u32,
}

pub struct CliHost {
    cfg: CliConfig,
    resolved: Mutex<HashMap<PathBuf, String>>,
    procs: Mutex<HashMap<String, Arc<Proc>>>,
    login_env: OnceLock<HashMap<String, String>>,
    pub sessions: Arc<SessionRegistry>,
}

impl CliHost {
    pub fn new(cfg: CliConfig) -> Self {
        let sessions = Arc::new(SessionRegistry::default());
        sessions.set_root(&cfg.workspaces_root());
        Self {
            cfg,
            resolved: Mutex::new(HashMap::new()),
            procs: Mutex::new(HashMap::new()),
            login_env: OnceLock::new(),
            sessions,
        }
    }

    /// Makes this host's registry the one the MCP hub consults (the app's single host).
    pub fn install_global(&self) {
        let _ = GLOBAL_SESSIONS.set(self.sessions.clone());
    }

    fn login_env(&self) -> &HashMap<String, String> {
        self.login_env.get_or_init(|| {
            if self.cfg.login_shell_env {
                read_login_env().unwrap_or_default()
            } else {
                HashMap::new()
            }
        })
    }

    /// Generic CLI command names from `<kimo home>/ai/clis.json` (`[{id, command, …}]`).
    fn generic_commands(&self) -> Vec<String> {
        let p = self.cfg.kimo_home.join("ai").join("clis.json");
        let v: Value = crate::util::read_json(&p)
            .ok()
            .flatten()
            .unwrap_or(Value::Null);
        let arr = v
            .as_array()
            .cloned()
            .or_else(|| v.get("clis").and_then(Value::as_array).cloned())
            .unwrap_or_default();
        arr.iter()
            .filter_map(|c| c.get("command").and_then(Value::as_str).map(String::from))
            .collect()
    }

    pub fn command_allowed(&self, command: &str) -> bool {
        if !valid_command_name(command) {
            return false;
        }
        if BUILTIN_COMMANDS.contains(&command) {
            return true;
        }
        let base = command
            .trim_end_matches(".exe")
            .trim_end_matches(".cmd")
            .to_ascii_lowercase();
        !DENIED_COMMANDS.contains(&base.as_str())
            && self.generic_commands().iter().any(|c| c == command)
    }

    /// Common install dirs, expanded (nvm versions newest first).
    pub fn known_dirs(&self) -> Vec<PathBuf> {
        let h = &self.cfg.home;
        let mut v: Vec<PathBuf> = [
            "~/.local/bin",
            "~/.claude/local",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "~/.npm-global/bin",
            "~/.bun/bin",
            "~/.volta/bin",
            "~/.asdf/shims",
            "~/.local/share/mise/shims",
            "~/.local/share/fnm/aliases/default/bin",
            "~/Library/Application Support/fnm/aliases/default/bin",
            "~/Library/pnpm",
            "~/.local/share/pnpm",
            "~/.yarn/bin",
        ]
        .iter()
        .map(|p| expand(p, h))
        .collect();
        if let Ok(rd) = std::fs::read_dir(h.join(".nvm/versions/node")) {
            let mut vers: Vec<PathBuf> = rd.flatten().map(|e| e.path().join("bin")).collect();
            vers.sort_by_key(|p| std::cmp::Reverse(node_version_key(p)));
            v.extend(vers);
        }
        if cfg!(windows) {
            if let Some(a) = std::env::var_os("APPDATA") {
                v.push(PathBuf::from(a).join("npm"));
            }
            if let Some(l) = std::env::var_os("LOCALAPPDATA") {
                v.push(PathBuf::from(l).join("Volta").join("bin"));
            }
        }
        v
    }

    fn forbidden_location(&self, p: &Path) -> bool {
        let canon = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        self.cfg.forbidden_roots.iter().any(|r| {
            let rc = std::fs::canonicalize(r).unwrap_or_else(|_| r.clone());
            canon.starts_with(&rc) || p.starts_with(r)
        })
    }

    fn search_dirs(&self, extra: &[String]) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = Vec::new();
        let sep = if cfg!(windows) { ';' } else { ':' };
        if self.cfg.search_process_path {
            if let Some(p) = std::env::var_os("PATH") {
                dirs.extend(std::env::split_paths(&p));
            }
        }
        if let Some(p) = self.login_env().get("PATH") {
            dirs.extend(p.split(sep).filter(|s| !s.is_empty()).map(PathBuf::from));
        }
        let known = self.known_dirs();
        for e in extra {
            let d = expand(e, &self.cfg.home);
            let ok = d.is_absolute()
                && (known.contains(&d)
                    || (d.starts_with(&self.cfg.home) && !d.starts_with(&self.cfg.kimo_home)));
            if ok {
                dirs.push(d);
            }
        }
        dirs.extend(known);
        let mut seen = std::collections::HashSet::new();
        dirs.retain(|d| d.is_absolute() && seen.insert(d.clone()));
        dirs
    }

    pub fn which(&self, command: &str, extra_dirs: &[String]) -> R<Option<String>> {
        if !self.command_allowed(command) {
            return Err(permission(format!(
                "\"{command}\" is not an allowed agent CLI"
            )));
        }
        for d in self.search_dirs(extra_dirs) {
            for e in exts() {
                let p = d.join(format!("{command}{e}"));
                if is_executable(&p) && !self.forbidden_location(&p) {
                    self.resolved
                        .lock()
                        .unwrap()
                        .insert(p.clone(), command.to_string());
                    return Ok(Some(crate::util::path_str(&p)));
                }
            }
        }
        Ok(None)
    }

    fn check_resolved(&self, path: &str) -> R<PathBuf> {
        let p = PathBuf::from(path);
        if !self.resolved.lock().unwrap().contains_key(&p) {
            return Err(permission(
                "Only paths returned by kimo_cli_which can be run",
            ));
        }
        Ok(p)
    }

    fn base_env(
        &self,
        bin: &Path,
        extra: Option<&HashMap<String, String>>,
    ) -> R<Vec<(String, String)>> {
        let mut env: HashMap<String, String> = HashMap::new();
        for (k, v) in self.login_env() {
            env.insert(k.clone(), v.clone());
        }
        for (k, v) in std::env::vars() {
            env.insert(k, v);
        }
        env.retain(|k, _| !blocked_env(k));
        // PATH: the binary's dir first (node shebangs), then the process and login PATHs, then
        // the known install dirs.
        let mut path: Vec<PathBuf> = Vec::new();
        if let Some(d) = bin.parent() {
            path.push(d.to_path_buf());
        }
        path.extend(self.search_dirs(&[]));
        if cfg!(unix) {
            // The system dirs, last (a GUI app's PATH may lack them).
            path.extend(["/usr/bin", "/bin", "/usr/sbin", "/sbin"].map(PathBuf::from));
        }
        let joined = std::env::join_paths(path.iter().filter(|p| p.is_dir()))
            .map_err(|e| invalid(format!("Bad PATH: {e}")))?;
        env.insert("PATH".into(), joined.to_string_lossy().into_owned());
        if let Some(extra) = extra {
            for (k, v) in extra {
                if !valid_env_name(k) || blocked_env(k) {
                    return Err(invalid(format!("Environment variable {k} cannot be set")));
                }
                env.insert(k.clone(), v.clone());
            }
        }
        let mut v: Vec<_> = env.into_iter().collect();
        v.sort();
        Ok(v)
    }

    fn command(
        &self,
        bin: &Path,
        args: &[String],
        cwd: &Path,
        env: Vec<(String, String)>,
    ) -> Command {
        let mut c = Command::new(bin);
        c.args(args).current_dir(cwd).env_clear().envs(env);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            c.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
            c.creation_flags(0x0000_0200 | 0x0800_0000);
        }
        c
    }

    fn ensure_root(&self) -> R<PathBuf> {
        let root = self.cfg.workspaces_root();
        std::fs::create_dir_all(&root).map_err(crate::error::ctx("cli workspaces"))?;
        std::fs::canonicalize(&root).map_err(crate::error::ctx("cli workspaces"))
    }

    /// Short non-interactive probe: stdin closed, output capped, killed at the timeout.
    pub fn exec(
        &self,
        path: &str,
        args: &[String],
        timeout_ms: u64,
        env: Option<&HashMap<String, String>>,
    ) -> R<ExecResult> {
        let bin = self.check_resolved(path)?;
        let timeout = Duration::from_millis(timeout_ms.clamp(100, 30_000));
        let cwd = self.ensure_root()?;
        let env = self.base_env(&bin, env)?;
        let mut child = match self
            .command(&bin, args, &cwd, env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                return Ok(ExecResult {
                    code: None,
                    stdout: String::new(),
                    stderr: e.to_string(),
                })
            }
        };
        let read_all = |mut r: Box<dyn Read + Send>| {
            std::thread::spawn(move || {
                let mut out = Vec::new();
                let mut buf = [0u8; 8192];
                while let Ok(n) = r.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    if out.len() < MAX_OUTPUT {
                        out.extend_from_slice(&buf[..n.min(MAX_OUTPUT - out.len())]);
                    }
                }
                String::from_utf8_lossy(&out).into_owned()
            })
        };
        let so = read_all(Box::new(child.stdout.take().unwrap()));
        let se = read_all(Box::new(child.stderr.take().unwrap()));
        let start = Instant::now();
        let pid = child.id();
        let code = loop {
            match child.try_wait() {
                Ok(Some(s)) => break s.code(),
                Ok(None) if start.elapsed() >= timeout => {
                    signal_group(pid, Sig::Kill);
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(e) => return Err(io_msg(format!("wait failed: {e}"))),
            }
        };
        Ok(ExecResult {
            code,
            stdout: so.join().unwrap_or_default(),
            stderr: se.join().unwrap_or_default(),
        })
    }

    pub fn home_file_exists(&self, rel: &str) -> R<bool> {
        if !AUTH_FILES.contains(&rel) {
            return Err(permission(format!("{rel} is not an allowed probe")));
        }
        Ok(self.cfg.home.join(rel).is_file())
    }

    pub fn has_env(&self, name: &str) -> R<bool> {
        if !valid_env_name(name) {
            return Err(invalid(format!("Bad environment variable name {name}")));
        }
        let set = |v: Option<&str>| v.is_some_and(|v| !v.trim().is_empty());
        Ok(set(std::env::var(name).ok().as_deref())
            || set(self.login_env().get(name).map(String::as_str)))
    }

    /// Creates `<root>/<session>/` and writes `files` (relative paths) inside it.
    pub fn prepare_workspace(&self, session: &str, files: &[(String, String)]) -> R<String> {
        if !valid_session(session) {
            return Err(invalid(format!("Invalid session id {session}")));
        }
        if files.len() > MAX_FILES {
            return Err(invalid("Too many workspace files"));
        }
        let root = self.ensure_root()?;
        let dir = root.join(session);
        std::fs::create_dir_all(&dir).map_err(crate::error::ctx("workspace"))?;
        let dir = std::fs::canonicalize(&dir).map_err(crate::error::ctx("workspace"))?;
        if !dir.starts_with(&root) || dir == root {
            return Err(permission("Workspace escapes the workspaces root"));
        }
        for (rel, text) in files {
            if text.len() > MAX_FILE_BYTES {
                return Err(invalid(format!("{rel} is too large")));
            }
            let rp = Path::new(rel);
            if rel.is_empty()
                || rel.contains('\\')
                || !rp.components().all(|c| matches!(c, Component::Normal(_)))
            {
                return Err(invalid(format!("Invalid workspace path {rel}")));
            }
            let target = dir.join(rp);
            let parent = target.parent().unwrap_or(&dir).to_path_buf();
            std::fs::create_dir_all(&parent).map_err(crate::error::ctx(rel))?;
            let canon_parent = std::fs::canonicalize(&parent).map_err(crate::error::ctx(rel))?;
            if !canon_parent.starts_with(&dir) {
                return Err(permission(format!("{rel} escapes the workspace")));
            }
            if std::fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err(permission(format!("{rel} is a symlink")));
            }
            std::fs::write(&target, text).map_err(crate::error::ctx(rel))?;
        }
        let marker = json!({ "session": session, "shimPath": self.cfg.shim_path });
        let _ = std::fs::write(dir.join(".kimo-workspace.json"), format!("{marker}\n"));
        Ok(crate::util::path_str(&dir))
    }

    fn check_cwd(&self, cwd: &str) -> R<(PathBuf, String)> {
        let root = self.ensure_root()?;
        let p = std::fs::canonicalize(cwd)
            .map_err(|_| permission(format!("{cwd} is not a CLI workspace")))?;
        let rel = p
            .strip_prefix(&root)
            .map_err(|_| permission(format!("{cwd} is not under the CLI workspaces root")))?;
        let session = match rel.components().next() {
            Some(Component::Normal(s)) => s.to_string_lossy().into_owned(),
            _ => return Err(permission("The cwd must be a session workspace")),
        };
        if !p.is_dir() {
            return Err(permission("The cwd is not a directory"));
        }
        Ok((p, session))
    }

    pub fn spawn(
        self: &Arc<Self>,
        path: &str,
        args: &[String],
        cwd: &str,
        env: Option<&HashMap<String, String>>,
        sink: Arc<dyn EventSink>,
    ) -> R<Spawned> {
        let bin = self.check_resolved(path)?;
        let (cwd, session) = self.check_cwd(cwd)?;
        let env = self.base_env(&bin, env)?;
        let mut child: Child = self
            .command(&bin, args, &cwd, env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| io_msg(format!("Could not start {path}: {e}")))?;
        let pid = child.id();
        let process_id = format!("p_{}", uuid::Uuid::new_v4().simple());
        let proc = Arc::new(Proc {
            pid,
            stdin: Mutex::new(child.stdin.take()),
            exited: AtomicBool::new(false),
        });
        self.procs
            .lock()
            .unwrap()
            .insert(process_id.clone(), proc.clone());
        self.sessions
            .pids
            .lock()
            .unwrap()
            .insert(pid, session.clone());

        let (done_tx, done_rx) = mpsc::channel::<()>();
        for (stream, reader) in [
            (
                "stdout",
                Box::new(child.stdout.take().unwrap()) as Box<dyn Read + Send>,
            ),
            ("stderr", Box::new(child.stderr.take().unwrap())),
        ] {
            let sink = sink.clone();
            let id = process_id.clone();
            let done = done_tx.clone();
            std::thread::spawn(move || {
                pump(reader, stream, &id, sink.as_ref());
                let _ = done.send(());
            });
        }
        drop(done_tx);
        let me = self.clone();
        let id = process_id.clone();
        std::thread::spawn(move || {
            let status = child.wait();
            proc.exited.store(true, Ordering::SeqCst);
            // Let the readers drain (a grandchild may hold the pipes; don't wait forever).
            let deadline = Instant::now() + Duration::from_secs(2);
            for _ in 0..2 {
                let left = deadline.saturating_duration_since(Instant::now());
                if done_rx.recv_timeout(left).is_err() {
                    break;
                }
            }
            let (code, signal) = match status {
                Ok(s) => (s.code(), exit_signal(&s)),
                Err(_) => (None, Some("error".to_string())),
            };
            sink.emit(
                EV_CLI_EXIT,
                json!({ "processId": id, "code": code, "signal": signal }),
            );
            me.procs.lock().unwrap().remove(&id);
            me.sessions.pids.lock().unwrap().remove(&pid);
        });
        Ok(Spawned { process_id, pid })
    }

    fn proc(&self, process_id: &str) -> R<Arc<Proc>> {
        self.procs
            .lock()
            .unwrap()
            .get(process_id)
            .cloned()
            .ok_or_else(|| not_found(format!("No CLI process {process_id}")))
    }

    pub fn write(&self, process_id: &str, data: &str) -> R<()> {
        let p = self.proc(process_id)?;
        let mut g = p.stdin.lock().unwrap();
        let w = g.as_mut().ok_or_else(|| invalid("stdin is closed"))?;
        w.write_all(data.as_bytes())
            .and_then(|_| w.flush())
            .map_err(|e| io_msg(format!("stdin write failed: {e}")))
    }

    pub fn close_stdin(&self, process_id: &str) -> R<()> {
        let p = self.proc(process_id)?;
        p.stdin.lock().unwrap().take();
        Ok(())
    }

    /// Signals the process group; SIGINT/SIGTERM escalate if the process is still alive.
    /// Idempotent: killing a process that already exited is Ok.
    pub fn kill(&self, process_id: &str, signal: &str) -> R<()> {
        let sig = match signal {
            "SIGINT" => Sig::Int,
            "SIGTERM" => Sig::Term,
            "SIGKILL" => Sig::Kill,
            s => return Err(invalid(format!("Unknown signal {s}"))),
        };
        let Ok(p) = self.proc(process_id) else {
            return Ok(());
        };
        if p.exited.load(Ordering::SeqCst) {
            return Ok(());
        }
        signal_group(p.pid, sig);
        let steps: Vec<(Duration, Sig)> = match sig {
            Sig::Int => vec![
                (self.cfg.term_grace, Sig::Term),
                (self.cfg.kill_grace, Sig::Kill),
            ],
            Sig::Term => vec![(self.cfg.kill_grace, Sig::Kill)],
            Sig::Kill => vec![],
        };
        if !steps.is_empty() {
            std::thread::spawn(move || {
                for (wait, s) in steps {
                    std::thread::sleep(wait);
                    if p.exited.load(Ordering::SeqCst) {
                        return;
                    }
                    signal_group(p.pid, s);
                }
            });
        }
        Ok(())
    }

    pub fn running(&self) -> usize {
        self.procs.lock().unwrap().len()
    }

    /// App exit: SIGTERM every live group, then SIGKILL shortly after.
    pub fn shutdown(&self) {
        let live: Vec<Arc<Proc>> = self.procs.lock().unwrap().values().cloned().collect();
        if live.is_empty() {
            return;
        }
        for p in &live {
            if !p.exited.load(Ordering::SeqCst) {
                signal_group(p.pid, Sig::Term);
            }
        }
        std::thread::sleep(Duration::from_millis(300));
        for p in &live {
            if !p.exited.load(Ordering::SeqCst) {
                signal_group(p.pid, Sig::Kill);
            }
        }
    }
}

fn node_version_key(p: &Path) -> Vec<u64> {
    p.parent()
        .and_then(|d| d.file_name())
        .map(|n| {
            n.to_string_lossy()
                .trim_start_matches('v')
                .split('.')
                .map(|x| x.parse().unwrap_or(0))
                .collect()
        })
        .unwrap_or_default()
}

fn pump(mut r: Box<dyn Read + Send>, stream: &str, id: &str, sink: &dyn EventSink) {
    let mut buf = vec![0u8; 64 * 1024];
    let mut dec = Utf8Chunker::default();
    loop {
        match r.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let chunk = dec.push(&buf[..n]);
                if !chunk.is_empty() {
                    sink.emit(
                        EV_CLI_OUTPUT,
                        json!({ "processId": id, "stream": stream, "chunk": chunk }),
                    );
                }
            }
        }
    }
    let rest = dec.flush();
    if !rest.is_empty() {
        sink.emit(
            EV_CLI_OUTPUT,
            json!({ "processId": id, "stream": stream, "chunk": rest }),
        );
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Sig {
    Int,
    Term,
    Kill,
}

#[cfg(unix)]
pub(crate) fn signal_group(pid: u32, sig: Sig) {
    let s = match sig {
        Sig::Int => libc::SIGINT,
        Sig::Term => libc::SIGTERM,
        Sig::Kill => libc::SIGKILL,
    };
    // SAFETY: plain signal delivery to the process group we created (pgid = pid).
    unsafe {
        if libc::killpg(pid as libc::pid_t, s) != 0 {
            libc::kill(pid as libc::pid_t, s);
        }
    }
}

#[cfg(windows)]
pub(crate) fn signal_group(pid: u32, sig: Sig) {
    let mut c = Command::new("taskkill");
    c.args(["/PID", &pid.to_string(), "/T"]);
    if sig == Sig::Kill {
        c.arg("/F");
    }
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let _ = c.stdout(Stdio::null()).stderr(Stdio::null()).status();
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn signal_group(_pid: u32, _sig: Sig) {}

fn exit_signal(s: &std::process::ExitStatus) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        s.signal().map(|n| {
            match n {
                libc::SIGINT => "SIGINT",
                libc::SIGTERM => "SIGTERM",
                libc::SIGKILL => "SIGKILL",
                libc::SIGHUP => "SIGHUP",
                libc::SIGPIPE => "SIGPIPE",
                _ => return format!("SIG{n}"),
            }
            .to_string()
        })
    }
    #[cfg(not(unix))]
    {
        let _ = s;
        None
    }
}

/// The login shell's environment (macOS/Linux GUI apps don't inherit the user's shell setup).
/// Values stay in memory: they feed spawned CLIs and `has_env`, never IPC.
pub(crate) fn read_login_env() -> Option<HashMap<String, String>> {
    if cfg!(windows) {
        return None;
    }
    let shell = std::env::var("SHELL").ok().filter(|s| s.starts_with('/'))?;
    const MARK: &str = "__KIMO_ENV_7f3a__";
    let mut child = Command::new(&shell)
        .args(["-ilc", &format!("printf '{MARK}'; env -0")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut out = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = out.read_to_end(&mut b);
        let _ = tx.send(b);
    });
    let bytes = match rx.recv_timeout(Duration::from_secs(3)) {
        Ok(b) => b,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };
    let _ = child.wait();
    let text = String::from_utf8_lossy(&bytes);
    let body = text.split_once(MARK)?.1;
    Some(
        body.split('\0')
            .filter_map(|kv| kv.split_once('='))
            .filter(|(k, _)| valid_env_name(k))
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    )
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::ai::tests_support::ChannelSink;
    use std::os::unix::fs::PermissionsExt;

    struct Fixture {
        _dir: tempfile::TempDir,
        home: PathBuf,
        bin: PathBuf,
        host: Arc<CliHost>,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        // Canonical (macOS /var → /private/var) so prefix checks are exact.
        let base = std::fs::canonicalize(dir.path()).unwrap();
        let home = base.join("home");
        let bin = home.join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let mut cfg = CliConfig::new(home.clone(), home.join(".kimo"), "/app/kimo-mcp".into());
        cfg.login_shell_env = false;
        cfg.term_grace = Duration::from_millis(300);
        cfg.kill_grace = Duration::from_millis(300);
        // The fixture lives in the temp dir; keep only the Kimo-home rule.
        cfg.forbidden_roots = vec![home.join(".kimo")];
        cfg.search_process_path = false;
        Fixture {
            _dir: dir,
            home,
            bin,
            host: Arc::new(CliHost::new(cfg)),
        }
    }

    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    fn which_in(f: &Fixture, cmd: &str) -> String {
        f.host
            .which(cmd, &["~/.local/bin".into()])
            .unwrap()
            .expect("resolves")
    }

    #[test]
    fn which_allow_list_and_forbidden_dirs() {
        let f = fixture();
        script(&f.bin, "claude", "echo 1.2.3");
        std::fs::create_dir_all(f.home.join(".kimo/ai")).unwrap();
        std::fs::write(
            f.home.join(".kimo/ai/clis.json"),
            r#"[{"id":"aider","command":"aider"},{"id":"x","command":"python3"},{"id":"f","command":"kimofakecli"}]"#,
        )
        .unwrap();
        assert_eq!(f.host.which("bash", &[]).unwrap_err().code, "PERMISSION");
        assert_eq!(
            f.host.which("../claude", &[]).unwrap_err().code,
            "PERMISSION"
        );
        // Found through an extra dir under $HOME, then runnable.
        let found = f
            .host
            .which("claude", &["~/.local/bin".into()])
            .unwrap()
            .unwrap();
        assert_eq!(found, crate::util::path_str(&f.bin.join("claude")));
        assert_eq!(
            f.host.exec(&found, &[], 2000, None).unwrap().stdout,
            "1.2.3\n"
        );
        // Binaries under ~/.kimo never resolve (JS can write files there), even if asked.
        // (A unique generic name, so a real install in a known dir can't answer.)
        let planted = f.home.join(".kimo/bin");
        std::fs::create_dir_all(&planted).unwrap();
        script(&planted, "kimofakecli", "echo pwned");
        assert_eq!(
            f.host
                .which("kimofakecli", &["~/.kimo/bin".into()])
                .unwrap(),
            None
        );
        // Extra dirs outside $HOME that are not known install dirs are ignored.
        let outside = f.home.parent().unwrap().join("elsewhere");
        std::fs::create_dir_all(&outside).unwrap();
        script(&outside, "kimofakecli", "echo x");
        assert_eq!(
            f.host
                .which("kimofakecli", &[crate::util::path_str(&outside)])
                .unwrap(),
            None
        );
        // Generic CLIs come from ~/.kimo/ai/clis.json, minus denied names.
        assert!(f.host.command_allowed("aider"));
        assert!(!f.host.command_allowed("python3"));
        assert!(!f.host.command_allowed("rm"));
    }

    #[test]
    fn exec_probe_and_timeout() {
        let f = fixture();
        script(
            &f.bin,
            "claude",
            "echo \"claude 2.1.289\"; echo warn >&2; exit 3",
        );
        let p = which_in(&f, "claude");
        let r = f.host.exec(&p, &["--version".into()], 5_000, None).unwrap();
        assert_eq!(r.code, Some(3));
        assert_eq!(r.stdout.trim(), "claude 2.1.289");
        assert_eq!(r.stderr.trim(), "warn");
        script(&f.bin, "codex", "sleep 10");
        let p = which_in(&f, "codex");
        let t = Instant::now();
        let r = f.host.exec(&p, &[], 200, None).unwrap();
        assert_eq!(r.code, None);
        assert!(t.elapsed() < Duration::from_secs(3));
        // Unresolved paths are refused.
        assert_eq!(
            f.host.exec("/bin/echo", &[], 1000, None).unwrap_err().code,
            "PERMISSION"
        );
        // Injection variables are refused.
        let env = HashMap::from([("DYLD_INSERT_LIBRARIES".to_string(), "x".to_string())]);
        assert_eq!(
            f.host.exec(&p, &[], 1000, Some(&env)).unwrap_err().code,
            "INVALID"
        );
    }

    #[test]
    fn env_and_file_probes() {
        let f = fixture();
        std::env::set_var("KIMO_TEST_PRESENT_VAR", "secret-value");
        assert!(f.host.has_env("KIMO_TEST_PRESENT_VAR").unwrap());
        assert!(!f.host.has_env("KIMO_TEST_ABSENT_VAR_X").unwrap());
        assert!(f.host.has_env("bad-name").is_err());
        assert!(!f.host.home_file_exists(".gemini/oauth_creds.json").unwrap());
        std::fs::create_dir_all(f.home.join(".gemini")).unwrap();
        std::fs::write(f.home.join(".gemini/oauth_creds.json"), "{}").unwrap();
        assert!(f.host.home_file_exists(".gemini/oauth_creds.json").unwrap());
        assert_eq!(
            f.host.home_file_exists(".ssh/id_rsa").unwrap_err().code,
            "PERMISSION"
        );
    }

    #[test]
    fn workspace_confinement() {
        let f = fixture();
        let ws = f
            .host
            .prepare_workspace(
                "abc123",
                &[(
                    ".gemini/settings.json".into(),
                    "{\"mcpServers\":{}}\n".into(),
                )],
            )
            .unwrap();
        assert!(ws.ends_with(".kimo/cli-workspaces/abc123"));
        assert!(Path::new(&ws).join(".gemini/settings.json").is_file());
        let marker = std::fs::read_to_string(Path::new(&ws).join(".kimo-workspace.json")).unwrap();
        assert!(marker.contains("/app/kimo-mcp"));
        for bad in ["../x", "/etc/passwd", "a/../../b", ""] {
            assert!(
                f.host
                    .prepare_workspace("abc123", &[(bad.into(), "x".into())])
                    .is_err(),
                "{bad}"
            );
        }
        assert!(f.host.prepare_workspace("../evil", &[]).is_err());
        // A symlink inside the workspace cannot redirect writes outside it.
        std::os::unix::fs::symlink(&f.home, Path::new(&ws).join("link")).unwrap();
        assert_eq!(
            f.host
                .prepare_workspace("abc123", &[("link/owned.txt".into(), "x".into())])
                .unwrap_err()
                .code,
            "PERMISSION"
        );
        // Spawn refuses a cwd outside the workspaces root.
        script(&f.bin, "claude", "pwd");
        let p = which_in(&f, "claude");
        let (sink, _rx) = ChannelSink::pair();
        let e = f
            .host
            .spawn(&p, &[], &crate::util::path_str(&f.home), None, sink.clone())
            .unwrap_err();
        assert_eq!(e.code, "PERMISSION");
        let root = crate::util::path_str(&f.home.join(".kimo/cli-workspaces"));
        assert_eq!(
            f.host.spawn(&p, &[], &root, None, sink).unwrap_err().code,
            "PERMISSION"
        );
    }

    #[tokio::test]
    async fn spawn_streams_stdin_and_exit() {
        let f = fixture();
        script(
            &f.bin,
            "claude",
            "printf 'cwd=%s\\n' \"$(pwd)\"; while IFS= read -r l; do printf 'got:%s\\n' \"$l\"; done; echo bye >&2; exit 7",
        );
        let p = which_in(&f, "claude");
        let ws = f.host.prepare_workspace("s1", &[]).unwrap();
        let (sink, rx) = ChannelSink::pair();
        let s = f.host.spawn(&p, &["-p".into()], &ws, None, sink).unwrap();
        assert_eq!(
            f.host.sessions.session_for(None, s.pid).as_deref(),
            Some("s1")
        );
        assert_eq!(
            f.host.sessions.session_for(Some(&ws), 0).as_deref(),
            Some("s1")
        );
        f.host.write(&s.process_id, "hello\nwörld\n").unwrap();
        f.host.close_stdin(&s.process_id).unwrap();
        let events = ChannelSink::collect_until_exit(rx, &s.process_id).await;
        let out: String = events
            .iter()
            .filter(|e| e["stream"] == "stdout")
            .map(|e| e["chunk"].as_str().unwrap())
            .collect();
        assert!(out.contains(&format!("cwd={ws}")), "{out}");
        assert!(out.contains("got:hello\ngot:wörld\n"), "{out}");
        assert!(events
            .iter()
            .any(|e| e["stream"] == "stderr" && e["chunk"] == "bye\n"));
        let exit = events.last().unwrap();
        assert_eq!(exit["code"], 7);
        assert_eq!(exit["signal"], Value::Null);
        assert_eq!(f.host.running(), 0);
        assert_eq!(f.host.sessions.session_for(None, s.pid), None);
        // Kill after exit is a no-op; write is not.
        f.host.kill(&s.process_id, "SIGTERM").unwrap();
        assert_eq!(
            f.host.write(&s.process_id, "x").unwrap_err().code,
            "NOT_FOUND"
        );
    }

    #[tokio::test]
    async fn kill_escalates_to_sigkill() {
        let f = fixture();
        // Ignores SIGINT and SIGTERM: only SIGKILL ends it.
        script(
            &f.bin,
            "codex",
            "trap '' INT TERM; echo ready; while :; do sleep 0.05; done",
        );
        let p = which_in(&f, "codex");
        let ws = f.host.prepare_workspace("s2", &[]).unwrap();
        let (sink, mut rx) = ChannelSink::pair();
        let s = f.host.spawn(&p, &[], &ws, None, sink).unwrap();
        // Wait for the trap to be installed.
        loop {
            let e = rx.recv().await.unwrap();
            if e["chunk"] == "ready\n" {
                break;
            }
        }
        let t = Instant::now();
        f.host.kill(&s.process_id, "SIGINT").unwrap();
        let events = ChannelSink::collect_until_exit(rx, &s.process_id).await;
        let exit = events.last().unwrap();
        assert_eq!(exit["signal"], "SIGKILL");
        let took = t.elapsed();
        // term_grace + kill_grace = 600 ms in the fixture.
        assert!(took >= Duration::from_millis(550), "{took:?}");
        assert!(took < Duration::from_secs(5), "{took:?}");
    }

    #[tokio::test]
    async fn sigint_ends_a_cooperative_process() {
        let f = fixture();
        script(&f.bin, "gemini", "echo up; exec sleep 30");
        let p = which_in(&f, "gemini");
        let ws = f.host.prepare_workspace("s3", &[]).unwrap();
        let (sink, mut rx) = ChannelSink::pair();
        let s = f.host.spawn(&p, &[], &ws, None, sink).unwrap();
        let _ = rx.recv().await;
        f.host.kill(&s.process_id, "SIGINT").unwrap();
        let events = ChannelSink::collect_until_exit(rx, &s.process_id).await;
        assert_eq!(events.last().unwrap()["signal"], "SIGINT", "{events:?}");
    }

    #[test]
    fn utf8_chunker_holds_back_partial_sequences() {
        let mut c = Utf8Chunker::default();
        let bytes = "aé€😀".as_bytes();
        let mut out = String::new();
        for b in bytes {
            out.push_str(&c.push(&[*b]));
        }
        out.push_str(&c.flush());
        assert_eq!(out, "aé€😀");
        assert_eq!(c.push(&[0xff, b'x']), "\u{fffd}x");
    }

    #[test]
    fn blocked_env_names() {
        for n in [
            "PATH",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
            "NODE_OPTIONS",
            "TAURI_X",
        ] {
            assert!(blocked_env(n), "{n}");
        }
        for n in ["ANTHROPIC_API_KEY", "HOME", "KIMO_HOME"] {
            assert!(!blocked_env(n), "{n}");
        }
    }

    #[test]
    fn known_dirs_include_nvm_newest_first() {
        let f = fixture();
        for v in ["v18.2.0", "v22.10.1", "v20.0.0"] {
            std::fs::create_dir_all(f.home.join(".nvm/versions/node").join(v).join("bin")).unwrap();
        }
        let d = f.host.known_dirs();
        let nvm: Vec<String> = d
            .iter()
            .filter(|p| p.to_string_lossy().contains(".nvm"))
            .map(|p| {
                p.parent()
                    .unwrap()
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(nvm, ["v22.10.1", "v20.0.0", "v18.2.0"]);
        assert!(d.contains(&f.home.join(".local/bin")));
        assert!(d.contains(&PathBuf::from("/opt/homebrew/bin")));
    }
}
