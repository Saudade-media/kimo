//! Relay tests with a fake document host: handshake (bad token, bad version, missing hello),
//! heartbeat timeout, queueing while the host starts, host restart (TIMEOUT + initialize
//! replay), backpressure, control messages, the Unix socket listener, HTTP forwarding and an
//! end-to-end run of the real `kimo-mcp` shim.

use super::hub::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncWriteExt, BufReader, DuplexStream, ReadHalf, WriteHalf};
use tokio::sync::mpsc;

const TOKEN: &str = "tok-123";

#[derive(Default)]
struct Sink {
    tx: Mutex<Option<mpsc::UnboundedSender<(String, Value)>>>,
    status: Mutex<Vec<Value>>,
}

impl HostSink for Sink {
    fn to_host(&self, event: &'static str, payload: Value) {
        if let Some(tx) = &*self.tx.lock().unwrap() {
            let _ = tx.send((event.to_string(), payload));
        }
    }
    fn broadcast(&self, _event: &'static str, payload: Value) {
        self.status.lock().unwrap().push(payload);
    }
}

fn cfg() -> HubConfig {
    let mut c = HubConfig::new(TOKEN.into(), "9.9.9".into());
    c.hello_timeout = Duration::from_millis(200);
    c.queue_window = Duration::from_millis(300);
    c
}

fn hub_with(c: HubConfig) -> (Arc<Hub>, mpsc::UnboundedReceiver<(String, Value)>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let sink = Arc::new(Sink {
        tx: Mutex::new(Some(tx)),
        ..Default::default()
    });
    let hub = Hub::new(c, "/tmp/kimo.sock".into(), "/x/kimo-mcp".into(), sink);
    (hub, rx)
}

struct Client {
    r: BufReader<ReadHalf<DuplexStream>>,
    w: WriteHalf<DuplexStream>,
}

impl Client {
    fn connect(hub: &Arc<Hub>, buf: usize) -> Self {
        let (a, b) = tokio::io::duplex(buf);
        tokio::spawn(hub.clone().serve(b));
        let (r, w) = tokio::io::split(a);
        Client {
            r: BufReader::new(r),
            w,
        }
    }
    async fn send(&mut self, v: Value) {
        self.w.write_all(format!("{v}\n").as_bytes()).await.unwrap();
    }
    async fn recv(&mut self) -> Option<Value> {
        tokio::time::timeout(Duration::from_secs(5), read_frame(&mut self.r))
            .await
            .expect("timely")
            .ok()
            .flatten()
            .map(|l| serde_json::from_str(&l).unwrap())
    }
    /// Next message that is not a heartbeat ping.
    async fn recv_skip_pings(&mut self) -> Option<Value> {
        loop {
            let m = self.recv().await?;
            if m["method"] != "kimo/ping" {
                return Some(m);
            }
        }
    }
    async fn hello(&mut self, token: &str, protocol: &str) -> Value {
        self.send(
            json!({"jsonrpc":"2.0","id":"hello","method":"kimo/hello","params":{
            "protocol":protocol,"token":token,"relay":{"name":"kimo-mcp","version":"0.0.0"},
            "client":"test","pid":10,"ppid":11,"cwd":"/repo"}}),
        )
        .await;
        self.recv().await.expect("hello reply")
    }
}

async fn next_event(rx: &mut mpsc::UnboundedReceiver<(String, Value)>) -> (String, Value) {
    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("event in time")
        .expect("sink open")
}

