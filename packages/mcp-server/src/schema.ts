/**
 * Portable JSON Schema kit for tool inputs and outputs (ADR 0013 §3, teardown 11.1 "Strict JSON
 * Schemas"). Every tool schema is built from these helpers, so it stays inside the
 * **portable profile**: the subset of JSON Schema that Claude (Anthropic tool `input_schema`),
 * OpenAI/Codex function tools and Gemini function declarations all accept, and that compiles
 * under Ajv strict mode. `checkPortable` enforces the profile in CI (`test/schemas.test.ts`).
 *
 * Profile rules (a violation is a CI failure):
 * - root is `type: "object"` with a non-empty `properties`;
 * - every object declares `additionalProperties` explicitly; `true` ("open") is allowed only with
 *   a `description` (it names the server-side validator, e.g. the `.kimo` node schema) and with
 *   at least one declared property (an empty-properties object broke OpenAI-compatible providers,
 *   `[gh pencil#9]`);
 * - single `type` strings only (no `["string","null"]`), no `null` type: absence = omit the key;
 * - literals are one-value `enum`s, never `const` (older Gemini rejects `const`);
 * - unions are `anyOf` only (no `oneOf`/`allOf`/`not`/`if`), no `$ref`/`$defs`,
 *   `patternProperties`, `propertyNames`, `dependentRequired`, `unevaluatedProperties`;
 * - arrays always have `items`;
 * - every property has a `description` (written for LLM agents).
 *
 * Note: "strict" here means Ajv-strict + portable, NOT OpenAI structured-outputs `strict: true`
 * (which would force every property to be required). Gemini CLI strips `additionalProperties`
 * client-side; the server validates every input against the full schema anyway.
 */
import Type, { type Static, type TSchema } from "typebox"

export type { Static, TSchema }

type Opts = { description?: string; title?: string; examples?: unknown[]; default?: unknown }

/** A closed object (`additionalProperties: false`). */
export function Obj<T extends Parameters<typeof Type.Object>[0]>(properties: T, opts: Opts = {}) {
  return Type.Object(properties, { additionalProperties: false, ...opts })
}

/**
 * An open object: declared hint properties plus any other key (`additionalProperties: true`).
 * Used only where the shape is the `.kimo` format itself (node bodies, field maps, variable
 * values); the description must say which validator checks it.
 */
export function Open<T extends Parameters<typeof Type.Object>[0]>(
  properties: T,
  opts: Opts & { description: string },
) {
  return Type.Unsafe<Static<ReturnType<typeof Type.Object<T>>> & Record<string, unknown>>(
    Type.Object(properties, { additionalProperties: true, ...opts }),
  )
}

export const Str = (
  opts: Opts & { pattern?: string; minLength?: number; maxLength?: number } = {},
) => Type.String(opts)
export const Num = (opts: Opts & { minimum?: number; maximum?: number } = {}) => Type.Number(opts)
export const Int = (opts: Opts & { minimum?: number; maximum?: number } = {}) => Type.Integer(opts)
export const Bool = (opts: Opts = {}) => Type.Boolean(opts)
export const Arr = <T extends TSchema>(
  items: T,
  opts: Opts & { minItems?: number; maxItems?: number; uniqueItems?: boolean } = {},
) => Type.Array(items, opts)
export const Opt = <T extends TSchema>(s: T) => Type.Optional(s)

/** String enumeration rendered as a plain `enum` (no `const`/`anyOf` of literals). */
export function Enum<const T extends readonly string[]>(values: T, opts: Opts = {}) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...opts })
}

/** A one-value enum: the discriminator of a tagged union member (`op: "insert"`). */
export function Tag<const T extends string>(value: T, opts: Opts = {}) {
  return Type.Unsafe<T>({ type: "string", enum: [value], ...opts })
}

/** `anyOf` union. */
export function AnyOf<const T extends TSchema[]>(members: [...T], opts: Opts = {}) {
  return Type.Unsafe<Static<T[number]>>({ anyOf: members, ...opts })
}

