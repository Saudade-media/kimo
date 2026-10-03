/**
 * JSON Schema (draft 2020-12) generation from the TypeBox schemas, with shared sub-schemas
 * hoisted into `$defs`. `scripts/build-schema.ts` writes the result to
 * `schema/kimo-0.1.schema.json`.
 */
import type { TSchema } from "typebox"
import { FEATURES } from "./features"
import * as Doc from "./schema/document"
import * as G from "./schema/graphics"
import * as M from "./schema/merge"
import * as N from "./schema/nodes"
import * as P from "./schema/primitives"
import * as T from "./schema/text"
import { FORMAT_VERSION, SCHEMA_ID } from "./version"

type Json = Record<string, unknown>

/** Shared definitions, most composite first so larger sub-trees are matched first. */
const DEFS: [string, TSchema][] = [
  ["Conflict", M.Conflict],
  ["PropConflict", M.PropConflict],
  ["NodeConflict", M.NodeConflict],
  ["MoveConflict", M.MoveConflict],
  ["VariableConflict", M.VariableConflict],
  ["HeaderConflict", M.HeaderConflict],
  ["Placement", M.Placement],
  ["MergeInfo", M.MergeInfo],
  ["Node", N.Node],
  ["FrameNode", N.FrameNode],
  ["GroupNode", N.GroupNode],
  ["RectNode", N.RectNode],
  ["EllipseNode", N.EllipseNode],
  ["PolygonNode", N.PolygonNode],
  ["PathNode", N.PathNode],
  ["TextNode", N.TextNode],
  ["IconNode", N.IconNode],
  ["InstanceNode", N.InstanceNode],
  ["NoteNode", N.NoteNode],
  ["PromptNode", N.PromptNode],
  ["ScriptNode", N.ScriptNode],
  ["BrowserNode", N.BrowserNode],
  ["Variable", Doc.Variable],
  ["ColorVariable", Doc.ColorVariable],
  ["NumberVariable", Doc.NumberVariable],
  ["StringVariable", Doc.StringVariable],
  ["BooleanVariable", Doc.BooleanVariable],
  ["TypographyVariable", Doc.TypographyVariable],
  ["ShadowVariable", Doc.ShadowVariable],
  ["DimensionVariable", Doc.DimensionVariable],
  ["DimensionValue", Doc.DimensionValue],
  ["DocumentMeta", Doc.DocumentMeta],
  ["Themes", Doc.Themes],
  ["Imports", Doc.Imports],
  ["Assets", Doc.Assets],
  ["AssetEntry", Doc.AssetEntry],
  ["ComponentDef", N.ComponentDef],
  ["PropDef", N.PropDef],
  ["Override", N.Override],
  ["SlotDef", N.SlotDef],
  ["Placeholder", N.Placeholder],
  ["TextStyle", T.TextStyle],
  ["TypographyValue", T.TypographyValue],
  ["TextSpan", T.TextSpan],
  ["TextContent", T.TextContent],
  ["Layout", G.Layout],
  ["Stroke", G.Stroke],
  ["StrokeSides", G.StrokeSides],
  ["Effects", G.Effects],
  ["Effect", G.Effect],
  ["ShadowEffect", G.ShadowEffect],
  ["BlurEffect", G.BlurEffect],
  ["BackdropBlurEffect", G.BackdropBlurEffect],
  ["Paints", G.Paints],
  ["Paint", G.Paint],
  ["SolidPaint", G.SolidPaint],
  ["GradientPaint", G.GradientPaint],
  ["GradientStop", G.GradientStop],
  ["ImagePaint", G.ImagePaint],
  ["MeshPaint", G.MeshPaint],
  ["ShaderPaint", G.ShaderPaint],
  ["Size", G.Size],
  ["SizeFit", G.SizeFit],
  ["SizeFill", G.SizeFill],
  ["Radius", G.Radius],
  ["Padding", G.Padding],
  ["Color", P.Color],
  ["ColorLit", P.ColorLit],
  ["HexColor", P.HexColor],
  ["OklchColor", P.OklchColor],
  ["P3Color", P.P3Color],
  ["BlendMode", P.BlendMode],
  ["ThemeSelection", P.ThemeSelection],
  ["Meta", P.Meta],
  ["Num", P.Num],
  ["NonNegNum", P.NonNegNum],
  ["UnitNum", P.UnitNum],
  ["BoolOrRef", P.BoolOrRef],
  ["StringOrRef", P.StringOrRef],
  ["Ref", P.Ref],
  ["Id", P.Id],
  ["QId", P.QId],
  ["IdPath", P.IdPath],
  ["OrderKey", P.OrderKey],
]

