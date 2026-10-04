# Kimo local socket protocol `kimo-socket/1`

Status: Draft for M5 ([ADR 0013](../adr/0013-m5-mcp-server.md) §7). Normative types:
`packages/mcp-server/src/protocol.ts` and `topology.ts`. Licence: MIT.

The protocol connects an MCP relay (the Rust `kimo-mcp` shim shipped in the app bundle, or
`kimo mcp` in attach mode) to the running Kimo desktop app. It is a thin authenticated envelope
around plain MCP.

## 1. Endpoint

| OS | Endpoint | Permissions |
|---|---|---|
| macOS, Linux | Unix domain socket `~/.kimo/socket/kimo.sock` | directory 0700, socket 0600 |
| Windows | Named pipe `\\.\pipe\kimo-<username>` | ACL: current user only |

The app writes `~/.kimo/mcp/endpoint.json` (0600) once its listeners are up and removes it on
quit:

```json
{ "version": 1, "pid": 48213, "appVersion": "0.5.0", "socket": "/Users/me/.kimo/socket/kimo.sock",
  "socketProtocol": "kimo-socket/1", "http": { "url": "http://127.0.0.1:47820/mcp", "port": 47820 },
  "startedAtIso": "2026-10-04T09:12:00.000Z" }
```

A relay considers the app reachable when the file exists, its `pid` is alive and a hello succeeds.
A stale socket file (no listener) is removed by the app at start.

## 2. Framing

- UTF-8, newline-delimited JSON: exactly one JSON-RPC 2.0 message per line, terminated by `\n`
  (`\r\n` tolerated on input). No embedded newlines.
- Maximum line: 32 MiB. Longer → error −32005 and the connection closes.
- A line that is not JSON closes the connection.

## 3. Handshake

The client's first line MUST be:

```json
{"jsonrpc":"2.0","id":"hello","method":"kimo/hello","params":{
  "protocol":"kimo-socket/1","token":"<contents of ~/.kimo/mcp/token>",
  "relay":{"name":"kimo-mcp","version":"0.5.0"},"client":"claude-code",
  "pid":5123,"ppid":5100,"cwd":"/Users/me/repo"}}
```

- `token`: 32 random bytes, base64url, in `~/.kimo/mcp/token` (0600), rotated at every app start.
- `client`: slug written by the installer (`--client <slug>`); otherwise the MCP
  `clientInfo.name` is used. It becomes the origin `mcp:<client>.<session>`.
- No hello within 5 s, or any other first message → −32004 and close.

Success:

```json
{"jsonrpc":"2.0","id":"hello","result":{"protocol":"kimo-socket/1",
  "app":{"name":"kimo-desktop","version":"0.5.0","pid":48213},
  "connectionId":"c_7Hq2","heartbeatMs":10000,"documentHost":"ready"}}
```

Errors (JSON-RPC `error`, then close):

| Code | Meaning | `data` |
|---|---|---|
| −32001 | PROTOCOL_MISMATCH | `{ "supported": ["kimo-socket/1"] }` |
| −32002 | UNAUTHORIZED (bad token) | |
| −32003 | HOST_UNAVAILABLE (document host failed to start) | `{ "message": "…" }` |
| −32004 | HANDSHAKE_REQUIRED | |
| −32005 | FRAME_TOO_LARGE | |

## 4. After the handshake

Every line is an MCP JSON-RPC message, relayed verbatim in both directions (`initialize`,
`notifications/initialized`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`,
`notifications/cancelled`, …). The app routes them to the document host, which runs one MCP
server session per connection.

Methods starting with `kimo/` are **control messages**. Relays and the app consume them; they are
never forwarded to the agent host:

| Method | Direction | Kind | Meaning |
|---|---|---|---|
| `kimo/ping` | both | request → `{}` | Heartbeat |
| `kimo/bye` | both | notification | Graceful close |
| `kimo/hostRestarting` | app → relay | notification | The document host is restarting; in-flight calls will fail with TIMEOUT (retryable) |

## 5. Liveness and cleanup

- The app pings every `heartbeatMs` (10 s); after 3 missed pings it closes the connection and
  cancels the connection's in-flight calls (pending approval prompts resolve as
  `disconnected`).
- The relay exits when its stdin reaches EOF or when its parent pid disappears (polled every
  2 s). It never outlives the agent host.

## 6. Relay behaviour when the app is unavailable

- Not running at start: the shim answers `initialize` and `tools/list` from its embedded
  `generated/tools.json` and fails each `tools/call` with a Kimo envelope `{ok:false,
  errors:[{code:"APP_NOT_RUNNING", retryable:true, suggestion:"Start Kimo, or run kimo mcp
  (headless)"}]}`. It keeps probing the endpoint and attaches when the app appears.
- Disconnected mid-session: it reconnects for up to 30 s, replays the cached `initialize` and
  `notifications/initialized`, drops the duplicate `initialize` response, and fails requests
  that were in flight with JSON-RPC error −32010 `{kimoCode:"TIMEOUT", retryable:true}`.
- `--launch` (opt-in): start the app hidden and wait ≤ 15 s before answering the first call.

## 7. Inside the app

Rust authenticates the connection, then forwards each line to the hidden document host as the
Tauri event `kimo://mcp-in {connectionId, message}`; the host writes back with the command
`kimo_mcp_send {connectionId, message}`. `kimo://mcp-connection` announces opens (with the
hello) and closes. While the host is `starting`, Rust queues messages for ≤ 15 s. Rust never
reads or changes document content.

## 8. Streamable HTTP

Optional (Settings › Agents › HTTP). `http://127.0.0.1:<port>/mcp`, loopback only, default port
47820 (else ephemeral, published in `endpoint.json`). Every request needs `Authorization: Bearer
<token>` with a per-host token from `~/.kimo/mcp/http-tokens.json` (0600, rotatable). `Host` must
be `127.0.0.1`/`localhost`; requests with a browser `Origin` are rejected. Rust forwards each
request whole (`kimo://mcp-http-request`) and streams the response from the host
(`kimo_mcp_http_respond`, chunked, first chunk with status and headers); the host uses the MCP
SDK's web-standard Streamable HTTP transport.

## 9. Versioning

`kimo-socket/<major>`. Additive control methods do not bump the major; any change to framing,
handshake or relaying does. The app lists every major it accepts in `PROTOCOL_MISMATCH.data`.
