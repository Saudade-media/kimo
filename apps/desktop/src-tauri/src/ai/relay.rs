//! The AI request relay (ADR 0014 §4): `kimo_ai_request` performs a provider HTTP call in Rust
//! with the key read from the keychain, and streams the response back as `kimo://ai-response`
//! events `{requestId, status?, headers?, chunkBase64?, end, error?}`. Keys never cross to JS.
//!
//! Rules:
//! - URLs: `https://…`, `http://localhost|127.0.0.1|[::1]…`, `kimo-relay://bedrock|vertex|foundry/…`.
//! - Header auth: the well-known providers get their canonical header (Anthropic `x-api-key` +
//!   `anthropic-version`, OpenAI / OpenRouter `Authorization: Bearer`, Gemini `x-goog-api-key`)
//!   and their key is only ever sent to their official host. Other providers (`custom:*`) use
//!   the header JS names, and their key is pinned to the first origin it is sent to
//!   (`<kimo home>/ai/key-origins.json`, cleared when the key is saved again or deleted).
//! - Auth headers JS sets are dropped; redirects are not followed (a redirect could carry the key).
//! - Backpressure: the body is pulled one chunk at a time and the next read starts only after
//!   the previous chunk was handed to the webview, so a slow consumer slows the socket (TCP flow
//!   control) instead of buffering unboundedly in Rust.
//! - Timeouts: connect 20 s, response head 120 s, idle between chunks 300 s. Abort is immediate.
//! - Missing credentials answer a synthetic 401 (Anthropic-shaped error body) so adapters map
//!   it to an `auth` card; transport failures are `error` events.

use super::cloud::{self, Prepared};
use super::secrets::{Secret, Secrets};
use super::EventSink;
use crate::error::{invalid, permission, R};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const EV_AI_RESPONSE: &str = "kimo://ai-response";
const MAX_BODY: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RelayAuth {
    Header {
        header: String,
        #[serde(default)]
        scheme: Option<String>,
    },
    None,
    Cloud {
        platform: String,
        #[serde(default)]
        region: Option<String>,
        #[serde(default)]
        project: Option<String>,
        /// The provider card's credential choice (`cloud::check_credentials`).
        #[serde(default)]
        credentials: Option<String>,
        /// Bedrock: the AWS profile.
        #[serde(default)]
        profile: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct RelayRequest {
    pub request_id: String,
    pub provider: String,
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
    pub auth: RelayAuth,
}

#[derive(Debug, Clone)]
pub struct RelayConfig {
    pub connect_timeout: Duration,
    pub head_timeout: Duration,
    pub idle_timeout: Duration,
    /// The Azure CLI for Foundry Entra ID tokens (None: search PATH and the usual dirs).
    pub azure_cli: Option<PathBuf>,
}

impl Default for RelayConfig {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(20),
            head_timeout: Duration::from_secs(120),
            idle_timeout: Duration::from_secs(300),
            azure_cli: None,
        }
    }
}

/// Official hosts and the canonical auth header of the well-known providers.
fn builtin(provider: &str) -> Option<(&'static [&'static str], &'static str, bool)> {
    Some(match provider {
        "anthropic" => (&["api.anthropic.com"], "x-api-key", false),
        "openai" => (&["api.openai.com"], "authorization", true),
        "openrouter" => (&["openrouter.ai"], "authorization", true),
        "gemini" => (
            &["generativelanguage.googleapis.com"],
            "x-goog-api-key",
            false,
        ),
        _ => return None,
    })
}

/// Request headers JS may not set (auth, hop-by-hop, framing).
fn dropped_header(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    matches!(
        n.as_str(),
        "authorization"
            | "x-api-key"
            | "x-goog-api-key"
            | "api-key"
            | "host"
            | "content-length"
            | "connection"
            | "keep-alive"
            | "transfer-encoding"
            | "te"
            | "trailer"
            | "upgrade"
            | "accept-encoding"
            | "cookie"
    ) || n.starts_with("proxy-")
        || n.starts_with("x-amz-")
}

#[derive(Debug, PartialEq)]
pub enum Target {
    Http(url::Url),
    Cloud(cloud::RelayUrl),
}

/// The URL allow-list.
pub fn check_url(raw: &str) -> R<Target> {
    if raw.starts_with("kimo-relay://") {
        return Ok(Target::Cloud(cloud::parse_relay_url(raw)?));
    }
    let u = url::Url::parse(raw).map_err(|_| invalid(format!("Bad URL {raw}")))?;
    if !u.username().is_empty() || u.password().is_some() {
        return Err(permission("URLs with credentials are not relayed"));
    }
    match u.scheme() {
        "https" if u.host_str().is_some() => Ok(Target::Http(u)),
        "http" => match u.host() {
            Some(url::Host::Domain("localhost")) => Ok(Target::Http(u)),
            Some(url::Host::Ipv4(ip)) if ip.is_loopback() && ip.octets() == [127, 0, 0, 1] => {
                Ok(Target::Http(u))
            }
            Some(url::Host::Ipv6(ip)) if ip.is_loopback() => Ok(Target::Http(u)),
            _ => Err(permission(format!(
                "Plain http is only relayed to localhost / 127.0.0.1 (got {raw})"
            ))),
        },
        s => Err(permission(format!("Scheme {s}: is not relayed"))),
    }
}

fn origin_of(u: &url::Url) -> String {
    u.origin().ascii_serialization()
}

/// Account → origin pins for keys of non-built-in providers (names and origins only).
pub struct KeyPins {
    path: PathBuf,
    lock: Mutex<()>,
}

