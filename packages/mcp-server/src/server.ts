/**
 * MCP SDK adapter (`@kimo/mcp-server/server`, ADR 0013 §3): builds one `McpServer` per client
 * connection from the registry. Used by the desktop document host (one per socket/HTTP
 * connection) and by headless `kimo mcp` (one for its stdio).
 *
 * Input validation is done by the dispatcher with Ajv so failures come back as INVALID_INPUT
 * envelopes (structured, with `path`), never as SDK prose: the SDK is given a pass-through
 * validator, while `tools/list` still advertises the full schemas.
 */
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server"
import { Ajv } from "@modelcontextprotocol/server/validators/ajv"
import type { ToolError } from "./envelope"
import { toCallToolResult } from "./envelope"
import { type ListOptions, listTools, toMcpDescriptor } from "./registry"
import { PROMPTS } from "./resources"
import { type DispatchOptions, dispatch, type ToolContext, type ToolHandlers } from "./runtime"
import type { ToolDef } from "./tools/define"

export const SERVER_NAME = "kimo"

/** Server-level instructions sent at initialize (kept short; guides live in kimo_read_docs). */
export const SERVER_INSTRUCTIONS =
  "Kimo is a local design canvas (.kimo files). Start with kimo_get_state, open files with kimo_open, read with kimo_query, edit only with kimo_apply_ops (pass baseRevision from your last result), verify with kimo_render. Every call targets an explicit docId. Results are JSON envelopes {ok, summary, revision, warnings, errors}; branch on errors[].code. Read kimo_read_docs before your first edit."

const passThrough: Parameters<typeof fromJsonSchema>[1] & object = {
  getValidator: (() => (input: unknown) => ({
    valid: true as const,
    data: input,
    errorMessage: undefined,
  })) as never,
}

const ajv = new Ajv({ strict: true, allErrors: true })
const compiled = new Map<string, ReturnType<typeof ajv.compile>>()

/** Ajv validation of a tool input → INVALID_INPUT errors with JSON paths. */
export function validateInput(def: ToolDef, input: unknown): ToolError[] {
  let v = compiled.get(def.name)
  if (!v) {
    v = ajv.compile(toMcpDescriptor(def).inputSchema)
    compiled.set(def.name, v)
  }
  if (v(input)) return []
  return (v.errors ?? []).slice(0, 10).map((e) => ({
    code: "INVALID_INPUT" as const,
    message: `${e.instancePath || "(input)"} ${e.message ?? "is invalid"}`,
    path: e.instancePath
      .replace(/^\//, "")
      .replace(/\/(\d+)/g, "[$1]")
      .replace(/\//g, "."),
  }))
}

export interface KimoServerOptions extends ListOptions {
  version: string
  handlers: ToolHandlers
  /** Builds the per-connection context once the client has initialized. */
  context: () => ToolContext
  targets: DispatchOptions["targets"]
}

export function createKimoMcpServer(options: KimoServerOptions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: options.version },
    { instructions: SERVER_INSTRUCTIONS },
  )
  for (const def of listTools(options)) {
    const d = toMcpDescriptor(def)
    server.registerTool(
      def.name,
      {
        title: d.title,
        description: d.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(d.inputSchema as never, passThrough),
        outputSchema: fromJsonSchema<Record<string, unknown>>(d.outputSchema as never, passThrough),
        annotations: d.annotations,
      },
      async (args) => {
        const out = await dispatch(def.name, args, options.context(), options.handlers, {
          validate: validateInput,
          targets: options.targets,
        })
        return toCallToolResult(out.result, out.images) as never
      },
    )
  }
  for (const p of PROMPTS) {
    server.registerPrompt(p.name, { title: p.title, description: p.description }, () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `${p.description} Arguments: ${p.arguments.map((a) => a.name).join(", ")}.`,
          },
        },
      ],
    }))
  }
  // Resources (RESOURCES) are registered by the host implementation, which can read documents.
  return server
}