/** Any JSON scalar or object (no arrays/null): values written into `.kimo` fields. */
export const JsonValue = (opts: Opts = {}) =>
  Type.Unsafe<unknown>({
    anyOf: [
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      {
        type: "object",
        properties: {
          type: { type: "string", description: "Discriminator, when the value has one." },
        },
        additionalProperties: true,
        description: "Structured value, validated against the .kimo schema (kimo://schema/0.1).",
      },
      {
        type: "array",
        items: {
          type: "object",
          properties: { type: { type: "string", description: "Discriminator." } },
          additionalProperties: true,
          description: "Array element, validated against the .kimo schema.",
        },
      },
    ],
    ...opts,
  })

// --- Portable-profile checker ------------------------------------------------------------------

const FORBIDDEN = [
  "$ref",
  "$defs",
  "definitions",
  "const",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "propertyNames",
  "dependentRequired",
  "dependentSchemas",
  "unevaluatedProperties",
  "unevaluatedItems",
  "prefixItems",
  "contains",
] as const

const ALLOWED = new Set([
  "type",
  "description",
  "title",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "anyOf",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "default",
  "examples",
  "format",
  "minProperties",
  "maxProperties",
])

export interface PortableIssue {
  /** JSON Pointer of the offending sub-schema. */
  at: string
  message: string
}

/** Checks a tool schema against the portable profile. Empty array = conforming. */
export function checkPortable(schema: unknown, at = ""): PortableIssue[] {
  const issues: PortableIssue[] = []
  const walk = (s: unknown, p: string, isPropertyValue: boolean) => {
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      issues.push({ at: p, message: "sub-schema must be an object" })
      return
    }
    const o = s as Record<string, unknown>
    for (const k of Object.keys(o)) {
      if ((FORBIDDEN as readonly string[]).includes(k))
        issues.push({ at: p, message: `forbidden keyword "${k}"` })
      else if (!ALLOWED.has(k)) issues.push({ at: p, message: `unknown keyword "${k}"` })
    }
    if (isPropertyValue && typeof o.description !== "string")
      issues.push({ at: p, message: "property has no description" })
    if (o.anyOf !== undefined) {
      if (!Array.isArray(o.anyOf) || o.anyOf.length < 2)
        issues.push({ at: p, message: "anyOf needs at least two members" })
      else
        o.anyOf.forEach((m, i) => {
          walk(m, `${p}/anyOf/${i}`, false)
        })
      return
    }
    if (typeof o.type !== "string") {
      issues.push({ at: p, message: "type must be a single string" })
      return
    }
    if (o.type === "null")
      issues.push({ at: p, message: "null type is not portable; omit the key" })
    if (o.type === "object") {
      const props = o.properties as Record<string, unknown> | undefined
      if (!props || typeof props !== "object" || Object.keys(props).length === 0)
        issues.push({ at: p, message: "object needs non-empty properties" })
      if (o.additionalProperties !== false && o.additionalProperties !== true)
        issues.push({ at: p, message: "object must declare additionalProperties true|false" })
      if (o.additionalProperties === true && typeof o.description !== "string")
        issues.push({ at: p, message: "open object needs a description naming its validator" })
      if (Array.isArray(o.required))
        for (const r of o.required)
          if (!props || !(r in props))
            issues.push({ at: p, message: `required "${r}" not declared` })
      if (props) for (const [k, v] of Object.entries(props)) walk(v, `${p}/properties/${k}`, true)
    }
    if (o.type === "array") {
      if (o.items === undefined) issues.push({ at: p, message: "array needs items" })
      else walk(o.items, `${p}/items`, false)
    }
  }
  const root = schema as Record<string, unknown>
  if (typeof root !== "object" || root === null || root.type !== "object")
    issues.push({ at, message: "root must be type object" })
  walk(schema, at, false)
  return issues
}

/** Plain JSON copy of a TypeBox schema (drops symbol keys). */
export function toJsonSchema(schema: TSchema): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
}