impl KeyPins {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }
    fn read(&self) -> BTreeMap<String, String> {
        crate::util::read_json(&self.path)
            .ok()
            .flatten()
            .unwrap_or_default()
    }
    /// Ok when the key may go to `origin` (pinning it on first use).
    pub fn check_and_pin(&self, account: &str, origin: &str) -> R<()> {
        let _g = self.lock.lock().unwrap();
        let mut m = self.read();
        match m.get(account) {
            Some(o) if o == origin => Ok(()),
            Some(o) => Err(permission(format!(
                "The key for {account} is pinned to {o}; save the key again to use it with {origin}"
            ))),
            None => {
                m.insert(account.into(), origin.into());
                crate::util::write_json(&self.path, &m)
            }
        }
    }
    pub fn clear(&self, account: &str) {
        let _g = self.lock.lock().unwrap();
        let mut m = self.read();
        if m.remove(account).is_some() {
            let _ = crate::util::write_json(&self.path, &m);
        }
    }
}

/// The cloud fields of a request's relay auth.
#[derive(Clone, Copy)]
struct CloudChoice<'a> {
    region: Option<&'a str>,
    project: Option<&'a str>,
    credentials: Option<&'a str>,
    profile: Option<&'a str>,
}

enum Plan {
    Send {
        method: reqwest::Method,
        prepared: Prepared,
    },
    /// A response produced locally (missing credentials, unsupported cloud route).
    Synthetic { status: u16, body: Vec<u8> },
}

fn synthetic(status: u16, kind: &str, message: &str) -> Plan {
    let mut v: Value = serde_json::from_slice(&cloud::anthropic_error_body(kind, message))
        .unwrap_or_else(|_| json!({}));
    v["error"]["code"] = json!(status);
    Plan::Synthetic {
        status,
        body: serde_json::to_vec(&v).unwrap_or_default(),
    }
}

pub struct Relay {
    client: reqwest::Client,
    secrets: Arc<Secrets>,
    pub pins: KeyPins,
    cfg: RelayConfig,
    inflight: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
    google_tokens: tokio::sync::Mutex<HashMap<String, (Secret, Instant)>>,
    /// AWS SSO role credentials per (profile, account, role).
    sso_creds: tokio::sync::Mutex<HashMap<String, (cloud::AwsCreds, Instant)>>,
    /// The Azure CLI's Entra ID token for Foundry.
    entra_token: tokio::sync::Mutex<Option<(Secret, Instant)>>,
}

