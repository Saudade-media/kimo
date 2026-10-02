/**
 * Jittered fractional indexing for sibling `order` keys (teardown 9.2 "Tree moves on Yjs",
 * 10.2 rule 3; spec §5.1).
 *
 * Keys are strings over the base-62 alphabet `0-9A-Za-z` (grammar `^[0-9A-Za-z]{1,64}$`),
 * compared by UTF-16 code unit — which for this alphabet is the same as digit order. Sibling
 * order is normatively (`order`, then id), so equal keys are legal (they arise from concurrent
 * inserts) and merely tie-broken.
 *
 * Two generators are combined:
 *
 * - Keys that follow the "integer head + fraction" grammar of rocicorp's `fractional-indexing`
 *   (CC0; e.g. `a0`, `a1`, `a0V`) use that algorithm, which keeps keys short under repeated
 *   appends and prepends.
 * - Any other legal key (hand-written files may use `1`, `zz`, …) falls back to a plain
 *   lexicographic midpoint, so every document can be edited without re-keying first.
 *
 * Generated keys get a short random suffix ("jitter") so two clients inserting at the same
 * position concurrently almost never produce the same key.
 */

/** The base-62 digit alphabet, in code-unit order. */
export const ORDER_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** Maximum key length allowed by the format (`ORDER_PATTERN`). */
export const MAX_ORDER_KEY_LENGTH = 64

const ORDER_KEY_RE = /^[0-9A-Za-z]{1,64}$/
const ZERO = "0"
const BASE = ORDER_DIGITS.length

/** Thrown when no key exists strictly between two bounds (or the bounds are malformed). */
export class OrderKeyError extends RangeError {
  override readonly name = "OrderKeyError"
}

/** Options for key generation. */
export interface OrderKeyOptions {
  /**
   * Number of random digits appended to each generated key. Default 3 (~17.9 bits); 0 turns
   * jitter off, which makes generation deterministic.
   */
  jitter?: number
  /** Uniform random source in [0, 1). Default: `crypto.getRandomValues` when available. */
  random?: () => number
}

/** True when `key` is a legal `.kimo` order key. */
export function isOrderKey(key: unknown): key is string {
  return typeof key === "string" && ORDER_KEY_RE.test(key)
}

const digit = (c: string | undefined): number => (c === undefined ? -1 : ORDER_DIGITS.indexOf(c))
const char = (i: number): string => ORDER_DIGITS[i] as string

// --- rocicorp/fractional-indexing (CC0), adapted -----------------------------------------------

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - 97 + 2
  if (head >= "A" && head <= "Z") return 90 - head.charCodeAt(0) + 2
  throw new OrderKeyError(`invalid order key head: ${head}`)
}

function integerPart(key: string): string {
  const n = integerLength(key[0] as string)
  if (n > key.length) throw new OrderKeyError(`invalid order key: ${key}`)
  return key.slice(0, n)
}

