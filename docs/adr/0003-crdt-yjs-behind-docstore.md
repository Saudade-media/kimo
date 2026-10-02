# 0003. Yjs as the document CRDT, behind a `DocStore` interface

- **Status:** Accepted
- **Date:** 2026-10-02
- **Teardown refs:** 9.2 (document state / CRDT; tree moves on Yjs), 9.3, 10.2 rule 3, 11.1 (revisions), 11.4 (undo per origin), 12 (M1, v2), 13.3 (cycles, large op logs)

## Context

The document store must support per-origin undo for users and agents (11.4), revisions for
optimistic concurrency (11.1), local persistence now and multiplayer later (12, v2), and it must
map cleanly onto the flat `.kimo` node table (10.2). Choosing a CRDT now, rather than a plain
immutable store, avoids a rewrite at the multiplayer milestone; but CRDT libraries differ on tree
moves, which is the hardest case for a design tool.

## Decision

1. **Yjs** is the v1 CRDT (MIT, ~18 kB gz, the widest provider ecosystem: y-websocket, y-webrtc,
   y-indexeddb, and a built-in `UndoManager` with `trackedOrigins` for per-origin undo).
2. **Only `editor-state` imports Yjs types in its implementation**, and exposes a Kimo-owned
   `DocStore` interface: apply an op group with an origin, read nodes, subscribe to changes,
   encode/apply updates and state vectors, and expose undo stacks per origin. `sync` providers and
   every consumer use `DocStore`, never `Y.*` directly. (`sync`'s local IndexedDB provider wraps
   `y-indexeddb` behind the provider interface.)
3. **Shape:** a flat `Y.Map<nodeId, Y.Map>` with `parent` and a fractional-index `order` string
   (generated with random jitter), mirroring the `.kimo` node table 1:1. No nested `Y.Array` trees.
   Sibling order is normatively (`order`, then `id`) by code unit.
4. **Cycles:** the op layer rejects local moves that would create a cycle. Cycles that only appear
   after a CRDT or git merge are repaired by the normative rule in 9.2: the node whose move has
   the later timestamp (ties: larger id) goes back to its previous parent, or to the root if that
   parent is also in the cycle. The same repair code runs in the Yjs observer and the merge driver.
5. **Revisions** are `{epoch, seq}` tokens in v1 (11.1); with multiplayer they become a hash of
   the Yjs state vector.
6. **Re-evaluate Loro at the multiplayer milestone** (v2, teardown 9.2 says "decide at M5"; the
   roadmap in 12 places multiplayer in v2, so the evaluation happens when that work starts). Loro
   (MIT) has a Movable Tree CRDT that prevents cycles natively and is faster, with a thinner
   ecosystem. The evaluation compares: cycle handling under concurrent reparenting, memory and
   load time on the 5k-node M1 benchmark document, update size, undo semantics per origin, and
   provider/relay availability.

## Consequences

- Per-origin undo comes from `Y.UndoManager` rather than custom code.
- Because consumers only see `DocStore`, switching to Loro (or Automerge) touches `editor-state`
  and `sync` providers, not the editor, MCP or agent.
- The `DocStore` interface must not leak Yjs semantics that Loro lacks (e.g. `Y.Map` identity or
  transaction internals); a contract test suite runs against every implementation.
- Cycle repair is a Kimo responsibility on Yjs and needs property tests (13.3).
- Op logs grow; periodic snapshotting is needed (13.3) and is tracked for M1.

## Alternatives considered

- **Loro now.** Native tree moves and speed, but a thinner provider ecosystem and fewer
  production references; the adapter keeps a later switch cheap. Deferred to the re-evaluation.
- **Automerge 3.** Git-like history and lower memory; less ecosystem for real-time relays and
  undo per origin. Not chosen.
- **No CRDT (immutable store + op log).** Simplest for single-user, but multiplayer would require
  a rewrite and violates the server-readiness rule in [0001](0001-monorepo-and-server-readiness.md).
- **Nested `Y.Array` children.** Natural tree shape, but concurrent moves duplicate nodes and the
  layout does not match the flat file format. Rejected.

## Revisit when

Multiplayer work starts, or the M1 benchmark shows Yjs memory or load time over budget.
