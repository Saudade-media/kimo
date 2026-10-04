//! M5 MCP relay inside the desktop app (ADR 0013 §7, docs/spec/socket.md): the socket/pipe
//! listener, the optional loopback Streamable HTTP listener, `~/.kimo/mcp/{token,endpoint.json}`
//! and the hidden `document-host` webview the relay talks to (ADR 0002 Option A, 0012 §2).
//!
//! Document host contract (the `#/host` route):
//! - listen to `kimo://mcp-connection` (opens with the hello, closes), `kimo://mcp-in`
//!   (`{connectionId, message}`: one MCP JSON-RPC line) and `kimo://mcp-http-request`;
//! - answer with `kimo_mcp_send {connectionId, message}` and
//!   `kimo_mcp_http_respond {requestId, status?, headers?, chunkBase64?, end}`;
//! - call `kimo_mcp_host_ready {version}` once listeners are installed (after every page load).
//!   Until then Rust queues inbound lines ≤ 15 s; on ready it re-announces every open
//!   connection and, after a reload, replays each session's `initialize` (response swallowed).

pub mod files;
pub mod http;
pub mod hub;
pub mod listener;
#[cfg(test)]
mod tests;

use crate::error::{io_msg, R};
use hub::{HostSink, HttpStatus, Hub, HubConfig};
use kimo_mcp::paths::{EndpointFile, HttpEndpoint, KimoPaths};
use kimo_mcp::protocol::SOCKET_PROTOCOL;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// The hidden document host window (ADR 0012 §2, ADR 0013 §7).
pub const HOST_LABEL: &str = "document-host";
/// The web app route the host window loads.
pub const HOST_ROUTE: &str = "index.html#/host";
/// argv flag: start without an editor window (`kimo-mcp --launch`).
pub const BACKGROUND_FLAG: &str = kimo_mcp::launch::BACKGROUND_FLAG;

struct TauriSink<Rt: Runtime> {
    app: AppHandle<Rt>,
}

impl<Rt: Runtime> HostSink for TauriSink<Rt> {
    fn to_host(&self, event: &'static str, payload: Value) {
        let _ = self.app.emit_to(HOST_LABEL, event, payload);
    }
    fn broadcast(&self, event: &'static str, payload: Value) {
        let _ = self.app.emit(event, payload);
    }
}

pub struct McpService {
    pub hub: Arc<Hub>,
    pub paths: KimoPaths,
    /// Socket path or pipe name.
    pub endpoint: String,
    /// This process listens on the endpoint (another live Kimo may own it).
    owns_endpoint: AtomicBool,
    /// Stops the socket/pipe accept loop (Some while the server runs).
    socket_stop: std::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    /// Serializes start / stop / restart.
    lifecycle: tokio::sync::Mutex<()>,
    http: tokio::sync::Mutex<Option<http::HttpHandle>>,
    pub http_tokens: http::Tokens,
    /// Last error written to the server log (Settings › Agents › Log).
    last_error: std::sync::Mutex<Option<String>>,
    started_at_iso: String,
    app_version: String,
    /// Started with `--background`: no editor window until the user asks for one.
    pub background: bool,
    /// The user asked to quit (menu / ⌘Q): exit once the editor windows are gone.
    pub quitting: AtomicBool,
    /// The process is exiting: do not resurrect the host window.
    pub exiting: AtomicBool,
}

/// The bundled shim next to the app binary (`Kimo.app/Contents/MacOS/kimo-mcp`, …).
pub fn shim_path() -> String {
    let name = if cfg!(windows) {
        "kimo-mcp.exe"
    } else {
        "kimo-mcp"
    };
    std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join(name)))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string())
}

/// `McpServerError` (packages/platform/src/mcp.ts).
pub fn server_error(code: &str, message: &str, port: Option<u16>, suggested: Option<u16>) -> Value {
    let mut v = serde_json::json!({
        "code": code,
        "message": message,
        "time": crate::util::now_ms(),
    });
    if let Some(p) = port {
        v["port"] = p.into();
    }
    if let Some(p) = suggested {
        v["suggestedPort"] = p.into();
    }
    v
}

