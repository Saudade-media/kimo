//! Cloud routes of the relay (`kimo-relay://bedrock|vertex|foundry/…`, ADR 0014 §4): the agent
//! speaks the Anthropic Messages wire to these URLs and Rust maps each call onto the platform's
//! endpoint with its own credentials:
//!
//! - **Bedrock**: AWS SigV4 (keychain JSON `{accessKeyId, secretAccessKey, sessionToken?}`, the
//!   `AWS_*` env vars or `~/.aws/credentials`) or a Bedrock API key (a non-JSON keychain value,
//!   or `AWS_BEARER_TOKEN_BEDROCK`) → `invoke[-with-response-stream]`; the AWS event stream is
//!   re-encoded as Anthropic SSE so the SDK parses it unchanged.
//! - **Vertex**: Google ADC (keychain JSON, `GOOGLE_APPLICATION_CREDENTIALS`, or gcloud's
//!   `application_default_credentials.json`; `authorized_user` and `service_account` types) →
//!   `rawPredict` / `streamRawPredict` (already SSE).
//! - **Foundry**: `https://<resource>.services.ai.azure.com/anthropic/…` with the keychain API
//!   key. Entra ID tokens are not implemented (UNSUPPORTED with a clear message).
//!
//! Only `POST /v1/messages` is mapped; other paths answer an Anthropic-shaped 404.

use super::secrets::Secret;
use crate::error::{invalid, PlatformErrorPayload, R};
use ring::{hmac, rand, signature};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const PLATFORMS: &[&str] = &["bedrock", "vertex", "foundry"];

pub fn unsupported(message: impl Into<String>) -> PlatformErrorPayload {
    PlatformErrorPayload::new("UNSUPPORTED", message)
}

// --- Shared ---------------------------------------------------------------------------------------

/// `kimo-relay://<platform>/<path>?<query>` split into parts.
#[derive(Debug, PartialEq)]
pub struct RelayUrl {
    pub platform: String,
    pub path: String,
    pub query: Option<String>,
}

pub fn parse_relay_url(url: &str) -> R<RelayUrl> {
    let rest = url
        .strip_prefix("kimo-relay://")
        .ok_or_else(|| invalid("Not a kimo-relay URL"))?;
    let (host, tail) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    if !PLATFORMS.contains(&host) {
        return Err(crate::error::permission(format!(
            "Unknown relay route kimo-relay://{host}"
        )));
    }
    let (path, query) = match tail.split_once('?') {
        Some((p, q)) => (p.to_string(), Some(q.to_string())),
        None => (tail.to_string(), None),
    };
    if path.contains("..") {
        return Err(invalid("Bad relay path"));
    }
    Ok(RelayUrl {
        platform: host.into(),
        path,
        query,
    })
}

/// An Anthropic-shaped error body for routes the platform does not serve.
pub fn anthropic_error_body(kind: &str, message: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({"type": "error", "error": {"type": kind, "message": message}}))
        .unwrap_or_default()
}

/// A request ready to send: final URL, headers (incl. auth) and body.
pub struct Prepared {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// Re-encode the AWS event stream as SSE.
    pub bedrock_stream: bool,
}

/// Splits an Anthropic Messages body into (model, stream, rest-of-body).
fn split_body(body: &[u8]) -> R<(String, bool, serde_json::Map<String, Value>)> {
    let v: Value =
        serde_json::from_slice(body).map_err(|e| invalid(format!("Body is not JSON: {e}")))?;
    let Value::Object(mut m) = v else {
        return Err(invalid("Body is not a JSON object"));
    };
    let model = m
        .remove("model")
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid("Body has no model"))?;
    let stream = m.get("stream").and_then(Value::as_bool).unwrap_or(false);
    Ok((model, stream, m))
}

