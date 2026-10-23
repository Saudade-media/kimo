/**
 * Agent area claims at the tool layer (ADR 0016 item 16, docs/spec/multiplayer.md §15.11).
 *
 * `dispatch` and the streamed-edit engine gate every `kimo_apply_ops` (and the call a
 * `kimo_script` compiles to) of an agent or MCP origin through {@link claimGate}. Agents
 * (`agent:<id>`, in turns) hold claims; MCP clients respect them but hold none, since no turn
 * would end their claims (their concurrency stays on `baseRevision`):
 *
 * 1. A person edited inside the caller's claim since its last write: the call fails once with
 *    `REVISION_CONFLICT` (detail `human-edit`); the agent re-reads, and the retry goes through.
 * 2. The call touches a node inside another agent's live claim (here or on another client):
 *    `AREA_BUSY` (retryable after a wait), nothing is applied.
 * 3. Otherwise the touched nodes are claimed before the ops apply, and after the call lands
 *    ({@link landClaims}) the nodes it created at the top level join the claim.
 *
 * Op groups that only set or clear `placeholder` are exempt (a placeholder is runtime state,
 * never a lock), and so are dry runs. People's edits never go through here.
 */
import {
  claimsFor,
  type DocStore,
  isClaimingOrigin,
  isClaimRespectingOrigin,
} from "@kimo/editor-state"
import type { ToolError, ToolResult } from "./envelope"
import type { WireOp } from "./ops"
import type { ToolContext } from "./runtime"
import type { ToolDef } from "./tools/define"

/** One gated call: a pure check, then the claim itself (after any approval). */
export interface ClaimGate {
  /** The error the call would fail with now, without side effects. */
  check(): ToolError | null
  /**
   * Re-checks and, when clear, claims the touched nodes. A `human-edit` error is consumed here
   * (the agent was told), except for provisional streamed ops, which only hold.
   */
  take(): ToolError | null
  /** The call failed with `error` from {@link check}: consumes a `human-edit` notice. */
  told(error: ToolError): void
}

const CLAIM_FIELDS = ["id", "instance", "frame", "node"] as const

/** Existing node ids a group of wire ops edits (ids, insert/move parents). Reads are left out. */
export function claimTargets(ops: readonly unknown[]): string[] {
  const out = new Set<string>()
  const add = (v: unknown) => {
    if (typeof v !== "string" || v === "" || v === "root" || v.startsWith("@")) return
    out.add(v.split("/")[0] as string)
  }
  for (const raw of ops) {
    if (!raw || typeof raw !== "object") continue
    const op = raw as Record<string, unknown>
    if (op.op === "copy") {
      // The source is only read; the copy lands in `parent`.
      add(op.parent)
      continue
    }
    if (op.op === "insert" || op.op === "instantiate" || op.op === "move") add(op.parent)
    if (op.op !== "insert" && op.op !== "instantiate") for (const k of CLAIM_FIELDS) add(op[k])
    if (Array.isArray(op.ids)) for (const v of op.ids) add(v)
  }
  return [...out]
}

/** True when every op only sets or clears `placeholder` (exempt from claims). */
export function placeholderOnly(ops: readonly unknown[]): boolean {
  return (
    ops.length > 0 &&
    ops.every((raw) => {
      const op = raw as WireOp & { set?: Record<string, unknown>; unset?: string[] }
      if (op?.op !== "update") return false
      const keys = [...Object.keys(op.set ?? {}), ...(op.unset ?? [])]
      return keys.length > 0 && keys.every((k) => k === "placeholder")
    })
  )
}

function storeOf(ctx: ToolContext, input: Record<string, unknown>): DocStore | null {
  // Test doubles of the host may not resolve documents: no store, no claims.
  if (typeof input.docId !== "string" || typeof ctx.host?.get !== "function") return null
  const r = ctx.host.get(input.docId)
  return r?.ok ? r.value.store : null
}

/**
 * The gate of one call, or null when claims do not apply (another tool, a dry run, a person,
 * placeholder-only ops, an unknown document).
 */