const ANNOTATIONS = new Set(["default", "description", "title", "examples"])

/** Plain JSON copy (drops TypeBox's non-enumerable markers). */
const plain = (s: unknown): unknown => JSON.parse(JSON.stringify(s))

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
  if (v && typeof v === "object") {
    const o = v as Json
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(v)
}

function signature(s: Json): string {
  const o: Json = {}
  for (const [k, v] of Object.entries(s)) if (!ANNOTATIONS.has(k)) o[k] = v
  return stable(o)
}

const SCHEMA_MAPS = ["properties", "patternProperties", "$defs"]
const SCHEMA_LISTS = ["anyOf", "oneOf", "allOf", "prefixItems"]
const SCHEMA_SINGLE = [
  "items",
  "additionalProperties",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "contains",
]

/** Builds the published JSON Schema for format 0.1. */
export function buildJsonSchema(): Record<string, unknown> {
  const defs = DEFS.map(([name, s]) => [name, plain(s) as Json] as const)
  const bySig = new Map<string, string>()
  for (const [name, s] of defs) if (!bySig.has(signature(s))) bySig.set(signature(s), name)
  const used = new Set<string>()

  const visit = (s: unknown, self?: string): unknown => {
    if (!s || typeof s !== "object" || Array.isArray(s)) return s
    const o = s as Json
    const name = bySig.get(signature(o))
    if (name && name !== self) {
      used.add(name)
      const ref: Json = { $ref: `#/$defs/${name}` }
      const def = defs.find(([n]) => n === name)?.[1] as Json
      for (const k of ANNOTATIONS) if (k in o && stable(o[k]) !== stable(def[k])) ref[k] = o[k]
      return ref
    }
    const out: Json = {}
    for (const [k, v] of Object.entries(o)) {
      if (SCHEMA_MAPS.includes(k) && v && typeof v === "object") {
        const m: Json = {}
        for (const [mk, mv] of Object.entries(v as Json)) m[mk] = visit(mv)
        out[k] = m
      } else if (SCHEMA_LISTS.includes(k) && Array.isArray(v)) {
        out[k] = v.map((x) => visit(x))
      } else if (SCHEMA_SINGLE.includes(k)) {
        out[k] = visit(v)
      } else out[k] = v
    }
    return out
  }

  const root = visit(plain(Doc.KimoDocument)) as Json
  const $defs: Json = {}
  const done = new Set<string>()
  // Hoisted definitions may reference further definitions: expand until closed.
  for (
    let pending = [...used];
    pending.length > 0;
    pending = [...used].filter((n) => !done.has(n))
  ) {
    for (const name of pending) {
      done.add(name)
      $defs[name] = visit(defs.find(([n]) => n === name)?.[1], name)
    }
  }
  const sortedDefs: Json = {}
  for (const k of Object.keys($defs).sort()) sortedDefs[k] = $defs[k]

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_ID,
    description: `Structural schema of the .kimo file format ${FORMAT_VERSION} (Draft). Semantic rules (referential integrity, override paths, variable types, …) are checked by validate() in @kimo/core-schema; see docs/spec/kimo-format-v0.1.md. Known features: ${Object.keys(FEATURES).join(", ")}.`,
    ...root,
    $defs: sortedDefs,
  }
}

/** The generated schema, pretty-printed (before repository formatting). */
export function jsonSchemaText(): string {
  return `${JSON.stringify(buildJsonSchema(), null, 2)}\n`
}
