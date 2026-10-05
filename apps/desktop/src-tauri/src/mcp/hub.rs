//! The relay core (socket.md §3–§7): authenticates socket connections, heartbeats them, and
//! moves MCP lines between each connection and the document host. Independent of Tauri: the
//! host side is a [`HostSink`] (Tauri events in the app, a channel in tests) plus calls to
//! [`Hub::send`] / [`Hub::host_ready`] (the `kimo_mcp_send` / `kimo_mcp_host_ready` commands).
//!
//! Rust never reads or changes document content: it only peeks at `method` / `id` to route
//! control messages, track in-flight requests and fail them when the host restarts.

use super::files::base36;
use bytes::Bytes;
use kimo_mcp::protocol::{
    check_hello, codes, error_response, id_key, notification, relay_error, request,
    result_response, AppInfo, HelloParams, HelloResult, Peek, RpcError, BYE_METHOD, HELLO_METHOD,
    HOST_RESTARTING_METHOD, MAX_FRAME_BYTES, PING_METHOD, SOCKET_PROTOCOL,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, watch};

pub const EV_IN: &str = "kimo://mcp-in";
pub const EV_CONNECTION: &str = "kimo://mcp-connection";
pub const EV_HTTP_REQUEST: &str = "kimo://mcp-http-request";
pub const EV_STATUS: &str = "kimo://mcp-status";

