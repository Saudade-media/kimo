/**
 * MCP SDK adapter (`@kimo/mcp-server/server`, ADR 0013 §3): builds one `McpServer` per client
 * connection from the registry. Used by the desktop document host (one per socket/HTTP
 * connection) and by headless `kimo mcp` (one for its stdio).
 *
 * Input validation is done by the dispatcher with Ajv so failures come back as INVALID_INPUT
 * envelopes (structured, with `path`), never as SDK prose: the SDK is given a pass-through
 * validator. Calls are validated against the strict schema (`validationSchemaOf`), while
 * `tools/list` advertises the compact model-facing one (`advertisedInputSchema`).
 */
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server"
import { Ajv } from "@modelcontextprotocol/server/validators/ajv"
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker"
import type { ToolError } from "./envelope"
import { toCallToolResult } from "./envelope"
import { type ListOptions, listTools, toMcpDescriptor, validationSchemaOf } from "./registry"
import { PROMPTS } from "./resources"
import { type DispatchOptions, dispatch, type ToolContext, type ToolHandlers } from "./runtime"
import type { ToolDef } from "./tools/define"

export const SERVER_NAME = "kimo"

/** Server-level instructions sent at initialize (kept short; guides live in kimo_read_docs). */
export const SERVER_INSTRUCTIONS =
  "Kimo is a local design canvas (.kimo files). Find the docId in your context or with kimo_get_state (kimo_open opens files); read with kimo_query; edit only with kimo_apply_ops (baseRevision from your last result); check with kimo_render. Build step by step: a skeleton, then one section per call (at most 40 new layers per call), one short status line before each call. Copy existing frames or pages instead of re-creating them. Results are JSON envelopes; branch on errors[].code. Write to the user plainly: what changed and where, layer names quoted, no filler, hype words or emoji. Guides: kimo_read_docs."

const passThrough: Parameters<typeof fromJsonSchema>[1] & object = {
  getValidator: (() => (input: unknown) => ({
    valid: true as const,
    data: input,
    errorMessage: undefined,
  })) as never,
}

const ajv = new Ajv({ strict: true, allErrors: true })
const compiled = new Map<string, ReturnType<typeof ajv.compile>>()

/**
 * Ajv compiles validators with `new Function`, which a Content-Security-Policy without
 * `'unsafe-eval'` forbids (the desktop app's hidden document host webview). There the
 * interpreting `@cfworker/json-schema` validator takes over: same schemas, one INVALID_INPUT
 * error with its message instead of Ajv's per-path list.
 */
let evalAllowed: boolean | undefined
function canEval(): boolean {
  if (evalAllowed === undefined) {
    try {
      evalAllowed = new Function("return true")() === true
    } catch {
      evalAllowed = false
    }
  }
  return evalAllowed
}
const interpreter = new CfWorkerJsonSchemaValidator({ shortcircuit: false })
const interpreted = new Map<string, (input: unknown) => { valid: boolean; errorMessage?: string }>()

function validateInterpreted(def: ToolDef, input: unknown): ToolError[] {
  let v = interpreted.get(def.name)
  if (!v) {
    v = interpreter.getValidator(validationSchemaOf(def) as never)
    interpreted.set(def.name, v)
  }
  const r = v(input)
  if (r.valid) return []
  return [{ code: "INVALID_INPUT", message: r.errorMessage ?? "Input is invalid.", path: "" }]
}

/** Ajv validation of a tool input → INVALID_INPUT errors with JSON paths. */
/** Test seam: force the eval-free validator (CSP webviews). */
export function setEvalAllowedForTests(allowed: boolean | undefined): void {
  evalAllowed = allowed
}

export function validateInput(def: ToolDef, input: unknown): ToolError[] {
  if (!canEval()) return validateInterpreted(def, input)
  let v = compiled.get(def.name)
  if (!v) {
    try {
      v = ajv.compile(validationSchemaOf(def))
    } catch (e) {
      if (!(e instanceof EvalError)) throw e
      evalAllowed = false
      return validateInterpreted(def, input)
    }
    compiled.set(def.name, v)
  }
  if (v(input)) return []
  return (v.errors ?? []).slice(0, 10).map((e) => ({
    code: "INVALID_INPUT" as const,
    // Name the offending key: "must NOT have additional properties" alone costs a guess.
    message: `${e.instancePath || "(input)"} ${e.message ?? "is invalid"}${
      e.keyword === "additionalProperties"
        ? `: "${(e.params as { additionalProperty?: string }).additionalProperty}"`
        : ""
    }`,
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
  preview?: DispatchOptions["preview"]
  beforeCall?: DispatchOptions["beforeCall"]
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
          ...(options.preview ? { preview: options.preview } : {}),
          ...(options.beforeCall ? { beforeCall: options.beforeCall } : {}),
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
