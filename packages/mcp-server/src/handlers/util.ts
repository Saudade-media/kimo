/**
 * Shared helpers for the tool handlers (ADR 0013 §4): envelope fragments, error mapping from
 * editor-state / core-schema planners, ids, hashing and path utilities. Runtime-neutral (Bun,
 * Node, browsers, workers): no Node or DOM imports.
 */
import type { NodeData, OpError, Revision } from "@kimo/editor-state"
import { sha256Sync } from "@kimo/sync"
import type { DocRef, ErrorCode, RevisionToken, ToolError, ToolWarning } from "../envelope"
import type { HostDocument, HostResult } from "../runtime"

/** `{ok:true, value}`. */
export const ok = <T>(value: T): HostResult<T> => ({ ok: true, value })
/** `{ok:false, error}`. */
export const err = <T = never>(
  code: ErrorCode,
  message: string,
  extra: Partial<ToolError> = {},
): HostResult<T> => ({ ok: false, error: { code, message, ...extra } })

/** SHA-256 hex of text or bytes. */
export const sha256Hex = (data: string | Uint8Array): string => sha256Sync(data)

/** `sha256(path)[:16]`: the id shared by docIds, leases, recovery and activity logs. */
export const pathHash = (path: string): string => sha256Sync(path).slice(0, 16)

/** Activity file id of a document path (ADR 0013 §6). */
export function fileIdOf(path: string, docId?: string): string {
  if (path.startsWith("untitled:")) return `untitled-${docId ?? path.slice(9)}`
  return pathHash(path)
}

export const toToken = (r: Revision): RevisionToken => ({ epoch: r.epoch, seq: r.seq })

/** `revision {before, after}` for a read (both equal). */
export const sameRev = (r: Revision) => ({ before: toToken(r), after: toToken(r) })

/** Random base-36 id (approval ids, undo tokens, sessions). */
export function randomId(length = 10): string {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  let s = ""
  for (const b of bytes) s += (b % 36).toString(36)
  return s
}

/** Base64 of bytes (browser + Bun + Node, no Buffer). */
export function toBase64(bytes: Uint8Array): string {
  let bin = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk)
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

/** Lexical absolute-path normalization (`.`/`..`, duplicate and trailing slashes). */
export function normalizePath(path: string): string {
  if (path.startsWith("untitled:")) return path
  const win = /^[A-Za-z]:[\\/]/.test(path)
  const p = path.replace(/\\/g, "/")
  const prefix = win ? p.slice(0, 2) : ""
  const rest = win ? p.slice(2) : p
  const out: string[] = []
  for (const seg of rest.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") out.pop()
    else out.push(seg)
  }
  return `${prefix}/${out.join("/")}`
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/")
  return i <= 0 ? "/" : path.slice(0, i)
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, "")}/${name}`
}

/** The envelope's DocRef of a host document. */
export function docRefOf(d: HostDocument): DocRef {
  return d.ref
}

/** editor-state `OpErrorCode` → envelope code (1:1; INVALID_OP/INVALID_ID → INVALID_INPUT). */
export function mapOpError(e: OpError, pathMap?: (p: string) => string): ToolError {
  const code: ErrorCode =
    e.code === "INVALID_OP" || e.code === "INVALID_ID" ? "INVALID_INPUT" : e.code
  const out: ToolError = { code, message: e.message }
  if (e.path) out.path = pathMap ? pathMap(e.path) : e.path
  if (e.nodeId) out.nodeId = e.nodeId
  if (e.issue)
    out.detail = {
      kind: "schema",
      issue: { code: e.issue.code, path: e.issue.path, message: e.issue.message },
    }
  if (code === "REVISION_CONFLICT")
    out.suggestion = "Re-read with kimo_query or kimo_get_state and retry with the new revision."
  if (code === "SCHEMA_VIOLATION")
    out.suggestion = "Check the node body against kimo_read_docs path=schema."
  return out
}

/** core-schema planner refusal → envelope error (ADR 0013 §4). */
export function mapPlanError(
  e: { code: string; message: string; nodeId?: string },
  path: string,
): ToolError {
  const code: ErrorCode =
    e.code === "NOT_FOUND"
      ? "NODE_NOT_FOUND"
      : e.code === "LIBRARY_READ_ONLY"
        ? "READ_ONLY"
        : e.code === "CYCLE"
          ? "CYCLE"
          : e.code === "NOT_AN_INSTANCE" || e.code === "NOT_A_COMPONENT" || e.code === "NOT_A_SLOT"
            ? "INSTANCE_STRUCTURE"
            : "INVALID_INPUT"
  const out: ToolError = {
    code,
    message: e.message,
    path,
    detail: { kind: "plan", planCode: e.code },
  }
  if (e.nodeId) out.nodeId = e.nodeId
  return out
}

/** Validation warnings → envelope warnings. */
export function toWarnings(
  issues: readonly { code: string; message: string; path?: string }[],
): ToolWarning[] {
  return issues.map((i) => {
    const w: ToolWarning = { code: i.code, message: i.message }
    const id = nodeIdOfPointer(i.path)
    if (id) w.nodeId = id
    return w
  })
}

/** `/nodes/<id>/...` → id. */
export function nodeIdOfPointer(path: string | undefined): string | undefined {
  const m = path ? /^\/nodes\/([^/]+)/.exec(path) : null
  return m ? (m[1] as string).replace(/~1/g, "/").replace(/~0/g, "~") : undefined
}

/** Node data without tree fields (an insert/replace-ready body). */
export function bodyOf(n: NodeData): Record<string, unknown> {
  const { parent: _p, order: _o, at: _a, ...rest } = n as Record<string, unknown>
  return rest
}

/** Parses `[{axis, value}]` into a theme record. */
export function themeOf(
  list: readonly { axis: string; value: string }[] | undefined,
): Record<string, string> | undefined {
  if (!list || list.length === 0) return undefined
  return Object.fromEntries(list.map((t) => [t.axis, t.value]))
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
