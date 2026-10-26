//! The MCP files under `~/.kimo` (ADR 0013 §6, §7, §9): socket token, endpoint file, HTTP
//! config and per-host bearer tokens, per-client policies, activity logs, and the allow-list of
//! agent-host config files the installer may read and write.

use crate::error::{invalid, io_msg, permission, R};
use base64::Engine;
use kimo_mcp::paths::KimoPaths;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Activity logs keep the last 500 entries per file.
pub const ACTIVITY_KEEP: usize = 500;
/// Rewrite the log once it grows this far past the cap (amortized trimming).
const ACTIVITY_SLACK: usize = 100;
pub const DEFAULT_HTTP_PORT: u16 = 47_820;

/// 32 random bytes, base64url without padding.
pub fn mint_token() -> String {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).expect("OS random source");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// `n` random base-36 characters (connection/session ids).
pub fn base36(n: usize) -> String {
    const A: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut b = vec![0u8; n];
    getrandom::fill(&mut b).expect("OS random source");
    // 252 = 7 × 36: reject the tail so every character is uniform.
    let mut out = String::with_capacity(n);
    let mut i = 0;
    while out.len() < n {
        if i == b.len() {
            getrandom::fill(&mut b).expect("OS random source");
            i = 0;
        }
        if b[i] < 252 {
            out.push(A[(b[i] % 36) as usize] as char);
        }
        i += 1;
    }
    out
}

/// `mkdir -p`, then 0700 on Unix.
pub fn ensure_private_dir(dir: &Path) -> R<()> {
    std::fs::create_dir_all(dir)
        .map_err(|e| io_msg(format!("Could not create {}: {e}", dir.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

/// Atomic write of a private file (0600 on Unix from the first byte).
pub fn write_private(path: &Path, bytes: &[u8]) -> R<()> {
    let dir = path
        .parent()
        .ok_or_else(|| invalid(format!("No parent directory: {}", path.display())))?;
    ensure_private_dir(dir)?;
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("kimo"),
        base36(8)
    ));
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let res = (|| -> std::io::Result<()> {
        let mut f = opts.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_file(&tmp);
        return Err(io_msg(format!("Could not write {}: {e}", path.display())));
    }
    Ok(())
}

fn write_private_json<T: Serialize>(path: &Path, v: &T) -> R<()> {
    let mut bytes = serde_json::to_vec_pretty(v).map_err(|e| invalid(e.to_string()))?;
    bytes.push(b'\n');
    write_private(path, &bytes)
}

fn read_json_or_default<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

// --- HTTP ---------------------------------------------------------------------------------------

/// `~/.kimo/mcp/http.json`. Off by default; `port` is configurable here (or with
/// `KIMO_MCP_HTTP_PORT`), falling back to an ephemeral port when taken.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_port")]
    pub port: u16,
}

fn default_port() -> u16 {
    DEFAULT_HTTP_PORT
}

impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_HTTP_PORT,
        }
    }
}

pub fn read_http_config(paths: &KimoPaths) -> HttpConfig {
    let mut c: HttpConfig = read_json_or_default(&paths.http_config());
    if let Some(p) = std::env::var("KIMO_MCP_HTTP_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        c.port = p;
    }
    c
}

pub fn write_http_config(paths: &KimoPaths, c: &HttpConfig) -> R<()> {
    write_private_json(&paths.http_config(), c)
}

/// `{ "<client>": "<token>" }`.
pub fn read_http_tokens(paths: &KimoPaths) -> BTreeMap<String, String> {
    read_json_or_default(&paths.http_tokens())
}

/// New bearer for one host (revokes the old one). Returns the token.
pub fn rotate_http_token(paths: &KimoPaths, client: &str) -> R<(String, BTreeMap<String, String>)> {
    check_client(client)?;
    let mut all = read_http_tokens(paths);
    let t = mint_token();
    all.insert(client.to_string(), t.clone());
    write_private_json(&paths.http_tokens(), &all)?;
    Ok((t, all))
}

// --- Server settings and log --------------------------------------------------------------------

/// `~/.kimo/mcp/server.json`: Settings › Agents › "Start server when Kimo opens" and "Ask before
/// destructive or out-of-scope ops" (both default on).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSettings {
    #[serde(default = "default_true")]
    pub start_on_launch: bool,
    /// Off: no client's destructive edits wait for approval, whatever its own policy says (the
    /// document host ANDs this with each policy's `confirmDestructive`).
    #[serde(default = "default_true")]
    pub ask_before_destructive: bool,
}

fn default_true() -> bool {
    true
}

impl Default for ServerSettings {
    fn default() -> Self {
        Self {
            start_on_launch: true,
            ask_before_destructive: true,
        }
    }
}