impl McpService {
    /// Creates the service and, unless Settings › Agents turned "Start server when Kimo opens"
    /// off (a `--background` launch from the shim always starts it), starts the listeners and
    /// writes `endpoint.json`. Never fails the app: problems show up in the status `error`.
    pub fn start<Rt: Runtime>(
        app: &AppHandle<Rt>,
        home: PathBuf,
        app_version: String,
        background: bool,
    ) -> Arc<Self> {
        let paths = KimoPaths::new(home);
        let endpoint = paths.endpoint_name();
        let _ = files::ensure_private_dir(&paths.mcp_dir());
        let sink = Arc::new(TauriSink { app: app.clone() });
        let hub = Hub::new(
            HubConfig::new(files::mint_token(), app_version.clone()),
            endpoint.clone(),
            shim_path(),
            sink,
        );
        let settings = files::read_server_settings(&paths);
        let svc = Arc::new(Self {
            hub: hub.clone(),
            http_tokens: Arc::new(RwLock::new(files::read_http_tokens(&paths))),
            paths,
            endpoint,
            owns_endpoint: AtomicBool::new(false),
            socket_stop: std::sync::Mutex::new(None),
            lifecycle: tokio::sync::Mutex::new(()),
            http: tokio::sync::Mutex::new(None),
            last_error: std::sync::Mutex::new(None),
            started_at_iso: crate::util::iso_from_ms(crate::util::now_ms()),
            app_version,
            background,
            quitting: AtomicBool::new(false),
            exiting: AtomicBool::new(false),
        });
        svc.publish_settings();
        let h = hub.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;
                h.tick();
            }
        });
        if settings.start_on_launch || background {
            let s = svc.clone();
            tauri::async_runtime::spawn(async move {
                let _ = s.start_server().await;
            });
        } else {
            svc.log("server not started (start on launch is off)");
        }
        svc
    }

    fn owns(&self) -> bool {
        self.owns_endpoint.load(Ordering::SeqCst)
    }

    /// One line in `~/.kimo/mcp/server.log` (and stderr).
    pub fn log(&self, line: &str) {
        eprintln!("kimo: MCP {line}");
        files::log_append(&self.paths, line);
    }

    /// Records (or clears) the error shown in Settings › Agents and logs it.
    pub fn set_error(&self, error: Option<Value>) {
        if let Some(e) = &error {
            let msg = format!(
                "error {}: {}",
                e["code"].as_str().unwrap_or("ERROR"),
                e["message"].as_str().unwrap_or("")
            );
            self.log(&msg);
            *self.last_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(msg);
        }
        self.hub
            .set_status_field("error", error.unwrap_or(Value::Null));
    }

    /// `{path, lastError?}` for Settings › Agents › Log.
    pub fn log_info(&self) -> Value {
        let mut v = serde_json::json!({
            "path": files::server_log_path(&self.paths).to_string_lossy(),
        });
        if let Some(e) = self
            .last_error
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
        {
            v["lastError"] = e.into();
        }
        v
    }

    /// Mirrors `server.json` / `http.json` into the status (`startOnLaunch`, `httpPort`,
    /// `logPath`).
    fn publish_settings(&self) {
        let s = files::read_server_settings(&self.paths);
        let h = files::read_http_config(&self.paths);
        self.hub
            .set_status_field("startOnLaunch", s.start_on_launch.into());
        self.hub.set_status_field("httpPort", h.port.into());
        if let Some(h) = kimo_mcp::paths::home_dir() {
            self.hub
                .set_status_field("home", h.to_string_lossy().into_owned().into());
        }
        self.hub.set_status_field(
            "backupDir",
            self.paths.backups().to_string_lossy().into_owned().into(),
        );
        self.hub.set_status_field(
            "logPath",
            files::server_log_path(&self.paths)
                .to_string_lossy()
                .into_owned()
                .into(),
        );
    }

    /// `{startOnLaunch, httpPort}`.
    pub fn settings(&self) -> Value {
        let s = files::read_server_settings(&self.paths);
        let h = files::read_http_config(&self.paths);
        serde_json::json!({ "startOnLaunch": s.start_on_launch, "httpPort": h.port })
    }

    /// `kimo_mcp_server_settings_set`: persists, and moves a running HTTP listener to the new
    /// port.
    pub async fn set_settings(
        &self,
        start_on_launch: Option<bool>,
        http_port: Option<u16>,
    ) -> R<Value> {
        if let Some(v) = start_on_launch {
            let mut s = files::read_server_settings(&self.paths);
            s.start_on_launch = v;
            files::write_server_settings(&self.paths, &s)?;
        }
        if let Some(port) = http_port {
            if port < 1024 {
                return Err(crate::error::invalid(format!(
                    "Port {port} is reserved; pick 1024–65535."
                )));
            }
            let mut c = files::read_http_config(&self.paths);
            if c.port != port {
                c.port = port;
                files::write_http_config(&self.paths, &c)?;
                let running = self.http.lock().await.is_some();
                if running {
                    self.set_http_enabled(false).await?;
                    self.set_http_enabled(true).await?;
                }
                self.log(&format!("HTTP port set to {port}"));
            }
        }
        self.publish_settings();
        Ok(self.settings())
    }

    /// True when `port` is free (or is the port our HTTP listener already uses).
    pub async fn port_free(&self, port: u16) -> bool {
        if self.http.lock().await.as_ref().map(|h| h.port) == Some(port) {
            return true;
        }
        files::port_free(port)
    }

    /// Binds the socket/pipe and starts accepting. Writes the token only when this process
    /// owns the endpoint (never breaks another live Kimo).
    fn listen(&self) -> bool {
        match listener::prepare(&self.endpoint) {
            listener::Prepared::Ready(l) => {
                if let Err(e) =
                    files::write_private(&self.paths.token(), self.hub.cfg.token.as_bytes())
                {
                    self.log(&format!("token: {}", e.message));
                }
                self.owns_endpoint.store(true, Ordering::SeqCst);
                let (stop, stop_rx) = tokio::sync::watch::channel(false);
                *self.socket_stop.lock().unwrap_or_else(|p| p.into_inner()) = Some(stop);
                // Report listening right away (the accept loop confirms it).
                self.hub.set_listening(true);
                tauri::async_runtime::spawn(listener::run(self.hub.clone(), l, stop_rx));
                self.log(&format!("listening on {}", self.endpoint));
                true
            }
            listener::Prepared::InUse => {
                self.owns_endpoint.store(false, Ordering::SeqCst);
                self.set_error(Some(server_error(
                    "ENDPOINT_IN_USE",
                    &format!(
                        "Another Kimo is listening on {}. Quit it, then start the server here.",
                        self.endpoint
                    ),
                    None,
                    None,
                )));
                false
            }
            listener::Prepared::Failed(e) => {
                self.owns_endpoint.store(false, Ordering::SeqCst);
                self.set_error(Some(server_error(
                    "SOCKET_FAILED",
                    &format!("Could not listen on {}: {e}", self.endpoint),
                    None,
                    None,
                )));
                false
            }
        }
    }

    /// `kimo_mcp_server_start`: socket/pipe, then HTTP when enabled, then `endpoint.json`.
    pub async fn start_server(&self) -> R<Value> {
        let _g = self.lifecycle.lock().await;
        let running = self
            .socket_stop
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .is_some();
        if !running {
            self.set_error(None);
            if self.listen() && files::read_http_config(&self.paths).enabled {
                if let Err(e) = self.set_http_enabled(true).await {
                    self.log(&format!("HTTP: {}", e.message));
                }
            }
            self.write_endpoint();
        }
        Ok(self.hub.status())
    }

    /// `kimo_mcp_server_stop`: `kimo/bye` to every agent, stop both listeners, remove
    /// `endpoint.json` and the socket file. The HTTP preference is kept.
    pub async fn stop_server(&self) -> R<Value> {
        let _g = self.lifecycle.lock().await;
        self.stop_listeners().await;
        self.log("server stopped");
        Ok(self.hub.status())
    }

    async fn stop_listeners(&self) {
        let stop = self
            .socket_stop
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take();
        if let Some(stop) = stop {
            let _ = stop.send(true);
        }
        let _ = tokio::time::timeout(Duration::from_millis(500), self.hub.shutdown()).await;
        if let Some(h) = self.http.lock().await.take() {
            h.stop();
        }
        self.hub.set_http(HttpStatus::default());
        self.hub.set_listening(false);
        if self.owns() {
            let _ = std::fs::remove_file(self.paths.endpoint());
            listener::cleanup(&self.endpoint);
        }
        self.owns_endpoint.store(false, Ordering::SeqCst);
    }

    /// `kimo_mcp_server_restart`.
    pub async fn restart_server(&self) -> R<Value> {
        {
            let _g = self.lifecycle.lock().await;
            self.stop_listeners().await;
            self.log("server restarting");
        }
        self.start_server().await
    }

    /// `~/.kimo/mcp/endpoint.json` (0600), rewritten when HTTP changes.
    pub fn write_endpoint(&self) {
        if !self.owns() {
            return;
        }
        let status = self.hub.status();
        let http = status["http"]["port"].as_u64().map(|port| HttpEndpoint {
            url: format!("http://127.0.0.1:{port}{}", http::HTTP_PATH),
            port: port as u16,
        });
        let e = EndpointFile {
            version: 1,
            pid: std::process::id(),
            app_version: self.app_version.clone(),
            socket: self.endpoint.clone(),
            socket_protocol: SOCKET_PROTOCOL.into(),
            http,
            started_at_iso: self.started_at_iso.clone(),
        };
        match serde_json::to_vec_pretty(&e) {
            Ok(mut b) => {
                b.push(b'\n');
                if let Err(e) = files::write_private(&self.paths.endpoint(), &b) {
                    self.log(&format!("endpoint.json: {}", e.message));
                }
            }
            Err(e) => self.log(&format!("endpoint.json: {e}")),
        }
    }

    /// `kimo_mcp_http_set_enabled`: persists the choice, (re)starts or stops the listener.
    /// When the configured port is taken the listener falls back to an ephemeral port and the
    /// status carries an `EADDRINUSE` error with that port as the suggestion.
    pub async fn set_http_enabled(&self, enabled: bool) -> R<Value> {
        let mut cfg = files::read_http_config(&self.paths);
        {
            let mut guard = self.http.lock().await;
            if enabled && guard.is_none() {
                if !self.owns() {
                    return Err(crate::error::blocked(
                        "The MCP server is stopped, or another Kimo instance owns its endpoints",
                    ));
                }
                let h =
                    match http::start(self.hub.clone(), self.http_tokens.clone(), cfg.port).await {
                        Ok(h) => h,
                        Err(e) => {
                            let msg = format!("Could not start the MCP HTTP listener: {e}");
                            self.set_error(Some(server_error(
                                &format!("HTTP_FAILED 127.0.0.1:{}", cfg.port),
                                &msg,
                                Some(cfg.port),
                                None,
                            )));
                            return Err(io_msg(msg));
                        }
                    };
                if cfg.port != 0 && h.port != cfg.port {
                    self.set_error(Some(server_error(
                        &format!("EADDRINUSE 127.0.0.1:{}", cfg.port),
                        &format!(
                            "Port {} is in use; HTTP is on port {} for now. Stdio agents still work over the local socket.",
                            cfg.port, h.port
                        ),
                        Some(cfg.port),
                        Some(h.port),
                    )));
                } else {
                    self.log(&format!("HTTP listening on 127.0.0.1:{}", h.port));
                }
                self.hub.set_http(HttpStatus {
                    enabled: true,
                    port: Some(h.port),
                });
                *guard = Some(h);
            } else if !enabled {
                if let Some(h) = guard.take() {
                    h.stop();
                    self.log("HTTP stopped");
                }
                self.hub.set_http(HttpStatus::default());
            }
        }
        if cfg.enabled != enabled {
            cfg.enabled = enabled;
            files::write_http_config(&self.paths, &cfg)?;
        }
        self.write_endpoint();
        Ok(self.hub.status())
    }

    /// `kimo_mcp_http_token_rotate`.
    pub fn rotate_token(&self, client: &str) -> R<String> {
        let (token, all) = files::rotate_http_token(&self.paths, client)?;
        *self.http_tokens.write().unwrap_or_else(|p| p.into_inner()) = all;
        Ok(token)
    }

    /// `kimo_mcp_http_token_get`: the current bearer of one host (None when it has none).
    pub fn token_of(&self, client: &str) -> R<Option<String>> {
        files::check_client(client)?;
        Ok(self
            .http_tokens
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .get(client)
            .cloned())
    }

    /// Quit: `kimo/bye` to relays, stop HTTP, remove `endpoint.json` and the socket file.
    pub fn shutdown_blocking(&self) {
        self.exiting.store(true, Ordering::SeqCst);
        if let Some(stop) = self
            .socket_stop
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            let _ = stop.send(true);
        }
        let hub = self.hub.clone();
        tauri::async_runtime::block_on(async move {
            let _ = tokio::time::timeout(Duration::from_millis(500), hub.shutdown()).await;
        });
        if let Ok(mut g) = self.http.try_lock() {
            if let Some(h) = g.take() {
                h.stop();
            }
        }
        if self.owns() {
            let _ = std::fs::remove_file(self.paths.endpoint());
            listener::cleanup(&self.endpoint);
        }
    }
}