#[tokio::test]
async fn handshake_then_round_trip_through_the_host() {
    let (hub, mut rx) = hub_with(cfg());
    hub.host_ready();
    let mut c = Client::connect(&hub, 1 << 16);
    let r = c.hello(TOKEN, "kimo-socket/1").await;
    let res = &r["result"];
    assert_eq!(res["protocol"], "kimo-socket/1");
    assert_eq!(res["app"]["name"], "kimo-desktop");
    assert_eq!(res["app"]["version"], "9.9.9");
    assert_eq!(res["heartbeatMs"], 10_000);
    assert_eq!(res["documentHost"], "ready");
    let conn = res["connectionId"].as_str().unwrap().to_string();
    assert!(conn.starts_with("c_") && conn.len() == 8);

    let (ev, open) = next_event(&mut rx).await;
    assert_eq!(ev, EV_CONNECTION);
    assert_eq!(open["state"], "open");
    assert_eq!(open["transport"], "socket");
    assert_eq!(open["hello"]["client"], "test");
    assert_eq!(open["hello"]["cwd"], "/repo");
    assert!(open["hello"].get("token").is_none(), "never leak the token");

    let infos = hub.connections();
    assert_eq!(infos.len(), 1);
    let session = &conn[2..];
    assert_eq!(infos[0]["origin"], format!("mcp:test.{session}"));
    assert_eq!(infos[0]["identity"]["session"], session);
    assert_eq!(infos[0]["identity"]["pid"], 11);
    assert_eq!(hub.status()["connections"], 1);

    c.send(
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kimo_get_state"}}),
    )
    .await;
    let (ev, inb) = next_event(&mut rx).await;
    assert_eq!(ev, EV_IN);
    assert_eq!(inb["connectionId"], conn.as_str());
    let msg: Value = serde_json::from_str(inb["message"].as_str().unwrap()).unwrap();
    assert_eq!(msg["method"], "tools/call");
    hub.send(
        &conn,
        json!({"jsonrpc":"2.0","id":1,"result":{"ok":true}}).to_string(),
    )
    .await
    .unwrap();
    let resp = c.recv_skip_pings().await.unwrap();
    assert_eq!(resp["result"]["ok"], true);

    // The host may not send control methods or multi-line text, nor to unknown connections.
    assert!(matches!(
        hub.send(
            &conn,
            json!({"jsonrpc":"2.0","method":"kimo/bye"}).to_string()
        )
        .await,
        Err(HubError::Invalid(_))
    ));
    assert!(matches!(
        hub.send(&conn, "{\n}".into()).await,
        Err(HubError::Invalid(_))
    ));
    assert!(matches!(
        hub.send("c_nope00", "{}".into()).await,
        Err(HubError::NotFound(_))
    ));

    // Closing the socket announces the close.
    drop(c);
    let (ev, closed) = next_event(&mut rx).await;
    assert_eq!(ev, EV_CONNECTION);
    assert_eq!(closed["state"], "closed");
    assert_eq!(closed["connectionId"], conn.as_str());
    assert!(hub.connections().is_empty());
}

#[tokio::test]
async fn bad_token_and_bad_version_are_refused_and_closed() {
    let (hub, _rx) = hub_with(cfg());
    hub.host_ready();
    let mut c = Client::connect(&hub, 1 << 16);
    let r = c.hello("wrong", "kimo-socket/1").await;
    assert_eq!(r["error"]["code"], -32002);
    assert!(c.recv().await.is_none(), "closed after the error");

    let mut c = Client::connect(&hub, 1 << 16);
    let r = c.hello(TOKEN, "kimo-socket/2").await;
    assert_eq!(r["error"]["code"], -32001);
    assert_eq!(r["error"]["data"]["supported"], json!(["kimo-socket/1"]));
    assert!(c.recv().await.is_none());
    assert!(hub.connections().is_empty());
}

#[tokio::test]
async fn hello_is_required_first_and_in_time() {
    let (hub, _rx) = hub_with(cfg());
    let mut c = Client::connect(&hub, 1 << 16);
    c.send(json!({"jsonrpc":"2.0","id":1,"method":"initialize"}))
        .await;
    let r = c.recv().await.unwrap();
    assert_eq!(r["error"]["code"], -32004);
    assert!(c.recv().await.is_none());

    let mut c = Client::connect(&hub, 1 << 16);
    let r = c.recv().await.unwrap(); // no hello within 200 ms
    assert_eq!(r["error"]["code"], -32004);
    assert!(c.recv().await.is_none());

    // Non-JSON first line: closed without an answer.
    let mut c = Client::connect(&hub, 1 << 16);
    c.w.write_all(b"hello?\n").await.unwrap();
    assert!(c.recv().await.is_none());
}

