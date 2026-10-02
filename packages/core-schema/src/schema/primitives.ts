/**
 * Value types shared by every part of the format (teardown 10.3 "Schema sketch", top block).
 */
import Type, { type Static, type TSchema } from "typebox"

/** A closed object: unknown properties are rejected by the schema (but preserved by the serializer). */
export function Strict<T extends Parameters<typeof Type.Object>[0]>(
  properties: T,
  options: Record<string, unknown> = {},
) {
  return Type.Object(properties, { additionalProperties: false, ...options })
}

/**
 * A JSON object whose keys are data (ids, names, axis names), not schema-defined properties.
 * Keys must match `keyPattern`; values must match `value`.
 */
export function RecordOf<V extends TSchema>(
  keyPattern: string,
  value: V,
  options: Record<string, unknown> = {},
) {
  return Type.Unsafe<Record<string, Static<V>>>({
    type: "object",
    propertyNames: { pattern: keyPattern },
    additionalProperties: value,
    ...options,
  })
}

/** A string-valued enumeration rendered as a JSON Schema `enum`. */
export function StringEnum<const T extends readonly string[]>(
  values: T,
  options: Record<string, unknown> = {},
) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options })
}

// ---------------------------------------------------------------------------------------------
// Grammars (10.2 rule 5, 10.3). Kept as strings so they appear verbatim in the JSON Schema.
// ---------------------------------------------------------------------------------------------

/** Node id: 6–24 ASCII alphanumerics. Never contains `/` or `:`. */
export const ID_PATTERN_BODY = "[A-Za-z0-9]{6,24}"
export const ID_PATTERN = `^${ID_PATTERN_BODY}$`

/** Import alias: a letter then up to 31 letters, digits, `_` or `-`. */
export const ALIAS_PATTERN_BODY = "[A-Za-z][A-Za-z0-9_-]{0,31}"
export const ALIAS_PATTERN = `^${ALIAS_PATTERN_BODY}$`

/** Qualified id: a local id or `alias:id` for a node of an imported library. */
export const QID_PATTERN_BODY = `(?:${ALIAS_PATTERN_BODY}:)?${ID_PATTERN_BODY}`
export const QID_PATTERN = `^${QID_PATTERN_BODY}$`

/** Id path: one or more QIds joined by `/`, one segment per instance boundary. */
export const ID_PATH_PATTERN = `^${QID_PATTERN_BODY}(?:/${QID_PATTERN_BODY})*$`

/** Variable name: 1–128 chars, no whitespace or `:`, not starting with `$`. */
export const NAME_PATTERN_BODY = "[^\\s:$][^\\s:]{0,127}"
export const VARIABLE_NAME_PATTERN = `^${NAME_PATTERN_BODY}$`

/** A variable reference target: `name` or `alias:name`. */
export const REF_TARGET_PATTERN = `^(?:${ALIAS_PATTERN_BODY}:)?${NAME_PATTERN_BODY}$`

/** Theme axis name (declared in `themes`): same grammar as a variable name. */
export const AXIS_PATTERN = VARIABLE_NAME_PATTERN

/** Theme axis key as used in `theme` pins and `when`: `axis` or `alias:axis`. */
export const AXIS_KEY_PATTERN = REF_TARGET_PATTERN

/** Fractional-index sibling order key: 1–64 base62 characters, compared by code unit. */
export const ORDER_PATTERN = "^[0-9A-Za-z]{1,64}$"

/** Namespaced extension key for `meta`: dotted, at least two segments (`kimo.export.tag`). */
export const META_KEY_PATTERN = "^[a-z][a-z0-9-]*(?:\\.[A-Za-z0-9_-]+)+$"

/** Content-addressed asset file name: first 16 hex chars of SHA-256 plus an extension. */
export const ASSET_FILE_PATTERN = "^[0-9a-f]{16}\\.[a-z0-9]{1,8}$"

/** Asset reference used in paints: `./assets/<hash>.<ext>`. */
export const ASSET_REF_PATTERN = "^\\./assets/[0-9a-f]{16}\\.[a-z0-9]{1,8}$"

