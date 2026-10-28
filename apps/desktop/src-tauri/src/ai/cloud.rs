//! Cloud routes of the relay (`kimo-relay://bedrock|vertex|foundry/…`, ADR 0014 §4): the agent
//! speaks the Anthropic Messages wire to these URLs and Rust maps each call onto the platform's
//! endpoint with its own credentials:
//!
//! - **Bedrock**: AWS SigV4 (keychain JSON `{accessKeyId, secretAccessKey, sessionToken?}`, the
//!   `AWS_*` env vars, a profile's static keys in `~/.aws/credentials` / `~/.aws/config`, or an
//!   IAM Identity Center (SSO) profile through the `aws sso login` token cache) or a Bedrock API
//!   key (a non-JSON keychain value, or `AWS_BEARER_TOKEN_BEDROCK`) →
//!   `invoke[-with-response-stream]`; the AWS event stream is re-encoded as Anthropic SSE so the
//!   SDK parses it unchanged.
//! - **Vertex**: Google ADC (keychain JSON, `GOOGLE_APPLICATION_CREDENTIALS`, or gcloud's
//!   `application_default_credentials.json`; `authorized_user` and `service_account` types) →
//!   `rawPredict` / `streamRawPredict` (already SSE).
//! - **Foundry**: `https://<resource>.services.ai.azure.com/anthropic/…` with the keychain API
//!   key, or a Microsoft Entra ID token from the Azure CLI (`az account get-access-token`).
//!
//! The provider card's credential choice arrives as the relay auth's `credentials` (and, for
//! Bedrock, `profile`); see [`check_credentials`].
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

/// Where credential lookups read the environment and the home directory (the process's, or a
/// fixed set in tests).
pub struct CloudEnv {
    vars: Option<std::collections::HashMap<String, String>>,
    home: Option<PathBuf>,
}

impl CloudEnv {
    pub fn process() -> Self {
        Self {
            vars: None,
            home: home(),
        }
    }

    #[cfg(test)]
    pub fn fixed(vars: &[(&str, &str)], home: Option<&Path>) -> Self {
        Self {
            vars: Some(
                vars.iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            ),
            home: home.map(Path::to_path_buf),
        }
    }

    fn var(&self, name: &str) -> Option<String> {
        match &self.vars {
            Some(m) => m.get(name).filter(|v| !v.trim().is_empty()).cloned(),
            None => env_nonempty(name),
        }
    }

    fn aws_file(&self, var: &str, name: &str) -> Option<PathBuf> {
        self.var(var)
            .map(PathBuf::from)
            .or_else(|| self.home.as_ref().map(|h| h.join(".aws").join(name)))
    }

    /// `[section]` of `~/.aws/config` for a profile (`[default]` / `[profile <name>]`).
    fn aws_config_profile(
        &self,
        profile: &str,
    ) -> Option<std::collections::HashMap<String, String>> {
        let text = std::fs::read_to_string(self.aws_file("AWS_CONFIG_FILE", "config")?).ok()?;
        ini_section(&text, &format!("profile {profile}")).or_else(|| {
            (profile == "default")
                .then(|| ini_section(&text, "default"))
                .flatten()
        })
    }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Validates the provider card's credential choice (`auth.credentials`) and Bedrock profile.
pub fn check_credentials(
    platform: &str,
    credentials: Option<&str>,
    profile: Option<&str>,
) -> R<()> {
    let allowed: &[&str] = match platform {
        "bedrock" => &["profile", "env", "sso"],
        "vertex" => &["adc", "service-account"],
        "foundry" => &["entra", "api-key"],
        _ => &[],
    };
    if let Some(c) = credentials {
        if !allowed.contains(&c) {
            return Err(invalid(format!("Unknown {platform} credentials \"{c}\"")));
        }
    }
    if let Some(p) = profile {
        if platform != "bedrock" {
            return Err(invalid("Only Bedrock takes an AWS profile"));
        }
        if p.is_empty()
            || p.len() > 128
            || !p
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'@' | b'+'))
        {
            return Err(invalid(format!("Invalid AWS profile \"{p}\"")));
        }
    }
    Ok(())
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
    /// An IAM Identity Center profile: the relay trades the cached `aws sso login` token for
    /// role credentials ([`sso_credentials_request`]) before signing.
    Sso(SsoRole),
}