#[tokio::test]
async fn frames_over_the_limit_are_refused() {
    let data = b"0123456789abcdef\nok\n".to_vec();
    let mut r = BufReader::new(&data[..]);
    assert!(matches!(
        read_frame_max(&mut r, 8).await,
        Err(FrameErr::TooLarge)
    ));
    let mut r = BufReader::new(&b"a\r\n\n b \nc"[..]);
    assert_eq!(read_frame_max(&mut r, 8).await.unwrap().unwrap(), "a");
    assert_eq!(read_frame_max(&mut r, 8).await.unwrap().unwrap(), " b ");
    assert!(read_frame_max(&mut r, 8).await.unwrap().is_none());
}

#[tokio::test]
async fn missed_heartbeats_close_the_connection() {
    let mut c = cfg();
    c.heartbeat = Duration::from_millis(40);
    let (hub, mut rx) = hub_with(c);
    hub.host_ready();
    let mut silent = Client::connect(&hub, 1 << 16);
    silent.hello(TOKEN, "kimo-socket/1").await;
    let _ = next_event(&mut rx).await; // open
    let mut pings = 0;
    while let Some(m) = silent.recv().await {
        assert_eq!(m["method"], "kimo/ping");
        assert!(m["id"].as_str().unwrap().starts_with("kimo-ping-"));
        pings += 1;
    }
    assert_eq!(pings, 3, "three unanswered pings, then close");
    let (_, closed) = next_event(&mut rx).await;
    assert_eq!(closed["state"], "closed");

    // A relay that answers stays connected.
    let mut alive = Client::connect(&hub, 1 << 16);
    alive.hello(TOKEN, "kimo-socket/1").await;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_millis(400) {
        let m = alive.recv().await.unwrap();
        assert_eq!(m["method"], "kimo/ping");
        alive
            .send(json!({"jsonrpc":"2.0","id":m["id"],"result":{}}))
            .await;
    }
    assert_eq!(hub.connections().len(), 1);
}

#[tokio::test]
async fn queues_while_the_host_starts_then_flushes_in_order() {
    let (hub, mut rx) = hub_with(cfg());
    let mut c = Client::connect(&hub, 1 << 16);
    let r = c.hello(TOKEN, "kimo-socket/1").await;
    assert_eq!(r["result"]["documentHost"], "starting");
    let conn = r["result"]["connectionId"].as_str().unwrap().to_string();
    c.send(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}))
        .await;
    c.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
        .await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(rx.try_recv().is_err(), "nothing reaches a starting host");
    hub.host_ready();
    let (ev, open) = next_event(&mut rx).await;
    assert_eq!(
        (ev.as_str(), open["connectionId"].as_str()),
        (EV_CONNECTION, Some(conn.as_str()))
    );
    let (_, m1) = next_event(&mut rx).await;
    assert!(m1["message"].as_str().unwrap().contains("\"initialize\""));
    let (_, m2) = next_event(&mut rx).await;
    assert!(m2["message"]
        .as_str()
        .unwrap()
        .contains("notifications/initialized"));
    assert_eq!(hub.status()["documentHost"], "ready");
}

#[tokio::test]
async fn queued_requests_time_out_after_15s_window() {
    let (hub, _rx) = hub_with(cfg());
    let mut c = Client::connect(&hub, 1 << 16);
    c.hello(TOKEN, "kimo-socket/1").await;
    c.send(json!({"jsonrpc":"2.0","id":"q","method":"tools/list"}))
        .await;
    tokio::time::sleep(Duration::from_millis(350)).await;
    hub.tick();
    let r = c.recv_skip_pings().await.unwrap();
    assert_eq!(r["id"], "q");
    assert_eq!(r["error"]["code"], -32010);
    assert_eq!(r["error"]["data"]["kimoCode"], "TIMEOUT");
    assert_eq!(r["error"]["data"]["retryable"], true);
}

