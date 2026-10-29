//! One authenticated socket/pipe connection from the shim to the app: connect, `kimo/hello`,
//! then a reader thread that posts every line to the shim's event loop and a writer thread, so
//! an app that stops reading never blocks the loop (stdin EOF and parent death still exit).

use crate::paths::{pid_alive, read_endpoint, KimoPaths};
use crate::protocol::{
    codes, request, HelloParams, HelloResult, RelayInfo, RpcError, HELLO_METHOD, HELLO_TIMEOUT_MS,
    MAX_FRAME_BYTES, SOCKET_PROTOCOL,
};
use serde_json::{json, Value};
use std::io::Write;
use std::sync::mpsc::Sender;

/// Everything the shim's event loop reacts to.
#[derive(Debug)]
pub enum Event {
    Stdin(String),
    StdinEof,
    /// A line from the app on connection `gen`.
    Socket(u64, String),
    SocketClosed(u64),
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConnectError {
    /// No endpoint, stale endpoint, nothing listening, or the app closed during hello.
    NotRunning(String),
    ProtocolMismatch(Vec<String>),
    Unauthorized,
    HostUnavailable(String),
    Other(String),
}

impl std::fmt::Display for ConnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectError::NotRunning(m) => write!(f, "app not reachable: {m}"),
            ConnectError::ProtocolMismatch(s) => {
                write!(
                    f,
                    "protocol mismatch: app supports {}, shim speaks {SOCKET_PROTOCOL}",
                    s.join(", ")
                )
            }
            ConnectError::Unauthorized => write!(f, "the app rejected the token"),
            ConnectError::HostUnavailable(m) => write!(f, "document host unavailable: {m}"),
            ConnectError::Other(m) => write!(f, "{m}"),
        }
    }
}

pub struct Conn {
    pub writer: Box<dyn Write + Send>,
    pub hello: HelloResult,
}

impl Conn {
    pub fn send(&mut self, line: &str) -> std::io::Result<()> {
        let mut buf = Vec::with_capacity(line.len() + 1);
        buf.extend_from_slice(line.as_bytes());
        buf.push(b'\n');
        self.writer.write_all(&buf)?;
        self.writer.flush()
    }
}

pub struct HelloInput {
    pub client: Option<String>,
    pub pid: u32,
    pub ppid: u32,
    pub cwd: Option<String>,
}

/// The endpoint to dial: `endpoint.json`'s `socket` when the file names a live pid, else the
/// default path. A stale endpoint file (dead pid) means the app is not running.
pub fn endpoint(paths: &KimoPaths) -> Result<String, ConnectError> {
    match read_endpoint(paths) {
        Some(e) if !pid_alive(e.pid) => Err(ConnectError::NotRunning(
            "endpoint.json names a dead pid".into(),
        )),
        Some(e) if !e.socket.is_empty() => Ok(e.socket),
        _ => Ok(paths.endpoint_name()),
    }
}

fn hello_line(paths: &KimoPaths, input: &HelloInput) -> Result<String, ConnectError> {
    let token = std::fs::read_to_string(paths.token())
        .map_err(|e| ConnectError::NotRunning(format!("no token file: {e}")))?;
    let params = HelloParams {
        protocol: SOCKET_PROTOCOL.into(),
        token: token.trim().to_string(),
        relay: RelayInfo {
            name: "kimo-mcp".into(),
            version: env!("CARGO_PKG_VERSION").into(),
        },
        client: input.client.clone(),
        pid: input.pid,
        ppid: input.ppid,
        cwd: input.cwd.clone(),
    };
    Ok(request(
        &json!("hello"),
        HELLO_METHOD,
        serde_json::to_value(params).unwrap_or(Value::Null),
    ))
}

