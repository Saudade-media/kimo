/**
 * Structural checks: the TypeBox schemas, compiled, with union errors collapsed into the
 * single most useful message.
 */
import type { TSchema } from "typebox"
import { Compile, type Validator } from "typebox/compile"
import type { TLocalizedValidationError } from "typebox/error"
import { Settings } from "typebox/system"
import { escapePointer } from "../json"
import type { IssueSink } from "./issues"

const compiled = new Map<TSchema, Validator>()

/** Returns a cached compiled validator for `schema`. */
export function validatorFor(schema: TSchema): Validator {
  let v = compiled.get(schema)
  if (!v) {
    v = Compile(schema)
    compiled.set(schema, v)
  }
  return v
}

/** True when `value` matches `schema`. */
export function check(schema: TSchema, value: unknown): boolean {
  return validatorFor(schema).Check(value)
}

type Err = TLocalizedValidationError

const DISCRIMINATORS = new Set(["type", "kind", "space", "mode", "$ref"])

const ANYOF = "/anyOf/"

function branchOf(anyOfPath: string, e: Err): number | null {
  const prefix = anyOfPath + ANYOF
  if (!e.schemaPath.startsWith(prefix)) return null
  return Number.parseInt(e.schemaPath.slice(prefix.length), 10)
}

/** A branch is implausible when the value's basic shape or discriminator contradicts it. */
function implausible(at: string, errs: Err[]): boolean {
  return errs.some((e) => {
    if (e.instancePath === at && e.keyword === "type") return true
    if (e.instancePath === at && e.keyword === "required") {
      const req = (e.params as { requiredProperties?: string[] }).requiredProperties ?? []
      return req.some((r) => DISCRIMINATORS.has(r))
    }
    if ((e.keyword === "const" || e.keyword === "enum") && e.instancePath.startsWith(`${at}/`)) {
      const rest = e.instancePath.slice(at.length + 1)
      return !rest.includes("/") && DISCRIMINATORS.has(rest.replace(/~1/g, "/").replace(/~0/g, "~"))
    }
    return false
  })
}

function describeTypes(errs: Err[], at: string): string {
  const types = new Set<string>()
  for (const e of errs) {
    if (e.instancePath !== at) continue
    if (e.keyword === "type") types.add(String((e.params as { type?: unknown }).type))
  }
  return types.size > 0 ? ` (expected ${[...types].join(" or ")})` : ""
}

/** Collapses `anyOf` branch noise: keep the one plausible branch's errors, or one summary error. */
function collapse(errs: Err[]): Err[] {
  const anyOfs = errs.filter((e) => e.keyword === "anyOf")
  const outer = anyOfs.filter(
    (a) => !anyOfs.some((b) => b !== a && a.schemaPath.startsWith(b.schemaPath + ANYOF)),
  )
  const consumed = new Set<Err>()
  const out: Err[] = []
  for (const a of outer) {
    consumed.add(a)
    const branches = new Map<number, Err[]>()
    for (const e of errs) {
      const b = branchOf(a.schemaPath, e)
      if (b === null) continue
      consumed.add(e)
      const list = branches.get(b) ?? []
      list.push(e)
      branches.set(b, list)
    }
    const plausible = [...branches.values()].filter((list) => !implausible(a.instancePath, list))
    if (plausible.length > 0) {
      plausible.sort((x, y) => x.length - y.length)
      out.push(...collapse(plausible[0] as Err[]))
    } else {
      const all = [...branches.values()].flat()
      out.push({
        ...a,
        message: `does not match any allowed form${describeTypes(all, a.instancePath)}`,
      })
    }
  }
  for (const e of errs) if (!consumed.has(e)) out.push(e)
  return out
}

function decodePointer(p: string): string[] {
  return p === ""
    ? []
    : p
        .slice(1)
        .split("/")
        .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"))
}

/**
 * Validates `value` against `schema` and adds issues under `basePath`.
 * `onUnknownProperty` may claim an unknown property (return true) to report it differently.
 * @returns true when the value is structurally valid.
 */
export function schemaIssues(
  schema: TSchema,
  value: unknown,
  basePath: string,
  sink: IssueSink,
  onUnknownProperty?: (path: string, name: string) => boolean,
): boolean {
  const v = validatorFor(schema)
  if (v.Check(value)) return true
  const previous = Settings.Get().maxErrors
  let raw: Err[]
  try {
    Settings.Set({ maxErrors: 256 })
    raw = v.Errors(value)
  } finally {
    Settings.Set({ maxErrors: previous })
  }
  // A key rejected by `additionalProperties: false` also yields a "schema is false" error at
  // the key. A record (`additionalProperties: <schema>`) whose value fails yields only the
  // value's own errors, so its `additionalProperties` error must not become UNKNOWN_PROPERTY.
  const rejected = new Set<string>()
  raw = raw.filter((e) => {
    if (!(e.keyword === "boolean" && e.schemaPath.endsWith("/additionalProperties"))) return true
    rejected.add(`${e.schemaPath}\u0000${e.instancePath}`)
    return false
  })
  for (const e of collapse(raw)) {
    const at = basePath + e.instancePath
    if (e.keyword === "additionalProperties") {
      const names = (e.params as { additionalProperties?: string[] }).additionalProperties ?? []
      for (const name of names) {
        const key = `${e.schemaPath}/additionalProperties\u0000${e.instancePath}/${escapePointer(name)}`
        if (!rejected.has(key)) continue
        const p = `${at}/${escapePointer(name)}`
        if (onUnknownProperty?.(p, name)) continue
        sink.add("UNKNOWN_PROPERTY", p, `Unknown property ${JSON.stringify(name)}`)
      }
      continue
    }
    if (e.keyword === "required") {
      const names = (e.params as { requiredProperties?: string[] }).requiredProperties ?? []
      for (const name of names) {
        sink.add(
          "SCHEMA",
          `${at}/${escapePointer(name)}`,
          `Missing required property ${JSON.stringify(name)}`,
        )
      }
      continue
    }
    if (e.keyword === "propertyNames") continue // reported per key below
    if (e.schemaPath.includes("/propertyNames")) {
      const segs = decodePointer(e.instancePath)
      sink.add(
        "SCHEMA",
        at,
        `Invalid key ${JSON.stringify(segs[segs.length - 1] ?? "")}: ${e.message}`,
      )
      continue
    }
    sink.add("SCHEMA", at, e.message)
  }
  return false
}
