/**
 * Provider errors (ADR 0014 §6, board 22 "E · error and interrupt states"). Every adapter turns
 * its failures into one {@link ProviderError} whose `kind` picks the inline card. Errors never
 * roll back ops that were already applied.
 */

export type ProviderErrorKind =
  /** 401/403: invalid or missing key (danger card, "Open settings"). */
  | "auth"
  /** 429 / overloaded: warning card, automatic retry with backoff. */
  | "rate_limit"
  /** Connection failed while online (neutral; retried with backoff). */
  | "network"
  /** The device is offline: paused, resumes when the connection is back. */
  | "offline"
  /** The browser blocked the request (web only). */
  | "cors"
  /** Monthly spending limit reached (warning; the current batch finished). */
  | "budget"
  /** The user pressed Stop / Esc. */
  | "aborted"
  /** 5xx from the provider (retried with backoff). */
  | "server"
  /** 400/404/422: a bug or an unsupported parameter (no retry). */
  | "invalid_request"
  /** Unknown provider or model (ADR 0006 §4: fail loudly). */
  | "unknown_model"
  /** The prompt is longer than the model's context window. */
  | "context_length"
  /** The model declined (Anthropic `stop_reason: "refusal"`). */
  | "refusal"
  /** Provider not reachable from this platform (Bedrock/Vertex/Foundry on web). */
  | "unsupported_platform"
  | "unknown"

/** Kinds the loop retries on its own (rate_limit, network, server). */
export const RETRYABLE_KINDS: ReadonlySet<ProviderErrorKind> = new Set([
  "rate_limit",
  "network",
  "server",
])

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly provider: string
  readonly status?: number
  /** From `retry-after` / `retry-after-ms` headers when given. */
  readonly retryAfterMs?: number
  /** Provider error type string (`authentication_error`, `rate_limit_exceeded`, …). */
  readonly providerCode?: string

  constructor(
    kind: ProviderErrorKind,
    message: string,
    opts: {
      provider: string
      status?: number
      retryAfterMs?: number
      providerCode?: string
      cause?: unknown
    },
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.name = "ProviderError"
    this.kind = kind
    this.provider = opts.provider
    if (opts.status !== undefined) this.status = opts.status
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs
    if (opts.providerCode !== undefined) this.providerCode = opts.providerCode
  }

  get retryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind)
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError
}

/** Maps an HTTP status (and optional provider code) to a kind. */
export function kindForStatus(status: number, code?: string): ProviderErrorKind {
  if (status === 401 || status === 403) return "auth"
  if (status === 429 || status === 529) return "rate_limit"
  if (status === 408) return "network"
  if (status === 413) return "context_length"
  if (code && /context_length|too_long|prompt is too long/i.test(code)) return "context_length"
  if (status >= 500) return "server"
  if (status === 404) return "invalid_request"
  if (status >= 400) return "invalid_request"
  return "unknown"
}

/** Parses `retry-after-ms`, then `retry-after` (seconds or HTTP date). */
export function retryAfterFrom(
  headers: { get(name: string): string | null } | undefined,
  now = Date.now(),
): number | undefined {
  if (!headers) return undefined
  const ms = headers.get("retry-after-ms")
  if (ms && Number.isFinite(Number(ms))) return Math.max(0, Number(ms))
  const ra = headers.get("retry-after")
  if (!ra) return undefined
  if (Number.isFinite(Number(ra))) return Math.max(0, Number(ra) * 1000)
  const t = Date.parse(ra)
  return Number.isNaN(t) ? undefined : Math.max(0, t - now)
}

/**
 * Classifies a thrown fetch failure (no HTTP response). `online` comes from the platform
 * (`navigator.onLine`); a TypeError on web while online is reported as `cors` only when the
 * adapter knows the endpoint is cross-origin and the platform is web.
 */
export function classifyFetchFailure(
  e: unknown,
  ctx: { provider: string; online: boolean; web: boolean },
): ProviderError {
  if (isAbort(e)) return new ProviderError("aborted", "Stopped.", { provider: ctx.provider })
  if (!ctx.online)
    return new ProviderError("offline", "You're offline.", { provider: ctx.provider, cause: e })
  const msg = e instanceof Error ? e.message : String(e)
  if (ctx.web && e instanceof TypeError)
    return new ProviderError("cors", `The browser blocked this request (CORS): ${msg}`, {
      provider: ctx.provider,
      cause: e,
    })
  return new ProviderError("network", msg || "Network error.", {
    provider: ctx.provider,
    cause: e,
  })
}

export function isAbort(e: unknown): boolean {
  return (
    (e instanceof Error && (e.name === "AbortError" || e.name === "APIUserAbortError")) ||
    (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError")
  )
}
