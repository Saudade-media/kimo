//! Drives the real `kimo-mcp` binary over stdio: offline answers, relaying through a fake app on
//! the socket, heartbeat replies, reconnect with initialize replay, attach after offline, bad
//! tokens, stdin EOF and parent-death exits.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

const BIN: &str = env!("CARGO_BIN_EXE_kimo-mcp");

struct Shim {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<String>,
}

impl Shim {
    fn spawn(home: &std::path::Path, extra: &[(&str, &str)]) -> Self {
        let mut cmd = Command::new(BIN);
        cmd.args(["--client", "test-host"])
            .env("KIMO_HOME", home)
            .env("KIMO_MCP_PROBE_MS", "100")
            .env("KIMO_MCP_RECONNECT_MS", "3000")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        for (k, v) in extra {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().expect("spawn kimo-mcp");
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Shim {
            stdin: child.stdin.take(),
            child,
            lines: rx,
        }
    }

    fn send(&mut self, v: Value) {
        let s = self.stdin.as_mut().unwrap();
        writeln!(s, "{v}").unwrap();
        s.flush().unwrap();
    }

    fn recv(&self) -> Value {
        let line = self
            .lines
            .recv_timeout(Duration::from_secs(10))
            .expect("shim answered");
        serde_json::from_str(&line).unwrap()
    }

    fn no_output_for(&self, d: Duration) {
        if let Ok(l) = self.lines.recv_timeout(d) {
            panic!("unexpected output: {l}");
        }
    }

    fn close_and_wait(mut self) -> i32 {
        drop(self.stdin.take());
        let start = Instant::now();
        loop {
            if let Some(st) = self.child.try_wait().unwrap() {
                return st.code().unwrap_or(-1);
            }
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "shim did not exit on stdin EOF"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Shim {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn init_msg(id: i64) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}})
}

#[test]
fn offline_answers_from_the_manifest_and_exits_on_eof() {
    let home = tempfile::tempdir().unwrap();
    let mut shim = Shim::spawn(home.path(), &[]);
    shim.send(init_msg(1));
    let r = shim.recv();
    assert_eq!(r["id"], 1);
    assert_eq!(r["result"]["serverInfo"]["name"], "kimo");
    assert_eq!(r["result"]["protocolVersion"], "2025-06-18");
    shim.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
    shim.send(json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    let r = shim.recv();
    assert_eq!(r["id"], 2);
    let tools = r["result"]["tools"].as_array().unwrap();
    assert!(tools.iter().any(|t| t["name"] == "kimo_apply_ops"));
    shim.send(json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"kimo_get_state","arguments":{}}}));
    let r = shim.recv();
    assert_eq!(r["id"], 3);
    assert_eq!(r["result"]["isError"], true);
    assert_eq!(
        r["result"]["structuredContent"]["errors"][0]["code"],
        "APP_NOT_RUNNING"
    );
    assert_eq!(
        r["result"]["structuredContent"]["errors"][0]["retryable"],
        true
    );
    // Garbage never kills the shim.
    shim.stdin.as_mut().unwrap().write_all(b"nope\n").unwrap();
    assert_eq!(shim.recv()["error"]["code"], -32700);
    assert_eq!(shim.close_and_wait(), 0);
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::mpsc::Sender;

    const TOKEN: &str = "test-token-123";

    fn setup_home(home: &std::path::Path) -> UnixListener {
        std::fs::create_dir_all(home.join("socket")).unwrap();
        std::fs::create_dir_all(home.join("mcp")).unwrap();
        std::fs::write(home.join("mcp/token"), TOKEN).unwrap();
        UnixListener::bind(home.join("socket/kimo.sock")).unwrap()
    }

    fn read_line(r: &mut BufReader<UnixStream>) -> Option<Value> {
        let mut s = String::new();
        match r.read_line(&mut s) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(serde_json::from_str(s.trim_end()).unwrap()),
        }
    }

    fn write_line(w: &mut UnixStream, v: &Value) {
        writeln!(w, "{v}").unwrap();
    }

    /// Accepts one connection and answers the hello (checking the token). Returns the reader,
    /// the writer and the hello params, or None when the token was refused.
    fn accept(l: &UnixListener, token: &str) -> Option<(BufReader<UnixStream>, UnixStream, Value)> {
        let (s, _) = l.accept().unwrap();
        let mut w = s.try_clone().unwrap();
        let mut r = BufReader::new(s);
        let hello = read_line(&mut r).unwrap();
        assert_eq!(hello["method"], "kimo/hello");
        let p = hello["params"].clone();
        if p["token"] != token {
            write_line(
                &mut w,
                &json!({"jsonrpc":"2.0","id":"hello","error":{"code":-32002,"message":"bad token"}}),
            );
            return None;
        }
        write_line(
            &mut w,
            &json!({"jsonrpc":"2.0","id":"hello","result":{"protocol":"kimo-socket/1",
                "app":{"name":"kimo-desktop","version":"0.0.0","pid":std::process::id()},
                "connectionId":"c_test01","heartbeatMs":10000,"documentHost":"ready"}}),
        );
        Some((r, w, p))
    }

    fn fake_app(l: UnixListener, seen: Sender<Value>) {
        std::thread::spawn(move || {
            let Some((mut r, mut w, hello)) = accept(&l, TOKEN) else {
                return;
            };
            seen.send(hello).unwrap();
            // Heartbeat from the app: the shim must answer, and never print it.
            write_line(
                &mut w,
                &json!({"jsonrpc":"2.0","id":"kimo-ping-1","method":"kimo/ping"}),
            );
            while let Some(m) = read_line(&mut r) {
                seen.send(m.clone()).unwrap();
                if m["id"] == "kimo-ping-1" {
                    continue;
                }
                if m.get("method").is_some() && m.get("id").is_some() {
                    write_line(
                        &mut w,
                        &json!({"jsonrpc":"2.0","id":m["id"],"result":{"echo":m["method"]}}),
                    );
                }
            }
        });
    }

    #[test]
    fn relays_through_the_socket_and_answers_pings() {
        let home = tempfile::tempdir().unwrap();
        let l = setup_home(home.path());
        let (tx, seen) = channel();
        fake_app(l, tx);
        let mut shim = Shim::spawn(home.path(), &[]);
        let hello = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(hello["protocol"], "kimo-socket/1");
        assert_eq!(hello["client"], "test-host");
        assert_eq!(hello["relay"]["name"], "kimo-mcp");
        assert!(hello["ppid"].as_u64().unwrap() > 0);
        let pong = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(pong["id"], "kimo-ping-1");
        assert_eq!(pong["result"], json!({}));

        shim.send(init_msg(1));
        assert_eq!(shim.recv()["result"]["echo"], "initialize");
        shim.send(json!({"jsonrpc":"2.0","id":"x","method":"tools/call","params":{"name":"kimo_get_state"}}));
        let r = shim.recv();
        assert_eq!(r["id"], "x");
        assert_eq!(r["result"]["echo"], "tools/call");
        assert_eq!(shim.close_and_wait(), 0);
        // EOF sends kimo/bye before exiting.
        let mut saw_bye = false;
        while let Ok(m) = seen.recv_timeout(Duration::from_secs(2)) {
            saw_bye |= m["method"] == "kimo/bye";
        }
        assert!(saw_bye);
    }

    #[test]
    fn reconnects_fails_inflight_and_replays_initialize() {
        let home = tempfile::tempdir().unwrap();
        let l = setup_home(home.path());
        let (tx, seen) = channel::<Value>();
        let (go_tx, go_rx) = channel::<()>();
        std::thread::spawn(move || {
            // First connection: answer initialize, then drop while a call is in flight.
            let (mut r, mut w, _) = accept(&l, TOKEN).unwrap();
            let init = read_line(&mut r).unwrap();
            write_line(
                &mut w,
                &json!({"jsonrpc":"2.0","id":init["id"],"result":{"first":true}}),
            );
            let initialized = read_line(&mut r).unwrap();
            tx.send(initialized).unwrap();
            let call = read_line(&mut r).unwrap();
            tx.send(call).unwrap();
            drop(r);
            drop(w);
            go_rx.recv().unwrap();
            // Second connection: expect the replayed initialize + initialized.
            let (mut r, mut w, _) = accept(&l, TOKEN).unwrap();
            let replay = read_line(&mut r).unwrap();
            tx.send(replay.clone()).unwrap();
            write_line(
                &mut w,
                &json!({"jsonrpc":"2.0","id":replay["id"],"result":{"replayed":true}}),
            );
            while let Some(m) = read_line(&mut r) {
                tx.send(m.clone()).unwrap();
                if m.get("id").is_some() && m.get("method").is_some() {
                    write_line(
                        &mut w,
                        &json!({"jsonrpc":"2.0","id":m["id"],"result":{"second":true}}),
                    );
                }
            }
        });
        let mut shim = Shim::spawn(home.path(), &[]);
        shim.send(init_msg(1));
        assert_eq!(shim.recv()["result"]["first"], true);
        shim.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
        shim.send(
            json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"kimo_render"}}),
        );
        let initialized = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(initialized["method"], "notifications/initialized");
        let call = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(call["id"], 7);
        // In-flight call fails TIMEOUT retryable.
        let r = shim.recv();
        assert_eq!(r["id"], 7);
        assert_eq!(r["error"]["code"], -32010);
        assert_eq!(r["error"]["data"]["kimoCode"], "TIMEOUT");
        assert_eq!(r["error"]["data"]["retryable"], true);
        // A call made while reconnecting is held, then delivered.
        shim.send(json!({"jsonrpc":"2.0","id":8,"method":"tools/list"}));
        go_tx.send(()).unwrap();
        let replay = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(replay["method"], "initialize");
        assert_eq!(replay["id"], "kimo-replay-init-1");
        assert_eq!(replay["params"]["clientInfo"]["name"], "test");
        let initialized = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(initialized["method"], "notifications/initialized");
        let held = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(held["id"], 8);
        // The replayed initialize response is swallowed; the held call's answer comes through.
        let r = shim.recv();
        assert_eq!(r["id"], 8);
        assert_eq!(r["result"]["second"], true);
        shim.no_output_for(Duration::from_millis(200));
    }

    #[test]
    fn attaches_after_starting_offline() {
        let home = tempfile::tempdir().unwrap();
        let mut shim = Shim::spawn(home.path(), &[]);
        shim.send(init_msg(1));
        assert_eq!(shim.recv()["result"]["serverInfo"]["name"], "kimo");
        shim.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
        // The app appears.
        let l = setup_home(home.path());
        let (tx, seen) = channel();
        std::thread::spawn(move || {
            let (mut r, mut w, _) = accept(&l, TOKEN).unwrap();
            while let Some(m) = read_line(&mut r) {
                tx.send(m.clone()).unwrap();
                if m.get("id").is_some() && m.get("method").is_some() {
                    write_line(
                        &mut w,
                        &json!({"jsonrpc":"2.0","id":m["id"],"result":{"live":true}}),
                    );
                }
            }
        });
        let replay = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(replay["method"], "initialize");
        assert_eq!(replay["id"], "kimo-replay-init-1");
        assert_eq!(
            seen.recv_timeout(Duration::from_secs(5)).unwrap()["method"],
            "notifications/initialized"
        );
        // The host is told to re-list tools.
        assert_eq!(shim.recv()["method"], "notifications/tools/list_changed");
        shim.send(json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"kimo_get_state"}}));
        let r = shim.recv();
        assert_eq!(r["id"], 2);
        assert_eq!(r["result"]["live"], true);
    }

    #[test]
    fn a_refused_token_leaves_the_shim_offline() {
        let home = tempfile::tempdir().unwrap();
        let l = setup_home(home.path());
        std::fs::write(home.path().join("mcp/token"), "stale").unwrap();
        std::thread::spawn(move || loop {
            let _ = accept(&l, TOKEN);
        });
        let mut shim = Shim::spawn(home.path(), &[]);
        shim.send(json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kimo_get_state"}}));
        let r = shim.recv();
        assert_eq!(
            r["result"]["structuredContent"]["errors"][0]["code"],
            "APP_NOT_RUNNING"
        );
    }

    #[test]
    fn a_stale_endpoint_file_means_not_running() {
        let home = tempfile::tempdir().unwrap();
        let _l = setup_home(home.path());
        // A dead pid in endpoint.json: never dial (the socket file may be stale too).
        std::fs::write(
            home.path().join("mcp/endpoint.json"),
            json!({"version":1,"pid":999999,"appVersion":"0","socket":"/nonexistent","socketProtocol":"kimo-socket/1","startedAtIso":"x"}).to_string(),
        )
        .unwrap();
        let mut shim = Shim::spawn(home.path(), &[]);
        shim.send(json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kimo_get_state"}}));
        assert_eq!(
            shim.recv()["result"]["structuredContent"]["errors"][0]["code"],
            "APP_NOT_RUNNING"
        );
    }

    #[test]
    fn exits_when_the_parent_dies() {
        let home = tempfile::tempdir().unwrap();
        let fifo = home.path().join("stdin.fifo");
        let c = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
        // SAFETY: mkfifo on a fresh path in our temp dir.
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
        // Hold the write end open so the shim's stdin never reaches EOF.
        let fifo_w = fifo.clone();
        let (wtx, wrx) = channel();
        std::thread::spawn(move || {
            let f = std::fs::OpenOptions::new()
                .write(true)
                .open(fifo_w)
                .unwrap();
            wtx.send(f).unwrap();
        });
        let out = Command::new("sh")
            .arg("-c")
            .arg(r#""$0" < "$1" > /dev/null 2>&1 & echo $!; sleep 0.5"#)
            .arg(BIN)
            .arg(&fifo)
            .env("KIMO_HOME", home.path())
            .output()
            .unwrap();
        let _writer = wrx.recv_timeout(Duration::from_secs(5)).unwrap();
        let pid: i32 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap();
        let start = Instant::now();
        loop {
            // SAFETY: existence probe only.
            let alive = unsafe { libc::kill(pid, 0) } == 0;
            if !alive {
                break;
            }
            assert!(
                start.elapsed() < Duration::from_secs(6),
                "shim outlived its parent"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