fn parse_hello_reply(line: Option<String>) -> Result<HelloResult, ConnectError> {
    let line = line.ok_or_else(|| ConnectError::NotRunning("closed during hello".into()))?;
    let v: Value =
        serde_json::from_str(&line).map_err(|e| ConnectError::Other(format!("bad hello: {e}")))?;
    if let Some(err) = v.get("error") {
        let err: RpcError = serde_json::from_value(err.clone())
            .unwrap_or_else(|_| RpcError::new(0, "hello failed"));
        return Err(match err.code {
            codes::PROTOCOL_MISMATCH => ConnectError::ProtocolMismatch(
                err.data
                    .as_ref()
                    .and_then(|d| d["supported"].as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|s| s.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
            ),
            codes::UNAUTHORIZED => ConnectError::Unauthorized,
            codes::HOST_UNAVAILABLE => ConnectError::HostUnavailable(err.message),
            _ => ConnectError::Other(format!("hello failed: {} {}", err.code, err.message)),
        });
    }
    serde_json::from_value(v["result"].clone())
        .map_err(|e| ConnectError::Other(format!("bad hello result: {e}")))
}

/// Connects, performs the handshake and starts the reader thread for connection `gen`.
pub fn connect(
    paths: &KimoPaths,
    input: &HelloInput,
    events: Sender<Event>,
    gen: u64,
) -> Result<Conn, ConnectError> {
    let name = endpoint(paths)?;
    let hello = hello_line(paths, input)?;
    imp::connect(&name, &hello, events, gen)
}

#[cfg(unix)]
mod imp {
    use super::*;
    use crate::protocol::{read_frame, FrameError};
    use std::io::BufReader;
    use std::net::Shutdown;
    use std::os::unix::net::UnixStream;
    use std::sync::mpsc::{channel, Receiver};
    use std::time::Duration;

    /// How long dropping a connection waits for queued lines (the closing `kimo/bye`) to go out.
    const DRAIN_MS: u64 = 500;

    /// Queues lines for the writer thread. The queue is unbounded, like the Windows pipe
    /// writer's: agent hosts wait for answers, so it stays short.
    struct SockWriter {
        lines: Option<Sender<Vec<u8>>>,
        /// Disconnects when the writer thread ends.
        done: Receiver<()>,
        stream: UnixStream,
    }

    impl Write for SockWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.lines
                .as_ref()
                .and_then(|tx| tx.send(buf.to_vec()).ok())
                .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::BrokenPipe))?;
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Drop for SockWriter {
        /// Lets queued lines drain for a moment, then closes the socket, which also ends a
        /// write stuck on an app that stopped reading.
        fn drop(&mut self) {
            drop(self.lines.take());
            let _ = self.done.recv_timeout(Duration::from_millis(DRAIN_MS));
            let _ = self.stream.shutdown(Shutdown::Both);
        }
    }

    fn spawn_writer(
        stream: UnixStream,
        events: Sender<Event>,
        gen: u64,
    ) -> std::io::Result<SockWriter> {
        let mut out = stream.try_clone()?;
        let (lines, rx) = channel::<Vec<u8>>();
        let (done_tx, done) = channel::<()>();
        std::thread::spawn(move || {
            let _done = done_tx;
            for bytes in rx {
                if out.write_all(&bytes).is_err() {
                    let _ = out.shutdown(Shutdown::Both);
                    let _ = events.send(Event::SocketClosed(gen));
                    return;
                }
            }
        });
        Ok(SockWriter {
            lines: Some(lines),
            done,
            stream,
        })
    }

    pub fn connect(
        name: &str,
        hello: &str,
        events: Sender<Event>,
        gen: u64,
    ) -> Result<Conn, ConnectError> {
        let mut stream =
            UnixStream::connect(name).map_err(|e| ConnectError::NotRunning(e.to_string()))?;
        stream
            .set_read_timeout(Some(Duration::from_millis(HELLO_TIMEOUT_MS)))
            .map_err(|e| ConnectError::Other(e.to_string()))?;
        let mut reader = BufReader::new(
            stream
                .try_clone()
                .map_err(|e| ConnectError::Other(e.to_string()))?,
        );
        stream
            .write_all(format!("{hello}\n").as_bytes())
            .map_err(|e| ConnectError::NotRunning(e.to_string()))?;
        let first = match read_frame(&mut reader, MAX_FRAME_BYTES) {
            Ok(l) => l,
            Err(FrameError::Io(e)) => return Err(ConnectError::NotRunning(e.to_string())),
            Err(e) => return Err(ConnectError::Other(e.to_string())),
        };
        let result = parse_hello_reply(first)?;
        let _ = reader.get_ref().set_read_timeout(None);
        let writer = spawn_writer(stream, events.clone(), gen)
            .map_err(|e| ConnectError::Other(e.to_string()))?;
        std::thread::spawn(move || {
            while let Ok(Some(line)) = read_frame(&mut reader, MAX_FRAME_BYTES) {
                if events.send(Event::Socket(gen, line)).is_err() {
                    return;
                }
            }
            let _ = events.send(Event::SocketClosed(gen));
        });
        Ok(Conn {
            writer: Box::new(writer),
            hello: result,
        })
    }
}