/// RFC 3986 encoding (unreserved kept), as SigV4 requires.
pub fn uri_encode(s: &str, encode_slash: bool) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        let keep = b.is_ascii_alphanumeric()
            || matches!(b, b'-' | b'_' | b'.' | b'~')
            || (b == b'/' && !encode_slash);
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn sha256_hex(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

fn home() -> Option<PathBuf> {
    kimo_mcp::paths::home_dir()
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

/// `[section]` → key = value pairs of an INI file (AWS config/credentials).
fn ini_section(text: &str, section: &str) -> Option<std::collections::HashMap<String, String>> {
    let mut cur: Option<String> = None;
    let mut out = std::collections::HashMap::new();
    let mut found = false;
    for line in text.lines() {
        let l = line.trim();
        if l.is_empty() || l.starts_with('#') || l.starts_with(';') {
            continue;
        }
        if let Some(name) = l.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
            cur = Some(name.trim().to_string());
            if cur.as_deref() == Some(section) {
                found = true;
            }
            continue;
        }
        if cur.as_deref() == Some(section) {
            if let Some((k, v)) = l.split_once('=') {
                out.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    found.then_some(out)
}

// --- Bedrock: SigV4 --------------------------------------------------------------------------------

#[derive(Clone)]
pub struct AwsCreds {
    pub access_key: String,
    pub secret_key: Secret,
    pub session_token: Option<Secret>,
}

pub enum BedrockAuth {
    SigV4(AwsCreds),
    /// Bedrock API key (`Authorization: Bearer`).
    Bearer(Secret),
}

/// Credentials in precedence order: keychain value, env, `~/.aws/credentials`.
pub fn bedrock_auth(keychain: Option<&Secret>) -> R<BedrockAuth> {
    if let Some(s) = keychain {
        let v = s.expose().trim();
        if v.starts_with('{') {
            let j: Value = serde_json::from_str(v)
                .map_err(|_| invalid("The saved Bedrock credentials are not valid JSON"))?;
            let get = |k: &str| j.get(k).and_then(Value::as_str).map(String::from);
            let (Some(a), Some(sk)) = (get("accessKeyId"), get("secretAccessKey")) else {
                return Err(invalid(
                    "Bedrock credentials need accessKeyId and secretAccessKey",
                ));
            };
            return Ok(BedrockAuth::SigV4(AwsCreds {
                access_key: a,
                secret_key: Secret::new(sk),
                session_token: get("sessionToken").map(Secret::new),
            }));
        }
        return Ok(BedrockAuth::Bearer(Secret::new(v)));
    }
    if let Some(t) = env_nonempty("AWS_BEARER_TOKEN_BEDROCK") {
        return Ok(BedrockAuth::Bearer(Secret::new(t)));
    }
    if let (Some(a), Some(s)) = (
        env_nonempty("AWS_ACCESS_KEY_ID"),
        env_nonempty("AWS_SECRET_ACCESS_KEY"),
    ) {
        return Ok(BedrockAuth::SigV4(AwsCreds {
            access_key: a,
            secret_key: Secret::new(s),
            session_token: env_nonempty("AWS_SESSION_TOKEN").map(Secret::new),
        }));
    }
    let profile = env_nonempty("AWS_PROFILE").unwrap_or_else(|| "default".into());
    let path = env_nonempty("AWS_SHARED_CREDENTIALS_FILE")
        .map(PathBuf::from)
        .or_else(|| home().map(|h| h.join(".aws").join("credentials")));
    if let Some(text) = path.and_then(|p| std::fs::read_to_string(p).ok()) {
        if let Some(sec) = ini_section(&text, &profile) {
            if let (Some(a), Some(s)) = (
                sec.get("aws_access_key_id"),
                sec.get("aws_secret_access_key"),
            ) {
                return Ok(BedrockAuth::SigV4(AwsCreds {
                    access_key: a.clone(),
                    secret_key: Secret::new(s.clone()),
                    session_token: sec.get("aws_session_token").cloned().map(Secret::new),
                }));
            }
            return Err(unsupported(format!(
                "AWS profile \"{profile}\" has no static keys (SSO, credential_process and role profiles are not supported by the relay yet); save an access key or a Bedrock API key in Settings"
            )));
        }
    }
    Err(unsupported(
        "No AWS credentials: save an access key or Bedrock API key in Settings, or set AWS_ACCESS_KEY_ID / AWS_PROFILE",
    ))
}

/// Region: request field, then `AWS_REGION`, `AWS_DEFAULT_REGION`, `~/.aws/config`.
pub fn bedrock_region(requested: Option<&str>) -> R<String> {
    let r = requested
        .map(String::from)
        .filter(|s| !s.is_empty())
        .or_else(|| env_nonempty("AWS_REGION"))
        .or_else(|| env_nonempty("AWS_DEFAULT_REGION"))
        .or_else(|| {
            let profile = env_nonempty("AWS_PROFILE").unwrap_or_else(|| "default".into());
            let sec = if profile == "default" {
                "default".to_string()
            } else {
                format!("profile {profile}")
            };
            let text = std::fs::read_to_string(home()?.join(".aws").join("config")).ok()?;
            ini_section(&text, &sec)?.get("region").cloned()
        })
        .ok_or_else(|| invalid("No AWS region: set it on the Bedrock provider or AWS_REGION"))?;
    check_label(&r, "region")?;
    Ok(r)
}

fn check_label(s: &str, what: &str) -> R<()> {
    if s.is_empty()
        || s.len() > 63
        || !s
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(invalid(format!("Invalid {what} \"{s}\"")));
    }
    Ok(())
}

fn hmac256(key: &[u8], data: &[u8]) -> Vec<u8> {
    hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, key), data)
        .as_ref()
        .to_vec()
}

/// SigV4 `Authorization` value. `headers`: lowercase names, values as sent (all are signed).
#[allow(clippy::too_many_arguments)]
pub fn sigv4_authorization(
    method: &str,
    canonical_uri: &str,
    canonical_query: &str,
    headers: &[(String, String)],
    payload: &[u8],
    creds: &AwsCreds,
    region: &str,
    service: &str,
    amz_date: &str,
) -> String {
    let mut hs: Vec<(String, String)> = headers
        .iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    hs.sort();
    let canonical_headers: String = hs.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let signed: Vec<&str> = hs.iter().map(|(k, _)| k.as_str()).collect();
    let signed = signed.join(";");
    let creq = format!(
        "{method}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed}\n{}",
        sha256_hex(payload)
    );
    let date = &amz_date[..8];
    let scope = format!("{date}/{region}/{service}/aws4_request");
    let sts = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        sha256_hex(creq.as_bytes())
    );
    let k = hmac256(
        format!("AWS4{}", creds.secret_key.expose()).as_bytes(),
        date.as_bytes(),
    );
    let k = hmac256(&k, region.as_bytes());
    let k = hmac256(&k, service.as_bytes());
    let k = hmac256(&k, b"aws4_request");
    let sig = hex::encode(hmac256(&k, sts.as_bytes()));
    format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed}, Signature={sig}",
        creds.access_key
    )
}

