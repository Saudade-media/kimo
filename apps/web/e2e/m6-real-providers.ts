/**
 * Teardown §12 M6 exit check — "one prompt → screen across ≥ 3 providers" — run headless
 * through the real agent panel stack (manual; costs real tokens, never part of `bun run e2e`):
 *
 *   bun apps/web/e2e/m6-real-providers.ts [claude] [codex] [api]     (default: all three)
 *
 * The app's own composition is used end to end: an `AiSettingsController` (desktop flavour,
 * memory "keychain", the Node CLI host detecting the real `claude` / `codex` on PATH) →
 * `createPlatformAgentRuntime` (provider fetch from `ai.fetchFor`) → `createAgentPanelController`
 * → `send(prompt)`.
 *
 * - CLI providers (Claude Code, Codex) run in `~/.kimo/cli-workspaces/<session>/` exactly as the
 *   app spawns them (flags from `@kimo/ai-agent` adapters: inline `--mcp-config` /
 *   `-c mcp_servers.kimo.*`, nothing is written to ~/.claude or ~/.codex). Kimo's MCP server is
 *   the M5 headless `kimo mcp --headless --files <file>` (the app uses the shim → document
 *   host); edits land in a temp `.kimo` that is validated with `kimo validate` afterwards.
 *   Claude Code gets `--max-turns 6` (appended by this harness's process host).
 * - The API provider is the real Anthropic adapter over HTTP against a local mock Messages
 *   endpoint (no ANTHROPIC_API_KEY / OPENAI_API_KEY on this machine), editing the window's
 *   DocStore through the in-window M5 tools.
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { CliProcessHost } from "@kimo/ai-agent"
import { createNodeCliHost } from "@kimo/ai-agent/node"
import { type KimoDocument, parse, serialize } from "@kimo/core-schema"
import { createEmptyDocument, type DocStore, importDocument } from "@kimo/editor-state"
import { createMemorySecrets } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createAgentPanelController, createInWindowTools } from "../src/agent-panel"
import { createPlatformAgentRuntime } from "../src/agent-panel/runtime"
import { createAiSettingsController } from "../src/ai-settings/controller"
import { relayAuthFor } from "../src/ai-settings/runtime"
import { memoryStorage } from "../src/ai-settings/testing"

const ROOT = resolve(import.meta.dir, "../../..")
const KIMO_CLI = join(ROOT, "packages/cli/src/main.ts")
const BUN = process.execPath

const PROMPT = (path: string) =>
  [
    `The Kimo design file is ${path}. Open it with kimo_open (path above), then build a small pricing card`,
    'inside the existing root frame named "Screen": a vertical auto-layout card frame named "Card" with',
    'a title text "Pro plan", a price text "$29/mo" and a button frame named "Button" containing the text',
    '"Subscribe". Use one kimo_apply_ops call if you can, then kimo_save. Do not do anything else.',
    'Hints (skip the guides): insert ops look like {op:"insert", key:"card", parent:"<Screen id>",',
    'node:{type:"frame", name:"Card", layout:{dir:"column", gap:12, pad:[24,24,24,24]}}}; later ops',
    'reference it as parent:"@card"; text nodes are {type:"text", name, content}. Use only those',
    "properties. kimo_open returns the docId and the Screen id: do not call kimo_get_state.",
  ].join(" ")

function seed(): KimoDocument {
  const d = createEmptyDocument("Real provider run") as KimoDocument & {
    nodes: Record<string, unknown>
  }
  d.nodes.Screen0001 = {
    type: "frame",
    parent: null,
    order: "a0",
    name: "Screen",
    x: 0,
    y: 0,
    w: 480,
    h: 400,
  }
  return d
}

type N = { type: string; name?: string; content?: unknown; parent?: string | null; order?: string }
function tree(doc: KimoDocument): string {
  const nodes = doc.nodes as Record<string, N>
  const kids = (p: string | null) =>
    Object.entries(nodes)
      .filter(([, n]) => (n.parent ?? null) === p)
      .sort(([, a], [, b]) => String(a.order).localeCompare(String(b.order)))
  const out: string[] = []
  const walk = (p: string | null, depth: number) => {
    for (const [id, n] of kids(p)) {
      const text = typeof n.content === "string" ? ` "${n.content}"` : ""
      out.push(`${"  ".repeat(depth)}${n.type} ${n.name ?? id}${text}`)
      walk(id, depth + 1)
    }
  }
  walk(null, 0)
  return out.join("\n")
}

function validateFile(file: string): string {
  const r = spawnSync(BUN, [KIMO_CLI, "validate", file], { encoding: "utf8" })
  return `exit ${r.status}: ${(r.stdout + r.stderr).trim().split("\n").slice(-3).join(" | ")}`
}

// --- Local mock Anthropic Messages endpoint (the API provider run) ------------------------------

const sse = (events: { event: string; data: unknown }[]) =>
  events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("")

function messageStream(
  block: { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown },
) {
  const start =
    block.type === "text"
      ? { type: "text", text: "" }
      : { type: "tool_use", id: `toolu_${Date.now()}`, name: block.name, input: {} }
  const delta =
    block.type === "text"
      ? { type: "text_delta", text: block.text }
      : { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
  return sse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5-20251001",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1200, output_tokens: 1 },
        },
      },
    },
    {
      event: "content_block_start",
      data: { type: "content_block_start", index: 0, content_block: start },
    },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta } },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: {
          stop_reason: block.type === "text" ? "end_turn" : "tool_use",
          stop_sequence: null,
        },
        usage: { output_tokens: 180 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ])
}

function startMockAnthropic(docId: () => string) {
  const seen: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as {
        tools?: unknown[]
        messages: { role: string; content: unknown }[]
      }
      seen.push(`${req.headers.get("x-api-key") ? "key" : "nokey"} ${new URL(req.url).pathname}`)
      const stream = (s: string) =>
        new Response(s, { headers: { "content-type": "text/event-stream" } })
      if (!body.tools?.length)
        return stream(messageStream({ type: "text", text: '{"title":"Pricing card"}' }))
      const hasResult = body.messages.some(
        (m) =>
          Array.isArray(m.content) &&
          (m.content as { type?: string }[]).some((c) => c.type === "tool_result"),
      )
      if (hasResult)
        return stream(messageStream({ type: "text", text: "The pricing card is in Screen." }))
      return stream(
        messageStream({
          type: "tool_use",
          name: "kimo_apply_ops",
          input: {
            docId: docId(),
            ops: [
              {
                op: "insert",
                key: "card",
                parent: "Screen0001",
                node: {
                  type: "frame",
                  name: "Card",
                  layout: { dir: "column", gap: 12, pad: [24, 24, 24, 24] },
                  w: 320,
                  h: 220,
                },
              },
              {
                op: "insert",
                parent: "@card",
                node: { type: "text", name: "Title", content: "Pro plan" },
              },
              {
                op: "insert",
                parent: "@card",
                node: { type: "text", name: "Price", content: "$29/mo" },
              },
              {
                op: "insert",
                key: "btn",
                parent: "@card",
                node: { type: "frame", name: "Button", w: 140, h: 40 },
              },
              {
                op: "insert",
                parent: "@btn",
                node: { type: "text", name: "Label", content: "Subscribe" },
              },
            ],
          },
        }),
      )
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, seen, stop: () => server.stop(true) }
}

// --- One run --------------------------------------------------------------------------------------

interface RunResult {
  provider: string
  model: string
  status: string
  turns?: number
  opsApplied: number
  steps: string[]
  costUsd: number | null
  tokens: { in: number; out: number }
  text: string
  error?: string
  file: string
  tree: string
  validate: string
  ms: number
}

async function run(which: "claude" | "codex" | "api"): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), "kimo-m6-real-"))
  const file = join(dir, "Pricing.kimo")
  writeFileSync(file, serialize(seed()))
  const store: DocStore = importDocument(seed())
  const tools = createInWindowTools({ store, path: file })
  const mock = which === "api" ? startMockAnthropic(() => tools.docId()) : null

  // Node CLI host (real processes); Claude Code is capped at 6 turns by appending --max-turns.
  const node = createNodeCliHost()
  const cliHost: CliProcessHost = {
    ...node,
    spawn: (spec) => {
      // Board 39: show the model and effort flags the adapter passed.
      const flags = spec.args.flatMap((a, i) =>
        a === "--model" || a === "--effort" || /^model_reasoning_effort=/.test(a)
          ? [a.startsWith("--") ? `${a} ${spec.args[i + 1]}` : a]
          : [],
      )
      console.log(
        `spawn ${spec.path.split("/").pop()}: ${flags.join(" ") || "(no model/effort flags)"}`,
      )
      return node.spawn(
        spec.path.endsWith("/claude")
          ? { ...spec, args: [...spec.args, "--max-turns", "6"] }
          : spec,
      )
    },
  }
  const secrets = createMemorySecrets(mock ? { "provider.anthropic": "sk-ant-local-mock" } : {})
  const ai = createAiSettingsController({
    platform: "desktop",
    os: "macos",
    secrets,
    cliHost,
    storage: memoryStorage(),
    // Stands in for the Rust relay: injects the stored key per relayAuthFor; the mock endpoint
    // replaces api.anthropic.com.
    fetchFor: (p) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init)
        const auth = relayAuthFor(p)
        const headers = new Headers(req.headers)
        for (const h of ["authorization", "x-api-key"]) headers.delete(h)
        const key = await secrets.get(`provider.${p.id}`)
        if (auth.kind === "header" && key) headers.set(auth.header, key)
        const url = new URL(req.url)
        const target = mock ? `${mock.url}${url.pathname}${url.search}` : req.url
        return fetch(new Request(target, { method: req.method, headers, body: await req.text() }))
      }) as typeof fetch,
  })
  await ai.refresh()

  const rt = createPlatformAgentRuntime(createMemoryPlatform(), ai, tools.factory, {
    cliHost,
    mcpLaunch: (cli) => ({
      command: BUN,
      args: [KIMO_CLI, "mcp", "--headless", "--client", cli, "--files", file],
    }),
  })
  const c = createAgentPanelController({
    runtime: rt,
    fileId: "m6-real",
    fileName: "Pricing.kimo",
    docId: () => tools.docId(),
    nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name,
  })
  await c.refresh()
  const selection =
    which === "claude"
      ? {
          provider: "cli:claude-code",
          model: process.env.KIMO_CLAUDE_MODEL ?? "claude-haiku-4-5-20251001",
        }
      : which === "codex"
        ? { provider: "cli:codex", model: process.env.KIMO_CODEX_MODEL ?? "gpt-5.6-luna" }
        : { provider: "anthropic", model: "claude-haiku-4-5-20251001" }
  c.setModel(selection)
  // Board 39 Effort (KIMO_EFFORT: low | medium | high | max), clamped per model by the adapter.
  c.setThinking((process.env.KIMO_EFFORT as "low" | "medium" | "high" | "max" | undefined) ?? "low")
  const t0 = Date.now()
  await c.send(PROMPT(file))
  // Wait for the turn (send resolves at turn end; be safe for queued work).
  while (c.state.busy) await new Promise((r) => setTimeout(r, 200))
  const ms = Date.now() - t0
  const session = await rt.sessions.get(c.state.session?.id ?? "")
  const turn = session?.turns.at(-1)
  mock?.stop()

  let doc: KimoDocument
  let validate: string
  if (which === "api") {
    doc = store.toDocument()
    writeFileSync(file, serialize(doc))
    validate = validateFile(file)
  } else {
    // The headless MCP server saved through kimo_save (or its exit flush); give it a moment.
    await new Promise((r) => setTimeout(r, 2500))
    doc = parse(readFileSync(file, "utf8"))
    validate = validateFile(file)
  }
  const text = (turn?.messages ?? [])
    .flatMap((m) =>
      m.role === "assistant" ? m.content.map((p) => (p.type === "text" ? p.text : "")) : [],
    )
    .join("")
  const last = [...c.state.messages].reverse().find((m) => m.kind === "agent") as
    | { steps?: { label: string; state: string }[] }
    | undefined
  c.dispose()
  return {
    provider: selection.provider,
    model: turn?.servedBy ?? selection.model,
    status: turn?.status ?? "none",
    ...(turn?.cli?.turns !== undefined ? { turns: turn.cli.turns } : {}),
    opsApplied: turn?.opsApplied ?? 0,
    steps: (last?.steps ?? []).map((s) => `${s.state}: ${s.label}`),
    costUsd: turn?.cli?.reportedCostUsd ?? turn?.cost.usd ?? null,
    tokens: { in: turn?.usage.inputTokens ?? 0, out: turn?.usage.outputTokens ?? 0 },
    text: text.slice(0, 300),
    ...(turn?.error ? { error: `${turn.error.title}: ${turn.error.body}` } : {}),
    file,
    tree: tree(doc),
    validate,
    ms,
  }
}

const picked = process.argv.slice(2).filter((a) => ["claude", "codex", "api"].includes(a)) as (
  | "claude"
  | "codex"
  | "api"
)[]
for (const which of picked.length ? picked : (["api", "claude", "codex"] as const)) {
  console.log(`\n=== ${which} ===`)
  try {
    const r = await run(which)
    const { tree: t, ...rest } = r
    console.log(JSON.stringify(rest, null, 2))
    console.log(t)
  } catch (e) {
    console.log("FAILED", e)
  }
}
process.exit(0)