#[tokio::test]
async fn a_host_that_never_starts_fails_new_hellos() {
    let mut c = cfg();
    c.host_fail_after = Duration::from_millis(10);
    let (hub, _rx) = hub_with(c);
    tokio::time::sleep(Duration::from_millis(20)).await;
    hub.tick();
    assert_eq!(hub.status()["documentHost"], "failed");
    let mut c = Client::connect(&hub, 1 << 16);
    let r = c.hello(TOKEN, "kimo-socket/1").await;
    assert_eq!(r["error"]["code"], -32003);
    // A later page load starts over.
    hub.host_loading();
    assert_eq!(hub.status()["documentHost"], "starting");
}

#[tokio::test]
async fn host_restart_fails_inflight_and_replays_initialize() {
    let (hub, mut rx) = hub_with(cfg());
    hub.host_ready();
    let mut c = Client::connect(&hub, 1 << 16);
    let r = c.hello(TOKEN, "kimo-socket/1").await;
    let conn = r["result"]["connectionId"].as_str().unwrap().to_string();
    let _ = next_event(&mut rx).await; // open
    c.send(
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"t"}}}),
    )
    .await;
    let _ = next_event(&mut rx).await;
    hub.send(
        &conn,
        json!({"jsonrpc":"2.0","id":1,"result":{}}).to_string(),
    )
    .await
    .unwrap();
    assert_eq!(c.recv_skip_pings().await.unwrap()["id"], 1);
    c.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
        .await;
    let _ = next_event(&mut rx).await;
    c.send(json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"kimo_render"}}))
        .await;
    let _ = next_event(&mut rx).await;

    hub.host_loading(); // page reload
    assert_eq!(hub.status()["documentHost"], "restarting");
    let n = c.recv_skip_pings().await.unwrap();
    assert_eq!(n["method"], "kimo/hostRestarting");
    let e = c.recv_skip_pings().await.unwrap();
    assert_eq!(e["id"], 2);
    assert_eq!(e["error"]["data"]["kimoCode"], "TIMEOUT");

    // A call during the restart waits for the new host, after the replay.
    c.send(json!({"jsonrpc":"2.0","id":3,"method":"tools/list"}))
        .await;
    tokio::time::sleep(Duration::from_millis(30)).await;
    hub.host_ready();
    let (ev, _) = next_event(&mut rx).await;
    assert_eq!(ev, EV_CONNECTION);
    let (_, replay) = next_event(&mut rx).await;
    let replay: Value = serde_json::from_str(replay["message"].as_str().unwrap()).unwrap();
    assert_eq!(replay["method"], "initialize");
    assert_eq!(replay["params"]["clientInfo"]["name"], "t");
    let rid = replay["id"].as_str().unwrap().to_string();
    assert!(rid.starts_with("kimo-replay-init-"));
    let (_, init2) = next_event(&mut rx).await;
    assert!(init2["message"]
        .as_str()
        .unwrap()
        .contains("notifications/initialized"));
    let (_, held) = next_event(&mut rx).await;
    assert!(held["message"].as_str().unwrap().contains("tools/list"));
    // The new host answers the replay: swallowed. Then the held call.
    hub.send(
        &conn,
        json!({"jsonrpc":"2.0","id":rid,"result":{}}).to_string(),
    )
    .await
    .unwrap();
    hub.send(
        &conn,
        json!({"jsonrpc":"2.0","id":3,"result":{"tools":[]}}).to_string(),
    )
    .await
    .unwrap();
    let r = c.recv_skip_pings().await.unwrap();
    assert_eq!(r["id"], 3, "the replay response never reaches the relay");
}