/// An SSO profile with a live cached access token.
#[derive(Clone)]
pub struct SsoRole {
    pub profile: String,
    pub region: String,
    pub account_id: String,
    pub role_name: String,
    pub access_token: Secret,
}

impl SsoRole {
    /// Cache key for the role credentials (never the token).
    pub fn cache_key(&self) -> String {
        format!(
            "{}\u{0}{}\u{0}{}",
            self.profile, self.account_id, self.role_name
        )
    }
}

fn parse_keychain_bedrock(s: &Secret) -> R<BedrockAuth> {
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
    Ok(BedrockAuth::Bearer(Secret::new(v)))
}

fn static_keys(sec: &std::collections::HashMap<String, String>) -> Option<AwsCreds> {
    let (a, s) = (
        sec.get("aws_access_key_id")?,
        sec.get("aws_secret_access_key")?,
    );
    Some(AwsCreds {
        access_key: a.clone(),
        secret_key: Secret::new(s.clone()),
        session_token: sec.get("aws_session_token").cloned().map(Secret::new),
    })
}

/// Parses `expiresAt` of the SSO token cache (`2024-01-01T00:00:00Z`, older CLIs `…UTC`).
fn parse_aws_time(s: &str) -> Option<u64> {
    let s = s.trim();
    let s = s
        .strip_suffix("UTC")
        .map(|p| format!("{p}Z"))
        .unwrap_or(s.to_string());
    time::OffsetDateTime::parse(&s, &time::format_description::well_known::Rfc3339)
        .ok()
        .and_then(|t| u64::try_from(t.unix_timestamp()).ok())
}

/// The SSO role of a profile (`sso_session` → `[sso-session <name>]`, or the legacy inline
/// `sso_start_url`/`sso_region`) with its cached token; `Ok(None)` when it is not an SSO profile.
fn sso_role(
    env: &CloudEnv,
    sec: &std::collections::HashMap<String, String>,
    profile: &str,
    now_s: u64,
) -> R<Option<SsoRole>> {
    let (Some(account_id), Some(role_name)) = (sec.get("sso_account_id"), sec.get("sso_role_name"))
    else {
        return Ok(None);
    };
    let (cache_name, region) = if let Some(session) = sec.get("sso_session") {
        let text = env
            .aws_file("AWS_CONFIG_FILE", "config")
            .and_then(|p| std::fs::read_to_string(p).ok())
            .unwrap_or_default();
        let ss = ini_section(&text, &format!("sso-session {session}")).ok_or_else(|| {
            unsupported(format!(
                "AWS profile \"{profile}\" names sso-session \"{session}\", which ~/.aws/config does not define"
            ))
        })?;
        let region = ss
            .get("sso_region")
            .or_else(|| sec.get("sso_region"))
            .cloned();
        (session.clone(), region)
    } else {
        let Some(url) = sec.get("sso_start_url") else {
            return Ok(None);
        };
        (url.clone(), sec.get("sso_region").cloned())
    };
    let region = region
        .ok_or_else(|| unsupported(format!("AWS profile \"{profile}\" has no sso_region")))?;
    check_label(&region, "SSO region")?;
    if account_id.len() != 12 || !account_id.bytes().all(|b| b.is_ascii_digit()) {
        return Err(invalid(format!("Invalid sso_account_id \"{account_id}\"")));
    }
    let digest = ring::digest::digest(
        &ring::digest::SHA1_FOR_LEGACY_USE_ONLY,
        cache_name.as_bytes(),
    );
    let login = || {
        unsupported(format!(
            "The AWS SSO session of profile \"{profile}\" is missing or expired: run `aws sso login --profile {profile}`"
        ))
    };
    let cache = env
        .home
        .as_ref()
        .map(|h| {
            h.join(".aws")
                .join("sso")
                .join("cache")
                .join(format!("{}.json", hex::encode(digest.as_ref())))
        })
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .ok_or_else(login)?;
    let token = cache
        .get("accessToken")
        .and_then(Value::as_str)
        .ok_or_else(login)?;
    let expires = cache
        .get("expiresAt")
        .and_then(Value::as_str)
        .and_then(parse_aws_time)
        .ok_or_else(login)?;
    if expires <= now_s + 60 {
        return Err(login());
    }
    Ok(Some(SsoRole {
        profile: profile.to_string(),
        region,
        account_id: account_id.clone(),
        role_name: role_name.clone(),
        access_token: Secret::new(token),
    }))
}

