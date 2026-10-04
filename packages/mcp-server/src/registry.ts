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
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  annotations: ToolAnnotations & { title: string }
}

export function toMcpDescriptor(def: ToolDef): McpToolDescriptor {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: toJsonSchema(def.input),
    outputSchema: toJsonSchema(outputSchemaOf(def)),
    annotations: { ...def.annotations, title: def.title },
  }
}