#[tokio::test]
async fn control_messages_and_disconnect() {
    let (hub, mut rx) = hub_with(cfg());
    hub.host_ready();
    let mut c = Client::connect(&hub, 1 << 16);
    let r = c.hello(TOKEN, "kimo-socket/1").await;
    let conn = r["result"]["connectionId"].as_str().unwrap().to_string();
    let _ = next_event(&mut rx).await;
    c.send(json!({"jsonrpc":"2.0","id":"p","method":"kimo/ping"}))
        .await;
    assert_eq!(
        c.recv_skip_pings().await.unwrap(),
        json!({"jsonrpc":"2.0","id":"p","result":{}})
    );
    c.send(json!({"jsonrpc":"2.0","id":"h","method":"kimo/hello","params":{}}))
        .await;
    assert_eq!(c.recv_skip_pings().await.unwrap()["error"]["code"], -32004);
    c.send(json!({"jsonrpc":"2.0","id":"u","method":"kimo/unknown"}))
        .await;
    assert_eq!(c.recv_skip_pings().await.unwrap()["error"]["code"], -32601);
    // Control traffic never reached the host.
    assert!(rx.try_recv().is_err());

    assert!(hub.disconnect(&conn));
    assert_eq!(c.recv_skip_pings().await.unwrap()["method"], "kimo/bye");
    assert!(c.recv().await.is_none());
    let (_, closed) = next_event(&mut rx).await;
    assert_eq!(closed["state"], "closed");
    assert!(!hub.disconnect(&conn));

    // kimo/bye from the relay closes gracefully.
    let mut c = Client::connect(&hub, 1 << 16);
    c.hello(TOKEN, "kimo-socket/1").await;
    let _ = next_event(&mut rx).await;
    c.send(json!({"jsonrpc":"2.0","method":"kimo/bye"})).await;
    let (_, closed) = next_event(&mut rx).await;
    assert_eq!(closed["state"], "closed");
}

#[tokio::test]
async fn kimo_mcp_send_applies_backpressure() {
    let mut c = cfg();
    c.outbound_capacity = 1;
    let (hub, mut rx) = hub_with(c);
    hub.host_ready();
    // A 64-byte pipe the relay does not read.
    let mut client = Client::connect(&hub, 64);
    let r = client.hello(TOKEN, "kimo-socket/1").await;
    let conn = r["result"]["connectionId"].as_str().unwrap().to_string();
    let _ = next_event(&mut rx).await;
    let big =
        json!({"jsonrpc":"2.0","method":"notifications/message","params":{"data":"x".repeat(200)}})
            .to_string();
    let mut blocked = false;
    let mut sent_ok = 0;
    for _ in 0..6 {
        let f = hub.send(&conn, big.clone());
        if tokio::time::timeout(Duration::from_millis(100), f)
            .await
            .is_err()
        {
            blocked = true;
            break;
        }
        sent_ok += 1;
    }
    assert!(blocked, "send waits while the relay is not reading");
    // Draining the relay side lets sends complete again.
    let h = hub.clone();
    let c2 = conn.clone();
    let b2 = big.clone();
    let pending = tokio::spawn(async move { h.send(&c2, b2).await });
    let mut got = 0;
    while got < sent_ok + 1 {
        let m = client.recv().await.unwrap();
        if m["method"] == "notifications/message" {
            got += 1;
        }
    }
    tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn unix_listener_owns_a_private_socket() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("socket").join("kimo.sock");
    let ep = path.to_string_lossy().into_owned();
    // A stale file with no listener is replaced.
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"").unwrap();
    let super::listener::Prepared::Ready(l) = super::listener::prepare(&ep) else {
        panic!("socket should be ready");
    };
    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let dmode = std::fs::metadata(path.parent().unwrap())
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(dmode, 0o700);
    let (hub, _rx) = hub_with(cfg());
    hub.host_ready();
    let (stop, stop_rx) = tokio::sync::watch::channel(false);
    tokio::spawn(super::listener::run(hub.clone(), l, stop_rx));
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(hub.status()["socket"]["listening"], true);
    // A second app sees the endpoint in use.
    assert!(matches!(
        super::listener::prepare(&ep),
        super::listener::Prepared::InUse
    ));
    let s = tokio::net::UnixStream::connect(&path).await.unwrap();
    let (r, mut w) = tokio::io::split(s);
    let mut r = BufReader::new(r);
    w.write_all(
        format!(
            "{}\n",
            json!({"jsonrpc":"2.0","id":"hello","method":"kimo/hello","params":{
            "protocol":"kimo-socket/1","token":TOKEN,"relay":{"name":"kimo-cli","version":"0"},"pid":1,"ppid":1}})
        )
        .as_bytes(),
    )
    .await
    .unwrap();
    let line = read_frame(&mut r).await.unwrap().unwrap();
    let v: Value = serde_json::from_str(&line).unwrap();
    assert!(v["result"]["connectionId"].is_string());
    // Settings › Agents › Stop: the accept loop ends and the status says so.
    stop.send(true).unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(tokio::net::UnixStream::connect(&path).await.is_err());
}

