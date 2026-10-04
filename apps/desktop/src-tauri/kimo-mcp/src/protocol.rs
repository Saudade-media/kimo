//! `kimo-socket/1` (docs/spec/socket.md, `packages/mcp-server/src/protocol.ts`): constants,
//! the hello handshake types, JSON-RPC helpers and newline-delimited framing. Shared by the
//! shim and the desktop app so both sides speak the same bytes.

use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead};

pub const SOCKET_PROTOCOL: &str = "kimo-socket/1";
/// Majors the app accepts (newest first), reported in PROTOCOL_MISMATCH.data.supported.
pub const SUPPORTED_SOCKET_PROTOCOLS: &[&str] = &[SOCKET_PROTOCOL];

/// 32 MiB per line.
pub const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;
pub const HEARTBEAT_MS: u64 = 10_000;
pub const HEARTBEAT_MISSES: u32 = 3;
pub const HELLO_TIMEOUT_MS: u64 = 5_000;
/// The relay keeps reconnecting this long after the app went away.
pub const RECONNECT_WINDOW_MS: u64 = 30_000;
/// The app queues MCP messages this long while the document host is starting.
pub const HOST_QUEUE_MS: u64 = 15_000;
/// The relay polls its parent pid this often.
pub const PARENT_POLL_MS: u64 = 2_000;
/// `--launch` waits this long for the app before answering.
pub const LAUNCH_WAIT_MS: u64 = 15_000;

pub const HELLO_METHOD: &str = "kimo/hello";
pub const PING_METHOD: &str = "kimo/ping";
pub const BYE_METHOD: &str = "kimo/bye";
pub const HOST_RESTARTING_METHOD: &str = "kimo/hostRestarting";
pub const CONTROL_PREFIX: &str = "kimo/";

/// JSON-RPC error codes on the socket (`SOCKET_ERRORS`, `RELAY_UNAVAILABLE`).
pub mod codes {
    pub const PROTOCOL_MISMATCH: i64 = -32001;
    pub const UNAUTHORIZED: i64 = -32002;
    pub const HOST_UNAVAILABLE: i64 = -32003;
    pub const HANDSHAKE_REQUIRED: i64 = -32004;
    pub const FRAME_TOO_LARGE: i64 = -32005;
    /// A relay could not deliver an agent-host request; `data.kimoCode` says why.
    pub const RELAY_UNAVAILABLE: i64 = -32010;
    pub const PARSE_ERROR: i64 = -32700;
    pub const METHOD_NOT_FOUND: i64 = -32601;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RelayInfo {
    pub name: String,
    pub version: String,
}

/// `kimo/hello` params (relay → app).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloParams {
    pub protocol: String,
    pub token: String,
    pub relay: RelayInfo,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client: Option<String>,
    pub pid: u32,
    pub ppid: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub pid: u32,
}

/// `kimo/hello` result (app → relay).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloResult {
    pub protocol: String,
    pub app: AppInfo,
    pub connection_id: String,
    pub heartbeat_ms: u64,
    /// `ready` or `starting` (MCP requests are queued ≤ 15 s).
    pub document_host: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }
    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }
}

/// Mirrors `checkHello`: protocol first, then the token (constant time).
pub fn check_hello(params: Option<&Value>, expected_token: &str) -> Result<HelloParams, RpcError> {
    let Some(p) = params.filter(|p| p.is_object()) else {
        return Err(RpcError::new(
            codes::HANDSHAKE_REQUIRED,
            "hello params missing",
        ));
    };
    let protocol = p.get("protocol").and_then(Value::as_str);
    if !protocol.is_some_and(|v| SUPPORTED_SOCKET_PROTOCOLS.contains(&v)) {
        return Err(RpcError::new(
            codes::PROTOCOL_MISMATCH,
            format!("unsupported protocol {}", protocol.unwrap_or("undefined")),
        )
        .with_data(json!({ "supported": SUPPORTED_SOCKET_PROTOCOLS })));
    }
    let token = p.get("token").and_then(Value::as_str).unwrap_or("");
    if expected_token.is_empty() || !constant_time_eq(token.as_bytes(), expected_token.as_bytes()) {
        return Err(RpcError::new(codes::UNAUTHORIZED, "bad token"));
    }
    serde_json::from_value::<HelloParams>(p.clone())
        .map_err(|e| RpcError::new(codes::HANDSHAKE_REQUIRED, format!("bad hello params: {e}")))
}

pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

// --- JSON-RPC helpers ---------------------------------------------------------------------------

pub fn request(id: &Value, method: &str, params: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string()
}

pub fn notification(method: &str) -> String {
    json!({ "jsonrpc": "2.0", "method": method }).to_string()
}

pub fn result_response(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

pub fn error_response(id: &Value, err: &RpcError) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": err }).to_string()
}

/// The −32010 error a relay returns for a request it could not deliver.
pub fn relay_error(kimo_code: &str, message: &str, suggestion: &str) -> RpcError {
    RpcError::new(codes::RELAY_UNAVAILABLE, message).with_data(json!({
        "kimoCode": kimo_code,
        "retryable": kimo_code != "PROTOCOL_MISMATCH",
        "suggestion": suggestion,
    }))
}

/// What a relay needs to know about a line without materializing it: the method (control or
/// MCP), the id, and whether it is a response. Parsing still validates the whole line as JSON.
#[derive(Debug, Default, Deserialize)]
pub struct Peek {
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub id: Option<Value>,
    #[serde(default)]
    result: Option<IgnoredAny>,
    #[serde(default)]
    error: Option<IgnoredAny>,
}

impl Peek {
    pub fn parse(line: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(line)
    }
    pub fn is_request(&self) -> bool {
        self.method.is_some() && self.id.as_ref().is_some_and(|i| !i.is_null())
    }
    pub fn is_notification(&self) -> bool {
        self.method.is_some() && !matches!(&self.id, Some(i) if !i.is_null())
    }
    pub fn is_response(&self) -> bool {
        self.method.is_none() && (self.result.is_some() || self.error.is_some())
    }
    pub fn is_control(&self) -> bool {
        self.method
            .as_deref()
            .is_some_and(|m| m.starts_with(CONTROL_PREFIX))
    }
    /// Stable map key for the id (`"7"` and `7` differ, as in JSON-RPC).
    pub fn id_key(&self) -> Option<String> {
        self.id.as_ref().filter(|i| !i.is_null()).map(id_key)
    }
}

pub fn id_key(id: &Value) -> String {
    id.to_string()
}

// --- Framing -----------------------------------------------------------------------------------

#[derive(Debug)]
pub enum FrameError {
    /// A line longer than the limit: answer −32005 and close.
    TooLarge,
    /// The line is not UTF-8: close.
    NotUtf8,
    Io(io::Error),
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrameError::TooLarge => write!(f, "frame too large"),
            FrameError::NotUtf8 => write!(f, "frame is not UTF-8"),
            FrameError::Io(e) => write!(f, "{e}"),
        }
    }
}

/// Reads one newline-terminated frame (blocking), without the `\n` / `\r\n`. Blank lines are
/// skipped. `Ok(None)` at EOF (a trailing unterminated fragment is dropped). Never buffers more
/// than `max` bytes of one line.
pub fn read_frame<R: BufRead>(r: &mut R, max: usize) -> Result<Option<String>, FrameError> {
    let mut buf: Vec<u8> = Vec::new();
    loop {
        let (done, used) = {
            let chunk = match r.fill_buf() {
                Ok(c) => c,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(FrameError::Io(e)),
            };
            if chunk.is_empty() {
                return Ok(None);
            }
            match chunk.iter().position(|b| *b == b'\n') {
                Some(i) => {
                    buf.extend_from_slice(&chunk[..i]);
                    (true, i + 1)
                }
                None => {
                    buf.extend_from_slice(chunk);
                    (false, chunk.len())
                }
            }
        };
        r.consume(used);
        if buf.len() > max {
            return Err(FrameError::TooLarge);
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
                .map_err(|_| FrameError::NotUtf8);
        }
    }
}