pub fn server_settings_path(paths: &KimoPaths) -> PathBuf {
    paths.mcp_dir().join("server.json")
}

pub fn read_server_settings(paths: &KimoPaths) -> ServerSettings {
    read_json_or_default(&server_settings_path(paths))
}

pub fn write_server_settings(paths: &KimoPaths, s: &ServerSettings) -> R<()> {
    write_private_json(&server_settings_path(paths), s)
}

/// `~/.kimo/mcp/server.log`: listener starts/stops and failures (Settings › Agents › Log).
pub fn server_log_path(paths: &KimoPaths) -> PathBuf {
    paths.mcp_dir().join("server.log")
}

/// The log rotates to `server.log.1` past this size.
pub const SERVER_LOG_MAX: u64 = 512 * 1024;

/// Appends one timestamped line (best effort; 0600, rotated past {@link SERVER_LOG_MAX}).
pub fn log_append(paths: &KimoPaths, line: &str) {
    let path = server_log_path(paths);
    if ensure_private_dir(&paths.mcp_dir()).is_err() {
        return;
    }
    if std::fs::metadata(&path)
        .map(|m| m.len() > SERVER_LOG_MAX)
        .unwrap_or(false)
    {
        let _ = std::fs::rename(&path, path.with_extension("log.1"));
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    if let Ok(mut f) = opts.open(&path) {
        let iso = crate::util::iso_from_ms(crate::util::now_ms());
        let _ = writeln!(f, "{iso} {}", line.replace('\n', " "));
    }
}

/// True when nothing listens on `127.0.0.1:<port>` (Settings › Agents › port field).
pub fn port_free(port: u16) -> bool {
    port != 0 && std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

// --- Policies -----------------------------------------------------------------------------------

/// `McpClientPolicy` (structural check; the document host owns the semantics).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientPolicy {
    pub level: Level,
    pub files: Vec<String>,
    pub nodes: Vec<String>,
    pub grants: Vec<Grant>,
    pub on_exceed: OnExceed,
    pub confirm_destructive: bool,
    /// Board 34 auto-approve. Absent = true (ADR 0013 Addendum 8: connected clients are trusted
    /// unless Settings › "Ask before changes" is on), so it is always written back.
    #[serde(default = "auto_approve_default")]
    pub auto_approve: bool,
}

fn auto_approve_default() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Level {
    #[serde(rename = "read")]
    Read,
    #[serde(rename = "edit")]
    Edit,
    #[serde(rename = "edit+delete")]
    EditDelete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Grant {
    #[serde(rename = "globals")]
    Globals,
    #[serde(rename = "components")]
    Components,
    #[serde(rename = "save")]
    Save,
    #[serde(rename = "export")]
    Export,
    #[serde(rename = "files.create")]
    FilesCreate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OnExceed {
    Ask,
    Deny,
}

/// Client slugs: 1–128 printable characters (installer slugs like `claude-code`, or an MCP
/// `clientInfo.name`).
pub fn check_client(client: &str) -> R<()> {
    if client.is_empty() || client.len() > 128 || client.chars().any(char::is_control) {
        return Err(invalid(format!("Invalid client name: {client:?}")));
    }
    Ok(())
}

pub fn read_policies(paths: &KimoPaths) -> Map<String, Value> {
    let raw: Map<String, Value> = read_json_or_default(&paths.policies());
    // Drop entries that are not valid policies (hand edits), like settings normalization, and
    // read the rest back normalized, so a policy stored without autoApprove reads as trusted.
    raw.into_iter()
        .filter_map(|(k, v)| {
            let p = serde_json::from_value::<ClientPolicy>(v).ok()?;
            Some((k, serde_json::to_value(p).ok()?))
        })
        .collect()
}

pub fn set_policy(paths: &KimoPaths, client: &str, policy: Option<Value>) -> R<()> {
    check_client(client)?;
    let mut all = read_policies(paths);
    match policy {
        Some(v) => {
            let p: ClientPolicy = serde_json::from_value(v)
                .map_err(|e| invalid(format!("Invalid policy for {client}: {e}")))?;
            all.insert(
                client.to_string(),
                serde_json::to_value(p).map_err(|e| invalid(e.to_string()))?,
            );
        }
        None => {
            all.remove(client);
        }
    }
    write_private_json(&paths.policies(), &all)
}

// --- Activity -----------------------------------------------------------------------------------

/// `fileId` = `sha256(path)[:16]` (or an untitled id): `[A-Za-z0-9_-]{1,64}`.
pub fn check_file_id(id: &str) -> R<()> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(invalid(format!("Invalid file id: {id:?}")));
    }
    Ok(())
}

fn activity_path(paths: &KimoPaths, file_id: &str) -> R<PathBuf> {
    check_file_id(file_id)?;
    Ok(paths.activity().join(format!("{file_id}.jsonl")))
}

pub fn activity_append(paths: &KimoPaths, file_id: &str, entry: &Value) -> R<()> {
    if !entry.is_object() {
        return Err(invalid("Activity entry must be an object"));
    }
    let path = activity_path(paths, file_id)?;
    ensure_private_dir(&paths.activity())?;
    let line = serde_json::to_string(entry).map_err(|e| invalid(e.to_string()))?;
    let mut opts = std::fs::OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts
        .open(&path)
        .map_err(|e| io_msg(format!("Could not open {}: {e}", path.display())))?;
    f.write_all(format!("{line}\n").as_bytes())
        .map_err(|e| io_msg(e.to_string()))?;
    drop(f);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() > ACTIVITY_KEEP + ACTIVITY_SLACK {
        let keep = lines[lines.len() - ACTIVITY_KEEP..].join("\n") + "\n";
        write_private(&path, keep.as_bytes())?;
    }
    Ok(())
}

/// Newest last; at most `min(limit, 500)` entries. Unparsable lines are skipped.
pub fn activity_read(paths: &KimoPaths, file_id: &str, limit: usize) -> R<Vec<Value>> {
    let path = activity_path(paths, file_id)?;
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(io_msg(e.to_string())),
    };
    let all: Vec<Value> = text
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(Value::is_object)
        .collect();
    let n = limit.min(ACTIVITY_KEEP);
    Ok(all[all.len().saturating_sub(n)..].to_vec())
}

