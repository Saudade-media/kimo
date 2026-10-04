//! The files under the Kimo home (`~/.kimo`, `KIMO_PATHS` in `topology.ts`) that the app and
//! relays share, the endpoint file, and process liveness.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// `$KIMO_HOME`, else `~/.kimo` (`%USERPROFILE%\.kimo` on Windows).
pub fn kimo_home() -> PathBuf {
    if let Some(h) = std::env::var_os("KIMO_HOME").filter(|h| !h.is_empty()) {
        return h.into();
    }
    home_dir()
        .map(|h| h.join(".kimo"))
        .unwrap_or_else(|| std::env::temp_dir().join("kimo"))
}

pub fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var)
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
}

#[derive(Debug, Clone)]
pub struct KimoPaths {
    pub home: PathBuf,
}

impl KimoPaths {
    pub fn new(home: impl Into<PathBuf>) -> Self {
        Self { home: home.into() }
    }
    pub fn socket_dir(&self) -> PathBuf {
        self.home.join("socket")
    }
    pub fn socket(&self) -> PathBuf {
        self.home.join("socket").join("kimo.sock")
    }
    pub fn mcp_dir(&self) -> PathBuf {
        self.home.join("mcp")
    }
    /// Socket token, 0600, rotated at every app start.
    pub fn token(&self) -> PathBuf {
        self.mcp_dir().join("token")
    }
    pub fn endpoint(&self) -> PathBuf {
        self.mcp_dir().join("endpoint.json")
    }
    pub fn http_tokens(&self) -> PathBuf {
        self.mcp_dir().join("http-tokens.json")
    }
    /// `{ enabled, port }` for the Streamable HTTP listener (Settings › Agents › HTTP).
    pub fn http_config(&self) -> PathBuf {
        self.mcp_dir().join("http.json")
    }
    pub fn policies(&self) -> PathBuf {
        self.mcp_dir().join("policies.json")
    }
    pub fn backups(&self) -> PathBuf {
        self.mcp_dir().join("backups")
    }
    pub fn activity(&self) -> PathBuf {
        self.home.join("activity")
    }

    /// What the app listens on: the Unix socket path, or the per-user named pipe on Windows
    /// (`\\.\pipe\kimo-<user>`; a non-default `KIMO_HOME` adds a hash so test homes never
    /// collide with the real app).
    pub fn endpoint_name(&self) -> String {
        if cfg!(windows) {
            let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
            let user: String = user
                .chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect();
            let default = home_dir().map(|h| h.join(".kimo"));
            if default.as_deref() == Some(self.home.as_path()) {
                windows_pipe_name(&user)
            } else {
                format!("{}-{}", windows_pipe_name(&user), short_hash(&self.home))
            }
        } else {
            self.socket().to_string_lossy().into_owned()
        }
    }
}

pub fn windows_pipe_name(user: &str) -> String {
    format!(r"\\.\pipe\kimo-{user}")
}

fn short_hash(p: &Path) -> String {
    // FNV-1a: stable, no dependency; only used to keep test pipes apart.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in p.to_string_lossy().as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{:08x}", h as u32)
}

/// `~/.kimo/mcp/endpoint.json` (`EndpointFile`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointFile {
    pub version: u32,
    pub pid: u32,
    pub app_version: String,
    pub socket: String,
    pub socket_protocol: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http: Option<HttpEndpoint>,
    pub started_at_iso: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpEndpoint {
    pub url: String,
    pub port: u16,
}

pub fn read_endpoint(paths: &KimoPaths) -> Option<EndpointFile> {
    let bytes = std::fs::read(paths.endpoint()).ok()?;
    serde_json::from_slice(&bytes).ok()
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

/// The parent pid of this process.
pub fn parent_pid() -> u32 {
    #[cfg(unix)]
    {
        // SAFETY: getppid has no preconditions.
        unsafe { libc::getppid() as u32 }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        let me = std::process::id();
        // SAFETY: Toolhelp snapshot walk over a handle we own and close.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return 0;
            }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut found = 0;
            if Process32FirstW(snap, &mut e) != 0 {
                loop {
                    if e.th32ProcessID == me {
                        found = e.th32ParentProcessID;
                        break;
                    }
                    if Process32NextW(snap, &mut e) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
            found
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_matches_topology_ts() {
        let p = KimoPaths::new("/h/.kimo");
        assert!(p.socket().ends_with("socket/kimo.sock"));
        assert!(p.token().ends_with("mcp/token"));
        assert!(p.endpoint().ends_with("mcp/endpoint.json"));
        assert!(p.http_tokens().ends_with("mcp/http-tokens.json"));
        assert!(p.policies().ends_with("mcp/policies.json"));
        assert!(p.backups().ends_with("mcp/backups"));
        assert!(p.activity().ends_with("activity"));
        if cfg!(unix) {
            assert_eq!(p.endpoint_name(), "/h/.kimo/socket/kimo.sock");
        }
        assert_eq!(windows_pipe_name("me"), r"\\.\pipe\kimo-me");
    }

    #[test]
    fn liveness() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(0));
        assert_ne!(parent_pid(), 0);
    }

    #[test]
    fn endpoint_round_trips_camel_case() {
        let e = EndpointFile {
            version: 1,
            pid: 4,
            app_version: "0.5.0".into(),
            socket: "/s".into(),
            socket_protocol: "kimo-socket/1".into(),
            http: None,
            started_at_iso: "2026-10-04T09:12:00.000Z".into(),
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["appVersion"], "0.5.0");
        assert_eq!(v["socketProtocol"], "kimo-socket/1");
        assert!(v.get("http").is_none());
    }
}