fn amz_now() -> String {
    let n = time::OffsetDateTime::now_utc();
    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        n.year(),
        u8::from(n.month()),
        n.day(),
        n.hour(),
        n.minute(),
        n.second()
    )
}

/// Bedrock `invoke` / `invoke-with-response-stream` for a Messages body.
pub fn prepare_bedrock(
    body: &[u8],
    beta_header: Option<&str>,
    auth: &BedrockAuth,
    region: &str,
) -> R<Prepared> {
    let (model, stream, mut rest) = split_body(body)?;
    rest.remove("stream");
    rest.entry("anthropic_version")
        .or_insert(json!("bedrock-2023-05-31"));
    if let Some(b) = beta_header {
        let betas: Vec<Value> = b
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| json!(s))
            .collect();
        if !betas.is_empty() {
            rest.insert("anthropic_beta".into(), Value::Array(betas));
        }
    }
    let payload = serde_json::to_vec(&Value::Object(rest)).unwrap_or_default();
    let host = format!("bedrock-runtime.{region}.amazonaws.com");
    let action = if stream {
        "invoke-with-response-stream"
    } else {
        "invoke"
    };
    let path = format!("/model/{}/{action}", uri_encode(&model, true));
    let mut headers = vec![
        ("content-type".to_string(), "application/json".to_string()),
        (
            "accept".to_string(),
            if stream {
                "application/vnd.amazon.eventstream".to_string()
            } else {
                "application/json".to_string()
            },
        ),
    ];
    match auth {
        BedrockAuth::Bearer(t) => {
            headers.push(("authorization".into(), format!("Bearer {}", t.expose())));
        }
        BedrockAuth::SigV4(c) => {
            let amz_date = amz_now();
            let mut signed = vec![
                ("content-type".to_string(), "application/json".to_string()),
                ("host".to_string(), host.clone()),
                ("x-amz-date".to_string(), amz_date.clone()),
            ];
            if let Some(t) = &c.session_token {
                signed.push(("x-amz-security-token".into(), t.expose().to_string()));
            }
            // Non-S3 services sign the doubly-encoded path.
            let canonical_uri = path
                .split('/')
                .map(|seg| uri_encode(seg, true))
                .collect::<Vec<_>>()
                .join("/");
            let authz = sigv4_authorization(
                "POST",
                &canonical_uri,
                "",
                &signed,
                &payload,
                c,
                region,
                "bedrock",
                &amz_date,
            );
            headers.push(("x-amz-date".into(), amz_date));
            if let Some(t) = &c.session_token {
                headers.push(("x-amz-security-token".into(), t.expose().to_string()));
            }
            headers.push(("authorization".into(), authz));
        }
    }
    Ok(Prepared {
        url: format!("https://{host}{path}"),
        headers,
        body: payload,
        bedrock_stream: stream,
    })
}