/// True when a line can be sent as one frame (no raw newline, within the limit).
pub fn is_single_frame(line: &str) -> bool {
    line.len() < MAX_FRAME_BYTES && !line.contains('\n')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn frames_split_on_newlines() {
        let mut r = Cursor::new(b"{\"a\":1}\r\n\n  \n{\"b\":2}\npartial".to_vec());
        assert_eq!(
            read_frame(&mut r, 100).unwrap().as_deref(),
            Some("{\"a\":1}")
        );
        assert_eq!(
            read_frame(&mut r, 100).unwrap().as_deref(),
            Some("{\"b\":2}")
        );
        assert!(read_frame(&mut r, 100).unwrap().is_none());
    }

    #[test]
    fn frames_over_the_limit_fail() {
        let mut big = vec![b'x'; 64];
        big.push(b'\n');
        let mut r = std::io::BufReader::with_capacity(8, Cursor::new(big));
        assert!(matches!(read_frame(&mut r, 32), Err(FrameError::TooLarge)));
        let mut ok = vec![b'y'; 32];
        ok.push(b'\n');
        let mut r = std::io::BufReader::with_capacity(8, Cursor::new(ok));
        assert_eq!(read_frame(&mut r, 32).unwrap().unwrap().len(), 32);
    }

    #[test]
    fn non_utf8_is_an_error() {
        let mut r = Cursor::new(vec![0xff, 0xfe, b'\n']);
        assert!(matches!(read_frame(&mut r, 32), Err(FrameError::NotUtf8)));
    }

    #[test]
    fn hello_checks_protocol_then_token() {
        let good = json!({"protocol":"kimo-socket/1","token":"t0k","relay":{"name":"kimo-mcp","version":"0"},"pid":1,"ppid":2});
        assert_eq!(check_hello(Some(&good), "t0k").unwrap().ppid, 2);
        let e = check_hello(Some(&good), "other").unwrap_err();
        assert_eq!(e.code, codes::UNAUTHORIZED);
        let v2 = json!({"protocol":"kimo-socket/2","token":"t0k"});
        let e = check_hello(Some(&v2), "t0k").unwrap_err();
        assert_eq!(e.code, codes::PROTOCOL_MISMATCH);
        assert_eq!(e.data.unwrap()["supported"], json!(["kimo-socket/1"]));
        assert_eq!(
            check_hello(None, "t0k").unwrap_err().code,
            codes::HANDSHAKE_REQUIRED
        );
        // An empty expected token never authenticates.
        let empty = json!({"protocol":"kimo-socket/1","token":""});
        assert_eq!(
            check_hello(Some(&empty), "").unwrap_err().code,
            codes::UNAUTHORIZED
        );
    }

    #[test]
    fn peek_classifies_messages() {
        let r =
            Peek::parse(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{}}"#).unwrap();
        assert!(r.is_request() && !r.is_response() && !r.is_control());
        assert_eq!(r.id_key().unwrap(), "3");
        let n = Peek::parse(r#"{"jsonrpc":"2.0","method":"kimo/bye"}"#).unwrap();
        assert!(n.is_notification() && n.is_control());
        let s = Peek::parse(r#"{"jsonrpc":"2.0","id":"3","result":{"big":[1,2,3]}}"#).unwrap();
        assert!(s.is_response());
        assert_eq!(s.id_key().unwrap(), "\"3\"");
        let e =
            Peek::parse(r#"{"jsonrpc":"2.0","id":null,"error":{"code":1,"message":"x"}}"#).unwrap();
        assert!(e.is_response() && e.id_key().is_none());
        assert!(Peek::parse("not json").is_err());
    }
}