const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`

/** True when `key` follows the fractional-indexing grammar (integer head + fraction). */
export function isFractionalKey(key: string): boolean {
  if (!isOrderKey(key) || key === SMALLEST_INTEGER) return false
  try {
    const i = integerPart(key)
    return !key.slice(i.length).endsWith(ZERO)
  } catch {
    return false
  }
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? ZERO) === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a ? digit(a[0]) : 0
  const db = b !== null ? digit(b[0]) : BASE
  if (db - da > 1) return char(Math.round((da + db) / 2))
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return char(da) + midpoint(a.slice(1), null)
}

function incrementInteger(x: string): string | null {
  const head = x[0] as string
  const digs = x.slice(1).split("")
  let carry = true
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = digit(digs[i]) + 1
    if (d === BASE) digs[i] = ZERO
    else {
      digs[i] = char(d)
      carry = false
    }
  }
  if (!carry) return head + digs.join("")
  if (head === "Z") return `a${ZERO}`
  if (head === "z") return null
  const h = String.fromCharCode(head.charCodeAt(0) + 1)
  if (h > "a") digs.push(ZERO)
  else digs.pop()
  return h + digs.join("")
}

function decrementInteger(x: string): string | null {
  const head = x[0] as string
  const digs = x.slice(1).split("")
  let borrow = true
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = digit(digs[i]) - 1
    if (d === -1) digs[i] = char(BASE - 1)
    else {
      digs[i] = char(d)
      borrow = false
    }
  }
  if (!borrow) return head + digs.join("")
  if (head === "a") return `Z${char(BASE - 1)}`
  if (head === "A") return null
  const h = String.fromCharCode(head.charCodeAt(0) - 1)
  if (h < "Z") digs.push(char(BASE - 1))
  else digs.pop()
  return h + digs.join("")
}

function fractionalBetween(a: string | null, b: string | null): string {
  if (a === null) {
    if (b === null) return `a${ZERO}`
    const ib = integerPart(b)
    const fb = b.slice(ib.length)
    if (ib === SMALLEST_INTEGER) return ib + midpoint("", fb)
    if (ib < b) return ib
    const res = decrementInteger(ib)
    if (res === null) throw new OrderKeyError("cannot decrement any more")
    return res
  }
  const ia = integerPart(a)
  const fa = a.slice(ia.length)
  if (b === null) {
    const i = incrementInteger(ia)
    return i === null ? ia + midpoint(fa, null) : i
  }
  const ib = integerPart(b)
  const fb = b.slice(ib.length)
  if (ia === ib) return ia + midpoint(fa, fb)
  const i = incrementInteger(ia)
  if (i === null) throw new OrderKeyError("cannot increment any more")
  return i < b ? i : ia + midpoint(fa, null)
}

// --- Generic lexicographic fallback -----------------------------------------------------------

/** A non-empty key `s` with `s < rest`, or null when none exists (`rest` is `""`, `"0"`, …). */
function lowerThan(rest: string): string | null {
  if (rest === "") return null
  const d = digit(rest[0])
  if (d > 1) return char(d >> 1)
  if (d === 1) return `${ZERO}V`
  const t = lowerThan(rest.slice(1))
  if (t !== null) return ZERO + t
  return rest.length > 1 ? ZERO : null
}

/** A key `s` with `s > x` (any string). */
function greaterThan(x: string): string {
  if (x === "") return "V"
  const d = digit(x[0])
  if (d < BASE - 1) return char((d + BASE) >> 1)
  return x[0] + greaterThan(x.slice(1))
}

function lexicographicBetween(a: string | null, b: string | null): string | null {
  const lo = a ?? ""
  if (b === null) {
    if (lo === "") return "V"
    for (let i = lo.length - 1; i >= 0; i--) {
      const d = digit(lo[i])
      if (d < BASE - 1) return lo.slice(0, i) + char((d + BASE) >> 1)
    }
    return `${lo}V`
  }
  let i = 0
  while (i < lo.length && i < b.length && lo[i] === b[i]) i++
  if (i === lo.length) {
    const t = lowerThan(b.slice(i))
    return t === null ? null : lo + t
  }
  const da = digit(lo[i])
  const db = digit(b[i])
  if (db - da >= 2) return lo.slice(0, i) + char((da + db) >> 1)
  return lo.slice(0, i + 1) + greaterThan(lo.slice(i + 1))
}

// --- Public API -------------------------------------------------------------------------------

function defaultRandom(): number {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1)
    c.getRandomValues(buf)
    return (buf[0] as number) / 2 ** 32
  }
  return Math.random()
}

function jittered(key: string, b: string | null, options: OrderKeyOptions): string {
  const n = options.jitter ?? 3
  if (n <= 0 || key.length + n > MAX_ORDER_KEY_LENGTH) return key
  const random = options.random ?? defaultRandom
  // When `key` is a prefix of `b`, the suffix must sort below the rest of `b`: its first digit
  // is drawn below `b`'s next digit (then `key + suffix < b` whatever follows).
  const firstLimit = b?.startsWith(key) ? digit(b[key.length]) : BASE
  const pickDigit = (lo: number, hi: number) =>
    char(lo + Math.min(hi - lo - 1, Math.floor(random() * (hi - lo))))
  let suffix = ""
  for (let i = 0; i < n; i++) {
    // The last digit is never "0", so the key stays valid for fractional indexing.
    const lo = i === n - 1 ? 1 : 0
    const hi = i === 0 ? firstLimit : BASE
    if (lo >= hi) return key
    suffix += pickDigit(lo, hi)
  }
  const k = key + suffix
  return b === null || k < b ? k : key
}

/**
 * Returns a key strictly between `a` and `b` (`null` = unbounded on that side).
 *
 * @throws {OrderKeyError} when `a >= b`, a bound is not a legal order key, or no key fits
 *   (e.g. nothing sorts below `"0"`, nothing between `"a"` and `"a0"`).
 */
export function keyBetween(
  a: string | null,
  b: string | null,
  options: OrderKeyOptions = {},
): string {
  if (a !== null && !isOrderKey(a)) throw new OrderKeyError(`invalid order key: ${a}`)
  if (b !== null && !isOrderKey(b)) throw new OrderKeyError(`invalid order key: ${b}`)
  if (a !== null && b !== null && a >= b) throw new OrderKeyError(`${a} >= ${b}`)
  let key: string | null = null
  if ((a === null || isFractionalKey(a)) && (b === null || isFractionalKey(b))) {
    try {
      key = fractionalBetween(a, b)
    } catch {
      key = null
    }
  }
  key ??= lexicographicBetween(a, b)
  if (key === null || key.length > MAX_ORDER_KEY_LENGTH) {
    throw new OrderKeyError(`no order key fits between ${a ?? "-∞"} and ${b ?? "+∞"}`)
  }
  return jittered(key, b, options)
}

/**
 * Returns `n` increasing keys strictly between `a` and `b`.
 *
 * @throws {OrderKeyError} as {@link keyBetween}.
 */
export function keysBetween(
  a: string | null,
  b: string | null,
  n: number,
  options: OrderKeyOptions = {},
): string[] {
  if (n <= 0) return []
  if (n === 1) return [keyBetween(a, b, options)]
  const half = Math.floor(n / 2)
  const mid = keyBetween(a, b, options)
  return [...keysBetween(a, mid, half, options), mid, ...keysBetween(mid, b, n - half - 1, options)]
}

/** Result of {@link planInsertKeys}. */
export interface InsertKeyPlan {
  /** Keys for the inserted items, in order. */
  keys: string[]
  /**
   * Existing siblings that must be re-keyed so the new items land at the requested index:
   * `index` into the input `orders`, and its new key. Empty in the common case.
   */
  rekey: { index: number; order: string }[]
}

/**
 * Plans keys for inserting `count` items at position `index` of a sibling list whose keys are
 * `orders` (already sorted by sibling order, so non-decreasing).
 *
 * When there is no room between the neighbours (equal keys from concurrent inserts, adjacent
 * keys such as `a`/`a0`, or the 64-character limit), the following siblings are re-keyed as
 * well, as few as possible; in the worst case the whole list is.
 */
export function planInsertKeys(
  orders: readonly string[],
  index: number,
  count = 1,
  options: OrderKeyOptions = {},
): InsertKeyPlan {
  const m = orders.length
  const at = Math.max(0, Math.min(m, Math.trunc(index)))
  const lo = at > 0 ? (orders[at - 1] as string) : null
  for (let j = at; j <= m; j++) {
    const hi = j < m ? (orders[j] as string) : null
    if (lo !== null && hi !== null && lo >= hi) continue
    try {
      const keys = keysBetween(lo, hi, count + (j - at), options)
      return {
        keys: keys.slice(0, count),
        rekey: keys.slice(count).map((order, k) => ({ index: at + k, order })),
      }
    } catch (e) {
      if (!(e instanceof OrderKeyError)) throw e
    }
  }
  // Last resort: re-key the whole list.
  const keys = keysBetween(null, null, m + count, options)
  const rekey: { index: number; order: string }[] = []
  for (let k = 0; k < m; k++) {
    const pos = k < at ? k : k + count
    rekey.push({ index: k, order: keys[pos] as string })
  }
  return { keys: keys.slice(at, at + count), rekey }
}