/**
 * Relative reference to a sibling source file (shaders, scripts, imported libraries).
 * Resolved against the `.kimo` file's directory; no scheme, no absolute paths, no backslashes.
 */
export const RELATIVE_PATH_PATTERN = "^\\.{1,2}/(?:[^\\\\/\\s]+/)*[^\\\\/\\s]+$"

/** Component prop name: an identifier usable as a JS/React prop. */
export const PROP_NAME_PATTERN = "^[A-Za-z_][A-Za-z0-9_]{0,63}$"

/** sRGB hex color: `#RGB`, `#RRGGBB` or `#RRGGBBAA`. */
export const HEX_COLOR_PATTERN = "^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$"

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

export const Id = Type.String({ pattern: ID_PATTERN, description: "Node id." })
export type Id = Static<typeof Id>

export const QId = Type.String({
  pattern: QID_PATTERN,
  description: "Local node id, or alias:id for a node of an imported library.",
})
export type QId = Static<typeof QId>

export const IdPath = Type.String({
  pattern: ID_PATH_PATTERN,
  description: "QId segments joined by '/', one per instance boundary.",
})
export type IdPath = Static<typeof IdPath>

export const OrderKey = Type.String({
  pattern: ORDER_PATTERN,
  description: "Fractional-index key; siblings sort by (order, id), by code unit.",
})

/** Structured variable binding: `{ "$ref": "name" }` or `{ "$ref": "alias:name" }`. */
export const Ref = Strict(
  { $ref: Type.String({ pattern: REF_TARGET_PATTERN }) },
  { description: "Variable binding." },
)
export type Ref = Static<typeof Ref>

/** A number, or a binding to a number variable. */
export const Num = Type.Union([Type.Number(), Ref])
export type Num = Static<typeof Num>

/** A non-negative number, or a binding. */
export const NonNegNum = Type.Union([Type.Number({ minimum: 0 }), Ref])

/** A number in [0, 1], or a binding (opacity). */
export const UnitNum = Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Ref])

export const BoolOrRef = Type.Union([Type.Boolean(), Ref])
export const StringOrRef = Type.Union([Type.String(), Ref])

export const HexColor = Type.String({ pattern: HEX_COLOR_PATTERN, description: "sRGB hex color." })

const unit = (description: string) => Type.Number({ minimum: 0, maximum: 1, description })

export const OklchColor = Strict({
  space: Type.Literal("oklch"),
  l: unit("Lightness, 0–1."),
  c: Type.Number({ minimum: 0, description: "Chroma, >= 0." }),
  h: Type.Number({ minimum: 0, exclusiveMaximum: 360, description: "Hue in degrees, [0, 360)." }),
  alpha: Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 1 })),
})

export const P3Color = Strict({
  space: Type.Literal("display-p3"),
  r: unit("Red, 0–1."),
  g: unit("Green, 0–1."),
  b: unit("Blue, 0–1."),
  alpha: Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 1 })),
})

/** A literal color: sRGB hex, OKLCH or Display-P3. */
export const ColorLit = Type.Union([HexColor, OklchColor, P3Color])
export type ColorLit = Static<typeof ColorLit>

/** A literal color or a binding to a color variable. */
export const Color = Type.Union([HexColor, OklchColor, P3Color, Ref])
export type Color = Static<typeof Color>

export const BLEND_MODES = [
  "normal",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const
export const BlendMode = StringEnum(BLEND_MODES)
export type BlendMode = Static<typeof BlendMode>

/** Namespaced extension data (`meta` on nodes; extra keys of the document `meta`). */
export const Meta = RecordOf(META_KEY_PATTERN, Type.Unknown(), {
  description: "Namespaced extension data, e.g. 'kimo.export.tag'.",
})

/** Theme pins / `when` conditions: axis key → axis value. */
export const ThemeSelection = RecordOf(AXIS_KEY_PATTERN, Type.String({ minLength: 1 }))
export type ThemeSelection = Static<typeof ThemeSelection>
