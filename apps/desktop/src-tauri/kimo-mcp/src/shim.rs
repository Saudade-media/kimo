//! The stdio ↔ socket relay (socket.md §4–§6). One event loop owns stdout and the socket writer;
//! threads feed it stdin lines, socket lines and ticks.
//!
//! - Connected: agent-host lines go to the app verbatim, app lines go to stdout verbatim except
//!   `kimo/*` control messages (answered or consumed here) and the response to a replayed
//!   `initialize`.
//! - Disconnected: in-flight requests fail with −32010 TIMEOUT (retryable); for 30 s the shim
//!   reconnects, holding new lines, and replays the cached `initialize` + `initialized`.
//! - Offline (never connected, or the window ran out): answers from the embedded manifest and
//!   keeps probing; attaching later replays `initialize` and tells the host the tool list may
//!   have changed.
//! - Exit on stdin EOF (after `kimo/bye`) or when the parent pid goes away.

use crate::conn::{connect, Conn, ConnectError, Event, HelloInput};
use crate::offline::{self, Unavailable};
use crate::paths::{parent_pid, pid_alive, KimoPaths};
use crate::protocol::{
    codes, error_response, id_key, notification, relay_error, result_response, Peek, RpcError,
    BYE_METHOD, HOST_RESTARTING_METHOD, LAUNCH_WAIT_MS, MAX_FRAME_BYTES, PARENT_POLL_MS,
    PING_METHOD, RECONNECT_WINDOW_MS,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufReader, Write};
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct Options {
    pub client: Option<String>,
    pub launch: bool,
    pub home: PathBuf,
    /// Overrides for tests (`KIMO_MCP_RECONNECT_MS`, `KIMO_MCP_PROBE_MS`).
    pub reconnect_window: Duration,
    pub probe_every: Duration,
}

impl Options {
    pub fn from_env(client: Option<String>, launch: bool) -> Self {
        let ms = |k: &str, d: u64| {
            std::env::var(k)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(d)
        };
        Self {
            client,
            launch,
            home: crate::paths::kimo_home(),
            reconnect_window: Duration::from_millis(ms(
                "KIMO_MCP_RECONNECT_MS",
                RECONNECT_WINDOW_MS,
            )),
            probe_every: Duration::from_millis(ms("KIMO_MCP_PROBE_MS", 2_000)),
        }
    }
}

enum Mode {
    Connected(Conn),
    /// Lost the app; holding agent lines until `until`.
    Reconnecting {
        until: Instant,
    },
    /// `--launch` started the app; holding agent lines until `until`.
    Launching {
        until: Instant,
    },
    Offline,
}

const MAX_HELD: usize = 1_000;

struct Shim {
    opts: Options,
    paths: KimoPaths,
    hello: HelloInput,
    events: Sender<Event>,
    mode: Mode,
    gen: u64,
    last_try: Instant,
    /// Raw `initialize` request and `notifications/initialized` from the agent host.
    init_line: Option<String>,
    initialized_line: Option<String>,
    /// ids of replayed `initialize` requests whose responses are swallowed.
    replay_ids: HashSet<String>,
    replay_seq: u64,
    /// Agent-host requests waiting for the app (id key → id).
    inflight: HashMap<String, Value>,
    held: VecDeque<String>,
    /// The host saw offline answers: tell it to re-list once attached.
    answered_offline: bool,
    why_offline: Unavailable,
    out: std::io::Stdout,
}

impl Shim {
    fn write_out(&mut self, line: &str) {
        let mut lock = self.out.lock();
        let _ = lock.write_all(line.as_bytes());
        let _ = lock.write_all(b"\n");
        let _ = lock.flush();
    }

    fn try_connect(&mut self) -> Result<(), ConnectError> {
        self.last_try = Instant::now();
        self.gen += 1;
        let conn = connect(&self.paths, &self.hello, self.events.clone(), self.gen)?;
        self.attach(conn);
        Ok(())
    }

