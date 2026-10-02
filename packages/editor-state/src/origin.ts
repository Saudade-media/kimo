/**
 * Edit origins (teardown 9.3, 11.4). Every op group carries one; it becomes the Yjs
 * transaction origin, so undo stacks, attribution and scope checks key off it.
 */

/** Origins whose edits go through the op layer and get their own undo stack. */
export type LocalOrigin = "user" | `agent:${string}` | `mcp:${string}`

/** Updates that arrive from outside the op layer (sync providers, persistence). */
export type RemoteOrigin = "remote" | `remote:${string}`

/**
 * Every origin a change can carry:
 * - `user`, `agent:<id>`, `mcp:<client>`: op-layer edits, each with its own undo stack;
 * - `file`: content (re)loaded from disk;
 * - `remote` / `remote:<peer>`: binary updates applied by a sync provider;
 * - `system`: automatic repairs (post-merge cycle and orphan repair).
 */
export type Origin = LocalOrigin | RemoteOrigin | "file" | "system"

const LOCAL_RE = /^(?:user|agent:[^\s]+|mcp:[^\s]+)$/
const ORIGIN_RE = /^(?:user|agent:[^\s]+|mcp:[^\s]+|remote(?::[^\s]+)?|file|system)$/

/** True when `o` is a syntactically valid {@link Origin}. */
export function isOrigin(o: unknown): o is Origin {
  return typeof o === "string" && ORIGIN_RE.test(o)
}

/** True for origins that edit through the op layer and own an undo stack. */
export function isLocalOrigin(o: unknown): o is LocalOrigin {
  return typeof o === "string" && LOCAL_RE.test(o)
}

/** True for `remote` and `remote:<peer>`. */
export function isRemoteOrigin(o: unknown): o is RemoteOrigin {
  return o === "remote" || (typeof o === "string" && o.startsWith("remote:") && o.length > 7)
}