// --- AWS event stream → SSE --------------------------------------------------------------------------

fn crc32(data: &[u8]) -> u32 {
    let mut c: u32 = !0;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 {
                (c >> 1) ^ 0xEDB8_8320
            } else {
                c >> 1
            };
        }
    }
    !c
}

/// Incremental decoder of `application/vnd.amazon.eventstream` frames into Anthropic SSE.
#[derive(Default)]
pub struct EventStreamToSse {
    buf: Vec<u8>,
}

impl EventStreamToSse {
    /// Feeds bytes; returns SSE text for every complete frame. Err on a corrupt frame.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            if self.buf.len() < 12 {
                break;
            }
            let total = u32::from_be_bytes(self.buf[0..4].try_into().unwrap()) as usize;
            let hlen = u32::from_be_bytes(self.buf[4..8].try_into().unwrap()) as usize;
            let pcrc = u32::from_be_bytes(self.buf[8..12].try_into().unwrap());
            if crc32(&self.buf[0..8]) != pcrc {
                return Err("event stream prelude checksum mismatch".into());
            }
            if total < 16 + hlen || total > 16 * 1024 * 1024 {
                return Err("event stream frame length is invalid".into());
            }
            if self.buf.len() < total {
                break;
            }
            let frame: Vec<u8> = self.buf.drain(..total).collect();
            let mcrc = u32::from_be_bytes(frame[total - 4..].try_into().unwrap());
            if crc32(&frame[..total - 4]) != mcrc {
                return Err("event stream message checksum mismatch".into());
            }
            let headers = parse_es_headers(&frame[12..12 + hlen])?;
            let payload = &frame[12 + hlen..total - 4];
            out.extend(frame_to_sse(&headers, payload));
        }
        Ok(out)
    }
}

fn parse_es_headers(mut h: &[u8]) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    let bad = || "bad event stream header".to_string();
    while !h.is_empty() {
        let nlen = h[0] as usize;
        let name = std::str::from_utf8(h.get(1..1 + nlen).ok_or_else(bad)?)
            .map_err(|_| bad())?
            .to_string();
        h = &h[1 + nlen..];
        let ty = *h.first().ok_or_else(bad)?;
        h = &h[1..];
        let skip = |n: usize, h: &mut &[u8]| -> Result<(), String> {
            if h.len() < n {
                return Err(bad());
            }
            *h = &h[n..];
            Ok(())
        };
        match ty {
            0 | 1 => {}
            2 => skip(1, &mut h)?,
            3 => skip(2, &mut h)?,
            4 => skip(4, &mut h)?,
            5 | 8 => skip(8, &mut h)?,
            9 => skip(16, &mut h)?,
            6 | 7 => {
                if h.len() < 2 {
                    return Err(bad());
                }
                let l = u16::from_be_bytes([h[0], h[1]]) as usize;
                let v = h.get(2..2 + l).ok_or_else(bad)?;
                if ty == 7 {
                    out.push((name, String::from_utf8_lossy(v).into_owned()));
                }
                h = &h[2 + l..];
            }
            _ => return Err(bad()),
        }
    }
    Ok(out)
}

