# @kimo/server

Reserved Bun service. **It is a stub in v1, and nothing in `apps/web` or `apps/desktop` depends on it.**
Kimo is local-first: the editor works fully offline with no server.

## What it does today

| Route | Response |
|---|---|
| `GET /healthz` | `200 {"ok": true}` |
| `GET /version` | `200 {"name": "@kimo/server", "version": "…"}` (`formatVersion` is added once `core-schema` is wired in) |
| `/sync` (WebSocket upgrade) | `501 Not Implemented` with a JSON body explaining that multiplayer is planned (see [ADR 0001](../../docs/adr/0001-monorepo-and-server-readiness.md)) |

```sh
bun run --filter @kimo/server start   # PORT=8787 by default, binds 127.0.0.1 (override with HOST)
```

Programmatic use:

```ts
import { createServer } from "@kimo/server"
const server = createServer({ port: 0 }) // ephemeral port
```

## Future role (teardown section 9.1, milestone v2)

- **Multiplayer relay.** A y-websocket-compatible endpoint at `/sync`. The `packages/sync` network provider connects here;
  because every edit already flows through `editor-state` ops with an origin, adding the provider turns on multiplayer
  without editor changes (the server-readiness rule).
- **Share links.** Self-hostable read-only/comment links to documents.
- **Remote MCP.** Optionally host the Kimo MCP server over Streamable HTTP, running headless exports and validating ops
  with `core-schema`, `editor-state` and `sync`.

Dependency direction: `apps/server` may depend on `core-schema`, `editor-state` and `sync`; no app or package depends on
`apps/server`.