// --- Installer config files ---------------------------------------------------------------------

/// Project-scope config files (ADR 0013 §9), as path suffixes under any project directory.
const PROJECT_CONFIGS: &[&[&str]] = &[
    &[".mcp.json"],
    &[".codex", "config.toml"],
    &[".gemini", "settings.json"],
    &[".cursor", "mcp.json"],
    &[".vscode", "mcp.json"],
];

/// User-scope config files under the home directory.
pub fn user_configs(home: &Path) -> Vec<PathBuf> {
    let mut v = vec![
        home.join(".claude.json"),
        home.join(".codex").join("config.toml"),
        home.join(".gemini").join("settings.json"),
        home.join(".cursor").join("mcp.json"),
    ];
    if cfg!(target_os = "macos") {
        v.push(home.join("Library/Application Support/Code/User/mcp.json"));
    } else if cfg!(windows) {
        if let Some(app_data) = std::env::var_os("APPDATA") {
            v.push(
                PathBuf::from(app_data)
                    .join("Code")
                    .join("User")
                    .join("mcp.json"),
            );
        }
    } else {
        v.push(home.join(".config/Code/User/mcp.json"));
    }
    v
}

/// Whether the installer may touch `path`: a known user/project config file of one of the five
/// hosts, or a `.bak` directly under `~/.kimo/mcp/backups`.
pub fn config_path_allowed(paths: &KimoPaths, home: Option<&Path>, path: &Path) -> bool {
    if path.parent() == Some(paths.backups().as_path()) {
        return path.extension().is_some_and(|e| e == "bak");
    }
    if let Some(h) = home {
        if user_configs(h).iter().any(|p| p == path) {
            return true;
        }
    }
    let comps: Vec<String> = path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    PROJECT_CONFIGS.iter().any(|suffix| {
        comps.len() > suffix.len() && comps[comps.len() - suffix.len()..] == suffix[..]
    })
}