fn frame_to_sse(headers: &[(String, String)], payload: &[u8]) -> Vec<u8> {
    let get = |k: &str| {
        headers
            .iter()
            .find(|(n, _)| n == k)
            .map(|(_, v)| v.as_str())
    };
    let sse = |ty: &str, data: &str| format!("event: {ty}\ndata: {data}\n\n").into_bytes();
    match get(":message-type") {
        Some("event") => {
            if get(":event-type") != Some("chunk") {
                return Vec::new();
            }
            let Ok(v) = serde_json::from_slice::<Value>(payload) else {
                return Vec::new();
            };
            let Some(b64) = v.get("bytes").and_then(Value::as_str) else {
                return Vec::new();
            };
            use base64::Engine;
            let Ok(raw) = base64::engine::general_purpose::STANDARD.decode(b64) else {
                return Vec::new();
            };
            let text = String::from_utf8_lossy(&raw).into_owned();
            let ty = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v.get("type").and_then(Value::as_str).map(String::from))
                .unwrap_or_else(|| "message".into());
            sse(&ty, &text)
        }
        _ => {
            let kind = get(":exception-type")
                .or(get(":error-code"))
                .unwrap_or("api_error");
            let msg = serde_json::from_slice::<Value>(payload)
                .ok()
                .and_then(|v| v.get("message").and_then(Value::as_str).map(String::from))
                .or_else(|| get(":error-message").map(String::from))
                .unwrap_or_else(|| String::from_utf8_lossy(payload).into_owned());
            let ty = match kind {
                "throttlingException" => "rate_limit_error",
                "validationException" => "invalid_request_error",
                "serviceUnavailableException" | "modelNotReadyException" => "overloaded_error",
                _ => "api_error",
            };
            let data = json!({"type": "error", "error": {"type": ty, "message": format!("{kind}: {msg}")}});
            sse("error", &data.to_string())
        }
    }
}

/// Encodes one event-stream frame (tests and the local Bedrock fake).
pub fn encode_es_frame(headers: &[(&str, &str)], payload: &[u8]) -> Vec<u8> {
    let mut h = Vec::new();
    for (k, v) in headers {
        h.push(k.len() as u8);
        h.extend_from_slice(k.as_bytes());
        h.push(7);
        h.extend_from_slice(&(v.len() as u16).to_be_bytes());
        h.extend_from_slice(v.as_bytes());
    }
    let total = 16 + h.len() + payload.len();
    let mut f = Vec::with_capacity(total);
    f.extend_from_slice(&(total as u32).to_be_bytes());
    f.extend_from_slice(&(h.len() as u32).to_be_bytes());
    let pc = crc32(&f[..8]);
    f.extend_from_slice(&pc.to_be_bytes());
    f.extend_from_slice(&h);
    f.extend_from_slice(payload);
    let mc = crc32(&f);
    f.extend_from_slice(&mc.to_be_bytes());
    f
}

// --- Vertex: Google ADC --------------------------------------------------------------------------

/// An ADC credential (`authorized_user` or `service_account`).
pub struct GoogleCreds {
    /// Cache key (source, never the secret).
    pub source: String,
    pub json: Value,
}

fn gcloud_adc_path() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("APPDATA")
            .map(|a| Path::new(&a).join("gcloud/application_default_credentials.json"))
    } else {
        env_nonempty("CLOUDSDK_CONFIG")
            .map(PathBuf::from)
            .or_else(|| home().map(|h| h.join(".config/gcloud")))
            .map(|d| d.join("application_default_credentials.json"))
    }
}

pub fn google_creds(keychain: Option<&Secret>) -> R<GoogleCreds> {
    let (source, text) = if let Some(s) = keychain {
        ("keychain".to_string(), s.expose().to_string())
    } else if let Some(p) = env_nonempty("GOOGLE_APPLICATION_CREDENTIALS") {
        let t = std::fs::read_to_string(&p).map_err(|e| {
            invalid(format!(
                "GOOGLE_APPLICATION_CREDENTIALS could not be read: {e}"
            ))
        })?;
        (format!("file:{p}"), t)
    } else if let Some(t) = gcloud_adc_path().and_then(|p| std::fs::read_to_string(p).ok()) {
        ("gcloud-adc".to_string(), t)
    } else {
        return Err(unsupported(
            "No Google credentials: run `gcloud auth application-default login`, set GOOGLE_APPLICATION_CREDENTIALS, or paste a service-account JSON in Settings",
        ));
    };
    let json: Value = serde_json::from_str(&text)
        .map_err(|_| invalid("The Google credentials are not valid JSON"))?;
    match json.get("type").and_then(Value::as_str) {
        Some("authorized_user") | Some("service_account") => Ok(GoogleCreds { source, json }),
        Some(other) => Err(unsupported(format!(
            "Google credential type \"{other}\" is not supported by the relay yet (use authorized_user or service_account)"
        ))),
        None => Err(invalid("The Google credentials have no type")),
    }
}

