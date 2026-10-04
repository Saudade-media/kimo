/**
 * Inline error and interrupt cards (board 22 "E · error and interrupt states"): typed from the
 * ProviderError kind, never a modal, and never a rollback of applied ops.
 */
import type { ProviderError, ProviderErrorKind } from "./errors"

export type ErrorCardKind =
  | "auth"
  | "rate_limit"
  | "offline"
  | "cors"
  | "budget"
  | "stopped"
  | "refusal"
  | "error"

export type ErrorCardAction =
  | "open_settings"
  | "retry"
  | "retry_now"
  | "stop"
  | "switch_model"
  | "undo_turn"
  | "continue"
  | "raise_limit"
  | "usage"
  | "get_desktop"
  | "provider_matrix"

export interface ErrorCard {
  kind: ErrorCardKind
  severity: "danger" | "warning" | "neutral"
  /** Card label ("Invalid key", "Rate limited", "Offline", …). */
  label: string
  title: string
  body: string
  actions: ErrorCardAction[]
  providerError?: ProviderErrorKind
  /** Ops applied in this turn before the interruption (kept on the canvas and in undo). */
  opsApplied: number
  /** rate_limit: the scheduled retry. */
  retry?: { attempt: number; maxAttempts: number; inMs: number }
}

export function cardKindFor(kind: ProviderErrorKind): ErrorCardKind {
  switch (kind) {
    case "auth":
      return "auth"
    case "rate_limit":
      return "rate_limit"
    case "offline":
      return "offline"
    case "cors":
      return "cors"
    case "budget":
      return "budget"
    case "aborted":
      return "stopped"
    case "refusal":
      return "refusal"
    default:
      return "error"
  }
}

export function errorCard(
  e: ProviderError,
  ctx: {
    providerLabel: string
    opsApplied: number
    retry?: ErrorCard["retry"]
    fastModelLabel?: string
  },
): ErrorCard {
  const base = { providerError: e.kind, opsApplied: ctx.opsApplied }
  switch (cardKindFor(e.kind)) {
    case "auth":
      return {
        ...base,
        kind: "auth",
        severity: "danger",
        label: "Invalid key",
        title: `${ctx.providerLabel} rejected the API key`,
        body: `${e.status ?? 401} ${e.providerCode ?? "authentication_error"}. ${ctx.opsApplied ? "Applied changes stay on the canvas." : "Nothing was changed on the canvas."} Update the key in Settings › AI providers, then retry.`,
        actions: ["open_settings", "retry"],
      }
    case "rate_limit":
      return {
        ...base,
        kind: "rate_limit",
        severity: "warning",
        label: "Rate limited",
        title: ctx.retry
          ? `Rate limited · retrying in ${Math.ceil(ctx.retry.inMs / 1000)} s`
          : "Rate limited",
        body: `${ctx.providerLabel} returned ${e.status ?? 429}${ctx.retry ? ` (attempt ${ctx.retry.attempt} of ${ctx.retry.maxAttempts}, exponential backoff)` : ""}. Ops already applied are kept.`,
        actions: ctx.fastModelLabel ? ["switch_model", "stop"] : ["stop"],
        ...(ctx.retry ? { retry: ctx.retry } : {}),
      }
    case "offline":
      return {
        ...base,
        kind: "offline",
        severity: "neutral",
        label: "Offline",
        title: "You're offline",
        body: `Paused after ${ctx.opsApplied} ops. Applied changes stay on the canvas and in undo; the turn resumes when the connection is back.`,
        actions: ["retry_now"],
      }
    case "cors":
      return {
        ...base,
        kind: "cors",
        severity: "danger",
        label: "Blocked by the browser (web)",
        title: "The browser blocked this request (CORS)",
        body: `${e.message} Use the desktop app, a local proxy, or enable CORS on the endpoint.`,
        actions: ["get_desktop", "provider_matrix"],
      }
    case "budget":
      return {
        ...base,
        kind: "budget",
        severity: "warning",
        label: "Spending limit",
        title: e.message,
        body: "The current batch finished; the agent is paused until you raise the limit or the month resets.",
        actions: ["raise_limit", "usage"],
      }
    case "stopped":
      return {
        ...base,
        kind: "stopped",
        severity: "neutral",
        label: "Stopped by you",
        title: `Stopped · ${ctx.opsApplied} ops applied`,
        body: "Partial work is kept as one undo step, attributed to Kimo. Nothing is half-written: each op batch is atomic.",
        actions: ["undo_turn", "continue"],
      }
    case "refusal":
      return {
        ...base,
        kind: "refusal",
        severity: "warning",
        label: "Declined",
        title: "The model declined this request",
        body: `${ctx.providerLabel} stopped with a refusal. Applied changes are kept. Rephrase the prompt or pick another model.`,
        actions: ["retry", "switch_model"],
      }
    default:
      return {
        ...base,
        kind: "error",
        severity: "danger",
        label: "Error",
        title: `${ctx.providerLabel}: ${e.kind.replace(/_/g, " ")}`,
        body: `${e.message}${ctx.opsApplied ? " Applied changes are kept." : ""}`,
        actions:
          e.kind === "unknown_model" || e.kind === "unsupported_platform"
            ? ["open_settings"]
            : ["retry"],
      }
  }
}
