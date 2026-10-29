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
import {
  createRequestStateCodec,
  fromJsonSchema,
  inputRequired,
  McpServer,
  type PrimitiveSchemaDefinition,
} from "@modelcontextprotocol/server"
import { Ajv } from "@modelcontextprotocol/server/validators/ajv"
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker"
import type { ToolError } from "./envelope"
import { toCallToolResult } from "./envelope"
import { APPROVAL_TIMEOUT_MS } from "./policy"
import { type ListOptions, listTools, toMcpDescriptor, validationSchemaOf } from "./registry"
import { PROMPTS } from "./resources"
import {
  type DispatchOptions,
  dispatch,
  type HandlerOutput,
  type ToolContext,
  type ToolHandlers,
} from "./runtime"
import { CLAUDE_CODE_TOOL_USE_META } from "./stream"
import type { ToolDef } from "./tools/define"

export const SERVER_NAME = "kimo"

/** Server-level instructions sent at initialize (kept short; guides live in kimo_read_docs). */
export const SERVER_INSTRUCTIONS =
  "Kimo is a local design canvas (.kimo files). Find the docId in your context or with kimo_get_state (kimo_open opens files); read with kimo_query; edit only with kimo_script (build a section with a short JavaScript program whose calls compile to ops; guide: script) or kimo_apply_ops (a few precise edits), baseRevision from your last result. Never guess the file or frame: unless the request names both, call kimo_get_state with pick before its first edit. Show work early, no long planning: the first call makes the page frame with its first finished section, then one finished section per call (the new-layer limit is a ceiling, not a target), one short status line before each call. Pass render:true on the call that finishes a section instead of a separate kimo_render; fix the data.problems a result lists before moving on and finish with kimo_validate check:true clean. A failed call returns retryId: fix it with {docId, retryId, edits} instead of resending it. Copy existing frames or pages instead of re-creating them. Results are JSON envelopes; branch on errors[].code. Write to the user plainly: what changed and where, layer names quoted, no filler, hype words or emoji. Guides: kimo_read_docs."

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
  /**
   * Wraps each tool call (ADR 0013 §4.7): the host runs it with the provisional stream of its
   * tool-use id (`_meta["claudecode/toolUseId"]`) so a streamed edit commits or rolls back.
   */
  around?: (
    name: string,
    input: Record<string, unknown>,
    toolUseId: string | undefined,
    run: (ctx: ToolContext) => Promise<HandlerOutput>,
  ) => Promise<HandlerOutput>
  /**
   * #78: this transport carries server-to-client requests during a call, so a client that
   * declared elicitation may be shown a picker (socket relay and stdio: true; relayed HTTP:
   * false until tested live). Default false.
   */
  canAsk?: boolean | (() => boolean)
}

/** Per-process key of the picker state (one process serves every round of a call). */
const STATE_KEY = globalThis.crypto.getRandomValues(new Uint8Array(32))

/** Elicitation enum form: titled `oneOf` from 2025-11-25 on, `enum` + `enumNames` before. */
function choiceSchema(
  version: string | undefined,
  title: string,
  options: readonly { value: string; label: string }[],
): PrimitiveSchemaDefinition {
  if (version && version >= "2025-11-25")
    return {
      type: "string",
      title,
      oneOf: options.map((o) => ({ const: o.value, title: o.label })),
    }
  return {
    type: "string",
    title,
    enum: options.map((o) => o.value),
    enumNames: options.map((o) => o.label),
  }
}

export function createKimoMcpServer(options: KimoServerOptions): McpServer {
  // The picker state rides through the client: sealed, 10 minutes, bound to this connection.
  const connection = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")
  const codec = createRequestStateCodec<unknown>({
    key: STATE_KEY,
    ttlSeconds: 600,
    bind: () => connection,
  })
  const server = new McpServer(
    { name: SERVER_NAME, version: options.version },
    {
      instructions: SERVER_INSTRUCTIONS,
      inputRequired: { roundTimeoutMs: APPROVAL_TIMEOUT_MS, maxRounds: 4 },
      requestState: { verify: codec.verify },
    },
  )
  const transportCanAsk = () =>
    typeof options.canAsk === "function" ? options.canAsk() : options.canAsk === true
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
      async (args, extra) => {
        const req = extra.mcpReq
        // #78: the client may be shown a picker when it declared form elicitation (a bare
        // `elicitation: {}` counts) and the transport carries requests mid-call.
        const declared = server.server.getClientCapabilities()?.elicitation as
          | Record<string, unknown>
          | undefined
        const ask: NonNullable<ToolContext["ask"]> = {
          can:
            transportCanAsk() &&
            declared !== undefined &&
            (declared.form !== undefined || declared.url === undefined),
          ...(req.inputResponses ? { responses: req.inputResponses } : {}),
          ...(req.requestState() !== undefined ? { state: req.requestState() } : {}),
          signal: req.signal,
        }
        const run = (ctx: ToolContext) => {
          ctx.ask = ask
          return dispatch(def.name, args, ctx, options.handlers, {
            validate: validateInput,
            targets: options.targets,
            ...(options.preview ? { preview: options.preview } : {}),
            ...(options.beforeCall ? { beforeCall: options.beforeCall } : {}),
          })
        }
        const id = req._meta?.[CLAUDE_CODE_TOOL_USE_META]
        const out = options.around
          ? await options.around(
              def.name,
              (args ?? {}) as Record<string, unknown>,
              typeof id === "string" ? id : undefined,
              run,
            )
          : await run(options.context())
        if (out.ask) {
          const q = out.ask
          return inputRequired({
            inputRequests: {
              target: inputRequired.elicit({
                message: q.message,
                requestedSchema: {
                  type: "object",
                  properties: {
                    target: choiceSchema(
                      server.server.getNegotiatedProtocolVersion(),
                      q.title,
                      q.options,
                    ),
                  },
                  required: ["target"],
                },
              }),
            },
            requestState: await codec.mint(q.state, extra),
          }) as never
        }
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