export function claimGate(
  def: Pick<ToolDef, "name">,
  input: Record<string, unknown>,
  ctx: ToolContext,
  options: { provisional?: boolean } = {},
): ClaimGate | null {
  if (def.name !== "kimo_apply_ops" || input.dryRun === true) return null
  if (!isClaimRespectingOrigin(ctx.origin)) return null
  const ops = Array.isArray(input.ops) ? (input.ops as unknown[]) : []
  if (!ops.length || placeholderOnly(ops)) return null
  const store = storeOf(ctx, input)
  if (!store) return null
  const registry = claimsFor(store)
  const holder = ctx.origin
  const touched = claimTargets(ops)

  const humanError = (): ToolError | null => {
    const h = registry.humanEdit(holder)
    if (!h) return null
    return {
      code: "REVISION_CONFLICT",
      message:
        h.by === "local"
          ? "A person edited inside the area you are working on since your last write."
          : "Someone on another client edited inside the area you are working on since your last write.",
      ...(h.ids[0] ? { nodeId: h.ids[0] } : {}),
      suggestion:
        "Re-read those nodes (kimo_query with their ids), keep the person's changes, then retry. People are never blocked; build on what they did.",
      detail: {
        kind: "human-edit",
        ids: h.ids,
        by: h.by,
        current: { epoch: store.revision.epoch, seq: store.revision.seq },
      },
    }
  }
  const busyError = (): ToolError | null => {
    const c = registry.check(holder, touched)
    if (!c) return null
    const who = c.holderLabel ?? c.holder
    return {
      code: "AREA_BUSY",
      message: `${who} is working on this area (${c.ids.length} claimed layer${c.ids.length === 1 ? "" : "s"}).`,
      ...(c.touched[0] ? { nodeId: c.touched[0] } : {}),
      retryable: true,
      suggestion:
        "Work on another part of the document, or wait until that agent finishes (its claim ends with its turn) and retry. Do not edit inside its area.",
      detail: {
        kind: "area",
        holder: c.holder,
        ...(c.holderLabel ? { holderLabel: c.holderLabel } : {}),
        ids: c.ids,
        touched: c.touched,
        since: new Date(c.since).toISOString(),
      },
    }
  }
  const tell = (error: ToolError) => {
    if (
      !options.provisional &&
      (error.detail as { kind?: string } | undefined)?.kind === "human-edit"
    )
      registry.takeHumanEdit(holder)
  }

  return {
    check: () => humanError() ?? busyError(),
    take() {
      const human = humanError()
      if (human) {
        tell(human)
        return human
      }
      // MCP clients respect claims but hold none (no turn would end them).
      if (!isClaimingOrigin(holder)) return busyError()
      const conflict = registry.claim(holder, touched, {
        label: ctx.identity.label,
        ...(ctx.turn ? { turn: ctx.turn } : {}),
      })
      return conflict ? busyError() : null
    },
    told: tell,
  }
}

/**
 * After a call landed: the nodes it changed that the caller's claim does not cover yet (layers
 * it created at the top level, nodes moved there) join the claim, and the claim is renewed.
 */
export function landClaims(
  def: Pick<ToolDef, "name">,
  input: Record<string, unknown>,
  ctx: ToolContext,
  result: ToolResult,
): void {
  if (def.name !== "kimo_apply_ops" || !result.ok || result.dryRun) return
  if (!isClaimingOrigin(ctx.origin)) return
  const ops = Array.isArray(input.ops) ? (input.ops as unknown[]) : []
  if (placeholderOnly(ops)) return
  const store = storeOf(ctx, input)
  if (!store) return
  const registry = claimsFor(store)
  const fresh = (result.changed ?? []).filter(
    (id) => store.hasNode(id) && !registry.covers(ctx.origin, id),
  )
  registry.add(ctx.origin, fresh, {
    label: ctx.identity.label,
    ...(ctx.turn ? { turn: ctx.turn } : {}),
  })
}