pub fn checked_config_path(paths: &KimoPaths, home: Option<&Path>, path: &str) -> R<PathBuf> {
    let p = crate::util::clean_abs(path)?;
    if !config_path_allowed(paths, home, &p) {
        return Err(permission(format!(
            "Not an agent-host config file Kimo may edit: {path}"
        )));
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn paths() -> (tempfile::TempDir, KimoPaths) {
        let d = tempfile::tempdir().unwrap();
        let p = KimoPaths::new(d.path().join(".kimo"));
        (d, p)
    }

    #[test]
    fn tokens_are_32_bytes_base64url() {
        let t = mint_token();
        assert_eq!(t.len(), 43);
        assert!(t
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(t, mint_token());
        let s = base36(6);
        assert_eq!(s.len(), 6);
        assert!(s
            .chars()
            .all(|c| c.is_ascii_digit() || c.is_ascii_lowercase()));
    }

    #[cfg(unix)]
    #[test]
    fn private_files_are_0600() {
        use std::os::unix::fs::PermissionsExt;
        let (_d, p) = paths();
        write_private(&p.token(), b"abc").unwrap();
        let mode = std::fs::metadata(p.token()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let dmode = std::fs::metadata(p.mcp_dir()).unwrap().permissions().mode() & 0o777;
        assert_eq!(dmode, 0o700);
        assert_eq!(std::fs::read(p.token()).unwrap(), b"abc");
    }

    #[test]
    fn http_config_and_tokens() {
        let (_d, p) = paths();
        assert_eq!(read_http_config(&p), HttpConfig::default());
        write_http_config(
            &p,
            &HttpConfig {
                enabled: true,
                port: 5000,
            },
        )
        .unwrap();
        assert!(read_http_config(&p).enabled);
        let (t1, _) = rotate_http_token(&p, "codex").unwrap();
        let (t2, all) = rotate_http_token(&p, "codex").unwrap();
        assert_ne!(t1, t2);
        assert_eq!(all.get("codex"), Some(&t2));
        assert_eq!(read_http_tokens(&p).get("codex"), Some(&t2));
        assert!(rotate_http_token(&p, "").is_err());
    }

    #[test]
    fn policies_round_trip_and_validate() {
        let (_d, p) = paths();
        let pol = json!({"level":"edit+delete","files":["/repo/**"],"nodes":[],"grants":["save","files.create"],"onExceed":"ask","confirmDestructive":true});
        set_policy(&p, "claude-code", Some(pol.clone())).unwrap();
        // Policies stored before Addendum 8 have no autoApprove: they read back trusted.
        let mut trusted = pol.clone();
        trusted["autoApprove"] = json!(true);
        assert_eq!(read_policies(&p)["claude-code"], trusted);
        assert!(set_policy(&p, "x", Some(json!({"level":"admin"}))).is_err());
        set_policy(&p, "claude-code", None).unwrap();
        assert!(read_policies(&p).is_empty());
    }

    #[test]
    fn policies_keep_auto_approve() {
        let (_d, p) = paths();
        let on = json!({"level":"edit","files":[],"nodes":[],"grants":["export"],"onExceed":"ask","confirmDestructive":true,"autoApprove":true});
        set_policy(&p, "codex", Some(on.clone())).unwrap();
        assert_eq!(read_policies(&p)["codex"], on);
        // "Ask before changes" stores false explicitly, since absent means true.
        let off = json!({"level":"edit","files":[],"nodes":[],"grants":[],"onExceed":"ask","confirmDestructive":true,"autoApprove":false});
        set_policy(&p, "codex", Some(off.clone())).unwrap();
        assert_eq!(read_policies(&p)["codex"], off);
        assert!(set_policy(&p, "codex", Some(json!({"level":"edit","files":[],"nodes":[],"grants":[],"onExceed":"ask","confirmDestructive":true,"autoApprove":"yes"}))).is_err());
    }

    #[test]
    fn activity_keeps_the_last_500() {
        let (_d, p) = paths();
        for i in 0..(ACTIVITY_KEEP + ACTIVITY_SLACK + 5) {
            activity_append(&p, "abc123", &json!({"seq": i})).unwrap();
        }
        let all = activity_read(&p, "abc123", 10_000).unwrap();
        assert!(all.len() <= ACTIVITY_KEEP);
        assert_eq!(
            all.last().unwrap()["seq"],
            ACTIVITY_KEEP + ACTIVITY_SLACK + 4
        );
        let last3 = activity_read(&p, "abc123", 3).unwrap();
        assert_eq!(last3.len(), 3);
        assert_eq!(last3[2]["seq"], ACTIVITY_KEEP + ACTIVITY_SLACK + 4);
        assert!(activity_read(&p, "nope", 5).unwrap().is_empty());
        assert!(activity_append(&p, "../x", &json!({})).is_err());
        assert!(activity_append(&p, "ok", &json!(1)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn config_allow_list() {
        let (_d, p) = paths();
        let home = Path::new("/Users/me");
        let ok = |s: &str| config_path_allowed(&p, Some(home), Path::new(s));
        assert!(ok("/Users/me/.claude.json"));
        assert!(ok("/Users/me/.codex/config.toml"));
        assert!(ok("/Users/me/.gemini/settings.json"));
        assert!(ok("/Users/me/.cursor/mcp.json"));
        assert!(ok("/work/repo/.mcp.json"));
        assert!(ok("/work/repo/.vscode/mcp.json"));
        assert!(ok("/work/repo/.codex/config.toml"));
        assert!(!ok("/Users/me/.ssh/config"));
        assert!(!ok("/work/repo/.claude.json"));
        assert!(!ok("/work/repo/mcp.json"));
        let bak = p.backups().join("codex-2026.bak");
        assert!(config_path_allowed(&p, Some(home), &bak));
        assert!(!config_path_allowed(
            &p,
            Some(home),
            &p.backups().join("x.json")
        ));
        assert!(checked_config_path(&p, Some(home), "/work/../etc/.mcp.json").is_err());
        assert!(checked_config_path(&p, Some(home), "relative/.mcp.json").is_err());
    }
}