/// Token endpoint and form body for an ADC credential.
pub fn google_token_request(c: &GoogleCreds, now_s: u64) -> R<(String, String)> {
    let get = |k: &str| c.json.get(k).and_then(Value::as_str).map(String::from);
    let token_uri =
        get("token_uri").unwrap_or_else(|| "https://oauth2.googleapis.com/token".into());
    let u = url::Url::parse(&token_uri).map_err(|_| invalid("Bad token_uri"))?;
    if u.scheme() != "https"
        || !u
            .host_str()
            .is_some_and(|h| h == "googleapis.com" || h.ends_with(".googleapis.com"))
    {
        return Err(invalid("token_uri must be an https googleapis.com URL"));
    }
    let form = |pairs: &[(&str, &str)]| -> String {
        pairs
            .iter()
            .map(|(k, v)| format!("{}={}", uri_encode(k, true), uri_encode(v, true)))
            .collect::<Vec<_>>()
            .join("&")
    };
    match get("type").as_deref() {
        Some("authorized_user") => {
            let (Some(id), Some(secret), Some(rt)) =
                (get("client_id"), get("client_secret"), get("refresh_token"))
            else {
                return Err(invalid("authorized_user credentials are incomplete"));
            };
            Ok((
                token_uri,
                form(&[
                    ("grant_type", "refresh_token"),
                    ("client_id", &id),
                    ("client_secret", &secret),
                    ("refresh_token", &rt),
                ]),
            ))
        }
        Some("service_account") => {
            let (Some(email), Some(pem)) = (get("client_email"), get("private_key")) else {
                return Err(invalid("service_account credentials are incomplete"));
            };
            let jwt = service_account_jwt(&email, &pem, &token_uri, now_s)?;
            Ok((
                token_uri,
                form(&[
                    ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                    ("assertion", &jwt),
                ]),
            ))
        }
        _ => Err(invalid("Unsupported Google credential")),
    }
}

fn b64url(b: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// RS256 JWT assertion for the OAuth jwt-bearer grant.
pub fn service_account_jwt(email: &str, pem: &str, aud: &str, now_s: u64) -> R<String> {
    use base64::Engine;
    let der: String = pem
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    let der = base64::engine::general_purpose::STANDARD
        .decode(der.trim())
        .map_err(|_| invalid("The service-account private key is not PEM"))?;
    let key = signature::RsaKeyPair::from_pkcs8(&der)
        .map_err(|_| invalid("The service-account private key is not a PKCS#8 RSA key"))?;
    let header = b64url(br#"{"alg":"RS256","typ":"JWT"}"#);
    let claims = b64url(
        json!({
            "iss": email,
            "scope": "https://www.googleapis.com/auth/cloud-platform",
            "aud": aud,
            "iat": now_s,
            "exp": now_s + 3600,
        })
        .to_string()
        .as_bytes(),
    );
    let msg = format!("{header}.{claims}");
    let mut sig = vec![0u8; key.public().modulus_len()];
    key.sign(
        &signature::RSA_PKCS1_SHA256,
        &rand::SystemRandom::new(),
        msg.as_bytes(),
        &mut sig,
    )
    .map_err(|_| invalid("Could not sign the service-account assertion"))?;
    Ok(format!("{msg}.{}", b64url(&sig)))
}

/// Project: request field, then the credential, then `GOOGLE_CLOUD_PROJECT` / `CLOUDSDK_CORE_PROJECT`.
pub fn vertex_project(requested: Option<&str>, c: &GoogleCreds) -> R<String> {
    let p = requested
        .map(String::from)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            c.json
                .get("project_id")
                .or_else(|| c.json.get("quota_project_id"))
                .and_then(Value::as_str)
                .map(String::from)
        })
        .or_else(|| env_nonempty("GOOGLE_CLOUD_PROJECT"))
        .or_else(|| env_nonempty("CLOUDSDK_CORE_PROJECT"))
        .ok_or_else(|| invalid("No Google Cloud project: set it on the Vertex provider"))?;
    if p.is_empty()
        || p.len() > 63
        || !p
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b':' | b'.'))
    {
        return Err(invalid(format!("Invalid project \"{p}\"")));
    }
    Ok(p)
}