    fn attach(&mut self, mut conn: Conn) {
        log(&format!(
            "attached to Kimo (connection {}, document host {})",
            conn.hello.connection_id, conn.hello.document_host
        ));
        let mut ok = true;
        if let Some(init) = self.init_line.clone() {
            self.replay_seq += 1;
            let id = json!(format!("kimo-replay-init-{}", self.replay_seq));
            let mut v: Value = serde_json::from_str(&init).unwrap_or(Value::Null);
            v["id"] = id.clone();
            self.replay_ids.insert(id_key(&id));
            ok &= conn.send(&v.to_string()).is_ok();
            if let Some(n) = self.initialized_line.clone() {
                ok &= conn.send(&n).is_ok();
            }
        }
        self.mode = Mode::Connected(conn);
        if !ok {
            self.lost();
            return;
        }
        if std::mem::take(&mut self.answered_offline) {
            self.write_out(&notification("notifications/tools/list_changed"));
        }
        while let Some(line) = self.held.pop_front() {
            self.on_agent_line(line);
            if !matches!(self.mode, Mode::Connected(_)) {
                break;
            }
        }
    }

    /// The connection went away: fail in-flight requests, start the reconnect window.
    fn lost(&mut self) {
        self.mode = Mode::Reconnecting {
            until: Instant::now() + self.opts.reconnect_window,
        };
        self.replay_ids.clear();
        let err = relay_error(
            "TIMEOUT",
            "The connection to the Kimo app was lost before the call finished.",
            "Retry the call; Kimo is reconnecting.",
        );
        let ids: Vec<Value> = self.inflight.drain().map(|(_, id)| id).collect();
        for id in ids {
            self.write_out(&error_response(&id, &err));
        }
        log("lost the Kimo app; reconnecting");
    }

    fn go_offline(&mut self) {
        self.mode = Mode::Offline;
        while let Some(line) = self.held.pop_front() {
            self.answer_offline(&line);
        }
    }

    fn answer_offline(&mut self, line: &str) {
        if let Ok(peek) = Peek::parse(line) {
            self.note_session(&peek, line);
        }
        if let Some(resp) = offline::answer(line, self.why_offline) {
            self.answered_offline = true;
            self.write_out(&resp);
        }
    }

    fn on_agent_line(&mut self, line: String) {
        let peek = match Peek::parse(&line) {
            Ok(p) => p,
            Err(_) => {
                // Never forward non-JSON: the app would close the connection.
                self.write_out(&error_response(
                    &Value::Null,
                    &RpcError::new(codes::PARSE_ERROR, "Parse error"),
                ));
                return;
            }
        };
        match &mut self.mode {
            Mode::Connected(conn) => {
                if conn.send(&line).is_err() {
                    self.lost();
                    self.hold(line);
                    return;
                }
                self.note_session(&peek, &line);
                if peek.is_request() {
                    if let (Some(k), Some(id)) = (peek.id_key(), peek.id.clone()) {
                        self.inflight.insert(k, id);
                    }
                }
            }
            Mode::Reconnecting { .. } | Mode::Launching { .. } => self.hold(line),
            Mode::Offline => self.answer_offline(&line),
        }
    }

    /// Caches the session-opening lines once they reached an app or were answered offline, so
    /// a later attach replays them (held lines are cached when they are finally delivered).
    fn note_session(&mut self, peek: &Peek, line: &str) {
        match peek.method.as_deref() {
            Some("initialize") if peek.is_request() => self.init_line = Some(line.to_string()),
            Some("notifications/initialized") => self.initialized_line = Some(line.to_string()),
            _ => {}
        }
    }

    fn hold(&mut self, line: String) {
        if self.held.len() >= MAX_HELD {
            if let Some(old) = self.held.pop_front() {
                self.answer_offline(&old);
            }
        }
        self.held.push_back(line);
    }

    fn on_app_line(&mut self, line: String) {
        let Ok(peek) = Peek::parse(&line) else {
            return;
        };
        if peek.is_control() {
            match peek.method.as_deref() {
                Some(PING_METHOD) if peek.is_request() => {
                    let id = peek.id.clone().unwrap_or(Value::Null);
                    if let Mode::Connected(conn) = &mut self.mode {
                        if conn.send(&result_response(&id, json!({}))).is_err() {
                            self.lost();
                        }
                    }
                }
                Some(BYE_METHOD) => self.lost(),
                Some(HOST_RESTARTING_METHOD) => log("the Kimo document host is restarting"),
                _ => {}
            }
            return;
        }
        if peek.is_response() {
            if let Some(k) = peek.id_key() {
                if self.replay_ids.remove(&k) {
                    return;
                }
                self.inflight.remove(&k);
            }
        }
        self.write_out(&line);
    }

