# 0008. The desktop MCP sidecar is a small Rust binary, not `bun build --compile`

- **Status:** Accepted
- **Date:** 2026-10-02
- **Teardown refs:** 9.2 (MCP sidecar on desktop; web-only MCP), 9.4 (single writer per file), 11.5 (host integration), 12 (M5), 13.3 (security of local endpoints), 13.4 (third-party licences)

## Context

Agent hosts (Claude Code, Codex, Gemini CLI, Cursor, …) launch MCP servers as stdio processes.
On desktop, that process must reach the running app's document host
([0002](0002-document-authority-in-tauri.md)) over `~/.kimo/socket/kimo.sock` (a named pipe on
Windows). The binary ships inside the Tauri bundle, so its size and licence obligations become
Kimo's. pen.dev uses the same topology with an undocumented protocol and suffers from zombie
processes (`[gh pencil#21]`).

`bun build --compile` would let us reuse TypeScript, but Bun statically links JavaScriptCore /
WebKit (LGPL-2), so every distributed compiled binary carries the LGPL relinking obligation
(publish object files and build instructions), and it embeds the whole Bun runtime (tens of MB,
INFERRED).

## Decision

1. Ship **`kimo-mcp`, a tiny Rust stdio shim**, inside the Tauri app. It speaks MCP over stdio to
   the agent host and relays to the app over the local socket using an **open, versioned,
   newline-delimited JSON-RPC 2.0 protocol** documented in `docs/spec/socket.md`.
2. The shim holds **no tool logic**: tool definitions, validation and execution live once in
   `packages/mcp-server` and run in the app's document host. The shim only frames, relays,
   heartbeats and exits when its parent closes.
3. The app also exposes **Streamable HTTP on localhost** with a per-host token, bound to loopback
   only.
4. Hosts without the desktop app run **`bunx @kimo/mcp`** (or `kimo mcp`) with the user's own
   Bun/Node; this path is not distributed as a compiled binary, so no LGPL obligation arises.
5. If the app is not running, the shim says so with a structured error; it never opens files itself
   (the headless path is `kimo mcp`, which honours the file lease, 9.4).

## Consequences

- Small binary, no second JS runtime in the app bundle, no LGPL relinking materials to publish.
- The shim is a second language in the repo (Rust is already present via Tauri). It must stay
  thin; anything that grows logic belongs in TypeScript.
- The socket protocol becomes a published, versioned contract with its own spec and tests.
- NOTICE for desktop releases must be generated from both the JS lockfile and Cargo
  (cargo-about), per 13.4.
- Security: socket permissions restricted to the user, per-host tokens, loopback-only HTTP,
  heartbeats and process cleanup (11.5, 13.3).

## Alternatives considered

- **`bun build --compile` binary.** Reuses TS, but tens of MB per binary and LGPL-2 relinking
  obligations for JavaScriptCore/WebKit. Acceptable only if NOTICE lists JavaScriptCore/WebKit
  (LGPL-2) and object files plus relinking instructions are published; not worth it for a relay.
- **Node SEA / pkg-style bundling:** similar size problem, and still a second runtime in the bundle.
- **Running the MCP server inside the app and asking hosts to connect over HTTP only:** not every
  host supports Streamable HTTP well; stdio is the lowest common denominator.

## Revisit when

All target hosts support Streamable HTTP reliably (the shim could then become optional), or Bun's
licensing changes.
