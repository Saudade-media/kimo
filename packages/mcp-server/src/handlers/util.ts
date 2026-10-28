/**
 * Shared helpers for the tool handlers (ADR 0013 §4): envelope fragments, error mapping from
 * editor-state / core-schema planners, ids, hashing and path utilities. Runtime-neutral (Bun,
 * Node, browsers, workers): no Node or DOM imports.
 */
import type { OpError, Revision } from "@kimo/editor-state"
import { sha256Sync } from "@kimo/sync"
import type { ErrorCode, RevisionToken, ToolError, ToolWarning } from "../envelope"
import type { HostResult } from "../runtime"

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
    out.suggestion =
      (e.issue && schemaFix(e.issue.code, e.issue.path, e.issue.message)) ??
      "Check the node body against kimo_read_docs path=schema."
  return out
}

/**
 * One-line fixes for the field names agents most often borrow from CSS / Figma / other formats
 * (board 31 token pass: an exact fix instead of a guide round trip).
 */
const FIELD_FIXES: Readonly<Record<string, string>> = {
  unset:
    'Clear fields with the update op\'s own "unset": ["field"] (a sibling of "set"), or set the field to null in "set".',
  children: 'Children are separate insert ops with "parent": "@key" of this node.',
  text: 'A text node\'s text goes in "content": {"type":"text","content":"Hello"}.',
  string: 'A text node\'s text goes in "content": {"type":"text","content":"Hello"}.',
  direction: 'Use layout "dir": "row" | "column".',
  dir: 'Layout fields go inside "layout": {"dir": "row" | "column", "gap", "pad", "justify", "align"}.',
  gap: 'Layout fields go inside "layout": {"dir": "row" | "column", "gap", "pad", "justify", "align"}.',
  pad: 'Layout fields go inside "layout": {"dir": "row" | "column", "gap", "pad", "justify", "align"}.',
  justify:
    'Layout fields go inside "layout": {"dir": "row" | "column", "gap", "pad", "justify", "align"}.',
  align: 'Child alignment goes in "layout": {"align": …}; text alignment in "style": {"align": …}.',
  size: 'Text size goes in "style": {"size": n}; a box size is "w" / "h".',
  weight: 'Text weight goes in "style": {"weight": n}.',
  font: 'The font family goes in "style": {"font": "Inter"}.',
  lineHeight: 'Use "style": {"lineHeight": 1.4} (or {"px": 24}).',
  letterSpacing: 'Use "style": {"letterSpacing": n}.',
  flexDirection: 'Use layout "dir": "row" | "column".',
  layoutMode: 'Use layout "dir": "row" | "column".',
  padding: 'Use layout "pad": n, [vertical, horizontal] or [top, right, bottom, left].',
  spacing: 'Use layout "gap".',
  itemSpacing: 'Use layout "gap".',
  alignItems: 'Use layout "align": start | center | end | stretch | baseline.',
  justifyContent: 'Use layout "justify": start | center | end | between | around | evenly.',
  width: 'Use "w": a number, {"mode":"fit"} or {"mode":"fill"}.',
  height: 'Use "h": a number, {"mode":"fit"} or {"mode":"fill"}.',
  cornerRadius: 'Use "radius".',
  borderRadius: 'Use "radius".',
  fontSize: 'Text styles go in "style": {font, size, weight, lineHeight, letterSpacing, align}.',
  fontWeight: 'Text styles go in "style": {font, size, weight, lineHeight, letterSpacing, align}.',
  fontFamily: 'Text styles go in "style": {font, size, weight, lineHeight, letterSpacing, align}.',
  textAlign: 'Use "style": {"align": "left" | "center" | "right" | "justify"}.',
  color: 'Text and shape color is "fill" (icons: "color").',
  background: 'Use "fill".',
  backgroundColor: 'Use "fill".',
  border: 'Use "stroke": {"paint": "#RRGGBB", "width": 1, "align": "inside"}.',
  shadow: 'Use "effects": [{"kind":"shadow","x":0,"y":4,"blur":12,"color":"#0000001A"}].',
  boxShadow: 'Use "effects": [{"kind":"shadow","x":0,"y":4,"blur":12,"color":"#0000001A"}].',
}

/** The one-line fix for a schema issue, when Kimo knows a better one than the guide link. */
export function schemaFix(code: string, path: string, message = ""): string | undefined {
  const name = (path.split("/").pop() ?? "").replace(/~1/g, "/").replace(/~0/g, "~")
  if (code === "SCHEMA" && name === "content" && message.startsWith("Missing required"))
    return 'A text node\'s text goes in "content": {"type":"text","content":"Hello"}.'
  if (code !== "UNKNOWN_PROPERTY") return undefined
  return Object.hasOwn(FIELD_FIXES, name)
    ? FIELD_FIXES[name]
    : `"${name}" is not a field here (kimo_read_docs path=schema lists the fields).`
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