/// Where the hub's events go.
pub trait HostSink: Send + Sync + 'static {
    /// To the document host only (`kimo://mcp-in`, `kimo://mcp-connection`,
    /// `kimo://mcp-http-request`).
    fn to_host(&self, event: &'static str, payload: Value);
    /// To every window (`kimo://mcp-status`).
    fn broadcast(&self, event: &'static str, payload: Value);
}

#[derive(Debug, Clone)]
pub struct HubConfig {
    pub token: String,
    pub app_version: String,
    pub heartbeat: Duration,
    pub misses: u64,
    pub hello_timeout: Duration,
    /// Messages wait this long for a starting host.
    pub queue_window: Duration,
    /// A host that has not called `kimo_mcp_host_ready` after this long is `failed`.
    pub host_fail_after: Duration,
    /// An HTTP request waits this long for the host's first chunk.
    pub http_head_timeout: Duration,
    /// Lines buffered per connection towards the socket (backpressure on `kimo_mcp_send`).
    pub outbound_capacity: usize,
    pub max_queue: usize,
}

impl HubConfig {
    pub fn new(token: String, app_version: String) -> Self {
        Self {
            token,
            app_version,
            heartbeat: Duration::from_millis(kimo_mcp::protocol::HEARTBEAT_MS),
            misses: kimo_mcp::protocol::HEARTBEAT_MISSES as u64,
            hello_timeout: Duration::from_millis(kimo_mcp::protocol::HELLO_TIMEOUT_MS),
            queue_window: Duration::from_millis(kimo_mcp::protocol::HOST_QUEUE_MS),
            host_fail_after: Duration::from_secs(60),
            http_head_timeout: Duration::from_secs(300),
            outbound_capacity: 256,
            max_queue: 2_000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostState {
    Starting,
    Ready,
    Restarting,
    Failed,
}

impl HostState {
    pub fn as_str(self) -> &'static str {
        match self {
            HostState::Starting => "starting",
            HostState::Ready => "ready",
            HostState::Restarting => "restarting",
            HostState::Failed => "failed",
        }
    }
}

/// What kind of MCP line a connection sent (decides caching and in-flight tracking).
#[derive(Debug, Clone, PartialEq)]
enum Kind {
    Initialize(Value),
    Initialized,
    Request(Value),
    Other,
}

struct Queued {
    conn: String,
    line: String,
    kind: Kind,
    at: Instant,
}

struct Conn {
    out: mpsc::Sender<String>,
    kill: watch::Sender<bool>,
    hello: HelloParams,
    connected_at: u64,
    last_activity: u64,
    /// Requests the host has and has not answered (id key → id).
    inflight: HashMap<String, Value>,
    init_line: Option<String>,
    initialized_line: Option<String>,
    /// The cached initialize reached the current host (replay after a restart).
    init_delivered: bool,
    needs_replay: bool,
}

struct HttpPending {
    head: Option<oneshot::Sender<HttpHead>>,
    body: mpsc::Sender<Bytes>,
}

#[derive(Debug, Clone)]
pub struct HttpHead {
    pub status: u16,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, Default)]
pub struct HttpStatus {
    pub enabled: bool,
    pub port: Option<u16>,
}

struct Inner {
    conns: HashMap<String, Conn>,
    host: HostState,
    host_since: Instant,
    queue: VecDeque<Queued>,
    /// (connection, id key) of replayed initialize requests whose responses are swallowed.
    replay: HashSet<(String, String)>,
    replay_seq: u64,
    listening: bool,
    http: HttpStatus,
    http_pending: HashMap<String, HttpPending>,
    /// Extra `McpServerStatus` fields owned by the service (`running`, `error`, `logPath`,
    /// `version`, `startOnLaunch`, `httpPort`), merged into every status.
    extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HubError {
    NotFound(String),
    Invalid(String),
    Unavailable(String),
}

impl From<HubError> for crate::error::PlatformErrorPayload {
    fn from(e: HubError) -> Self {
        match e {
            HubError::NotFound(m) => crate::error::PlatformErrorPayload::new("NOT_FOUND", m),
            HubError::Invalid(m) => crate::error::invalid(m),
            HubError::Unavailable(m) => crate::error::blocked(m),
        }
    }
}

pub struct Hub {
    pub cfg: HubConfig,
    pub socket_path: String,
    pub shim_path: String,
    sink: Arc<dyn HostSink>,
    inner: Mutex<Inner>,
}

fn now_ms() -> u64 {
    crate::util::now_ms()
}

/// Display labels for the installer's client slugs (generic otherwise).
pub fn client_label(client: &str) -> String {
    match client {
        "claude-code" => "Claude Code".into(),
        "codex" => "Codex".into(),
        "gemini-cli" => "Gemini CLI".into(),
        "cursor" => "Cursor".into(),
        "vscode" => "VS Code".into(),
        other => other.to_string(),
    }
}

fn timeout_error(why: &str) -> RpcError {
    relay_error("TIMEOUT", why, "Retry the call.")
}

impl Hub {
    pub fn new(
        cfg: HubConfig,
        socket_path: String,
        shim_path: String,
        sink: Arc<dyn HostSink>,
    ) -> Arc<Self> {
        Arc::new(Self {
            cfg,
            socket_path,
            shim_path,
            sink,
            inner: Mutex::new(Inner {
                conns: HashMap::new(),
                host: HostState::Starting,
                host_since: Instant::now(),
                queue: VecDeque::new(),
                replay: HashSet::new(),
                replay_seq: 0,
                listening: false,
                http: HttpStatus::default(),
                http_pending: HashMap::new(),
                extra: serde_json::Map::new(),
            }),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn set_listening(&self, listening: bool) {
        self.lock().listening = listening;
        self.emit_status();
    }

    pub fn set_http(&self, http: HttpStatus) {
        self.lock().http = http;
        self.emit_status();
    }

    /// Sets (or with `Value::Null`, removes) one extra status field and broadcasts the status.
    pub fn set_status_field(&self, key: &str, value: Value) {
        {
            let mut g = self.lock();
            if value.is_null() {
                g.extra.remove(key);
            } else {
                g.extra.insert(key.to_string(), value);
            }
        }
        self.emit_status();
    }

    pub fn host_state(&self) -> HostState {
        self.lock().host
    }

    // --- Status ---------------------------------------------------------------------------------

    /// `McpServerStatus`.
    pub fn status(&self) -> Value {
        let g = self.lock();
        let mut http = json!({ "enabled": g.http.enabled });
        if let (true, Some(port)) = (g.http.enabled, g.http.port) {
            http["url"] = json!(format!("http://127.0.0.1:{port}/mcp"));
            http["port"] = json!(port);
        }
        let mut v = json!({
            "socket": { "path": self.socket_path, "listening": g.listening },
            "http": http,
            "documentHost": g.host.as_str(),
            "shimPath": self.shim_path,
            "protocol": SOCKET_PROTOCOL,
            "connections": g.conns.len(),
            "running": g.listening,
            "version": self.cfg.app_version,
        });
        if let Some(o) = v.as_object_mut() {
            for (k, x) in &g.extra {
                o.insert(k.clone(), x.clone());
            }
        }
        v
    }

    fn emit_status(&self) {
        self.sink.broadcast(EV_STATUS, self.status());
    }

    /// `McpConnectionInfo[]` as Rust knows them (the document host emits richer ones on
    /// `kimo://mcp-connections`): identity from the hello, state `idle`, no docs.
    pub fn connections(&self) -> Vec<Value> {
        let g = self.lock();
        let mut v: Vec<_> = g
            .conns
            .iter()
            .map(|(id, c)| connection_info(id, c))
            .collect();
        v.sort_by_key(|c| c["connectedAt"].as_u64().unwrap_or(0));
        v
    }

    fn connection_event(id: &str, c: Option<&Conn>, state: &str) -> Value {
        let mut ev = json!({ "connectionId": id, "state": state, "transport": "socket" });
        if let Some(c) = c {
            let mut hello = json!({
                "pid": c.hello.pid,
                "ppid": c.hello.ppid,
                "relay": { "name": c.hello.relay.name, "version": c.hello.relay.version },
            });
            if let Some(client) = &c.hello.client {
                hello["client"] = json!(client);
            }
            if let Some(cwd) = &c.hello.cwd {
                hello["cwd"] = json!(cwd);
            }
            ev["hello"] = hello;
            // M6 (ADR 0014 §11): a CLI the app spawned → its agent session (policy, presence).
            if let Some(s) = crate::ai::cli::agent_session_for(c.hello.cwd.as_deref(), c.hello.ppid)
            {
                ev["agentSession"] = json!(s);
            }
        }
        ev
    }

    // --- Host lifecycle -------------------------------------------------------------------------

    /// The document host called `kimo_mcp_host_ready`: announce every open connection, replay
    /// cached `initialize`s after a restart, then flush the queue in arrival order.
    pub fn host_ready(&self) {
        {
            let mut g = self.lock();
            g.host = HostState::Ready;
            g.host_since = Instant::now();
            let ids: Vec<String> = g.conns.keys().cloned().collect();
            for id in &ids {
                self.sink.to_host(
                    EV_CONNECTION,
                    Self::connection_event(id, g.conns.get(id), "open"),
                );
            }
            for id in &ids {
                let Some(c) = g.conns.get_mut(id) else {
                    continue;
                };
                if !std::mem::take(&mut c.needs_replay) {
                    continue;
                }
                let (Some(init), initialized) = (c.init_line.clone(), c.initialized_line.clone())
                else {
                    continue;
                };
                c.init_delivered = true;
                g.replay_seq += 1;
                let rid = json!(format!("kimo-replay-init-{}", g.replay_seq));
                let mut v: Value = serde_json::from_str(&init).unwrap_or(Value::Null);
                v["id"] = rid.clone();
                g.replay.insert((id.clone(), id_key(&rid)));
                self.deliver(id, v.to_string());
                if let Some(n) = initialized {
                    self.deliver(id, n);
                }
            }
            while let Some(q) = g.queue.pop_front() {
                self.deliver_tracked(&mut g, q.conn, q.line, q.kind);
            }
        }
        self.emit_status();
    }

    /// The document host page started (re)loading or its window went away. A host that was
    /// ready is now restarting: connections hear `kimo/hostRestarting`, in-flight calls fail
    /// TIMEOUT (retryable) and each session's `initialize` is replayed once it is ready again.
    pub fn host_loading(&self) {
        {
            let mut g = self.lock();
            g.host_since = Instant::now();
            match g.host {
                HostState::Ready => {
                    g.host = HostState::Restarting;
                    let err = timeout_error("The Kimo document host restarted during the call.");
                    for c in g.conns.values_mut() {
                        let _ = c.out.try_send(notification(HOST_RESTARTING_METHOD));
                        for (_, id) in c.inflight.drain() {
                            let _ = c.out.try_send(error_response(&id, &err));
                        }
                        c.needs_replay = c.init_delivered;
                        c.init_delivered = false;
                    }
                    g.replay.clear();
                    // HTTP requests in flight die with the host.
                    g.http_pending.clear();
                }
                HostState::Failed => g.host = HostState::Starting,
                HostState::Starting | HostState::Restarting => {}
            }
        }
        self.emit_status();
    }

    /// Periodic housekeeping: expire queued messages, mark a host that never became ready as
    /// failed.
    pub fn tick(&self) {
        let mut changed = false;
        {
            let mut g = self.lock();
            let window = self.cfg.queue_window;
            while g.queue.front().is_some_and(|q| q.at.elapsed() >= window) {
                let Some(q) = g.queue.pop_front() else { break };
                if let Kind::Request(id) | Kind::Initialize(id) = &q.kind {
                    if let Some(c) = g.conns.get(&q.conn) {
                        let _ = c.out.try_send(error_response(
                            id,
                            &timeout_error("The Kimo document host is still starting."),
                        ));
                    }
                }
            }
            if matches!(g.host, HostState::Starting | HostState::Restarting)
                && g.host_since.elapsed() >= self.cfg.host_fail_after
            {
                g.host = HostState::Failed;
                changed = true;
            }
        }
        if changed {
            self.emit_status();
        }
    }

    fn deliver(&self, conn: &str, line: String) {
        self.sink
            .to_host(EV_IN, json!({ "connectionId": conn, "message": line }));
    }

    fn deliver_tracked(&self, g: &mut Inner, conn: String, line: String, kind: Kind) {
        let Some(c) = g.conns.get_mut(&conn) else {
            return; // closed while queued
        };
        match &kind {
            Kind::Initialize(id) => {
                c.init_delivered = true;
                c.inflight.insert(id_key(id), id.clone());
            }
            Kind::Request(id) => {
                c.inflight.insert(id_key(id), id.clone());
            }
            Kind::Initialized | Kind::Other => {}
        }
        self.deliver(&conn, line);
    }

    /// One inbound MCP line: to the host now, or queued while it starts.
    fn route_in(&self, conn: &str, line: String, kind: Kind) {
        let mut g = self.lock();
        if let Some(c) = g.conns.get_mut(conn) {
            c.last_activity = now_ms();
            match &kind {
                Kind::Initialize(_) => c.init_line = Some(line.clone()),
                Kind::Initialized => c.initialized_line = Some(line.clone()),
                _ => {}
            }
        }
        if g.host == HostState::Ready {
            self.deliver_tracked(&mut g, conn.to_string(), line, kind);
            return;
        }
        if g.host == HostState::Failed || g.queue.len() >= self.cfg.max_queue {
            if let Kind::Request(id) | Kind::Initialize(id) = &kind {
                if let Some(c) = g.conns.get(conn) {
                    let err = RpcError::new(
                        codes::HOST_UNAVAILABLE,
                        "The Kimo document host is unavailable.",
                    )
                    .with_data(json!({ "message": "document host failed to start" }));
                    let _ = c.out.try_send(error_response(id, &err));
                }
            }
            return;
        }
        g.queue.push_back(Queued {
            conn: conn.to_string(),
            line,
            kind,
            at: Instant::now(),
        });
    }

    // --- Host → socket ---------------------------------------------------------------------------

    /// `kimo_mcp_send`: one outbound line for a connection. Awaits room in the connection's
    /// buffer (backpressure on the host).
    pub async fn send(&self, conn: &str, message: String) -> Result<(), HubError> {
        if !kimo_mcp::protocol::is_single_frame(&message) {
            return Err(HubError::Invalid(
                "message must be one JSON line under 32 MiB".into(),
            ));
        }
        let peek = Peek::parse(&message)
            .map_err(|e| HubError::Invalid(format!("message is not JSON: {e}")))?;
        if peek.is_control() {
            return Err(HubError::Invalid(
                "kimo/* control methods are reserved for the relay".into(),
            ));
        }
        let tx = {
            let mut g = self.lock();
            let key = peek.id_key();
            if peek.is_response() {
                if let Some(k) = &key {
                    if g.replay.remove(&(conn.to_string(), k.clone())) {
                        return Ok(()); // response to a replayed initialize
                    }
                }
            }
            let c = g
                .conns
                .get_mut(conn)
                .ok_or_else(|| HubError::NotFound(format!("No MCP connection {conn}")))?;
            if peek.is_response() {
                if let Some(k) = &key {
                    c.inflight.remove(k);
                    crate::dock_activity::mcp_call_finished(conn, k);
                }
            }
            c.last_activity = now_ms();
            c.out.clone()
        };
        tx.send(message)
            .await
            .map_err(|_| HubError::NotFound(format!("MCP connection {conn} closed")))
    }

    /// `kimo_mcp_disconnect`: `kimo/bye`, then close.
    pub fn disconnect(&self, conn: &str) -> bool {
        let g = self.lock();
        match g.conns.get(conn) {
            Some(c) => {
                let _ = c.out.try_send(notification(BYE_METHOD));
                let _ = c.kill.send(true);
                true
            }
            None => false,
        }
    }

    /// App quit: `kimo/bye` to every relay, then close (give writers a moment to flush).
    pub async fn shutdown(&self) {
        let ids: Vec<String> = self.lock().conns.keys().cloned().collect();
        for id in &ids {
            self.disconnect(id);
        }
        let deadline = Instant::now() + Duration::from_millis(300);
        while !self.lock().conns.is_empty() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    // --- Socket connections ----------------------------------------------------------------------

    /// Serves one accepted socket/pipe connection until it closes.
    pub async fn serve<S>(self: Arc<Self>, stream: S)
    where
        S: AsyncRead + AsyncWrite + Send + 'static,
    {
        let (r, mut w) = tokio::io::split(stream);
        let mut r = BufReader::new(r);

        // 1. Hello within 5 s, first line only.
        let first = tokio::time::timeout(self.cfg.hello_timeout, read_frame(&mut r)).await;
        let line = match first {
            Ok(Ok(Some(l))) => l,
            Ok(Err(FrameErr::TooLarge)) => {
                let err = RpcError::new(codes::FRAME_TOO_LARGE, "frame too large");
                let _ = write_line(&mut w, &error_response(&Value::Null, &err)).await;
                return;
            }
            Err(_) => {
                let err = RpcError::new(codes::HANDSHAKE_REQUIRED, "no kimo/hello within 5 s");
                let _ = write_line(&mut w, &error_response(&Value::Null, &err)).await;
                return;
            }
            _ => return,
        };
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            return; // not JSON: close
        };
        let id = v.get("id").cloned().unwrap_or(Value::Null);
        if v.get("method").and_then(Value::as_str) != Some(HELLO_METHOD) {
            let err = RpcError::new(
                codes::HANDSHAKE_REQUIRED,
                "the first message must be kimo/hello",
            );
            let _ = write_line(&mut w, &error_response(&id, &err)).await;
            return;
        }
        let hello = match check_hello(v.get("params"), &self.cfg.token) {
            Ok(h) => h,
            Err(err) => {
                let _ = write_line(&mut w, &error_response(&id, &err)).await;
                return;
            }
        };
        let host = self.host_state();
        if host == HostState::Failed {
            let err = RpcError::new(
                codes::HOST_UNAVAILABLE,
                "The Kimo document host failed to start.",
            )
            .with_data(json!({ "message": "document host failed to start" }));
            let _ = write_line(&mut w, &error_response(&id, &err)).await;
            return;
        }
        let conn_id = format!("c_{}", base36(6));
        let result = HelloResult {
            protocol: SOCKET_PROTOCOL.into(),
            app: AppInfo {
                name: "kimo-desktop".into(),
                version: self.cfg.app_version.clone(),
                pid: std::process::id(),
            },
            connection_id: conn_id.clone(),
            heartbeat_ms: self.cfg.heartbeat.as_millis() as u64,
            document_host: if host == HostState::Ready {
                "ready"
            } else {
                "starting"
            }
            .into(),
        };
        let reply = result_response(&id, serde_json::to_value(&result).unwrap_or(Value::Null));
        if write_line(&mut w, &reply).await.is_err() {
            return;
        }

        // 2. Register; writer task owns the write half.
        let (out_tx, mut out_rx) = mpsc::channel::<String>(self.cfg.outbound_capacity);
        let (kill_tx, mut kill_rx) = watch::channel(false);
        {
            let mut g = self.lock();
            let now = now_ms();
            g.conns.insert(
                conn_id.clone(),
                Conn {
                    out: out_tx.clone(),
                    kill: kill_tx.clone(),
                    hello,
                    connected_at: now,
                    last_activity: now,
                    inflight: HashMap::new(),
                    init_line: None,
                    initialized_line: None,
                    init_delivered: false,
                    needs_replay: false,
                },
            );
            if g.host == HostState::Ready {
                self.sink.to_host(
                    EV_CONNECTION,
                    Self::connection_event(&conn_id, g.conns.get(&conn_id), "open"),
                );
            }
        }
        self.emit_status();

        let mut writer_kill = kill_tx.subscribe();
        let writer = tokio::spawn(async move {
            loop {
                tokio::select! {
                    biased;
                    m = out_rx.recv() => match m {
                        Some(line) => if write_line(&mut w, &line).await.is_err() { break },
                        None => break,
                    },
                    _ = writer_kill.changed() => {
                        // Flush what is already queued (e.g. kimo/bye), then close.
                        while let Ok(line) = out_rx.try_recv() {
                            if write_line(&mut w, &line).await.is_err() { break }
                        }
                        break;
                    }
                }
            }
            let _ = w.shutdown().await;
        });

        // 3. Heartbeat: ping every heartbeatMs; `misses` unanswered pings close the connection.
        let sent = Arc::new(AtomicU64::new(0));
        let acked = Arc::new(AtomicU64::new(0));
        let hb = {
            let (sent, acked) = (sent.clone(), acked.clone());
            let out = out_tx.clone();
            let kill = kill_tx.clone();
            let mut hb_kill = kill_tx.subscribe();
            let every = self.cfg.heartbeat;
            let misses = self.cfg.misses;
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = tokio::time::sleep(every) => {}
                        _ = hb_kill.changed() => return,
                    }
                    let s = sent.load(Ordering::SeqCst);
                    if s.saturating_sub(acked.load(Ordering::SeqCst)) >= misses {
                        let _ = kill.send(true);
                        return;
                    }
                    let n = sent.fetch_add(1, Ordering::SeqCst) + 1;
                    let _ = out.try_send(request(
                        &json!(format!("kimo-ping-{n}")),
                        PING_METHOD,
                        json!({}),
                    ));
                }
            })
        };

        // 4. Reader loop.
        loop {
            let next = tokio::select! {
                l = read_frame(&mut r) => l,
                _ = kill_rx.changed() => break,
            };
            let line = match next {
                Ok(Some(l)) => l,
                Ok(None) => break,
                Err(FrameErr::TooLarge) => {
                    let err = RpcError::new(codes::FRAME_TOO_LARGE, "frame too large");
                    let _ = out_tx.try_send(error_response(&Value::Null, &err));
                    break;
                }
                Err(_) => break,
            };
            let Ok(peek) = Peek::parse(&line) else {
                break; // not JSON: close
            };
            if peek.is_control() {
                let id = peek.id.clone().unwrap_or(Value::Null);
                match peek.method.as_deref() {
                    Some(PING_METHOD) if peek.is_request() => {
                        let _ = out_tx.send(result_response(&id, json!({}))).await;
                    }
                    Some(BYE_METHOD) => break,
                    Some(HELLO_METHOD) if peek.is_request() => {
                        let err = RpcError::new(codes::HANDSHAKE_REQUIRED, "duplicate kimo/hello");
                        let _ = out_tx.send(error_response(&id, &err)).await;
                    }
                    _ if peek.is_request() => {
                        let err = RpcError::new(codes::METHOD_NOT_FOUND, "unknown control method");
                        let _ = out_tx.send(error_response(&id, &err)).await;
                    }
                    _ => {}
                }
                continue;
            }
            if peek.is_response() {
                if let Some(Value::String(s)) = &peek.id {
                    if let Some(n) = s.strip_prefix("kimo-ping-") {
                        if let Ok(n) = n.parse::<u64>() {
                            acked.fetch_max(n, Ordering::SeqCst);
                        }
                        continue;
                    }
                }
            }
            let kind = match (peek.method.as_deref(), peek.is_request()) {
                (Some("initialize"), true) => Kind::Initialize(peek.id.clone().unwrap_or_default()),
                (Some("notifications/initialized"), false) => Kind::Initialized,
                (Some(_), true) => Kind::Request(peek.id.clone().unwrap_or_default()),
                _ => Kind::Other,
            };
            // Any traffic counts as liveness for the heartbeat too.
            acked.store(sent.load(Ordering::SeqCst), Ordering::SeqCst);
            // Board 32: a tools/call in flight animates the macOS Dock tile.
            if peek.method.as_deref() == Some("tools/call") && peek.is_request() {
                if let Some(k) = peek.id_key() {
                    crate::dock_activity::mcp_call_started(&conn_id, &k);
                }
            }
            self.route_in(&conn_id, line, kind);
        }

        // 5. Cleanup.
        let _ = kill_tx.send(true);
        hb.abort();
        drop(out_tx);
        let _ = writer.await;
        self.unregister(&conn_id);
    }

    fn unregister(&self, conn: &str) {
        {
            let mut g = self.lock();
            if g.conns.remove(conn).is_none() {
                return;
            }
            g.queue.retain(|q| q.conn != conn);
            g.replay.retain(|(c, _)| c != conn);
            crate::dock_activity::mcp_connection_closed(conn);
            self.sink
                .to_host(EV_CONNECTION, Self::connection_event(conn, None, "closed"));
        }
        self.emit_status();
    }

    // --- HTTP (socket.md §8) ---------------------------------------------------------------------

    /// Forwards one HTTP request to the host and waits for the head of its response. The body
    /// streams through the returned receiver until the host sends `end`.
    pub async fn http_forward(
        &self,
        mut request: Value,
    ) -> Result<(HttpHead, mpsc::Receiver<Bytes>), HubError> {
        let deadline = Instant::now() + self.cfg.queue_window;
        while self.host_state() != HostState::Ready {
            if Instant::now() >= deadline || self.host_state() == HostState::Failed {
                return Err(HubError::Unavailable(
                    "The Kimo document host is not ready.".into(),
                ));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let request_id = format!("h_{}", base36(10));
        request["requestId"] = json!(request_id);
        let (head_tx, head_rx) = oneshot::channel();
        let (body_tx, body_rx) = mpsc::channel(64);
        self.lock().http_pending.insert(
            request_id.clone(),
            HttpPending {
                head: Some(head_tx),
                body: body_tx,
            },
        );
        self.sink.to_host(EV_HTTP_REQUEST, request);
        match tokio::time::timeout(self.cfg.http_head_timeout, head_rx).await {
            Ok(Ok(head)) => Ok((head, body_rx)),
            Ok(Err(_)) => {
                self.lock().http_pending.remove(&request_id);
                Err(HubError::Unavailable(
                    "The Kimo document host dropped the request.".into(),
                ))
            }
            Err(_) => {
                self.lock().http_pending.remove(&request_id);
                Err(HubError::Unavailable(
                    "The Kimo document host did not answer in time.".into(),
                ))
            }
        }
    }

    /// `kimo_mcp_http_respond`: the first call carries status + headers; chunks stream; `end`
    /// closes the response.
    pub async fn http_respond(
        &self,
        request_id: &str,
        status: Option<u16>,
        headers: Vec<(String, String)>,
        chunk: Option<Bytes>,
        end: bool,
    ) -> Result<(), HubError> {
        let body = {
            let mut g = self.lock();
            let p = g.http_pending.get_mut(request_id).ok_or_else(|| {
                HubError::NotFound(format!("No pending HTTP request {request_id}"))
            })?;
            if let Some(head) = p.head.take() {
                let _ = head.send(HttpHead {
                    status: status.unwrap_or(200),
                    headers,
                });
            }
            p.body.clone()
        };
        if let Some(c) = chunk.filter(|c| !c.is_empty()) {
            if body.send(c).await.is_err() {
                self.lock().http_pending.remove(request_id);
                return Err(HubError::NotFound(format!(
                    "HTTP client for {request_id} went away"
                )));
            }
        }
        if end {
            self.lock().http_pending.remove(request_id);
        }
        Ok(())
    }
}

fn connection_info(id: &str, c: &Conn) -> Value {
    let client = c.hello.client.clone().unwrap_or_else(|| "unknown".into());
    let session = id.strip_prefix("c_").unwrap_or(id).to_string();
    let mut identity = json!({
        "client": client,
        "label": client_label(&client),
        "session": session,
        "transport": "socket",
        "pid": c.hello.ppid,
    });
    if identity["pid"] == 0 {
        identity.as_object_mut().map(|o| o.remove("pid"));
    }
    let mut info = json!({
        "connectionId": id,
        "identity": identity,
        "origin": format!("mcp:{client}.{session}"),
        "connectedAt": c.connected_at,
        "lastActivityAt": c.last_activity,
        "state": "idle",
        "docs": [],
    });
    if let Some(cwd) = &c.hello.cwd {
        info["cwd"] = json!(cwd);
    }
    if let Some(s) = crate::ai::cli::agent_session_for(c.hello.cwd.as_deref(), c.hello.ppid) {
        info["agentSession"] = json!(s);
    }
    info
}

// --- Async framing -------------------------------------------------------------------------------

#[derive(Debug)]
pub enum FrameErr {
    TooLarge,
    Bad,
}

/// One newline-delimited frame (≤ 32 MiB), blank lines skipped, `\r\n` tolerated.
pub async fn read_frame<R: AsyncBufRead + Unpin>(r: &mut R) -> Result<Option<String>, FrameErr> {
    read_frame_max(r, MAX_FRAME_BYTES).await
}

pub async fn read_frame_max<R: AsyncBufRead + Unpin>(
    r: &mut R,
    max: usize,
) -> Result<Option<String>, FrameErr> {
    let mut buf: Vec<u8> = Vec::new();
    loop {
        let chunk = r.fill_buf().await.map_err(|_| FrameErr::Bad)?;
        if chunk.is_empty() {
            return Ok(None);
        }
        let (done, used) = match chunk.iter().position(|b| *b == b'\n') {
            Some(i) => {
                buf.extend_from_slice(&chunk[..i]);
                (true, i + 1)
            }
            None => {
                buf.extend_from_slice(chunk);
                (false, chunk.len())
            }
        };
        r.consume(used);
        if buf.len() > max {
            return Err(FrameErr::TooLarge);
        }
        if done {
            if buf.last() == Some(&b'\r') {
                buf.pop();
            }
            if buf.iter().all(|b| b.is_ascii_whitespace()) {
                buf.clear();
                continue;
            }
            return String::from_utf8(buf).map(Some).map_err(|_| FrameErr::Bad);
        }
    }
}

async fn write_line<W: AsyncWrite + Unpin>(w: &mut W, line: &str) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(line.len() + 1);
    buf.extend_from_slice(line.as_bytes());
    buf.push(b'\n');
    w.write_all(&buf).await?;
    w.flush().await
}