impl Relay {
    pub fn new(secrets: Arc<Secrets>, pins_path: PathBuf, cfg: RelayConfig) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(cfg.connect_timeout)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            secrets,
            pins: KeyPins::new(pins_path),
            cfg,
            inflight: Mutex::new(HashMap::new()),
            google_tokens: tokio::sync::Mutex::new(HashMap::new()),
            sso_creds: tokio::sync::Mutex::new(HashMap::new()),
            entra_token: tokio::sync::Mutex::new(None),
        }
    }

    /// Validates and starts a request. Policy rejections are returned; everything after the
    /// start (including credential problems) arrives as events.
    pub fn start(self: &Arc<Self>, req: RelayRequest, sink: Arc<dyn EventSink>) -> R<()> {
        if req.request_id.is_empty() || req.request_id.len() > 128 {
            return Err(invalid("Bad requestId"));
        }
        if !matches!(req.method.as_str(), "GET" | "POST") {
            return Err(invalid(format!("Method {} is not relayed", req.method)));
        }
        if req.body.len() > MAX_BODY {
            return Err(invalid("Request body too large"));
        }
        let target = check_url(&req.url)?;
        // Policy checks that need no keychain access happen now, so JS gets a rejection.
        match (&target, &req.auth) {
            (Target::Http(u), RelayAuth::Header { header, scheme }) => {
                if let Some((hosts, _, _)) = builtin(&req.provider) {
                    if u.scheme() != "https" || !hosts.contains(&u.host_str().unwrap_or("")) {
                        return Err(permission(format!(
                            "The {} key is only sent to {}; add a custom provider for other endpoints",
                            req.provider,
                            hosts.join(", ")
                        )));
                    }
                } else {
                    reqwest::header::HeaderName::from_bytes(header.as_bytes())
                        .map_err(|_| invalid(format!("Bad auth header {header}")))?;
                    let h = header.to_ascii_lowercase();
                    if matches!(
                        h.as_str(),
                        "host"
                            | "content-length"
                            | "connection"
                            | "keep-alive"
                            | "transfer-encoding"
                            | "te"
                            | "trailer"
                            | "upgrade"
                            | "accept-encoding"
                            | "cookie"
                    ) || h.starts_with("proxy-")
                    {
                        return Err(invalid(format!("Auth header {header} is not allowed")));
                    }
                    if scheme.as_deref().is_some_and(|s| s != "Bearer") {
                        return Err(invalid("Only the Bearer scheme is supported"));
                    }
                }
            }
            (Target::Http(_), RelayAuth::Cloud { .. }) => {
                return Err(invalid("Cloud auth needs a kimo-relay:// URL"));
            }
            (Target::Cloud(c), RelayAuth::Cloud { platform, .. }) if &c.platform != platform => {
                return Err(invalid("Relay route and cloud platform differ"));
            }
            (
                Target::Cloud(_),
                RelayAuth::Cloud {
                    platform,
                    credentials,
                    profile,
                    ..
                },
            ) => {
                cloud::check_credentials(platform, credentials.as_deref(), profile.as_deref())?;
            }
            (Target::Cloud(_), RelayAuth::Header { .. } | RelayAuth::None) => {
                return Err(invalid("kimo-relay:// URLs need cloud auth"));
            }
            _ => {}
        }
        if matches!(req.auth, RelayAuth::Header { .. } | RelayAuth::Cloud { .. }) {
            super::secrets::check_account(
                super::secrets::SERVICE,
                &format!("provider.{}", req.provider),
            )?;
        }
        let abort = Arc::new(tokio::sync::Notify::new());
        {
            let mut g = self.inflight.lock().unwrap();
            if g.contains_key(&req.request_id) {
                return Err(invalid("Duplicate requestId"));
            }
            g.insert(req.request_id.clone(), abort.clone());
        }
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let id = req.request_id.clone();
            tokio::select! {
                _ = abort.notified() => {
                    sink.emit(EV_AI_RESPONSE, json!({"requestId": id, "end": true, "error": "aborted"}));
                }
                _ = me.run(req, target, sink.clone()) => {}
            }
            me.inflight.lock().unwrap().remove(&id);
        });
        Ok(())
    }

    pub fn abort(&self, request_id: &str) {
        if let Some(n) = self.inflight.lock().unwrap().remove(request_id) {
            n.notify_one();
        }
    }

    /// Aborts every in-flight request (app exit).
    pub fn abort_all(&self) {
        for (_, n) in self.inflight.lock().unwrap().drain() {
            n.notify_one();
        }
    }

    pub fn inflight(&self) -> usize {
        self.inflight.lock().unwrap().len()
    }

    async fn key(&self, provider: &str) -> R<Option<Secret>> {
        let s = self.secrets.clone();
        let account = format!("provider.{provider}");
        tauri::async_runtime::spawn_blocking(move || s.get(&account))
            .await
            .map_err(|e| crate::error::io_msg(format!("Keychain task failed: {e}")))?
    }

    async fn plan(&self, req: &RelayRequest, target: &Target) -> R<Plan> {
        let method = if req.method == "GET" {
            reqwest::Method::GET
        } else {
            reqwest::Method::POST
        };
        let mut headers: Vec<(String, String)> = req
            .headers
            .iter()
            .filter(|(k, _)| !dropped_header(k))
            .map(|(k, v)| (k.to_ascii_lowercase(), v.clone()))
            .collect();
        match (target, &req.auth) {
            (Target::Http(u), RelayAuth::None) => Ok(Plan::Send {
                method,
                prepared: Prepared {
                    url: u.to_string(),
                    headers,
                    body: req.body.clone(),
                    bedrock_stream: false,
                },
            }),
            (Target::Http(u), RelayAuth::Header { header, scheme }) => {
                let Some(key) = self.key(&req.provider).await? else {
                    return Ok(synthetic(
                        401,
                        "authentication_error",
                        &format!(
                            "No API key saved for {} (Settings › AI providers)",
                            req.provider
                        ),
                    ));
                };
                let (name, bearer) = match builtin(&req.provider) {
                    Some((_, name, bearer)) => {
                        if req.provider == "anthropic"
                            && !headers.iter().any(|(k, _)| k == "anthropic-version")
                        {
                            headers.push(("anthropic-version".into(), "2023-06-01".into()));
                        }
                        (name.to_string(), bearer)
                    }
                    None => {
                        self.pins
                            .check_and_pin(&format!("provider.{}", req.provider), &origin_of(u))?;
                        (header.to_ascii_lowercase(), scheme.is_some())
                    }
                };
                let value = if bearer {
                    format!("Bearer {}", key.expose())
                } else {
                    key.expose().to_string()
                };
                headers.retain(|(k, _)| k != &name);
                headers.push((name, value));
                Ok(Plan::Send {
                    method,
                    prepared: Prepared {
                        url: u.to_string(),
                        headers,
                        body: req.body.clone(),
                        bedrock_stream: false,
                    },
                })
            }
            (
                Target::Cloud(c),
                RelayAuth::Cloud {
                    region,
                    project,
                    credentials,
                    profile,
                    ..
                },
            ) => {
                let choice = CloudChoice {
                    region: region.as_deref(),
                    project: project.as_deref(),
                    credentials: credentials.as_deref(),
                    profile: profile.as_deref(),
                };
                self.plan_cloud(req, c, choice, headers).await
            }
            _ => Err(invalid("Unsupported auth for this URL")),
        }
    }

    async fn plan_cloud(
        &self,
        req: &RelayRequest,
        c: &cloud::RelayUrl,
        choice: CloudChoice<'_>,
        js_headers: Vec<(String, String)>,
    ) -> R<Plan> {
        let CloudChoice {
            region,
            project,
            credentials,
            profile,
        } = choice;
        let beta = js_headers
            .iter()
            .find(|(k, _)| k == "anthropic-beta")
            .map(|(_, v)| v.clone());
        let messages = req.method == "POST" && c.path == "/v1/messages";
        if c.platform != "foundry" && !messages {
            return Ok(synthetic(
                404,
                "not_found_error",
                &format!(
                    "{} {} is not available on {} through the relay",
                    req.method, c.path, c.platform
                ),
            ));
        }
        let key = self.key(&req.provider).await?;
        let prepared = match c.platform.as_str() {
            "bedrock" => {
                let auth = match cloud::bedrock_auth(key.as_ref(), credentials, profile) {
                    Ok(cloud::BedrockAuth::Sso(role)) => match self.sso_role_creds(&role).await {
                        Ok(c) => cloud::BedrockAuth::SigV4(c),
                        Err(e) => return Ok(synthetic(401, "authentication_error", &e.message)),
                    },
                    Ok(a) => a,
                    Err(e) => return Ok(synthetic(401, "authentication_error", &e.message)),
                };
                cloud::prepare_bedrock(
                    &req.body,
                    beta.as_deref(),
                    &auth,
                    &cloud::bedrock_region(region, profile)?,
                )?
            }
            "vertex" => {
                let creds = match cloud::google_creds(key.as_ref(), credentials) {
                    Ok(c) => c,
                    Err(e) => return Ok(synthetic(401, "authentication_error", &e.message)),
                };
                let project = cloud::vertex_project(project, &creds)?;
                let region = region
                    .map(String::from)
                    .filter(|s| !s.is_empty())
                    .or_else(|| std::env::var("CLOUD_ML_REGION").ok())
                    .unwrap_or_else(|| "global".into());
                let token = match self.google_token(&creds).await {
                    Ok(t) => t,
                    Err(e) => return Ok(synthetic(401, "authentication_error", &e.message)),
                };
                cloud::prepare_vertex(&req.body, &token, &project, &region, beta.as_deref())?
            }
            "foundry" => {
                // `api-key`: the keychain key; `entra`: the Azure CLI's token; omitted: the key
                // when one is saved, else Entra ID.
                let auth = match (credentials, key) {
                    (Some("api-key"), None) => {
                        return Ok(synthetic(
                            401,
                            "authentication_error",
                            "No API key is saved for Foundry: paste the resource's key in Settings, or switch to Microsoft Entra ID",
                        ))
                    }
                    (Some("entra"), _) | (None, None) => match self.entra_token().await {
                        Ok(t) => cloud::FoundryAuth::Entra(t),
                        Err(e) => return Ok(synthetic(401, "authentication_error", &e.message)),
                    },
                    (_, Some(k)) => cloud::FoundryAuth::Key(k),
                    (Some(_), None) => return Err(invalid("Unknown Foundry credentials")),
                };
                let mut p = cloud::prepare_foundry(
                    &c.path,
                    c.query.as_deref(),
                    req.body.clone(),
                    &auth,
                    project,
                )?;
                p.headers.extend(js_headers.clone());
                p
            }
            other => return Err(permission(format!("Unknown platform {other}"))),
        };
        let mut prepared = prepared;
        // Pass through the remaining Anthropic headers (version/beta handled per platform).
        if prepared.bedrock_stream || c.platform == "bedrock" {
            // SigV4 signed a fixed header set; send nothing else that could break it.
        } else if c.platform == "vertex" {
            for (k, v) in js_headers {
                if k != "anthropic-beta" && k != "anthropic-version" && k != "content-type" {
                    prepared.headers.push((k, v));
                }
            }
        }
        let method = if req.method == "GET" {
            reqwest::Method::GET
        } else {
            reqwest::Method::POST
        };
        Ok(Plan::Send { method, prepared })
    }

    /// Trades a cached `aws sso login` token for role credentials (cached until 5 min before
    /// they expire).
    async fn sso_role_creds(&self, role: &cloud::SsoRole) -> R<cloud::AwsCreds> {
        let mut cache = self.sso_creds.lock().await;
        let key = role.cache_key();
        if let Some((c, until)) = cache.get(&key) {
            if Instant::now() < *until {
                return Ok(c.clone());
            }
        }
        let (url, headers) = cloud::sso_credentials_request(role)?;
        let mut rb = self.client.get(&url);
        for (k, v) in headers {
            rb = rb.header(k, v);
        }
        let resp = tokio::time::timeout(self.cfg.head_timeout, rb.send())
            .await
            .map_err(|_| crate::error::io_msg("AWS SSO request timed out"))?
            .map_err(|e| {
                crate::error::io_msg(format!("AWS SSO request failed: {}", e.without_url()))
            })?;
        let status = resp.status();
        let v: Value = resp.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            let why = v
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("no role credentials");
            return Err(invalid(format!(
                "AWS SSO refused the session of profile \"{}\" ({status}): {why}; run `aws sso login --profile {}`",
                role.profile, role.profile
            )));
        }
        let (creds, exp) = cloud::parse_sso_credentials(&v)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let ttl = exp.map(|e| e.saturating_sub(now)).unwrap_or(900);
        cache.insert(
            key,
            (
                creds.clone(),
                Instant::now() + Duration::from_secs(ttl.saturating_sub(300)),
            ),
        );
        Ok(creds)
    }

    /// A Microsoft Entra ID token for Foundry from the Azure CLI (`az login`), cached until
    /// 5 min before it expires.
    async fn entra_token(&self) -> R<Secret> {
        let mut cache = self.entra_token.lock().await;
        if let Some((t, until)) = cache.as_ref() {
            if Instant::now() < *until {
                return Ok(t.clone());
            }
        }
        let az = match &self.cfg.azure_cli {
            Some(p) => Some(p.clone()),
            None => cloud::azure_cli_candidates().into_iter().find(|p| p.is_file()),
        }
        .ok_or_else(|| {
            cloud::unsupported(
                "Microsoft Entra ID needs the Azure CLI (`az login`); install it, or save the resource's API key in Settings",
            )
        })?;
        let job = tauri::async_runtime::spawn_blocking(move || {
            std::process::Command::new(&az)
                .args([
                    "account",
                    "get-access-token",
                    "--resource",
                    cloud::FOUNDRY_ENTRA_RESOURCE,
                    "--output",
                    "json",
                ])
                .stdin(std::process::Stdio::null())
                .output()
        });
        let out = tokio::time::timeout(self.cfg.head_timeout, job)
            .await
            .map_err(|_| crate::error::io_msg("The Azure CLI timed out"))?
            .map_err(|e| crate::error::io_msg(format!("Azure CLI task failed: {e}")))?
            .map_err(|e| crate::error::io_msg(format!("The Azure CLI could not run: {e}")))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            let first = err
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .unwrap_or("no token");
            return Err(cloud::unsupported(format!(
                "The Azure CLI has no Entra ID token ({first}); run `az login`, or save the resource's API key in Settings"
            )));
        }
        let (tok, exp) = cloud::parse_az_token(&out.stdout)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let ttl = exp.map(|e| e.saturating_sub(now)).unwrap_or(3000);
        *cache = Some((
            tok.clone(),
            Instant::now() + Duration::from_secs(ttl.saturating_sub(300)),
        ));
        Ok(tok)
    }

    async fn google_token(&self, creds: &cloud::GoogleCreds) -> R<Secret> {
        let mut cache = self.google_tokens.lock().await;
        if let Some((t, until)) = cache.get(&creds.source) {
            if Instant::now() < *until {
                return Ok(t.clone());
            }
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let (uri, form) = cloud::google_token_request(creds, now)?;
        let resp = tokio::time::timeout(
            self.cfg.head_timeout,
            self.client
                .post(&uri)
                .header("content-type", "application/x-www-form-urlencoded")
                .body(form)
                .send(),
        )
        .await
        .map_err(|_| crate::error::io_msg("Google token request timed out"))?
        .map_err(|e| {
            crate::error::io_msg(format!("Google token request failed: {}", e.without_url()))
        })?;
        let status = resp.status();
        let v: Value = resp.json().await.unwrap_or(Value::Null);
        let Some(tok) = v.get("access_token").and_then(Value::as_str) else {
            let why = v
                .get("error_description")
                .or_else(|| v.get("error"))
                .and_then(Value::as_str)
                .unwrap_or("no access_token");
            return Err(invalid(format!(
                "Google refused the credentials ({status}): {why}"
            )));
        };
        let ttl = v.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
        let t = Secret::new(tok);
        cache.insert(
            creds.source.clone(),
            (
                t.clone(),
                Instant::now() + Duration::from_secs(ttl.saturating_sub(60)),
            ),
        );
        Ok(t)
    }

    async fn run(&self, req: RelayRequest, target: Target, sink: Arc<dyn EventSink>) {
        let id = req.request_id.clone();
        let fail = |msg: String| {
            sink.emit(
                EV_AI_RESPONSE,
                json!({"requestId": id, "end": true, "error": msg}),
            );
        };
        let plan = match self.plan(&req, &target).await {
            Ok(p) => p,
            Err(e) => {
                // Policy problems found late (pins, bad cloud config): a 400 the adapter shows.
                let status = if e.code == "PERMISSION" { 403 } else { 400 };
                let kind = if status == 403 {
                    "permission_error"
                } else {
                    "invalid_request_error"
                };
                synthetic(status, kind, &e.message)
            }
        };
        let (method, p) = match plan {
            Plan::Synthetic { status, body } => {
                sink.emit(
                    EV_AI_RESPONSE,
                    json!({
                        "requestId": id,
                        "status": status,
                        "headers": {"content-type": "application/json"},
                        "end": false,
                    }),
                );
                sink.emit(
                    EV_AI_RESPONSE,
                    json!({
                        "requestId": id,
                        "chunkBase64": base64::engine::general_purpose::STANDARD.encode(body),
                        "end": true,
                    }),
                );
                return;
            }
            Plan::Send { method, prepared } => (method, prepared),
        };
        let mut rb = self.client.request(method, &p.url);
        for (k, v) in &p.headers {
            rb = rb.header(k.as_str(), v.as_str());
        }
        if !p.body.is_empty() {
            rb = rb.body(p.body);
        }
        let resp = match tokio::time::timeout(self.cfg.head_timeout, rb.send()).await {
            Err(_) => return fail("timeout: no response headers".into()),
            Ok(Err(e)) => return fail(transport_msg(&e)),
            Ok(Ok(r)) => r,
        };
        let status = resp.status().as_u16();
        let translate = p.bedrock_stream && status == 200;
        let mut hdrs = Map::new();
        for (k, v) in resp.headers() {
            let k = k.as_str();
            if matches!(
                k,
                "content-length" | "transfer-encoding" | "connection" | "set-cookie"
            ) {
                continue;
            }
            if let Ok(v) = v.to_str() {
                hdrs.insert(k.to_string(), json!(v));
            }
        }
        if translate {
            hdrs.insert("content-type".into(), json!("text/event-stream"));
        }
        sink.emit(
            EV_AI_RESPONSE,
            json!({"requestId": id, "status": status, "headers": hdrs, "end": false}),
        );
        let mut resp = resp;
        let mut es = cloud::EventStreamToSse::default();
        loop {
            match tokio::time::timeout(self.cfg.idle_timeout, resp.chunk()).await {
                Err(_) => return fail("timeout: the stream went idle".into()),
                Ok(Err(e)) => return fail(transport_msg(&e)),
                Ok(Ok(None)) => {
                    sink.emit(EV_AI_RESPONSE, json!({"requestId": id, "end": true}));
                    return;
                }
                Ok(Ok(Some(bytes))) => {
                    let out = if translate {
                        match es.push(&bytes) {
                            Ok(b) => b,
                            Err(e) => return fail(format!("bedrock stream: {e}")),
                        }
                    } else {
                        bytes.to_vec()
                    };
                    if !out.is_empty() {
                        sink.emit(
                            EV_AI_RESPONSE,
                            json!({
                                "requestId": id,
                                "chunkBase64": base64::engine::general_purpose::STANDARD.encode(out),
                                "end": false,
                            }),
                        );
                    }
                }
            }
        }
    }
}

