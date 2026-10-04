//! Answers while the app is not reachable (socket.md §6): `initialize` and `tools/list` from the
//! embedded `generated/tools.json`, every `tools/call` fails with an APP_NOT_RUNNING envelope,
//! other requests fail with −32010.

use crate::protocol::{codes, error_response, relay_error, result_response, Peek, RpcError};
use serde_json::{json, Value};
use std::sync::OnceLock;

/// The `tools/list` payload of the desktop host (`bun run gen:tools`; checked in CI).
pub const TOOLS_JSON: &str =
    include_str!("../../../../../packages/mcp-server/generated/tools.json");

/// `SERVER_NAME` / `SERVER_INSTRUCTIONS` of `packages/mcp-server/src/server.ts` (a test keeps
/// them equal).
pub const SERVER_NAME: &str = "kimo";
pub const SERVER_INSTRUCTIONS: &str = "Kimo is a local design canvas (.kimo files). Start with kimo_get_state, open files with kimo_open, read with kimo_query, edit only with kimo_apply_ops (pass baseRevision from your last result), verify with kimo_render. Every call targets an explicit docId. Results are JSON envelopes {ok, summary, revision, warnings, errors}; branch on errors[].code. Read kimo_read_docs before your first edit.";

/// MCP protocol eras the offline answer may echo (newest first).
pub const MCP_PROTOCOL_VERSIONS: &[&str] = &[
    "2026-07-28",
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
];

pub const SUGGESTION: &str = "Start Kimo, or run kimo mcp (headless)";

fn manifest() -> &'static Value {
    static M: OnceLock<Value> = OnceLock::new();
    M.get_or_init(|| serde_json::from_str(TOOLS_JSON).unwrap_or_else(|_| json!({ "tools": [] })))
}

pub fn tools() -> &'static [Value] {
    manifest()["tools"].as_array().map_or(&[], Vec::as_slice)
}

pub fn socket_protocol() -> &'static str {
    manifest()["socketProtocol"].as_str().unwrap_or("")
}

pub fn initialize_result(requested: Option<&str>) -> Value {
    let version = requested
        .filter(|v| MCP_PROTOCOL_VERSIONS.contains(v))
        .unwrap_or(MCP_PROTOCOL_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": {
            "tools": { "listChanged": true },
            "resources": { "listChanged": true },
            "prompts": { "listChanged": true }
        },
        "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
        "instructions": SERVER_INSTRUCTIONS
    })
}

/// Why the app cannot be reached, for the envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unavailable {
    NotRunning,
    /// The app answered hello with PROTOCOL_MISMATCH (app and shim versions differ).
    ProtocolMismatch,
}

impl Unavailable {
    pub fn code(self) -> &'static str {
        match self {
            Unavailable::NotRunning => "APP_NOT_RUNNING",
            Unavailable::ProtocolMismatch => "PROTOCOL_MISMATCH",
        }
    }
    fn message(self) -> &'static str {
        match self {
            Unavailable::NotRunning => "The Kimo app is not running.",
            Unavailable::ProtocolMismatch => {
                "The running Kimo app speaks a different socket protocol than this kimo-mcp."
            }
        }
    }
    fn suggestion(self) -> &'static str {
        match self {
            Unavailable::NotRunning => SUGGESTION,
            Unavailable::ProtocolMismatch => {
                "Update Kimo and point the agent host at the kimo-mcp bundled with it"
            }
        }
    }
}

/// The `tools/call` result: a Kimo failure envelope as structured content (ADR 0013 §4).
pub fn tool_failure(why: Unavailable) -> Value {
    let message = why.message();
    let summary = format!("{}: {message}", why.code());
    let envelope = json!({
        "ok": false,
        "summary": summary,
        "errors": [{
            "code": why.code(),
            "message": message,
            "suggestion": why.suggestion(),
            "retryable": why == Unavailable::NotRunning
        }],
        "rolledBack": true
    });
    json!({
        "content": [
            { "type": "text", "text": summary },
            { "type": "text", "text": envelope.to_string() }
        ],
        "structuredContent": envelope,
        "isError": true
    })
}

/// The response to one agent-host line while offline (`None` for notifications/responses).
pub fn answer(line: &str, why: Unavailable) -> Option<String> {
    let peek = match Peek::parse(line) {
        Ok(p) => p,
        Err(_) => {
            return Some(error_response(
                &Value::Null,
                &RpcError::new(codes::PARSE_ERROR, "Parse error"),
            ))
        }
    };
    if !peek.is_request() {
        return None;
    }
    let id = peek.id.clone().unwrap_or(Value::Null);
    let method = peek.method.as_deref().unwrap_or("");
    let result = match method {
        "initialize" => {
            let v: Value = serde_json::from_str(line).unwrap_or(Value::Null);
            initialize_result(v["params"]["protocolVersion"].as_str())
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => tool_failure(why),
        "resources/list" => json!({ "resources": [] }),
        "resources/templates/list" => json!({ "resourceTemplates": [] }),
        "prompts/list" => json!({ "prompts": [] }),
        _ => {
            return Some(error_response(
                &id,
                &relay_error(why.code(), why.message(), why.suggestion()),
            ))
        }
    };
    Some(result_response(&id, result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_embedded() {
        assert!(tools().len() >= 19);
        assert_eq!(socket_protocol(), crate::protocol::SOCKET_PROTOCOL);
        assert!(tools().iter().any(|t| t["name"] == "kimo_get_state"));
    }

    #[test]
    fn instructions_match_server_ts() {
        let ts = include_str!("../../../../../packages/mcp-server/src/server.ts");
        let flat: String = ts.split_whitespace().collect::<Vec<_>>().join(" ");
        assert!(flat.contains(&format!("SERVER_NAME = \"{SERVER_NAME}\"")));
        assert!(
            flat.contains(&format!("\"{SERVER_INSTRUCTIONS}\"")),
            "SERVER_INSTRUCTIONS drifted from server.ts"
        );
    }

    #[test]
    fn answers_offline() {
        let init = answer(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}"#,
            Unavailable::NotRunning,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&init).unwrap();
        assert_eq!(v["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(v["result"]["serverInfo"]["name"], "kimo");

        let call = answer(
            r#"{"jsonrpc":"2.0","id":"c","method":"tools/call","params":{"name":"kimo_get_state","arguments":{}}}"#,
            Unavailable::NotRunning,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&call).unwrap();
        assert_eq!(v["id"], "c");
        assert_eq!(v["result"]["isError"], true);
        let env = &v["result"]["structuredContent"];
        assert_eq!(env["ok"], false);
        assert_eq!(env["rolledBack"], true);
        assert_eq!(env["errors"][0]["code"], "APP_NOT_RUNNING");
        assert_eq!(env["errors"][0]["retryable"], true);

        assert!(answer(
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            Unavailable::NotRunning
        )
        .is_none());
        let other = answer(
            r#"{"jsonrpc":"2.0","id":9,"method":"resources/read","params":{"uri":"kimo://x"}}"#,
            Unavailable::NotRunning,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&other).unwrap();
        assert_eq!(v["error"]["code"], codes::RELAY_UNAVAILABLE);
        assert_eq!(v["error"]["data"]["kimoCode"], "APP_NOT_RUNNING");
    }
}