pub fn prepare_vertex(
    body: &[u8],
    token: &Secret,
    project: &str,
    region: &str,
    beta_header: Option<&str>,
) -> R<Prepared> {
    check_label(region, "region")?;
    let (model, stream, mut rest) = split_body(body)?;
    rest.entry("anthropic_version")
        .or_insert(json!("vertex-2023-10-16"));
    let payload = serde_json::to_vec(&Value::Object(rest)).unwrap_or_default();
    let host = if region == "global" {
        "aiplatform.googleapis.com".to_string()
    } else {
        format!("{region}-aiplatform.googleapis.com")
    };
    let action = if stream {
        "streamRawPredict"
    } else {
        "rawPredict"
    };
    let mut headers = vec![
        ("content-type".to_string(), "application/json".to_string()),
        (
            "authorization".to_string(),
            format!("Bearer {}", token.expose()),
        ),
    ];
    if let Some(b) = beta_header {
        headers.push(("anthropic-beta".into(), b.to_string()));
    }
    Ok(Prepared {
        url: format!(
            "https://{host}/v1/projects/{}/locations/{region}/publishers/anthropic/models/{}:{action}",
            uri_encode(project, true),
            uri_encode(&model, true)
        ),
        headers,
        body: payload,
        bedrock_stream: false,
    })
}

// --- Foundry --------------------------------------------------------------------------------------

