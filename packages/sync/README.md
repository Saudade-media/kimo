# @kimo/sync

Persistence and transport for a `DocStore` (from `@kimo/editor-state`) behind one interface,
`SyncProvider` (teardown 9.1, [ADR 0001](../../docs/adr/0001-monorepo-and-server-readiness.md)).
Providers move opaque binary CRDT updates or whole documents. They never edit the document
themselves: every edit still goes through the `editor-state` op layer, with an origin.

| Entry | Provider | Runtime |
|---|---|---|
| `@kimo/sync` | `SyncProvider`, `BaseProvider`, `MemoryHub` + `MemoryProvider`, network provider types | anywhere |
| `@kimo/sync/file` | `FileProvider` | Bun, Node |
| `@kimo/sync/indexeddb` | `IndexedDbProvider` (y-indexeddb) | browser, worker |

The main entry imports neither `node:*` nor IndexedDB code, so the web editor can import it
without bundling `fs`. A test checks this.

```ts
interface SyncProvider {
  readonly id: string
  readonly status: SyncStatus // detached | connecting | loading | synced | dirty | saving | read-only | error
  readonly store: DocStore | null
  attach(store: DocStore): Promise<void>
  detach(): Promise<void>
  onStatus(listener: (e: SyncStatusEvent) => void): () => void
}
```

## FileProvider

```ts
import { createDocStore } from "@kimo/editor-state"
import { FileProvider } from "@kimo/sync/file"

const store = createDocStore()
const file = new FileProvider({ path: "design/app.kimo", autosaveMs: 3000 })
await file.attach(store) // open → validate → load
// … edits through store.apply(ops, { origin: "user" }) …
await file.flush() // on blur / quit
await file.detach() // flushes by default
```

- **Load.** The provider reads the file and calls core-schema `openDocument` (parse, version
  check, migrate, validate). A load that fails is terminal. The file may be unreadable,
  unparsable, invalid, in a newer format, or use an unknown feature. In every such case the
  provider and the store become read-only, and nothing is ever written: `flush` is a no-op, and
  `save` and `acceptUpgrade` reject.
- **Autosave.** A change is written at most `autosaveMs` (default 3 s) after it was made.
  `flush()` writes immediately.
- **Canonical output.** Saves use the core-schema serializer, so loading a file and saving it
  again gives back the same bytes.
- **Atomic write.** The provider writes a temp file in the same directory, fsyncs it, renames
  it over the target and fsyncs the directory. It then reads the file back and compares SHA-256
  hashes. If the process crashes, the original file is intact.
- **Recovery.** An older-format file opens migrated in memory. Until the user calls
  `acceptUpgrade()` or does an explicit `save()`, autosaves go to
  `~/.kimo/recovery/<sha256(path)[:16]>.kimo`, never to the working file.
- **Reload.** `reload()` re-reads the file when there are no unsaved local edits. Merging with
  local edits is planned for M4.

## IndexedDbProvider

```ts
import { IndexedDbProvider } from "@kimo/sync/indexeddb"
await new IndexedDbProvider("kimo:doc:<id>").attach(store)
```

The provider keeps a private bridge `Y.Doc` that `y-indexeddb` persists, and relays updates
between it and the store. The provider therefore only uses the `DocStore` API. `attach` rejects
where `indexedDB` is missing. Tests are skipped under Bun, which has no IndexedDB.

## MemoryProvider

`MemoryProvider` is an in-process relay for tests and same-process replicas. `hub.pause()` and
`hub.resume()` simulate offline, concurrent edits.

## Network provider (multiplayer, not implemented in v1)

`src/network.ts` defines the contract: `NetworkProvider`, `NetworkProviderOptions`, and
`Awareness` with `PresenceState`. apps/server will implement it as a **y-websocket-compatible
relay**.

- **Wire protocol.** Messages use y-protocols framing: `0` sync, `1` awareness, `2` auth, and
  `3` query-awareness. A sync message carries one of three sub-messages: step 1 (a state
  vector), step 2 (a diff) or update.
- **Client mapping.** The provider needs only the `DocStore` methods:
  1. On open, it sends `SyncStep1(store.encodeStateVector())`.
  2. It answers a `SyncStep1(sv)` with `SyncStep2(store.encodeStateAsUpdate(sv))`.
  3. It applies each incoming step-2 diff or update with `store.applyUpdate(u, "remote:<server>")`.
     The store repairs post-merge cycles and orphans itself.
  4. It forwards each `store.onUpdate` event as an update, except updates whose origin is its
     own.
  5. It reconnects with back-off after a disconnect.
- **Relay (apps/server).** The relay serves one room per document at `/sync/<room>`. It keeps a
  server-side `DocStore` per room, which lets it validate merged state, persist snapshots, run
  headless exports and host remote MCP through the same op layer. Each upgrade request carries
  a bearer token that maps to read, comment or edit permission. The relay drops updates from
  read-only connections.
- **What does not change.** The editor, the op layer and per-origin undo stay as they are. Undo
  stays local to each replica, because `Y.UndoManager` never undoes remote changes.
