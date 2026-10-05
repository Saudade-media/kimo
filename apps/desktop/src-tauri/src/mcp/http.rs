//! Streamable HTTP (socket.md §8): `http://127.0.0.1:<port>/mcp`, loopback only, a per-host
//! bearer from `~/.kimo/mcp/http-tokens.json`, `Host` checked, browser `Origin`s rejected. Each
//! request goes to the document host whole (`kimo://mcp-http-request`, with `x-kimo-client`
//! naming the token's host and `authorization` removed) and the response streams back through
//! `kimo_mcp_http_respond`.

use super::hub::{Hub, HubError};
use base64::Engine;
use bytes::Bytes;
use http_body_util::{BodyExt, Limited};
use hyper::body::{Body, Frame, Incoming};
use hyper::{Request, Response, StatusCode};
use kimo_mcp::protocol::{constant_time_eq, MAX_FRAME_BYTES};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::{Arc, RwLock};
use std::task::{Context, Poll};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};

pub const HTTP_PATH: &str = "/mcp";

/// Per-host bearer tokens (`client → token`), shared with the rotate command.
pub type Tokens = Arc<RwLock<BTreeMap<String, String>>>;

/// A running listener; dropping `stop` (or sending `true`) shuts it down, open streams included.
pub struct HttpHandle {
    pub port: u16,
    stop: watch::Sender<bool>,
}

impl HttpHandle {
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }
}

/// Binds `127.0.0.1:<port>`, falling back to an ephemeral port when it is taken.
pub async fn start(hub: Arc<Hub>, tokens: Tokens, port: u16) -> std::io::Result<HttpHandle> {
    let listener = match TcpListener::bind(("127.0.0.1", port)).await {
        Ok(l) => l,
        Err(_) if port != 0 => TcpListener::bind(("127.0.0.1", 0)).await?,
        Err(e) => return Err(e),
    };
    let port = listener.local_addr()?.port();
    let (stop, stop_rx) = watch::channel(false);
    tokio::spawn(accept_loop(listener, hub, tokens, port, stop_rx));
    Ok(HttpHandle { port, stop })
}

async fn accept_loop(
    listener: TcpListener,
    hub: Arc<Hub>,
    tokens: Tokens,
    port: u16,
    mut stop: watch::Receiver<bool>,
) {
    loop {
        let accepted = tokio::select! {
            a = listener.accept() => a,
            _ = stop.changed() => return,
        };
        let Ok((stream, peer)) = accepted else {
            continue;
        };
        if !peer.ip().is_loopback() {
            continue;
        }
        let (hub, tokens, mut stop) = (hub.clone(), tokens.clone(), stop.clone());
        tokio::spawn(async move {
            let svc = hyper::service::service_fn(move |req| {
                handle(hub.clone(), tokens.clone(), port, peer, req)
            });
            let conn = hyper::server::conn::http1::Builder::new()
                .serve_connection(hyper_util::rt::TokioIo::new(stream), svc);
            tokio::select! {
                _ = conn => {}
                _ = stop.changed() => {}
            }
        });
    }
}

/// Response body: fixed bytes, or the host's chunks as they arrive.
pub enum OutBody {
    Full(Option<Bytes>),
    Stream(mpsc::Receiver<Bytes>),
}

impl Body for OutBody {
    type Data = Bytes;
    type Error = Infallible;
    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, Infallible>>> {
        match self.get_mut() {
            OutBody::Full(b) => Poll::Ready(b.take().map(|b| Ok(Frame::data(b)))),
            OutBody::Stream(rx) => rx.poll_recv(cx).map(|o| o.map(|b| Ok(Frame::data(b)))),
        }
    }
}

fn plain(status: StatusCode, body: Value) -> Response<OutBody> {
    let mut r = Response::new(OutBody::Full(Some(Bytes::from(body.to_string()))));
    *r.status_mut() = status;
    r.headers_mut().insert(
        hyper::header::CONTENT_TYPE,
        hyper::header::HeaderValue::from_static("application/json"),
    );
    r
}

fn rpc_error(status: StatusCode, code: i64, message: &str) -> Response<OutBody> {
    plain(
        status,
        json!({ "jsonrpc": "2.0", "id": null, "error": { "code": code, "message": message } }),
    )
}

/// `Host` must name the loopback listener.
pub fn host_allowed(host: Option<&str>, port: u16) -> bool {
    let Some(h) = host else { return false };
    let h = h.trim().to_ascii_lowercase();
    ["127.0.0.1", "localhost"]
        .iter()
        .any(|name| h == *name || h == format!("{name}:{port}"))
}

/// The client whose token matches the bearer (constant-time per entry).
pub fn client_for(tokens: &BTreeMap<String, String>, auth: Option<&str>) -> Option<String> {
    let bearer = auth?.strip_prefix("Bearer ")?.trim();
    if bearer.is_empty() {
        return None;
    }
    let mut found = None;
    for (client, token) in tokens {
        if constant_time_eq(token.as_bytes(), bearer.as_bytes()) {
            found = Some(client.clone());
        }
    }
    found
}