/// Credentials per the provider's choice (`credentials`: `profile` | `env` | `sso`; omitted =
/// the default chain). A key saved in the keychain always wins; then `env`: `AWS_*` only;
/// `profile`: the profile's static keys (`~/.aws/credentials`, then `~/.aws/config`), else its
/// SSO role; `sso`: the profile's SSO role only. The default chain is env, then the profile.
pub fn bedrock_auth(
    keychain: Option<&Secret>,
    credentials: Option<&str>,
    profile: Option<&str>,
) -> R<BedrockAuth> {
    bedrock_auth_in(
        &CloudEnv::process(),
        keychain,
        credentials,
        profile,
        now_unix(),
    )
}

pub fn bedrock_auth_in(
    env: &CloudEnv,
    keychain: Option<&Secret>,
    credentials: Option<&str>,
    profile: Option<&str>,
    now_s: u64,
) -> R<BedrockAuth> {
    if let Some(s) = keychain {
        return parse_keychain_bedrock(s);
    }
    let source = credentials.unwrap_or("auto");
    if matches!(source, "auto" | "env") {
        if let Some(t) = env.var("AWS_BEARER_TOKEN_BEDROCK") {
            return Ok(BedrockAuth::Bearer(Secret::new(t)));
        }
        if let (Some(a), Some(s)) = (
            env.var("AWS_ACCESS_KEY_ID"),
            env.var("AWS_SECRET_ACCESS_KEY"),
        ) {
            return Ok(BedrockAuth::SigV4(AwsCreds {
                access_key: a,
                secret_key: Secret::new(s),
                session_token: env.var("AWS_SESSION_TOKEN").map(Secret::new),
            }));
        }
        if source == "env" {
            return Err(unsupported(
                "No AWS credentials in the environment: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or AWS_BEARER_TOKEN_BEDROCK), or choose an AWS profile",
            ));
        }
    }
    let profile = profile
        .filter(|p| !p.trim().is_empty())
        .map(|p| p.trim().to_string())
        .or_else(|| env.var("AWS_PROFILE"))
        .unwrap_or_else(|| "default".into());
    let creds_section = env
        .aws_file("AWS_SHARED_CREDENTIALS_FILE", "credentials")
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| ini_section(&t, &profile));
    let config_section = env.aws_config_profile(&profile);
    if source != "sso" {
        if let Some(c) = creds_section
            .as_ref()
            .and_then(static_keys)
            .or_else(|| config_section.as_ref().and_then(static_keys))
        {
            return Ok(BedrockAuth::SigV4(c));
        }
    }
    if let Some(sec) = &config_section {
        if let Some(role) = sso_role(env, sec, &profile, now_s)? {
            return Ok(BedrockAuth::Sso(role));
        }
    }
    if source == "sso" {
        return Err(unsupported(format!(
            "AWS profile \"{profile}\" has no SSO configuration (sso_session or sso_start_url, sso_account_id, sso_role_name) in ~/.aws/config"
        )));
    }
    if creds_section.is_some() || config_section.is_some() {
        return Err(unsupported(format!(
            "AWS profile \"{profile}\" has no static keys or SSO role (credential_process and assume-role profiles are not supported by the relay yet); save an access key or a Bedrock API key in Settings"
        )));
    }
    Err(unsupported(format!(
        "No AWS credentials: AWS profile \"{profile}\" is not in ~/.aws; save an access key or Bedrock API key in Settings, or set AWS_ACCESS_KEY_ID"
    )))
}