/// Transport error text without the URL (query strings may carry keys for some providers).
fn transport_msg(e: &reqwest::Error) -> String {
    let kind = if e.is_connect() {
        "connect"
    } else if e.is_timeout() {
        "timeout"
    } else if e.is_body() || e.is_decode() {
        "body"
    } else {
        "request"
    };
    let mut src: Option<&dyn std::error::Error> = std::error::Error::source(e);
    let mut detail = String::new();
    while let Some(s) = src {
        detail = s.to_string();
        src = s.source();
    }
    if detail.is_empty() {
        format!("{kind}: failed")
    } else {
        format!("{kind}: {detail}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::secrets::MemoryStore;
    use crate::ai::tests_support::ChannelSink;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn relay(dir: &std::path::Path, cfg: RelayConfig) -> (Arc<Relay>, Arc<Secrets>) {
        let secrets = Arc::new(Secrets::new(
            Box::new(MemoryStore::default()),
            dir.join("idx.json"),
        ));
        let r = Arc::new(Relay::new(secrets.clone(), dir.join("pins.json"), cfg));
        (r, secrets)
    }

    /// A one-shot HTTP/1.1 server: captures the request head, answers with chunked SSE events,
    /// `delay` apart, then closes. Returns (port, captured request).
    async fn sse_server(
        events: Vec<&'static str>,
        delay: Duration,
    ) -> (u16, tokio::sync::oneshot::Receiver<String>) {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut buf = vec![0u8; 65536];
            let mut got = Vec::new();
            loop {
                let n = s.read(&mut buf).await.unwrap();
                got.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&got).to_string();
                if let Some(i) = text.find("\r\n\r\n") {
                    let len = text[..i]
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if got.len() >= i + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let _ = tx.send(String::from_utf8_lossy(&got).to_string());
            let head = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\nx-request-id: req_1\r\n\r\n";
            if s.write_all(head.as_bytes()).await.is_err() {
                return;
            }
            for e in events {
                tokio::time::sleep(delay).await;
                let chunk = format!("{:x}\r\n{e}\r\n", e.len());
                if s.write_all(chunk.as_bytes()).await.is_err() {
                    return;
                }
            }
            let _ = s.write_all(b"0\r\n\r\n").await;
        });
        (port, rx)
    }

    fn req(id: &str, provider: &str, url: String, auth: RelayAuth) -> RelayRequest {
        RelayRequest {
            request_id: id.into(),
            provider: provider.into(),
            method: "POST".into(),
            url,
            headers: BTreeMap::from([
                ("content-type".to_string(), "application/json".to_string()),
                ("x-api-key".to_string(), "placeholder".to_string()),
            ]),
            body: br#"{"model":"m","stream":true}"#.to_vec(),
            auth,
        }
    }

    fn decode(events: &[Value]) -> String {
        events
            .iter()
            .filter_map(|e| e.get("chunkBase64").and_then(Value::as_str))
            .map(|c| {
                String::from_utf8(base64::engine::general_purpose::STANDARD.decode(c).unwrap())
                    .unwrap()
            })
            .collect()
    }

    #[tokio::test]
    async fn streams_sse_with_injected_key() {
        let dir = tempfile::tempdir().unwrap();
        let (r, secrets) = relay(dir.path(), RelayConfig::default());
        secrets
            .set("provider.custom:local", "sk-local-secret-1234")
            .unwrap();
        let (port, captured) = sse_server(
            vec!["event: a\ndata: 1\n\n", "event: b\ndata: 2\n\n"],
            Duration::from_millis(5),
        )
        .await;
        let (sink, rx) = ChannelSink::pair();
        r.start(
            req(
                "r1",
                "custom:local",
                format!("http://127.0.0.1:{port}/v1/messages"),
                RelayAuth::Header {
                    header: "authorization".into(),
                    scheme: Some("Bearer".into()),
                },
            ),
            sink,
        )
        .unwrap();
        let events = ChannelSink::collect_until_end(rx, "r1").await;
        assert_eq!(events[0]["status"], 200);
        assert_eq!(events[0]["headers"]["x-request-id"], "req_1");
        assert_eq!(
            decode(&events),
            "event: a\ndata: 1\n\nevent: b\ndata: 2\n\n"
        );
        assert!(events.last().unwrap()["end"] == true);
        assert!(events.iter().all(|e| e.get("error").is_none()));
        let head = captured.await.unwrap().to_ascii_lowercase();
        assert!(head.contains("authorization: bearer sk-local-secret-1234"));
        assert!(!head.contains("placeholder"), "JS auth headers are dropped");
        // Events never carry the key.
        assert!(!events
            .iter()
            .any(|e| e.to_string().contains("sk-local-secret")));
        assert_eq!(r.inflight(), 0);
        // The key is now pinned to that origin.
        let other = r.start(
            req(
                "r2",
                "custom:local",
                "https://evil.example/v1".into(),
                RelayAuth::Header {
                    header: "authorization".into(),
                    scheme: Some("Bearer".into()),
                },
            ),
            ChannelSink::pair().0,
        );
        assert!(other.is_ok(), "pin checks happen in the task");
    }

    #[tokio::test]
    async fn pinned_key_is_not_sent_elsewhere() {
        let dir = tempfile::tempdir().unwrap();
        let (r, secrets) = relay(dir.path(), RelayConfig::default());
        secrets
            .set("provider.custom:x", "sk-pinned-123456789")
            .unwrap();
        r.pins
            .check_and_pin("provider.custom:x", "http://127.0.0.1:1")
            .unwrap();
        let (sink, rx) = ChannelSink::pair();
        r.start(
            req(
                "p1",
                "custom:x",
                "http://localhost:9/v1".into(),
                RelayAuth::Header {
                    header: "x-api-key".into(),
                    scheme: None,
                },
            ),
            sink,
        )
        .unwrap();
        let events = ChannelSink::collect_until_end(rx, "p1").await;
        assert_eq!(events[0]["status"], 403);
        assert!(decode(&events).contains("pinned"));
    }

    #[tokio::test]
    async fn abort_stops_the_stream() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = relay(dir.path(), RelayConfig::default());
        let (port, _cap) = sse_server(
            vec!["data: 1\n\n", "data: 2\n\n", "data: 3\n\n"],
            Duration::from_millis(400),
        )
        .await;
        let (sink, mut rx) = ChannelSink::pair();
        r.start(
            req(
                "a1",
                "ollama",
                format!("http://localhost:{port}/x"),
                RelayAuth::None,
            ),
            sink,
        )
        .unwrap();
        // Wait for the head, then abort.
        let first = rx.recv().await.unwrap();
        assert_eq!(first["status"], 200);
        r.abort("a1");
        let rest = ChannelSink::collect_until_end(rx, "a1").await;
        let last = rest.last().unwrap();
        assert_eq!(last["error"], "aborted");
        assert_eq!(last["end"], true);
        assert!(!decode(&rest).contains("data: 3"));
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(r.inflight(), 0);
    }

    #[tokio::test]
    async fn idle_timeout_reports_error() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = relay(
            dir.path(),
            RelayConfig {
                idle_timeout: Duration::from_millis(100),
                ..RelayConfig::default()
            },
        );
        let (port, _cap) = sse_server(vec!["data: late\n\n"], Duration::from_millis(600)).await;
        let (sink, rx) = ChannelSink::pair();
        r.start(
            req(
                "t1",
                "ollama",
                format!("http://127.0.0.1:{port}/"),
                RelayAuth::None,
            ),
            sink,
        )
        .unwrap();
        let events = ChannelSink::collect_until_end(rx, "t1").await;
        assert!(events.last().unwrap()["error"]
            .as_str()
            .unwrap()
            .contains("idle"));
    }

    #[tokio::test]
    async fn url_allow_list() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = relay(dir.path(), RelayConfig::default());
        for bad in [
            "http://example.com/v1",
            "http://10.0.0.1/v1",
            "http://127.0.0.2/v1",
            "file:///etc/passwd",
            "ftp://x/y",
            "kimo-relay://evil/v1/messages",
            "https://user:pw@api.example.com/",
        ] {
            let e = r
                .start(
                    req("u", "ollama", bad.into(), RelayAuth::None),
                    ChannelSink::pair().0,
                )
                .unwrap_err();
            assert!(
                ["PERMISSION", "INVALID"].contains(&e.code.as_str()),
                "{bad}: {e}"
            );
        }
        assert!(check_url("https://api.anthropic.com/v1/messages").is_ok());
        assert!(check_url("http://localhost:11434/v1").is_ok());
        assert!(check_url("http://127.0.0.1:8080/").is_ok());
        assert!(check_url("http://[::1]:8080/").is_ok());
        assert!(check_url("kimo-relay://vertex/v1/messages").is_ok());
        // Built-in keys only go to their official hosts.
        let e = r
            .start(
                req(
                    "b",
                    "anthropic",
                    "https://proxy.example/v1/messages".into(),
                    RelayAuth::Header {
                        header: "x-api-key".into(),
                        scheme: None,
                    },
                ),
                ChannelSink::pair().0,
            )
            .unwrap_err();
        assert_eq!(e.code, "PERMISSION");
        // Cloud auth must match the route.
        let e = r
            .start(
                req(
                    "c",
                    "bedrock",
                    "kimo-relay://bedrock/v1/messages".into(),
                    RelayAuth::None,
                ),
                ChannelSink::pair().0,
            )
            .unwrap_err();
        assert_eq!(e.code, "INVALID");
    }

    #[tokio::test]
    async fn missing_key_is_a_synthetic_401() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = relay(dir.path(), RelayConfig::default());
        let (sink, rx) = ChannelSink::pair();
        r.start(
            req(
                "k1",
                "anthropic",
                "https://api.anthropic.com/v1/messages".into(),
                RelayAuth::Header {
                    header: "x-api-key".into(),
                    scheme: None,
                },
            ),
            sink,
        )
        .unwrap();
        let events = ChannelSink::collect_until_end(rx, "k1").await;
        assert_eq!(events[0]["status"], 401);
        assert!(decode(&events).contains("authentication_error"));
    }

    #[tokio::test]
    async fn unsupported_cloud_route_is_404() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = relay(dir.path(), RelayConfig::default());
        let (sink, rx) = ChannelSink::pair();
        let mut q = req(
            "v1",
            "vertex",
            "kimo-relay://vertex/v1/models".into(),
            RelayAuth::Cloud {
                platform: "vertex".into(),
                region: None,
                project: None,
                credentials: None,
                profile: None,
            },
        );
        q.method = "GET".into();
        r.start(q, sink).unwrap();
        let events = ChannelSink::collect_until_end(rx, "v1").await;
        assert_eq!(events[0]["status"], 404);
    }

    #[test]
    fn auth_json_shapes() {
        let a: RelayAuth =
            serde_json::from_value(json!({"kind": "header", "header": "x-api-key"})).unwrap();
        assert_eq!(
            a,
            RelayAuth::Header {
                header: "x-api-key".into(),
                scheme: None
            }
        );
        let a: RelayAuth = serde_json::from_value(json!({"kind": "none"})).unwrap();
        assert_eq!(a, RelayAuth::None);
        let a: RelayAuth = serde_json::from_value(
            json!({"kind": "cloud", "platform": "bedrock", "region": "us-east-1"}),
        )
        .unwrap();
        assert!(matches!(a, RelayAuth::Cloud { region: Some(r), .. } if r == "us-east-1"));
    }

    fn foundry(credentials: Option<&str>) -> RelayAuth {
        RelayAuth::Cloud {
            platform: "foundry".into(),
            region: None,
            project: Some("my-res".into()),
            credentials: credentials.map(String::from),
            profile: None,
        }
    }

    enum Planned {
        Send(Prepared),
        Synthetic(u16, String),
    }

    async fn plan_of(r: &Relay, q: &RelayRequest) -> Planned {
        let target = check_url(&q.url).unwrap();
        match r.plan(q, &target).await.unwrap() {
            Plan::Synthetic { status, body } => {
                Planned::Synthetic(status, String::from_utf8(body).unwrap())
            }
            Plan::Send { prepared, .. } => Planned::Send(prepared),
        }
    }

    async fn sent(r: &Relay, q: &RelayRequest) -> Prepared {
        match plan_of(r, q).await {
            Planned::Send(p) => p,
            Planned::Synthetic(status, body) => panic!("expected a request, got {status} {body}"),
        }
    }

    async fn refused(r: &Relay, q: &RelayRequest) -> (u16, String) {
        match plan_of(r, q).await {
            Planned::Synthetic(status, body) => (status, body),
            Planned::Send(p) => panic!("expected a synthetic response, got a request to {}", p.url),
        }
    }

    #[cfg(unix)]
    fn fake_az(dir: &std::path::Path, script: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join("az");
        std::fs::write(&p, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn foundry_entra_uses_the_azure_cli_token() {
        let dir = tempfile::tempdir().unwrap();
        let calls = dir.path().join("calls");
        let az = fake_az(
            dir.path(),
            &format!(
                "echo \"$@\" >> {}\necho '{{\"accessToken\":\"entra-tok\",\"expires_on\":4102444800}}'",
                calls.display()
            ),
        );
        let (r, secrets) = relay(
            dir.path(),
            RelayConfig {
                azure_cli: Some(az),
                ..RelayConfig::default()
            },
        );
        // Entra wins over a saved key when chosen.
        secrets.set("provider.foundry", "foundry-key-123").unwrap();
        let q = req(
            "f1",
            "foundry",
            "kimo-relay://foundry/v1/messages".into(),
            foundry(Some("entra")),
        );
        let p = sent(&r, &q).await;
        assert_eq!(
            p.url,
            "https://my-res.services.ai.azure.com/anthropic/v1/messages"
        );
        assert!(p
            .headers
            .contains(&("authorization".to_string(), "Bearer entra-tok".to_string())));
        assert!(!p.headers.iter().any(|(_, v)| v.contains("foundry-key")));
        // Cached: the CLI runs once.
        sent(&r, &q).await;
        let ran = std::fs::read_to_string(&calls).unwrap();
        assert_eq!(ran.lines().count(), 1);
        assert!(ran.contains("get-access-token --resource https://cognitiveservices.azure.com"));
        // `api-key` (and the default with a saved key) use the keychain key.
        for c in [Some("api-key"), None] {
            let q = req(
                "f2",
                "foundry",
                "kimo-relay://foundry/v1/messages".into(),
                foundry(c),
            );
            let p = sent(&r, &q).await;
            assert!(p
                .headers
                .contains(&("x-api-key".to_string(), "foundry-key-123".to_string())));
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn foundry_credential_errors_are_401() {
        let dir = tempfile::tempdir().unwrap();
        let az = fake_az(
            dir.path(),
            "echo 'ERROR: Please run az login to setup account.' >&2; exit 1",
        );
        let (r, _) = relay(
            dir.path(),
            RelayConfig {
                azure_cli: Some(az),
                ..RelayConfig::default()
            },
        );
        let url = "kimo-relay://foundry/v1/messages".to_string();
        let (status, body) = refused(
            &r,
            &req("e1", "foundry", url.clone(), foundry(Some("entra"))),
        )
        .await;
        assert_eq!(status, 401);
        assert!(body.contains("az login") && body.contains("authentication_error"));
        // No key saved: the default falls back to Entra; `api-key` says what to do.
        let (status, _) = refused(&r, &req("e2", "foundry", url.clone(), foundry(None))).await;
        assert_eq!(status, 401);
        let (status, body) =
            refused(&r, &req("e3", "foundry", url, foundry(Some("api-key")))).await;
        assert_eq!(status, 401);
        assert!(body.contains("No API key is saved for Foundry"));
    }

    #[tokio::test]
    async fn cloud_credential_choice_is_checked_at_start() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = relay(dir.path(), RelayConfig::default());
        let (sink, _rx) = ChannelSink::pair();
        let bad = |credentials: Option<&str>, profile: Option<&str>| {
            req(
                "c1",
                "bedrock",
                "kimo-relay://bedrock/v1/messages".into(),
                RelayAuth::Cloud {
                    platform: "bedrock".into(),
                    region: Some("us-east-1".into()),
                    project: None,
                    credentials: credentials.map(String::from),
                    profile: profile.map(String::from),
                },
            )
        };
        assert!(r.start(bad(Some("adc"), None), sink.clone()).is_err());
        assert!(r
            .start(bad(Some("sso"), Some("a b")), sink.clone())
            .is_err());
        let mut v = bad(None, None);
        v.url = "kimo-relay://vertex/v1/messages".into();
        v.auth = RelayAuth::Cloud {
            platform: "vertex".into(),
            region: None,
            project: None,
            credentials: Some("service-account".into()),
            profile: Some("x".into()),
        };
        assert!(r.start(v, sink).is_err());
    }

    #[tokio::test]
    async fn vertex_service_account_choice_without_a_key_is_401() {
        let dir = tempfile::tempdir().unwrap();
        let (r, _) = relay(dir.path(), RelayConfig::default());
        let q = req(
            "v2",
            "vertex",
            "kimo-relay://vertex/v1/messages".into(),
            RelayAuth::Cloud {
                platform: "vertex".into(),
                region: Some("us-east5".into()),
                project: Some("p".into()),
                credentials: Some("service-account".into()),
                profile: None,
            },
        );
        let (status, body) = refused(&r, &q).await;
        assert_eq!(status, 401);
        assert!(body.contains("Service account JSON"));
    }

    #[test]
    fn cloud_auth_json_carries_the_credential_choice() {
        let a: RelayAuth = serde_json::from_value(json!({
            "kind": "cloud", "platform": "bedrock", "region": "eu-west-1",
            "credentials": "sso", "profile": "design"
        }))
        .unwrap();
        assert_eq!(
            a,
            RelayAuth::Cloud {
                platform: "bedrock".into(),
                region: Some("eu-west-1".into()),
                project: None,
                credentials: Some("sso".into()),
                profile: Some("design".into()),
            }
        );
    }
}
