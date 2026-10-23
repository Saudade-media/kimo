/**
 * Token buckets (docs/spec/multiplayer.md §14.8). A bucket holds up to `capacity` tokens and
 * refills continuously; `take` returns 0 when the cost was granted, else the wait in ms until it
 * would be. The clock is passed in so tests drive it.
 */

export class TokenBucket {
  private tokens: number
  private at: number

  constructor(
    readonly capacity: number,
    /** Tokens added per millisecond. */
    readonly refillPerMs: number,
    now: number,
  ) {
    this.tokens = capacity
    this.at = now
  }

  take(now: number, cost = 1): number {
    const elapsed = Math.max(0, now - this.at)
    this.at = now
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs)
    if (cost > this.capacity) return Number.POSITIVE_INFINITY
    if (this.tokens >= cost) {
      this.tokens -= cost
      return 0
    }
    return Math.ceil((cost - this.tokens) / this.refillPerMs)
  }

  /** Whether the bucket is full again, so a keyed limiter can forget it. */
  idle(now: number): boolean {
    return this.tokens + Math.max(0, now - this.at) * this.refillPerMs >= this.capacity
  }
}

/** One bucket per key (an IP, a token id or a room). */
export class KeyedLimiter {
  private readonly buckets = new Map<string, TokenBucket>()

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
  ) {}

  /** 0 when granted, else the wait in ms. */
  take(key: string, now: number, cost = 1): number {
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillPerMs, now)
      this.buckets.set(key, bucket)
    }
    return bucket.take(now, cost)
  }

  prune(now: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.idle(now)) this.buckets.delete(key)
  }
}

/** Seconds for a `retry-after` header (at least 1). */
export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(Number.isFinite(ms) ? ms / 1000 : 60))
}