    fn tick(&mut self) {
        let now = Instant::now();
        match self.mode {
            Mode::Connected(_) => {}
            Mode::Reconnecting { until } | Mode::Launching { until } => {
                if now >= until {
                    log("Kimo did not come back; answering offline");
                    self.go_offline();
                } else if now.duration_since(self.last_try) >= Duration::from_millis(250) {
                    self.connect_or_note();
                }
            }
            Mode::Offline => {
                if now.duration_since(self.last_try) >= self.opts.probe_every {
                    self.connect_or_note();
                }
            }
        }
    }

    fn connect_or_note(&mut self) {
        match self.try_connect() {
            Ok(()) => self.why_offline = Unavailable::NotRunning,
            Err(ConnectError::ProtocolMismatch(s)) => {
                self.why_offline = Unavailable::ProtocolMismatch;
                log(&ConnectError::ProtocolMismatch(s).to_string());
            }
            Err(_) => self.why_offline = Unavailable::NotRunning,
        }
    }

    fn bye(&mut self) {
        if let Mode::Connected(conn) = &mut self.mode {
            let _ = conn.send(&notification(BYE_METHOD));
        }
    }
}

fn log(msg: &str) {
    eprintln!("kimo-mcp: {msg}");
}

fn spawn_stdin(events: Sender<Event>) {
    std::thread::spawn(move || {
        let mut r = BufReader::new(std::io::stdin());
        loop {
            match crate::protocol::read_frame(&mut r, MAX_FRAME_BYTES) {
                Ok(Some(line)) => {
                    if events.send(Event::Stdin(line)).is_err() {
                        return;
                    }
                }
                Ok(None) => break,
                Err(crate::protocol::FrameError::TooLarge) => {
                    log("stdin frame over 32 MiB; closing");
                    break;
                }
                Err(_) => break,
            }
        }
        let _ = events.send(Event::StdinEof);
    });
}

/// Runs the shim until stdin closes or the parent dies. Returns the exit code.
pub fn run(opts: Options) -> i32 {
    let (tx, rx) = channel::<Event>();
    let ppid = parent_pid();
    let paths = KimoPaths::new(opts.home.clone());
    let launch = opts.launch;
    let mut shim = Shim {
        hello: HelloInput {
            client: opts.client.clone(),
            pid: std::process::id(),
            ppid,
            cwd: std::env::current_dir()
                .ok()
                .map(|p| p.to_string_lossy().into_owned()),
        },
        opts,
        paths,
        events: tx.clone(),
        mode: Mode::Offline,
        gen: 0,
        last_try: Instant::now(),
        init_line: None,
        initialized_line: None,
        replay_ids: HashSet::new(),
        replay_seq: 0,
        inflight: HashMap::new(),
        held: VecDeque::new(),
        answered_offline: false,
        why_offline: Unavailable::NotRunning,
        out: std::io::stdout(),
    };
    shim.connect_or_note();
    if !matches!(shim.mode, Mode::Connected(_)) && launch {
        match crate::launch::launch_app() {
            Ok(how) => {
                log(&format!("launching Kimo ({how})"));
                shim.mode = Mode::Launching {
                    until: Instant::now() + Duration::from_millis(LAUNCH_WAIT_MS),
                };
            }
            Err(e) => log(&format!("--launch: {e}")),
        }
    }
    spawn_stdin(tx);

    let mut last_parent_check = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Event::Stdin(line)) => shim.on_agent_line(line),
            Ok(Event::StdinEof) => {
                shim.bye();
                return 0;
            }
            Ok(Event::Socket(gen, line)) if gen == shim.gen => shim.on_app_line(line),
            Ok(Event::SocketClosed(gen)) if gen == shim.gen => {
                if matches!(shim.mode, Mode::Connected(_)) {
                    shim.lost();
                }
            }
            Ok(_) => {} // stale connection
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return 0,
        }
        shim.tick();
        if last_parent_check.elapsed() >= Duration::from_millis(PARENT_POLL_MS) {
            last_parent_check = Instant::now();
            if parent_gone(ppid) {
                log("parent process exited; quitting");
                shim.bye();
                return 0;
            }
        }
    }
}

/// The agent host that spawned us is gone: on Unix we were re-parented (ppid changed), on
/// Windows the original parent pid is no longer alive.
fn parent_gone(original: u32) -> bool {
    if original <= 1 {
        return false;
    }
    if cfg!(unix) {
        parent_pid() != original
    } else {
        !pid_alive(original)
    }
}
