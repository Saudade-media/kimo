/**
 * The document root, variables, themes, imports and the asset manifest (teardown 10.3
 * `KimoFile`, `Variable`; 10.1 assets).
 */
import Type, { type Static, type TSchema } from "typebox"
import { FEATURE_PATTERN } from "../features"
import { SCHEMA_URL, SCHEMA_URL_PATTERN } from "../version"
import { ShadowEffect } from "./graphics"
import { Conflicts, MergeInfo } from "./merge"
import { Node } from "./nodes"
import {
  ALIAS_PATTERN,
  ASSET_FILE_PATTERN,
  AXIS_PATTERN,
  BoolOrRef,
  Color,
  ID_PATTERN,
  Id,
  META_KEY_PATTERN,
  Num,
  RELATIVE_PATH_PATTERN,
  RecordOf,
  Ref,
  Strict,
  StringOrRef,
  ThemeSelection,
  VARIABLE_NAME_PATTERN,
} from "./primitives"
import { TypographyValue } from "./text"

const opt = Type.Optional

// --- Variables --------------------------------------------------------------------------------

export const VARIABLE_TYPES = [
  "color",
  "number",
  "string",
  "boolean",
  "typography",
  "shadow",
  "dimension",
] as const
export type VariableType = (typeof VARIABLE_TYPES)[number]

/** Variable types that need feature "tokens/composite". */
export const COMPOSITE_VARIABLE_TYPES: ReadonlySet<VariableType> = new Set([
  "typography",
  "shadow",
  "dimension",
])

/** A "dimension" value: px-only in format 0.x and 1.x. */
export const DimensionValue = Strict({ value: Type.Number(), unit: Type.Literal("px") })

/** Schemas for one plain (non-themed) value of each variable type. A binding is an alias. */
export const VARIABLE_VALUE_SCHEMAS = {
  color: Color,
  number: Num,
  string: StringOrRef,
  boolean: BoolOrRef,
  typography: Type.Union([TypographyValue, Ref]),
  shadow: Type.Union([ShadowEffect, Type.Array(ShadowEffect), Ref]),
  dimension: Type.Union([DimensionValue, Ref]),
} as const satisfies Record<VariableType, TSchema>

function variableSchema<const K extends VariableType>(type: K) {
  const value = VARIABLE_VALUE_SCHEMAS[type]
  const entry = Strict({ value, when: opt(ThemeSelection) })
  return Strict({
    type: Type.Literal(type),
    value: Type.Union([value, Type.Array(entry, { minItems: 1 })]),
    description: opt(Type.String()),
    group: opt(Type.String({ minLength: 1, description: "Dotted group path for DTCG export." })),
  })
}

export const ColorVariable = variableSchema("color")
export const NumberVariable = variableSchema("number")
export const StringVariable = variableSchema("string")
export const BooleanVariable = variableSchema("boolean")
export const TypographyVariable = variableSchema("typography")
export const ShadowVariable = variableSchema("shadow")
export const DimensionVariable = variableSchema("dimension")

/**
 * A variable. `value` is either a plain value used under every theme, or a non-empty array of
 * themed entries `{ value, when? }` resolved per spec section "Theme and variable resolution".
 */
export const Variable = Type.Union([
  ColorVariable,
  NumberVariable,
  StringVariable,
  BooleanVariable,
  TypographyVariable,
  ShadowVariable,
  DimensionVariable,
])
export type Variable = Static<typeof Variable>

/** One themed entry of a variable value. */
export interface ThemedEntry<V = unknown> {
  value: V
  when?: Record<string, string>
}

// --- Header -----------------------------------------------------------------------------------

/** Document metadata. Extra keys must be namespaced (`vendor.key`). */
export const DocumentMeta = Strict(
  {
    name: opt(Type.String()),
    library: opt(Type.Boolean({ description: "True for a library (.lib.kimo) document." })),
    createdWith: opt(Type.String()),
  },
  { patternProperties: { [META_KEY_PATTERN]: {} } },
)

/** Theme axes: axis name → its values; the first value is the axis default. */
export const Themes = RecordOf(
  AXIS_PATTERN,
  Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
)

/** Imported libraries: alias → relative path of a `.kimo` library file. */
export const Imports = RecordOf(ALIAS_PATTERN, Type.String({ pattern: RELATIVE_PATH_PATTERN }))

/** One entry of the asset manifest. */
export const AssetEntry = Strict({
  mime: Type.String({ pattern: "^[a-z]+/[a-z0-9.+-]+$" }),
  bytes: opt(Type.Integer({ minimum: 0 })),
  width: opt(Type.Integer({ minimum: 0 })),
  height: opt(Type.Integer({ minimum: 0 })),
  name: opt(Type.String({ description: "Original file name (informative)." })),
})
export type AssetEntry = Static<typeof AssetEntry>

/** Optional asset manifest: content-addressed file name (under `assets/`) → entry. */
export const Assets = RecordOf(ASSET_FILE_PATTERN, AssetEntry)

/** Pattern of `format` accepted by the 0.1 schema (any 0.1 patch). */
export const FORMAT_0_1_PATTERN = "^0\\.1\\.(0|[1-9][0-9]*)$"

/** The `.kimo` document root (format 0.1). */
export const KimoDocument = Strict(
  {
    $schema: Type.String({
      pattern: SCHEMA_URL_PATTERN,
      description: `For format 0.1: "${SCHEMA_URL}". Another version's URL is only a SCHEMA_URL_MISMATCH warning in validate().`,
    }),
    format: Type.String({ pattern: FORMAT_0_1_PATTERN }),
    features: opt(Type.Array(Type.String({ pattern: FEATURE_PATTERN }), { uniqueItems: true })),
    meta: opt(DocumentMeta),
    themes: opt(Themes),
    imports: opt(Imports),
    variables: opt(RecordOf(VARIABLE_NAME_PATTERN, Variable)),
    assets: opt(Assets),
    components: opt(
      Type.Array(Id, { uniqueItems: true, description: "Optional index of component node ids." }),
    ),
    merge: opt(MergeInfo),
    conflicts: opt(Conflicts),
    nodes: RecordOf(ID_PATTERN, Node),
  },
  { title: "Kimo document (.kimo), format 0.1" },
)
export type KimoDocument = Static<typeof KimoDocument>

/** The header part of {@link KimoDocument}: everything but `nodes`, used for staged validation. */
export const KimoHeader = Strict(
  { ...KimoDocument.properties, nodes: RecordOf(ID_PATTERN, Type.Unknown()) },
  { title: "Kimo document header (format 0.1)" },
)
