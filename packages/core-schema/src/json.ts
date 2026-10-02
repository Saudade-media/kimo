/**
 * A strict JSON reader for `.kimo` files.
 *
 * `JSON.parse` silently keeps the last of two duplicate keys, which would hide a duplicated
 * node id. This reader rejects duplicate keys anywhere, reports line and column, and never
 * lets a `__proto__` key touch an object's prototype.
 */

/** Any JSON value. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
/** A JSON object. */
export interface JsonObject {
  [key: string]: JsonValue
}

/** Error codes raised while reading a file. */
export type ParseErrorCode = "PARSE_ERROR" | "DUPLICATE_KEY" | "NOT_AN_OBJECT"

/** Thrown by {@link parseJson} and `parse()` when a file is not well-formed. */
export class KimoParseError extends Error {
  override readonly name = "KimoParseError"
  constructor(
    readonly code: ParseErrorCode,
    message: string,
    /** JSON Pointer of the offending value, when known. */
    readonly path: string,
    /** 1-based line, when known. */
    readonly line?: number,
    /** 1-based column, when known. */
    readonly column?: number,
  ) {
    super(message)
  }
}

const MAX_DEPTH = 256
const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y

/** Escapes one JSON Pointer reference token (RFC 6901). */
export function escapePointer(token: string): string {
  // Fast path: ids and property names almost never need escaping.
  if (!token.includes("~") && !token.includes("/")) return token
  return token.replace(/~/g, "~0").replace(/\//g, "~1")
}

/** Builds a JSON Pointer from reference tokens. */
export function pointer(...tokens: (string | number)[]): string {
  return tokens.map((t) => `/${escapePointer(String(t))}`).join("")
}

/**
 * Parses JSON text strictly: RFC 8259 grammar, no duplicate keys, a leading UTF-8 BOM ignored.
 * @throws {KimoParseError}
 */
export function parseJson(text: string): JsonValue {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const fail = (code: ParseErrorCode, message: string, path: string, at = i): never => {
    let line = 1
    let col = 1
    for (let k = 0; k < at && k < text.length; k++) {
      if (text.charCodeAt(k) === 10) {
        line++
        col = 1
      } else col++
    }
    throw new KimoParseError(code, `${message} at ${line}:${col}`, path, line, col)
  }
  const ws = () => {
    for (;;) {
      const c = text.charCodeAt(i)
      if (c === 32 || c === 10 || c === 13 || c === 9) i++
      else return
    }
  }
  const str = (path: string): string => {
    const start = i
    i++ // opening quote
    for (;;) {
      if (i >= text.length) fail("PARSE_ERROR", "Unterminated string", path, start)
      const c = text.charCodeAt(i)
      if (c === 34) break
      if (c === 92) i += 2
      else i++
    }
    i++
    try {
      return JSON.parse(text.slice(start, i)) as string
    } catch {
      return fail("PARSE_ERROR", "Invalid string literal", path, start)
    }
  }
  const value = (path: string, depth: number): JsonValue => {
    if (depth > MAX_DEPTH) fail("PARSE_ERROR", "Nesting too deep", path)
    ws()
    const c = text[i]
    if (c === "{") {
      i++
      const obj: JsonObject = {}
      const seen = new Set<string>()
      ws()
      if (text[i] === "}") {
        i++
        return obj
      }
      for (;;) {
        ws()
        if (text[i] !== '"') fail("PARSE_ERROR", "Expected a property name", path)
        const keyAt = i
        const key = str(path)
        const childPath = `${path}/${escapePointer(key)}`
        if (seen.has(key))
          fail("DUPLICATE_KEY", `Duplicate key ${JSON.stringify(key)}`, childPath, keyAt)
        seen.add(key)
        ws()
        if (text[i] !== ":") fail("PARSE_ERROR", "Expected ':'", childPath)
        i++
        const v = value(childPath, depth + 1)
        setOwn(obj, key, v)
        ws()
        if (text[i] === ",") {
          i++
          continue
        }
        if (text[i] === "}") {
          i++
          return obj
        }
        fail("PARSE_ERROR", "Expected ',' or '}'", path)
      }
    }
    if (c === "[") {
      i++
      const arr: JsonValue[] = []
      ws()
      if (text[i] === "]") {
        i++
        return arr
      }
      for (;;) {
        arr.push(value(`${path}/${arr.length}`, depth + 1))
        ws()
        if (text[i] === ",") {
          i++
          continue
        }
        if (text[i] === "]") {
          i++
          return arr
        }
        fail("PARSE_ERROR", "Expected ',' or ']'", path)
      }
    }
    if (c === '"') return str(path)
    if (text.startsWith("true", i)) {
      i += 4
      return true
    }
    if (text.startsWith("false", i)) {
      i += 5
      return false
    }
    if (text.startsWith("null", i)) {
      i += 4
      return null
    }
    NUMBER_RE.lastIndex = i
    const m = NUMBER_RE.exec(text)
    if (m) {
      i += m[0].length
      const n = Number(m[0])
      if (!Number.isFinite(n)) fail("PARSE_ERROR", "Number out of range", path, i - m[0].length)
      return n
    }
    return fail(
      "PARSE_ERROR",
      i >= text.length ? "Unexpected end of input" : "Unexpected token",
      path,
    )
  }
  const result = value("", 0)
  ws()
  if (i < text.length) fail("PARSE_ERROR", "Unexpected data after the document", "")
  return result
}

/** Defines an own enumerable data property (safe for keys such as `__proto__`). */
export function setOwn(obj: object, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
}

/** True for a non-null, non-array object. */
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}