#[tokio::test]
async fn http_forwards_authenticated_requests_and_streams_the_answer() {
    use tokio::io::AsyncReadExt;
    let (hub, mut rx) = hub_with(cfg());
    hub.host_ready();
    let tokens: super::http::Tokens = Arc::new(std::sync::RwLock::new(
        [("codex".to_string(), "bearer-1".to_string())].into(),
    ));
    let h = super::http::start(hub.clone(), tokens, 0).await.unwrap();
    let port = h.port;

    async fn raw(port: u16, req: String) -> String {
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        s.write_all(req.as_bytes()).await.unwrap();
        let mut out = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(5), s.read_to_end(&mut out)).await;
        String::from_utf8_lossy(&out).into_owned()
    }
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
    let req = |extra: &str| {
        format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nConnection: close\r\n{extra}Content-Length: {}\r\n\r\n{body}",
            body.len()
        )
    };
    let unauth = raw(port, req("")).await;
    assert!(unauth.starts_with("HTTP/1.1 401"), "{unauth}");
    let wrong = raw(port, req("Authorization: Bearer nope\r\n")).await;
    assert!(wrong.starts_with("HTTP/1.1 401"));
    let browser = raw(
        port,
        req("Authorization: Bearer bearer-1\r\nOrigin: https://evil.example\r\n"),
    )
    .await;
    assert!(browser.starts_with("HTTP/1.1 403"));
    let bad_host = raw(
        port,
        "POST /mcp HTTP/1.1\r\nHost: evil.example\r\nAuthorization: Bearer bearer-1\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
            .to_string(),
    )
    .await;
    assert!(bad_host.starts_with("HTTP/1.1 403"));
    let not_mcp = raw(
        port,
        format!("GET /other HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"),
    )
    .await;
    assert!(not_mcp.starts_with("HTTP/1.1 404"));

    // Authenticated: the host sees the request and streams two chunks.
    let hub2 = hub.clone();
    let host = tokio::spawn(async move {
        let (ev, r) = next_event(&mut rx).await;
        assert_eq!(ev, EV_HTTP_REQUEST);
        assert_eq!(r["method"], "POST");
        assert_eq!(r["url"], format!("http://127.0.0.1:{port}/mcp"));
        assert_eq!(r["headers"]["x-kimo-client"], "codex");
        assert!(r["headers"].get("authorization").is_none());
        use base64::Engine;
        let b = base64::engine::general_purpose::STANDARD
            .decode(r["bodyBase64"].as_str().unwrap())
            .unwrap();
        assert_eq!(b, body.as_bytes());
        let id = r["requestId"].as_str().unwrap().to_string();
        hub2.http_respond(
            &id,
            Some(200),
            vec![("content-type".into(), "text/event-stream".into())],
            Some(bytes::Bytes::from_static(b"data: one\n\n")),
            false,
        )
        .await
        .unwrap();
        hub2.http_respond(
            &id,
            None,
            vec![],
            Some(bytes::Bytes::from_static(b"data: two\n\n")),
            true,
        )
        .await
        .unwrap();
        assert!(hub2
            .http_respond(&id, None, vec![], None, true)
            .await
            .is_err());
    });
    let ok = raw(port, req("Authorization: Bearer bearer-1\r\n")).await;
    host.await.unwrap();
    assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
    assert!(ok
        .to_lowercase()
        .contains("content-type: text/event-stream"));
    assert!(ok.contains("data: one") && ok.contains("data: two"));
    h.stop();
}