pub fn prepare_foundry(
    path: &str,
    query: Option<&str>,
    body: Vec<u8>,
    key: Option<&Secret>,
    resource: Option<&str>,
) -> R<Prepared> {
    let resource = resource
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid("No Foundry resource: set it (project) on the Foundry provider"))?;
    check_label(resource, "Foundry resource")?;
    let key = key.ok_or_else(|| {
        unsupported("Foundry with Entra ID is not supported by the relay yet; save the resource's API key in Settings")
    })?;
    let q = query.map(|q| format!("?{q}")).unwrap_or_default();
    Ok(Prepared {
        url: format!("https://{resource}.services.ai.azure.com/anthropic{path}{q}"),
        headers: vec![
            ("x-api-key".into(), key.expose().to_string()),
            ("api-key".into(), key.expose().to_string()),
        ],
        body,
        bedrock_stream: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example_creds() -> AwsCreds {
        AwsCreds {
            access_key: "AKIDEXAMPLE".into(),
            secret_key: Secret::new("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"),
            session_token: None,
        }
    }

    /// AWS SigV4 test suite: get-vanilla and post-vanilla.
    #[test]
    fn sigv4_matches_aws_test_suite() {
        let headers = vec![
            ("Host".to_string(), "example.amazonaws.com".to_string()),
            ("X-Amz-Date".to_string(), "20150830T123600Z".to_string()),
        ];
        let a = sigv4_authorization(
            "GET",
            "/",
            "",
            &headers,
            b"",
            &example_creds(),
            "us-east-1",
            "service",
            "20150830T123600Z",
        );
        assert_eq!(
            a,
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
        );
        let a = sigv4_authorization(
            "POST",
            "/",
            "",
            &headers,
            b"",
            &example_creds(),
            "us-east-1",
            "service",
            "20150830T123600Z",
        );
        assert!(a.ends_with(
            "Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b"
        ));
    }

    #[test]
    fn bedrock_request_shape() {
        let body =
            br#"{"model":"anthropic.claude-opus:0","stream":true,"max_tokens":5,"messages":[]}"#;
        let p = prepare_bedrock(
            body,
            Some("a-1, b-2"),
            &BedrockAuth::SigV4(example_creds()),
            "us-west-2",
        )
        .unwrap();
        assert_eq!(
            p.url,
            "https://bedrock-runtime.us-west-2.amazonaws.com/model/anthropic.claude-opus%3A0/invoke-with-response-stream"
        );
        assert!(p.bedrock_stream);
        let v: Value = serde_json::from_slice(&p.body).unwrap();
        assert_eq!(v["anthropic_version"], "bedrock-2023-05-31");
        assert_eq!(v["anthropic_beta"], json!(["a-1", "b-2"]));
        assert!(v.get("model").is_none() && v.get("stream").is_none());
        let auth = &p
            .headers
            .iter()
            .find(|(k, _)| k == "authorization")
            .unwrap()
            .1;
        assert!(auth.starts_with("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/"));
        assert!(auth.contains("/us-west-2/bedrock/aws4_request"));
        assert!(auth.contains("SignedHeaders=content-type;host;x-amz-date,"));
    }

    #[test]
    fn bedrock_api_key_from_keychain_is_bearer() {
        let a = bedrock_auth(Some(&Secret::new("ABSKexample"))).unwrap();
        assert!(matches!(a, BedrockAuth::Bearer(_)));
        let a = bedrock_auth(Some(&Secret::new(
            r#"{"accessKeyId":"AK","secretAccessKey":"SK"}"#,
        )))
        .unwrap();
        assert!(matches!(a, BedrockAuth::SigV4(c) if c.access_key == "AK"));
    }

    #[test]
    fn event_stream_becomes_sse() {
        use base64::Engine;
        let ev = br#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#;
        let payload =
            json!({"bytes": base64::engine::general_purpose::STANDARD.encode(ev)}).to_string();
        let f = encode_es_frame(
            &[
                (":event-type", "chunk"),
                (":content-type", "application/json"),
                (":message-type", "event"),
            ],
            payload.as_bytes(),
        );
        let mut d = EventStreamToSse::default();
        // Split across pushes.
        let (a, b) = f.split_at(7);
        assert!(d.push(a).unwrap().is_empty());
        let out = String::from_utf8(d.push(b).unwrap()).unwrap();
        assert_eq!(
            out,
            format!(
                "event: content_block_delta\ndata: {}\n\n",
                std::str::from_utf8(ev).unwrap()
            )
        );
        let ex = encode_es_frame(
            &[
                (":message-type", "exception"),
                (":exception-type", "throttlingException"),
            ],
            br#"{"message":"slow down"}"#,
        );
        let out = String::from_utf8(d.push(&ex).unwrap()).unwrap();
        assert!(out.starts_with("event: error\n"));
        assert!(out.contains("rate_limit_error") && out.contains("slow down"));
        let mut bad = f.clone();
        bad[8] ^= 1;
        assert!(EventStreamToSse::default().push(&bad).is_err());
    }

    #[test]
    fn vertex_and_foundry_urls() {
        let body = br#"{"model":"claude-opus-5-5","stream":true,"messages":[]}"#;
        let p = prepare_vertex(body, &Secret::new("tok"), "my-proj", "us-east5", None).unwrap();
        assert_eq!(
            p.url,
            "https://us-east5-aiplatform.googleapis.com/v1/projects/my-proj/locations/us-east5/publishers/anthropic/models/claude-opus-5-5:streamRawPredict"
        );
        let v: Value = serde_json::from_slice(&p.body).unwrap();
        assert_eq!(v["anthropic_version"], "vertex-2023-10-16");
        assert_eq!(v["stream"], true);
        let p = prepare_vertex(body, &Secret::new("tok"), "p", "global", None).unwrap();
        assert!(p.url.starts_with("https://aiplatform.googleapis.com/"));
        let p = prepare_foundry(
            "/v1/messages",
            Some("beta=true"),
            body.to_vec(),
            Some(&Secret::new("k")),
            Some("my-res"),
        )
        .unwrap();
        assert_eq!(
            p.url,
            "https://my-res.services.ai.azure.com/anthropic/v1/messages?beta=true"
        );
        let e = prepare_foundry("/v1/messages", None, vec![], None, Some("r"));
        assert_eq!(e.err().unwrap().code, "UNSUPPORTED");
    }

    #[test]
    fn google_token_requests() {
        let c = GoogleCreds {
            source: "t".into(),
            json: json!({"type":"authorized_user","client_id":"id","client_secret":"s","refresh_token":"r/1"}),
        };
        let (u, f) = google_token_request(&c, 0).unwrap();
        assert_eq!(u, "https://oauth2.googleapis.com/token");
        assert!(f.contains("grant_type=refresh_token") && f.contains("refresh_token=r%2F1"));
        let evil = GoogleCreds {
            source: "t".into(),
            json: json!({"type":"authorized_user","client_id":"id","client_secret":"s","refresh_token":"r","token_uri":"https://evil.example/token"}),
        };
        assert!(google_token_request(&evil, 0).is_err());
        assert_eq!(
            google_creds(Some(&Secret::new(r#"{"type":"external_account"}"#)))
                .err()
                .unwrap()
                .code,
            "UNSUPPORTED"
        );
    }

    #[test]
    fn relay_urls() {
        let u = parse_relay_url("kimo-relay://bedrock/v1/messages?beta=true").unwrap();
        assert_eq!(
            (u.platform.as_str(), u.path.as_str()),
            ("bedrock", "/v1/messages")
        );
        assert_eq!(u.query.as_deref(), Some("beta=true"));
        assert!(parse_relay_url("kimo-relay://evil/v1/messages").is_err());
    }
}
