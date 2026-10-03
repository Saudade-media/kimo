/** Small JSON helpers shared by the store and the op layer. */

/** Defines an own enumerable property (safe for keys such as `__proto__`). */
export function setOwn(obj: object, key: string, value: unknown): void {
  // Plain assignment is much faster; only the `__proto__` accessor needs defineProperty.
  if (key === "__proto__")
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
  else (obj as Record<string, unknown>)[key] = value
}

/** True for plain objects (not arrays, not null). */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Thrown by {@link cloneJson} for values JSON cannot represent. */
export class NotJsonError extends TypeError {
  override readonly name = "NotJsonError"
  constructor(readonly path: string) {
    super(`Value at ${path || "/"} is not representable as JSON`)
  }
}

/**
 * Deep-clones a JSON value. Object properties whose value is `undefined` are dropped.
 *
 * @throws {NotJsonError} for non-finite numbers, functions, symbols, bigints, class instances
 *   and `undefined` array items.
 */
export function cloneJson<T>(value: T, path = ""): T {
  // The path is only built for an error (perf: no string per property on the happy path).
  const at: string[] = []
  const fail = (): never => {
    throw new NotJsonError(path + at.map((k) => `/${k}`).join(""))
  }
  const clone = (v: unknown): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v
    if (typeof v === "number") return Number.isFinite(v) ? v : fail()
    if (Array.isArray(v)) {
      const out = new Array(v.length)
      for (let i = 0; i < v.length; i++) {
        at.push(String(i))
        if (v[i] === undefined) fail()
        out[i] = clone(v[i])
        at.pop()
      }
      return out
    }
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v)) {
        const x = v[k]
        if (x === undefined) continue
        at.push(k)
        setOwn(out, k, clone(x))
        at.pop()
      }
      return out
    }
    return fail()
  }
  return clone(value) as T
}

/** Freezes a JSON value recursively and returns it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}
