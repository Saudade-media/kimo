/**
 * Retry policy for retryable provider errors (rate_limit, network, server). Board 22: "429
 * (attempt 2 of 5, exponential backoff)". Offline is not an attempt: the loop pauses until the
 * platform reports the connection is back, then resumes.
 */

export interface RetryPolicy {
  maxAttempts: number
  baseMs: number
  maxMs: number
  /** 0..1 random spread added to each delay. */
  jitter: number
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 5,
  baseMs: 1_000,
  maxMs: 60_000,
  jitter: 0.2,
}

/** Delay before attempt `attempt + 1` (attempt is 1-based). Honors `retry-after` when larger. */
export function backoffDelay(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** (attempt - 1))
  const withJitter = exp * (1 + policy.jitter * random())
  return Math.round(Math.max(withJitter, Math.min(policy.maxMs, retryAfterMs ?? 0)))
}

/** Abortable sleep. Rejects with an AbortError when `signal` fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"))
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