/// The IAM Identity Center `GetRoleCredentials` call for an SSO role: (url, headers).
pub fn sso_credentials_request(r: &SsoRole) -> R<(String, Vec<(String, String)>)> {
    check_label(&r.region, "SSO region")?;
    Ok((
        format!(
            "https://portal.sso.{}.amazonaws.com/federation/credentials?account_id={}&role_name={}",
            r.region,
            uri_encode(&r.account_id, true),
            uri_encode(&r.role_name, true)
        ),
        vec![(
            "x-amz-sso_bearer_token".into(),
            r.access_token.expose().to_string(),
        )],
    ))
}

/// `GetRoleCredentials` response → credentials and their expiry (unix seconds).
pub fn parse_sso_credentials(v: &Value) -> R<(AwsCreds, Option<u64>)> {
    let rc = v
        .get("roleCredentials")
        .ok_or_else(|| invalid("AWS SSO returned no roleCredentials"))?;
    let get = |k: &str| rc.get(k).and_then(Value::as_str).map(String::from);
    let (Some(a), Some(s)) = (get("accessKeyId"), get("secretAccessKey")) else {
        return Err(invalid("AWS SSO role credentials are incomplete"));
    };
    Ok((
        AwsCreds {
            access_key: a,
            secret_key: Secret::new(s),
            session_token: get("sessionToken").map(Secret::new),
        },
        rc.get("expiration")
            .and_then(Value::as_u64)
            .map(|ms| ms / 1000),
    ))
}

/// Region: request field, then `AWS_REGION`, `AWS_DEFAULT_REGION`, the profile's `region` in
/// `~/.aws/config` (`profile`, else `AWS_PROFILE`, else `default`).
pub fn bedrock_region(requested: Option<&str>, profile: Option<&str>) -> R<String> {
    bedrock_region_in(&CloudEnv::process(), requested, profile)
}