const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "proxy-connection",
    "te",
    "trailer",
];

async fn handle(
    hub: Arc<Hub>,
    tokens: Tokens,
    port: u16,
    _peer: SocketAddr,
    req: Request<Incoming>,
) -> Result<Response<OutBody>, Infallible> {
    if req.uri().path() != HTTP_PATH {
        return Ok(rpc_error(StatusCode::NOT_FOUND, -32601, "Not found"));
    }
    let headers = req.headers();
    let header = |n: &str| headers.get(n).and_then(|v| v.to_str().ok());
    if !host_allowed(header("host"), port) {
        return Ok(rpc_error(StatusCode::FORBIDDEN, -32600, "Bad Host header"));
    }
    if headers.contains_key(hyper::header::ORIGIN) {
        return Ok(rpc_error(
            StatusCode::FORBIDDEN,
            -32600,
            "Browser origins are not allowed",
        ));
    }
    let client = {
        let t = tokens.read().unwrap_or_else(|p| p.into_inner());
        client_for(&t, header("authorization"))
    };
    let Some(client) = client else {
        let mut r = rpc_error(
            StatusCode::UNAUTHORIZED,
            -32002,
            "Missing or bad bearer token",
        );
        r.headers_mut().insert(
            hyper::header::WWW_AUTHENTICATE,
            hyper::header::HeaderValue::from_static("Bearer realm=\"kimo\""),
        );
        return Ok(r);
    };
    let mut fwd = Map::new();
    for (k, v) in headers {
        let name = k.as_str().to_ascii_lowercase();
        if name == "authorization" || name.starts_with("x-kimo-") {
            continue;
        }
        if let Ok(v) = v.to_str() {
            fwd.insert(name, json!(v));
        }
    }
    fwd.insert("x-kimo-client".into(), json!(client));
    let method = req.method().to_string();
    let url = format!(
        "http://127.0.0.1:{port}{}",
        req.uri()
            .path_and_query()
            .map(|p| p.as_str())
            .unwrap_or(HTTP_PATH)
    );
    let body = match Limited::new(req.into_body(), MAX_FRAME_BYTES)
        .collect()
        .await
    {
        Ok(b) => b.to_bytes(),
        Err(_) => {
            return Ok(rpc_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                -32005,
                "Request body too large",
            ))
        }
    };
    // Board 32: a tools/call animates the macOS Dock tile until the host answers.
    let _busy = crate::dock_activity::is_tools_call(&body).then(|| {
        crate::dock_activity::McpCallGuard::new(
            &format!("http:{client}"),
            &uuid::Uuid::new_v4().to_string(),
        )
    });
    let request = json!({
        "requestId": "",
        "method": method,
        "url": url,
        "headers": fwd,
        "bodyBase64": base64::engine::general_purpose::STANDARD.encode(&body),
    });
    match hub.http_forward(request).await {
        Ok((head, rx)) => {
            let mut r = Response::new(OutBody::Stream(rx));
            *r.status_mut() = StatusCode::from_u16(head.status).unwrap_or(StatusCode::OK);
            for (k, v) in head.headers {
                let name = k.to_ascii_lowercase();
                if HOP_BY_HOP.contains(&name.as_str()) {
                    continue;
                }
                if let (Ok(n), Ok(v)) = (
                    hyper::header::HeaderName::from_bytes(name.as_bytes()),
                    hyper::header::HeaderValue::from_str(&v),
                ) {
                    r.headers_mut().append(n, v);
                }
            }
            Ok(r)
        }
        Err(HubError::Unavailable(m)) => Ok(rpc_error(StatusCode::SERVICE_UNAVAILABLE, -32003, &m)),
        Err(e) => Ok(rpc_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            -32603,
            &format!("{e:?}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_header_rules() {
        assert!(host_allowed(Some("127.0.0.1:47820"), 47820));
        assert!(host_allowed(Some("localhost:47820"), 47820));
        assert!(host_allowed(Some("localhost"), 47820));
        assert!(!host_allowed(Some("127.0.0.1:1"), 47820));
        assert!(!host_allowed(Some("evil.com"), 47820));
        assert!(!host_allowed(None, 47820));
    }

    #[test]
    fn bearer_maps_to_client() {
        let mut t = BTreeMap::new();
        t.insert("codex".to_string(), "abc".to_string());
        t.insert("cursor".to_string(), "xyz".to_string());
        assert_eq!(
            client_for(&t, Some("Bearer xyz")).as_deref(),
            Some("cursor")
        );
        assert_eq!(client_for(&t, Some("Bearer nope")), None);
        assert_eq!(client_for(&t, Some("Basic abc")), None);
        assert_eq!(client_for(&t, Some("Bearer ")), None);
        assert_eq!(client_for(&t, None), None);
    }
}