/// The real shim against the real relay: `cargo test --workspace` builds `kimo-mcp` first, so
/// the binary sits next to this test's deps directory. Skipped when it is not built.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn end_to_end_with_the_kimo_mcp_shim() {
    use std::io::{BufRead, Write};
    let exe = std::env::current_exe().unwrap();
    let shim = exe
        .parent()
        .and_then(|d| d.parent())
        .map(|d| d.join("kimo-mcp"))
        .unwrap();
    if !shim.is_file() {
        eprintln!("skipping: {} not built", shim.display());
        return;
    }
    let home = tempfile::tempdir().unwrap();
    let paths = kimo_mcp::paths::KimoPaths::new(home.path());
    super::files::write_private(&paths.token(), TOKEN.as_bytes()).unwrap();
    let super::listener::Prepared::Ready(l) = super::listener::prepare(&paths.endpoint_name())
    else {
        panic!("socket");
    };
    let (hub, mut rx) = hub_with(cfg());
    hub.host_ready();
    let (_stop, stop_rx) = tokio::sync::watch::channel(false);
    tokio::spawn(super::listener::run(hub.clone(), l, stop_rx));
    // Fake document host: echo every request.
    let h = hub.clone();
    tokio::spawn(async move {
        while let Some((ev, p)) = rx.recv().await {
            if ev != EV_IN {
                continue;
            }
            let m: Value = serde_json::from_str(p["message"].as_str().unwrap()).unwrap();
            if m.get("id").is_some() && m.get("method").is_some() {
                let reply = json!({"jsonrpc":"2.0","id":m["id"],"result":{"host":m["method"]}});
                let _ = h
                    .send(p["connectionId"].as_str().unwrap(), reply.to_string())
                    .await;
            }
        }
    });
    let mut child = std::process::Command::new(&shim)
        .args(["--client", "claude-code"])
        .env("KIMO_HOME", home.path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let lines = tokio::task::spawn_blocking(move || {
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{}}}}"#)
            .unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{{"name":"kimo_get_state"}}}}"#).unwrap();
        let mut r = std::io::BufReader::new(stdout);
        let mut got = vec![];
        for _ in 0..2 {
            let mut s = String::new();
            r.read_line(&mut s).unwrap();
            got.push(serde_json::from_str::<Value>(&s).unwrap());
        }
        drop(stdin);
        got
    })
    .await
    .unwrap();
    assert_eq!(lines[0]["result"]["host"], "initialize");
    assert_eq!(lines[1]["result"]["host"], "tools/call");
    let infos = hub.connections();
    assert!(infos.is_empty() || infos[0]["identity"]["label"] == "Claude Code");
    let status = tokio::task::spawn_blocking(move || child.wait().unwrap())
        .await
        .unwrap();
    assert!(status.success());
}

