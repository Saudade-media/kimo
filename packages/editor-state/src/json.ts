/** Small JSON helpers shared by the store and the op layer. */

/** Defines an own enumerable property (safe for keys such as `__proto__`). */
export function setOwn(obj: object, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
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
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new NotJsonError(path)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      if (v === undefined) throw new NotJsonError(`${path}/${i}`)
      return cloneJson(v, `${path}/${i}`)
    }) as T
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) {
      const v = value[k]
      if (v === undefined) continue
      setOwn(out, k, cloneJson(v, `${path}/${k}`))
    }
    return out as T
  }
  throw new NotJsonError(path)
}

/** Freezes a JSON value recursively and returns it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}