#[cfg(windows)]
mod imp {
    //! Named pipe client on a tiny current-thread tokio runtime: a synchronous pipe handle
    //! serializes a blocking read against writes, so reads and writes run as async tasks.
    use super::*;
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::ClientOptions;
    use tokio::sync::mpsc;

    struct PipeWriter(mpsc::UnboundedSender<Vec<u8>>);

    impl Write for PipeWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0
                .send(buf.to_vec())
                .map_err(|_| std::io::Error::from(std::io::ErrorKind::BrokenPipe))?;
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    async fn read_line<R: tokio::io::AsyncBufRead + Unpin>(
        r: &mut R,
    ) -> std::io::Result<Option<String>> {
        let mut buf = Vec::new();
        loop {
            let chunk = r.fill_buf().await?;
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
            if buf.len() > MAX_FRAME_BYTES {
                return Err(std::io::Error::other("frame too large"));
            }
            if done {
                if buf.last() == Some(&b'\r') {
                    buf.pop();
                }
                if buf.iter().all(|b| b.is_ascii_whitespace()) {
                    buf.clear();
                    continue;
                }
                return String::from_utf8(buf)
                    .map(Some)
                    .map_err(|_| std::io::Error::other("not utf-8"));
            }
        }
    }

    pub fn connect(
        name: &str,
        hello: &str,
        events: Sender<Event>,
        gen: u64,
    ) -> Result<Conn, ConnectError> {
        let (tx_out, mut rx_out) = mpsc::unbounded_channel::<Vec<u8>>();
        let (tx_hs, rx_hs) = std::sync::mpsc::sync_channel::<Result<HelloResult, ConnectError>>(1);
        let name = name.to_string();
        let hello = format!("{hello}\n");
        std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    let _ = tx_hs.send(Err(ConnectError::Other(e.to_string())));
                    return;
                }
            };
            rt.block_on(async move {
                let client = match ClientOptions::new().open(&name) {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = tx_hs.send(Err(ConnectError::NotRunning(e.to_string())));
                        return;
                    }
                };
                let (r, mut w) = tokio::io::split(client);
                let mut r = BufReader::new(r);
                if let Err(e) = w.write_all(hello.as_bytes()).await {
                    let _ = tx_hs.send(Err(ConnectError::NotRunning(e.to_string())));
                    return;
                }
                let first = tokio::time::timeout(
                    Duration::from_millis(HELLO_TIMEOUT_MS),
                    read_line(&mut r),
                )
                .await;
                let first = match first {
                    Ok(Ok(l)) => l,
                    Ok(Err(e)) => {
                        let _ = tx_hs.send(Err(ConnectError::NotRunning(e.to_string())));
                        return;
                    }
                    Err(_) => {
                        let _ = tx_hs.send(Err(ConnectError::NotRunning("hello timed out".into())));
                        return;
                    }
                };
                let ok = parse_hello_reply(first);
                let failed = ok.is_err();
                let _ = tx_hs.send(ok);
                if failed {
                    return;
                }
                let writer = async move {
                    while let Some(bytes) = rx_out.recv().await {
                        if w.write_all(&bytes).await.is_err() {
                            break;
                        }
                    }
                };
                let reader = async {
                    while let Ok(Some(line)) = read_line(&mut r).await {
                        if events.send(Event::Socket(gen, line)).is_err() {
                            return;
                        }
                    }
                };
                tokio::select! {
                    _ = writer => {}
                    _ = reader => {}
                }
                let _ = events.send(Event::SocketClosed(gen));
            });
        });
        let hello = rx_hs
            .recv()
            .map_err(|_| ConnectError::Other("pipe thread ended".into()))??;
        Ok(Conn {
            writer: Box::new(PipeWriter(tx_out)),
            hello,
        })
    }
}