#[test]
fn server_settings_log_and_port_check() {
    let home = tempfile::tempdir().unwrap();
    let paths = kimo_mcp::paths::KimoPaths::new(home.path());
    // Start on launch defaults on; the choice persists.
    assert!(super::files::read_server_settings(&paths).start_on_launch);
    super::files::write_server_settings(
        &paths,
        &super::files::ServerSettings {
            start_on_launch: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!super::files::read_server_settings(&paths).start_on_launch);
    let raw = std::fs::read_to_string(super::files::server_settings_path(&paths)).unwrap();
    assert!(raw.contains("\"startOnLaunch\": false"));
    // The log appends timestamped lines.
    super::files::log_append(&paths, "error X: one\ntwo");
    let log = std::fs::read_to_string(super::files::server_log_path(&paths)).unwrap();
    assert!(log.trim_end().ends_with("error X: one two"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(super::files::server_log_path(&paths))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }
    // A bound port is not free; port 0 never is.
    let l = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = l.local_addr().unwrap().port();
    assert!(!super::files::port_free(port));
    assert!(!super::files::port_free(0));
    drop(l);
    assert!(super::files::port_free(port));
}

#[test]
fn status_carries_service_fields() {
    let (hub, _rx) = hub_with(cfg());
    hub.set_status_field("startOnLaunch", true.into());
    hub.set_status_field(
        "error",
        json!({"code": "EADDRINUSE 127.0.0.1:1", "message": "m", "time": 1}),
    );
    let s = hub.status();
    assert_eq!(s["running"], false);
    assert_eq!(s["startOnLaunch"], true);
    assert_eq!(s["error"]["code"], "EADDRINUSE 127.0.0.1:1");
    hub.set_status_field("error", Value::Null);
    assert!(hub.status().get("error").is_none());
}

/// D8: the configured port is taken, HTTP falls back to an ephemeral port and suggests it;
/// "Use <port> and restart" with that port must clear the error (the listener is already there).
#[tokio::test]
async fn using_the_suggested_port_clears_the_port_in_use_error() {
    let home = tempfile::tempdir().unwrap();
    let paths = kimo_mcp::paths::KimoPaths::new(home.path());
    std::fs::create_dir_all(paths.mcp_dir()).unwrap();
    let taken = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let taken_port = taken.local_addr().unwrap().port();
    super::files::write_http_config(
        &paths,
        &super::files::HttpConfig {
            enabled: true,
            port: taken_port,
        },
    )
    .unwrap();
    let (hub, _rx) = hub_with(cfg());
    let svc = super::McpService::for_test(hub.clone(), paths.clone());
    svc.set_http_enabled(true).await.unwrap();
    let st = hub.status();
    assert!(st["error"]["code"]
        .as_str()
        .unwrap()
        .starts_with("EADDRINUSE"));
    let suggested = st["error"]["suggestedPort"].as_u64().unwrap() as u16;
    assert_ne!(suggested, taken_port);
    assert_eq!(st["http"]["port"].as_u64(), Some(suggested as u64));
    // D9: the bearer exists by the time the status says HTTP is on.
    assert!(svc.token_of(super::HTTP_TOKEN_CLIENT).unwrap().is_some());
    assert!(svc.port_free(suggested).await);

    let out = svc.set_settings(None, None, Some(suggested)).await.unwrap();
    assert_eq!(out["httpPort"].as_u64(), Some(suggested as u64));
    let st = hub.status();
    assert!(st.get("error").is_none(), "error kept: {st}");
    assert_eq!(st["http"]["port"].as_u64(), Some(suggested as u64));
    assert_eq!(super::files::read_http_config(&paths).port, suggested);
    drop(taken);
    svc.set_http_enabled(false).await.unwrap();
}

/// D14: "Ask before destructive or out-of-scope ops" persists in server.json and rides the status
/// (the document host gates destructive approvals on it).
#[tokio::test]
async fn ask_before_destructive_persists_and_reaches_the_status() {
    let home = tempfile::tempdir().unwrap();
    let paths = kimo_mcp::paths::KimoPaths::new(home.path());
    let (hub, _rx) = hub_with(cfg());
    let svc = super::McpService::for_test(hub.clone(), paths.clone());
    assert!(super::files::read_server_settings(&paths).ask_before_destructive);
    let out = svc.set_settings(None, Some(false), None).await.unwrap();
    assert_eq!(out["askBeforeDestructive"], false);
    assert_eq!(out["startOnLaunch"], true);
    assert_eq!(hub.status()["askBeforeDestructive"], false);
    assert!(!super::files::read_server_settings(&paths).ask_before_destructive);
    svc.set_settings(None, Some(true), None).await.unwrap();
    assert_eq!(hub.status()["askBeforeDestructive"], true);
}
