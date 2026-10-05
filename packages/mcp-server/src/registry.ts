/**
 * The tool registry (teardown 9.4 "one tool registry", ADR 0013 §3): the single list of tools.
 * The MCP server (`./server.ts`), the M6 built-in agent and the `kimo` CLI all read it. This
 * module has no MCP SDK import, so it runs in the browser and in workers.
 */
import { toJsonSchema } from "./schema"
import type { ToolAnnotations, ToolDef } from "./tools/define"
import { outputSchemaOf } from "./tools/define"
import { kimoExport, kimoRender } from "./tools/output"
import {
  kimoFindSpace,
  kimoGetVariables,
  kimoListComponents,
  kimoQuery,
  kimoValidate,
} from "./tools/read"
import {
  kimoClose,
  kimoCreate,
  kimoFocus,
  kimoGetState,
  kimoHistory,
  kimoOpen,
  kimoReadDocs,
  kimoSave,
  kimoStyles,
} from "./tools/session"
import { kimoApplyOps, kimoAssets, kimoImport, kimoScript } from "./tools/write"

/** Every tool, in the order `tools/list` returns them (most useful first). */
export const TOOLS = [
  kimoGetState,
  kimoReadDocs,
  kimoOpen,
  kimoQuery,
  kimoApplyOps,
  kimoRender,
  kimoGetVariables,
  kimoListComponents,
  kimoFindSpace,
  kimoValidate,
  kimoHistory,
  kimoSave,
  kimoFocus,
  kimoImport,
  kimoAssets,
  kimoExport,
  kimoCreate,
  kimoClose,
  kimoStyles,
  kimoScript,
] as const satisfies readonly ToolDef[]

export type KimoTool = (typeof TOOLS)[number]
export type ToolName = KimoTool["name"]

export const TOOL_NAMES = TOOLS.map((t) => t.name) as ToolName[]

const BY_NAME = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t as unknown as ToolDef]))

export function toolByName(name: string): ToolDef | undefined {
  return BY_NAME.get(name)
}

export interface ListOptions {
  /** Where the tools are offered. */
  host: "desktop" | "headless" | "web"
  /** Include `stub` tools (Settings › Agents "Experimental tools"). Default false. */
  includeStubs?: boolean
}

/** The tools a host offers. */
export function listTools(options: ListOptions): ToolDef[] {
  return TOOLS.map((t) => t as unknown as ToolDef).filter(
    (t) => t.availability[options.host] && (options.includeStubs || t.status !== "stub"),
  )
}

/** An MCP `Tool` descriptor (spec `tools/list` entry), SDK-independent. */
export interface McpToolDescriptor {
  name: string
  title: string
  description: string
  /** The model-facing schema ({@link advertisedInputSchema}); the server validates the strict one. */
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  annotations: ToolAnnotations & { title: string }
}

/**
 * Keywords the advertised (model-facing) input schema drops (board 31 token pass). They cost
 * tokens on every model call and never steer a model; the server still enforces them, because
 * it validates against the strict schema ({@link validationSchemaOf}), so an input outside them
 * fails with INVALID_INPUT and its path. Number bounds stay (they read as guidance).
 */
const ADVERTISE_DROPS = new Set([
  "pattern",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "examples",
  "title",
  "default",
])

function stripForModel(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripForModel)
  if (v === null || typeof v !== "object") return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (ADVERTISE_DROPS.has(k)) continue
    // Inside `properties` keys are field names, not keywords: keep every one.
    out[k] =
      k === "properties"
        ? Object.fromEntries(
            Object.entries(x as Record<string, unknown>).map(([n, p]) => [n, stripForModel(p)]),
          )
        : stripForModel(x)
  }
  return out
}

/** The strict input schema every call is validated against (Ajv strict, ADR 0013 §3). */
export function validationSchemaOf(def: ToolDef): Record<string, unknown> {
  return toJsonSchema(def.input)
}

/**
 * The input schema advertised to models (`tools/list`, the built-in agent): the tool's
 * `advertise` override when it has one (kimo_apply_ops: ops as a compact grammar), else the
 * strict schema without the keywords in {@link ADVERTISE_DROPS}. Always a superset of the strict
 * schema: every valid input is valid against it too.
 */
export function advertisedInputSchema(def: ToolDef): Record<string, unknown> {
  return stripForModel(def.advertise ?? toJsonSchema(def.input)) as Record<string, unknown>
}

export function toMcpDescriptor(def: ToolDef): McpToolDescriptor {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: advertisedInputSchema(def),
    outputSchema: toJsonSchema(outputSchemaOf(def)),
    annotations: { ...def.annotations, title: def.title },
  }
}