pub fn bedrock_region_in(
    env: &CloudEnv,
    requested: Option<&str>,
    profile: Option<&str>,
) -> R<String> {
    let r = requested
        .map(String::from)
        .filter(|s| !s.is_empty())
        .or_else(|| env.var("AWS_REGION"))
        .or_else(|| env.var("AWS_DEFAULT_REGION"))
        .or_else(|| {
            let profile = profile
                .filter(|p| !p.trim().is_empty())
                .map(|p| p.trim().to_string())
                .or_else(|| env.var("AWS_PROFILE"))
                .unwrap_or_else(|| "default".into());
            env.aws_config_profile(&profile)?.get("region").cloned()
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
        BedrockAuth::Sso(_) => {
            return Err(invalid(
                "SSO credentials must be exchanged before the request is signed",
            ));
        }
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

/// Google credentials per the provider's choice (`credentials`): `service-account` → the
/// keychain JSON only; `adc` → `GOOGLE_APPLICATION_CREDENTIALS` / gcloud ADC only (a stale
/// keychain value is ignored); omitted → keychain, then ADC.
pub fn google_creds(keychain: Option<&Secret>, credentials: Option<&str>) -> R<GoogleCreds> {
    let keychain = match credentials {
        Some("adc") => None,
        Some("service-account") => Some(keychain.ok_or_else(|| {
            unsupported(
                "No service-account JSON is saved for Vertex: choose 'Service account JSON…' in Settings, or switch to application default credentials",
            )
        })?),
        _ => keychain,
    };
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

/// How the relay authenticates to a Foundry resource.
pub enum FoundryAuth {
    /// The resource's API key (keychain).
    Key(Secret),
    /// A Microsoft Entra ID access token (Azure CLI).
    Entra(Secret),
}

/// Entra ID resource the Foundry token is requested for.
pub const FOUNDRY_ENTRA_RESOURCE: &str = "https://cognitiveservices.azure.com";

/// `az account get-access-token --output json` → (token, expiry unix seconds if given).
pub fn parse_az_token(stdout: &[u8]) -> R<(Secret, Option<u64>)> {
    let v: Value = serde_json::from_slice(stdout)
        .map_err(|_| invalid("The Azure CLI did not return a token (JSON expected)"))?;
    let tok = v
        .get("accessToken")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| invalid("The Azure CLI returned no accessToken"))?;
    let exp = v.get("expires_on").and_then(|e| {
        e.as_u64()
            .or_else(|| e.as_str().and_then(|s| s.trim().parse().ok()))
    });
    Ok((Secret::new(tok), exp))
}

/// Candidate paths of the Azure CLI (PATH, then the usual install dirs; GUI apps on macOS start
/// with a minimal PATH).
pub fn azure_cli_candidates() -> Vec<PathBuf> {
    let name = if cfg!(windows) { "az.cmd" } else { "az" };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if cfg!(windows) {
        dirs.push(PathBuf::from(
            r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin",
        ));
        dirs.push(PathBuf::from(
            r"C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin",
        ));
    } else {
        for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            dirs.push(PathBuf::from(d));
        }
    }
    dirs.into_iter().map(|d| d.join(name)).collect()
}

pub fn prepare_foundry(
    path: &str,
    query: Option<&str>,
    body: Vec<u8>,
    auth: &FoundryAuth,
    resource: Option<&str>,
) -> R<Prepared> {
    let resource = resource
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid("No Foundry resource: set it (project) on the Foundry provider"))?;
    check_label(resource, "Foundry resource")?;
    let q = query.map(|q| format!("?{q}")).unwrap_or_default();
    let headers = match auth {
        FoundryAuth::Key(key) => vec![
            ("x-api-key".into(), key.expose().to_string()),
            ("api-key".into(), key.expose().to_string()),
        ],
        FoundryAuth::Entra(tok) => {
            vec![("authorization".into(), format!("Bearer {}", tok.expose()))]
        }
    };
    Ok(Prepared {
        url: format!("https://{resource}.services.ai.azure.com/anthropic{path}{q}"),
        headers,
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
        let a = bedrock_auth(Some(&Secret::new("ABSKexample")), None, None).unwrap();
        assert!(matches!(a, BedrockAuth::Bearer(_)));
        // A saved key wins over every credential source.
        let a = bedrock_auth(
            Some(&Secret::new(
                r#"{"accessKeyId":"AK","secretAccessKey":"SK"}"#,
            )),
            Some("sso"),
            Some("design"),
        )
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
            google_creds(Some(&Secret::new(r#"{"type":"external_account"}"#)), None)
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

    fn write(dir: &Path, rel: &str, text: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    const NOW: u64 = 1_800_000_000; // 2027-01-15

    fn sso_home() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        write(
            d.path(),
            ".aws/config",
            "[default]\nregion = us-west-2\n\n[profile keys]\naws_access_key_id = AKCFG\naws_secret_access_key = SKCFG\nregion = eu-west-1\n\n[profile design]\nsso_session = acme\nsso_account_id = 123456789012\nsso_role_name = Designer\nregion = eu-central-1\n\n[sso-session acme]\nsso_start_url = https://acme.awsapps.com/start\nsso_region = us-east-1\n\n[profile legacy]\nsso_start_url = https://old.awsapps.com/start\nsso_region = eu-west-1\nsso_account_id = 210987654321\nsso_role_name = Admin\n\n[profile procs]\ncredential_process = /bin/echo\n",
        );
        write(
            d.path(),
            ".aws/credentials",
            "[default]\naws_access_key_id = AKDEF\naws_secret_access_key = SKDEF\n\n[work]\naws_access_key_id = AKWORK\naws_secret_access_key = SKWORK\naws_session_token = TOK\n",
        );
        let sha = |s: &str| {
            hex::encode(ring::digest::digest(
                &ring::digest::SHA1_FOR_LEGACY_USE_ONLY,
                s.as_bytes(),
            ))
        };
        // Session-based profiles hash the session name; legacy ones the start URL.
        write(
            d.path(),
            &format!(".aws/sso/cache/{}.json", sha("acme")),
            r#"{"accessToken":"sso-token","expiresAt":"2027-01-15T09:00:00Z","region":"us-east-1"}"#,
        );
        write(
            d.path(),
            &format!(
                ".aws/sso/cache/{}.json",
                sha("https://old.awsapps.com/start")
            ),
            r#"{"accessToken":"old","expiresAt":"2020-01-01T00:00:00UTC"}"#,
        );
        d
    }

    #[test]
    fn bedrock_credential_sources() {
        let home = sso_home();
        let h = Some(home.path());
        let env_keys = [
            ("AWS_ACCESS_KEY_ID", "AKENV"),
            ("AWS_SECRET_ACCESS_KEY", "SKENV"),
        ];
        let ak = |a: BedrockAuth| match a {
            BedrockAuth::SigV4(c) => c.access_key,
            BedrockAuth::Bearer(_) => "bearer".into(),
            BedrockAuth::Sso(r) => format!("sso:{}", r.role_name),
        };
        // Default chain: env first, then the profile.
        let env = CloudEnv::fixed(&env_keys, h);
        assert_eq!(
            ak(bedrock_auth_in(&env, None, None, None, NOW).unwrap()),
            "AKENV"
        );
        assert_eq!(
            ak(bedrock_auth_in(&env, None, Some("env"), None, NOW).unwrap()),
            "AKENV"
        );
        // `profile` ignores the environment and picks the named profile (over AWS_PROFILE).
        let env = CloudEnv::fixed(&[env_keys[0], env_keys[1], ("AWS_PROFILE", "keys")], h);
        let a = bedrock_auth_in(&env, None, Some("profile"), Some("work"), NOW).unwrap();
        assert!(
            matches!(&a, BedrockAuth::SigV4(c) if c.session_token.as_ref().map(|t| t.expose()) == Some("TOK"))
        );
        assert_eq!(ak(a), "AKWORK");
        // Static keys in ~/.aws/config; AWS_PROFILE when no profile is given.
        assert_eq!(
            ak(bedrock_auth_in(&env, None, Some("profile"), None, NOW).unwrap()),
            "AKCFG"
        );
        let env = CloudEnv::fixed(&[], h);
        assert_eq!(
            ak(bedrock_auth_in(&env, None, Some("profile"), None, NOW).unwrap()),
            "AKDEF"
        );
        // `env` with nothing set is an error, never a silent fallback to a profile.
        let e = bedrock_auth_in(&env, None, Some("env"), None, NOW)
            .err()
            .unwrap();
        assert_eq!(e.code, "UNSUPPORTED");
        assert!(e.message.contains("environment"));
        // An SSO profile through `profile` or `sso`.
        for src in [Some("profile"), Some("sso"), None] {
            let a = bedrock_auth_in(&env, None, src, Some("design"), NOW).unwrap();
            let BedrockAuth::Sso(r) = a else {
                panic!("expected SSO")
            };
            assert_eq!(
                (
                    r.region.as_str(),
                    r.account_id.as_str(),
                    r.access_token.expose()
                ),
                ("us-east-1", "123456789012", "sso-token")
            );
        }
        // `sso` on a static-key profile, an expired session, unsupported profile kinds.
        let e = bedrock_auth_in(&env, None, Some("sso"), Some("work"), NOW)
            .err()
            .unwrap();
        assert!(e.message.contains("no SSO configuration"));
        let e = bedrock_auth_in(&env, None, Some("sso"), Some("legacy"), NOW)
            .err()
            .unwrap();
        assert!(e.message.contains("aws sso login --profile legacy"));
        let e = bedrock_auth_in(&env, None, Some("profile"), Some("procs"), NOW)
            .err()
            .unwrap();
        assert!(e.message.contains("credential_process"));
        let e = bedrock_auth_in(&env, None, None, Some("nope"), NOW)
            .err()
            .unwrap();
        assert!(e.message.contains("\"nope\" is not in ~/.aws"));
        // Expired 60 s early.
        let e = bedrock_auth_in(&env, None, Some("sso"), Some("design"), 1_800_003_580).err();
        assert!(e.is_some());
    }

    #[test]
    fn sso_role_credentials_exchange() {
        let r = SsoRole {
            profile: "design".into(),
            region: "us-east-1".into(),
            account_id: "123456789012".into(),
            role_name: "Design Role".into(),
            access_token: Secret::new("tok"),
        };
        let (url, headers) = sso_credentials_request(&r).unwrap();
        assert_eq!(
            url,
            "https://portal.sso.us-east-1.amazonaws.com/federation/credentials?account_id=123456789012&role_name=Design%20Role"
        );
        assert_eq!(
            headers,
            vec![("x-amz-sso_bearer_token".to_string(), "tok".to_string())]
        );
        let (c, exp) = parse_sso_credentials(&json!({"roleCredentials": {
            "accessKeyId": "ASIA", "secretAccessKey": "s", "sessionToken": "t", "expiration": 1_800_000_000_000u64
        }}))
        .unwrap();
        assert_eq!(c.access_key, "ASIA");
        assert_eq!(exp, Some(1_800_000_000));
        assert!(parse_sso_credentials(&json!({"message": "Session token not found"})).is_err());
    }

    #[test]
    fn vertex_credential_choice() {
        let sa =
            Secret::new(r#"{"type":"service_account","client_email":"a@b","private_key":"x"}"#);
        let c = google_creds(Some(&sa), Some("service-account")).unwrap();
        assert_eq!(c.source, "keychain");
        let e = google_creds(None, Some("service-account")).err().unwrap();
        assert_eq!(e.code, "UNSUPPORTED");
        assert!(e.message.contains("Service account JSON"));
        // `adc` never reads the keychain (whatever ADC this machine has, it is not "keychain").
        if let Ok(c) = google_creds(Some(&sa), Some("adc")) {
            assert_ne!(c.source, "keychain");
        }
    }

    #[test]
    fn credential_choices_are_validated() {
        assert!(check_credentials("bedrock", Some("sso"), Some("my.profile-1")).is_ok());
        assert!(check_credentials("bedrock", Some("adc"), None).is_err());
        assert!(check_credentials("bedrock", None, Some("bad profile")).is_err());
        assert!(check_credentials("vertex", Some("service-account"), None).is_ok());
        assert!(check_credentials("vertex", None, Some("p")).is_err());
        assert!(check_credentials("foundry", Some("entra"), None).is_ok());
        assert!(check_credentials("foundry", Some("cli"), None).is_err());
    }

    #[test]
    fn az_token_output() {
        let (t, e) = parse_az_token(
            br#"{"accessToken":"eyJ0","expiresOn":"2027-01-15 10:00:00.000000","expires_on":1800003600,"tokenType":"Bearer"}"#,
        )
        .unwrap();
        assert_eq!((t.expose(), e), ("eyJ0", Some(1_800_003_600)));
        let (_, e) = parse_az_token(br#"{"accessToken":"x","expires_on":"1800003600"}"#).unwrap();
        assert_eq!(e, Some(1_800_003_600));
        assert!(parse_az_token(b"ERROR: Please run 'az login'").is_err());
        assert!(parse_az_token(br#"{"accessToken":""}"#).is_err());
    }
}