pub fn service<Rt: Runtime>(app: &AppHandle<Rt>) -> Option<Arc<McpService>> {
    app.try_state::<Arc<McpService>>()
        .map(|s| s.inner().clone())
}

/// Creates the hidden document host window (once). Every page load start marks the host as
/// (re)starting; the page calls `kimo_mcp_host_ready` when its listeners are installed.
pub fn create_host_window<Rt: Runtime>(app: &AppHandle<Rt>) -> R<()> {
    if app.get_webview_window(HOST_LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, HOST_LABEL, WebviewUrl::App(HOST_ROUTE.into()))
        .title("Kimo Document Host")
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .inner_size(800.0, 600.0)
        .disable_drag_drop_handler()
        // A hidden WKWebView would otherwise suspend timers (macOS 14+).
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .on_page_load(|w, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                if let Some(s) = service(w.app_handle()) {
                    s.hub.host_loading();
                }
            }
        })
        .build()
        .map_err(|e| io_msg(format!("Could not start the document host: {e}")))?;
    Ok(())
}

/// The host window was destroyed while the app keeps running: mark it restarting and bring it
/// back.
pub fn on_host_destroyed<Rt: Runtime>(app: &AppHandle<Rt>) {
    let Some(s) = service(app) else { return };
    if s.exiting.load(Ordering::SeqCst) {
        return;
    }
    s.hub.host_loading();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if let Err(e) = create_host_window(&app) {
            eprintln!("kimo: {}", e.message);
        }
    });
}
