/**
 * `@kimo/mcp-server/host`: MCP SDK glue for document hosts (ADR 0013 §7). Kept out of the main
 * entry because it imports the SDK:
 *
 * - {@link RelayTransport}: an SDK `Transport` over relayed lines (the desktop host gets each
 *   socket line as `kimo://mcp-in` and answers with `kimo_mcp_send`);
 * - {@link createConnectionServer}: one `McpServer` per connection (tools from the registry,
 *   prompts, and the resources `kimo://schema/1.0`, `kimo://docs/{path}`, `kimo://doc/{docId}`,
 *   `kimo://doc/{docId}/node/{id}`, `kimo://doc/{docId}/variables`);
 * - `WebStandardStreamableHTTPServerTransport` re-exported for the relayed HTTP endpoint.
 */
import { jsonSchemaText } from "@kimo/core-schema"
import {
  type JSONRPCMessage,
  type McpServer,
  ResourceTemplate,
  type Transport,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server"
import { GUIDES, readGuide } from "../guides"
import { createKimoMcpServer, validateInput } from "../server"
import { connectionCall, connectionHandlers, type McpConnection } from "./host-runtime"

export { WebStandardStreamableHTTPServerTransport }

/** An SDK transport fed with relayed JSON-RPC lines. */
export class RelayTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  private closed = false

  constructor(private readonly write: (line: string) => Promise<void> | void) {}

  async start(): Promise<void> {}

  /** Feeds one inbound line (or parsed message). */
  receive(line: string | JSONRPCMessage): void {
    if (this.closed) return
    let msg: JSONRPCMessage
    try {
      msg = typeof line === "string" ? (JSON.parse(line) as JSONRPCMessage) : line
    } catch (e) {
      this.onerror?.(e instanceof Error ? e : new Error(String(e)))
      return
    }
    this.onmessage?.(msg)
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) return
    await this.write(JSON.stringify(message))
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
}

export interface ConnectionServerOptions {
  version: string
  host: "desktop" | "headless" | "web"
  includeStubs?: boolean
  /** #78: the transport carries a picker (elicitation) mid-call. Default false. */
  canAsk?: boolean | (() => boolean)
}

const json = (uri: URL, value: unknown) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value) }],
})

/** One MCP server for one connection, with tools, prompts and resources. */
export function createConnectionServer(
  conn: McpConnection,
  options: ConnectionServerOptions,
): McpServer {
  const server = createKimoMcpServer({
    host: options.host,
    version: options.version,
    ...(options.includeStubs ? { includeStubs: true } : {}),
    ...(options.canAsk !== undefined ? { canAsk: options.canAsk } : {}),
    handlers: connectionHandlers(conn),
    context: conn.context,
    targets: conn.targets,
    preview: conn.preview,
    beforeCall: conn.beforeCall,
    around: (name, input, toolUseId, run) => connectionCall(conn, name, input, toolUseId, run),
  })
  registerKimoResources(server, conn)
  return server
}

/** Registers the Kimo resources (ADR 0013 §2) on `server`, read through `conn`. */
export function registerKimoResources(server: McpServer, conn: McpConnection): void {
  const call = async (tool: string, input: Record<string, unknown>) =>
    (await conn.call(tool, input)).result
  server.registerResource(
    "kimo-schema",
    "kimo://schema/1.0",
    { title: ".kimo JSON Schema", mimeType: "application/schema+json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/schema+json", text: jsonSchemaText() }],
    }),
  )
  server.registerResource(
    "kimo-docs",
    new ResourceTemplate("kimo://docs/{path}", {
      list: async () => ({
        resources: Object.keys(GUIDES).map((p) => ({
          uri: `kimo://docs/${p}`,
          name: p,
          mimeType: "text/markdown",
        })),
      }),
    }),
    { title: "Kimo agent guides", mimeType: "text/markdown" },
    async (uri, vars) => {
      const g = readGuide(String(vars.path))
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: g?.markdown ?? "" }] }
    },
  )
  server.registerResource(
    "kimo-document",
    new ResourceTemplate("kimo://doc/{docId}", { list: undefined }),
    { title: "Open document summary", mimeType: "application/json" },
    async (uri, vars) => json(uri, await call("kimo_get_state", { docId: String(vars.docId) })),
  )
  server.registerResource(
    "kimo-node",
    new ResourceTemplate("kimo://doc/{docId}/node/{id}", { list: undefined }),
    { title: "Node", mimeType: "application/json" },
    async (uri, vars) =>
      json(
        uri,
        await call("kimo_query", {
          docId: String(vars.docId),
          select: { ids: [String(vars.id)] },
          depth: 1,
        }),
      ),
  )
  server.registerResource(
    "kimo-variables",
    new ResourceTemplate("kimo://doc/{docId}/variables", { list: undefined }),
    { title: "Variables and themes", mimeType: "application/json" },
    async (uri, vars) => json(uri, await call("kimo_get_variables", { docId: String(vars.docId) })),
  )
}

/** Input validation for in-process calls (`McpHostRuntimeOptions.validate`). */
export { validateInput }
