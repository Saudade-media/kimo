import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  claudeCodeAdapter,
  claudeInvocation,
  codexAdapter,
  codexInvocation,
  geminiInvocation,
  geminiParser,
  genericAdapter,
} from "../src/cli/adapters"
import { detectClis, pickDefaultSelection } from "../src/cli/detect"
import { parseEnvelope, runCliTurn, shimLaunch } from "../src/cli/engine"
import type { CliDetection, CliTurnInput } from "../src/cli/types"
import type { AgentEvent } from "../src/loop"
import { createNodeCliHost } from "../src/node"
import { replyOf } from "../src/progress"
import { resolveRuntime } from "../src/runtime"

const envelope = {
  ok: true,
  summary: "Inserted Waitlist Form (3 nodes)",
  doc: { id: "d_1", path: "/x.kimo", dirty: true, readOnly: false },
  ops: [{ op: "insert" }, { op: "insert" }, { op: "insert" }],
  changed: ["Form000001"],
  undoToken: "u-cli-1",
  pointer: "Submit0001",
  warnings: [],
  data: {},
}

/** Recorded Claude Code `-p --output-format stream-json --verbose --include-partial-messages` output. */
const CLAUDE_STREAM = [
  {
    type: "system",
    subtype: "init",
    session_id: "sess-claude-1",
    model: "claude-opus-5-5",
    tools: ["mcp__kimo__kimo_apply_ops"],
    mcp_servers: [{ name: "kimo", status: "connected" }],
  },
  {
    type: "stream_event",
    session_id: "sess-claude-1",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Adding the " },
    },
  },
  {
    type: "stream_event",
    session_id: "sess-claude-1",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "form." } },
  },
  {
    type: "stream_event",
    session_id: "sess-claude-1",
    parent_tool_use_id: null,
    event: {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id: "toolu_9",
        name: "mcp__kimo__kimo_apply_ops",
        input: {},
      },
    },
  },
  {
    type: "stream_event",
    session_id: "sess-claude-1",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"docId":"d_1","label":"Insert ' },
    },
  },
  {
    type: "stream_event",
    session_id: "sess-claude-1",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: 'Waitlist Form","ops":[]}' },
    },
  },
  {
    type: "assistant",
    session_id: "sess-claude-1",
    parent_tool_use_id: null,
    message: {
      content: [
        { type: "text", text: "Adding the form." },
        {
          type: "tool_use",
          id: "toolu_9",
          name: "mcp__kimo__kimo_apply_ops",
          input: { docId: "d_1", label: "Insert Waitlist Form", ops: [] },
        },
      ],
    },
  },
  {
    type: "user",
    session_id: "sess-claude-1",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_9",
          content: [
            { type: "text", text: envelope.summary },
            { type: "text", text: JSON.stringify(envelope) },
          ],
        },
      ],
    },
  },
  {
    type: "stream_event",
    session_id: "sess-claude-1",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " Done." } },
  },
  {
    type: "assistant",
    session_id: "sess-claude-1",
    parent_tool_use_id: null,
    message: { content: [{ type: "text", text: " Done." }] },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Adding the form. Done.",
    session_id: "sess-claude-1",
    num_turns: 2,
    total_cost_usd: 0.042,
    usage: {
      input_tokens: 3100,
      output_tokens: 1400,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 0,
    },
  },
]

const CODEX_STREAM = [
  { type: "thread.started", thread_id: "thr-1" },
  { type: "turn.started" },
  {
    type: "item.started",
    item: {
      id: "item_1",
      type: "mcp_tool_call",
      server: "kimo",
      tool: "kimo_apply_ops",
      arguments: { docId: "d_1", ops: [] },
      status: "in_progress",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "item_1",
      type: "mcp_tool_call",
      server: "kimo",
      tool: "kimo_apply_ops",
      arguments: { docId: "d_1" },
      result: {
        content: [
          { type: "text", text: envelope.summary },
          { type: "text", text: JSON.stringify(envelope) },
        ],
      },
      error: null,
      status: "completed",
    },
  },
  {
    type: "item.completed",
    item: { id: "item_2", type: "agent_message", text: "Added the waitlist form." },
  },
  {
    type: "turn.completed",
    usage: { input_tokens: 2000, cached_input_tokens: 500, output_tokens: 300 },
  },
]

let dir: string
let bin: string
let home: string

function writeExe(name: string, body: string) {
  const p = join(bin, name)
  writeFileSync(p, `#!${process.execPath}\n${body}`)
  chmodSync(p, 0o755)
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kimo-cli-"))
  bin = join(dir, "bin")
  home = join(dir, "home")
  mkdirSync(bin)
  mkdirSync(home)
  writeExe(
    "claude",
    `const a = process.argv.slice(2)
if (a[0] === "--version") { console.log("2.1.289 (Claude Code)"); process.exit(0) }
if (a[0] === "auth") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "me@example.com", subscriptionType: "max" })); process.exit(0) }
const fs = require("node:fs")
let input = ""
process.stdin.on("data", (d) => { input += d })
process.stdin.on("end", async () => {
  fs.writeFileSync("invocation.json", JSON.stringify({ args: a, stdin: input }))
  if (process.env.FAKE_SLOW) { setInterval(() => {}, 1000); return }
  for (const line of ${JSON.stringify(CLAUDE_STREAM.map((l) => JSON.stringify(l)))}) { process.stdout.write(line + "\\n"); await new Promise((r) => setTimeout(r, 1)) }
})
`,
  )
  writeExe(
    "codex",
    `const a = process.argv.slice(2)
if (a[0] === "--version") { console.log("codex-cli 0.146.0"); process.exit(0) }
if (a[0] === "login") { console.log("Logged in using ChatGPT"); process.exit(0) }
let input = ""
process.stdin.on("data", (d) => { input += d })
process.stdin.on("end", () => {
  require("node:fs").writeFileSync("invocation.json", JSON.stringify({ args: a, stdin: input }))
  for (const line of ${JSON.stringify(CODEX_STREAM.map((l) => JSON.stringify(l)))}) process.stdout.write(line + "\\n")
})
`,
  )
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const host = () =>
  createNodeCliHost({
    home,
    path: bin,
    env: { PATH: bin },
    workspacesRoot: join(home, ".kimo", "cli-workspaces"),
  })

describe("detection and default precedence", () => {
  test("probes PATH, version and auth without prompting", async () => {
    const d = await detectClis(host())
    const claude = d.find((x) => x.id === "claude-code")
    expect(claude).toMatchObject({
      installed: true,
      version: "2.1.289",
      signedIn: true,
      billing: "subscription",
      plan: "max",
      account: "me@example.com",
    })
    expect(d.find((x) => x.id === "codex")).toMatchObject({
      installed: true,
      version: "0.146.0",
      signedIn: true,
      billing: "subscription",
    })
    expect(d.find((x) => x.id === "gemini-cli")).toMatchObject({ installed: false })
  })

  test("Claude Code CLI → other signed-in CLIs → API keys → none; web never uses CLIs", () => {
    const cli = (id: string, signedIn: boolean | null): CliDetection => ({
      id,
      label: id,
      installed: true,
      path: `/b/${id}`,
      signedIn,
      billing: "subscription",
    })
    const api = [
      { id: "openai", agentModel: "gpt-4.1" },
      { id: "anthropic", agentModel: "claude-opus-5-5" },
    ]
    expect(
      pickDefaultSelection({
        platform: "desktop",
        clis: [cli("codex", true), cli("claude-code", true)],
        apiProviders: api,
      }),
    ).toEqual({ provider: "cli:claude-code", model: "default" })
    expect(
      pickDefaultSelection({
        platform: "desktop",
        clis: [cli("claude-code", false), cli("codex", true)],
        apiProviders: api,
      }),
    ).toEqual({ provider: "cli:codex", model: "default" })
    expect(
      pickDefaultSelection({
        platform: "desktop",
        clis: [cli("claude-code", null)],
        apiProviders: api,
      }),
    ).toEqual({ provider: "anthropic", model: "claude-opus-5-5" })
    expect(
      pickDefaultSelection({ platform: "web", clis: [cli("claude-code", true)], apiProviders: [] }),
    ).toBeNull()
    expect(
      pickDefaultSelection({
        platform: "desktop",
        clis: [cli("claude-code", true)],
        apiProviders: api,
        preferred: { provider: "openai", model: "gpt-4.1" },
      }),
    ).toEqual({ provider: "openai", model: "gpt-4.1" })
  })

  test("resolveRuntime routes cli:* to the adapter and refuses on web", () => {
    const clis: CliDetection[] = [
      {
        id: "claude-code",
        label: "Claude Code",
        installed: true,
        path: "/b/claude",
        signedIn: true,
        billing: "subscription",
      },
    ]
    const r = resolveRuntime(
      { provider: "cli:claude-code", model: "default" },
      { providers: [], clis, platform: "desktop" },
    )
    expect(r.kind).toBe("cli")
    expect(() =>
      resolveRuntime(
        { provider: "cli:claude-code", model: "default" },
        { providers: [], clis, platform: "web" },
      ),
    ).toThrow()
    expect(() =>
      resolveRuntime(
        { provider: "cli:codex", model: "default" },
        { providers: [], clis, platform: "desktop" },
      ),
    ).toThrow()
  })
})

const input = (extra: Partial<CliTurnInput> = {}): CliTurnInput => ({
  session: "abc123",
  model: "default",
  thinking: "high",
  prompt: "Add a waitlist form",
  systemPrompt: "You are Kimo.",
  mcp: shimLaunch("/Applications/Kimo.app/Contents/MacOS/kimo-mcp", "claude-code"),
  workspace: "/w",
  ...extra,
})

describe("invocations", () => {
  test("Claude Code: stream-json both ways, only Kimo's MCP server, no built-in tools, resume", () => {
    const { args, stdin } = claudeInvocation(
      input({ cliSessionId: "sess-1", model: "opus", thinking: "max" }),
    )
    const at = (flag: string) => args[args.indexOf(flag) + 1]
    expect(args).toContain("-p")
    expect(at("--output-format")).toBe("stream-json")
    expect(at("--input-format")).toBe("stream-json")
    expect(args).toContain("--strict-mcp-config")
    expect(at("--tools")).toBe("")
    expect(at("--allowedTools")).toBe("mcp__kimo")
    expect(at("--permission-mode")).toBe("dontAsk")
    expect(at("--resume")).toBe("sess-1")
    expect(at("--model")).toBe("opus")
    expect(at("--effort")).toBe("max")
    expect(JSON.parse(at("--mcp-config") ?? "{}").mcpServers.kimo.args).toEqual([
      "--client",
      "claude-code",
    ])
    expect(JSON.parse(stdin.trim()).message.content.at(-1)).toEqual({
      type: "text",
      text: "Add a waitlist form",
    })
  })

  test("Claude Code: Kimo's prompt replaces Claude Code's; context leads the user message", () => {
    const { args, stdin, env } = claudeInvocation(
      input({ context: "Document: docId d_1_2\nPage outline …" }),
    )
    const at = (flag: string) => args[args.indexOf(flag) + 1]
    expect(at("--system-prompt")).toBe("You are Kimo.")
    expect(args).not.toContain("--append-system-prompt")
    expect(args).toContain("--disable-slash-commands")
    expect(env).toEqual({
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    })
    const text = JSON.parse(stdin.trim()).message.content.at(-1).text as string
    expect(text).toBe(
      "<kimo-context>\nDocument: docId d_1_2\nPage outline …\n</kimo-context>\n\nAdd a waitlist form",
    )
    // The system prompt never carries the volatile context (Claude Code records it once).
    expect(at("--system-prompt")).not.toContain("docId")
  })

  test("Codex: exec --json, read-only sandbox, MCP via -c, resume", () => {
    const { args } = codexInvocation(
      input({ cliSessionId: "thr-1", mcp: shimLaunch("/k", "codex") }),
    )
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "thr-1"])
    expect(args).toContain("--json")
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only")
    expect(args).toContain('mcp_servers.kimo.command="/k"')
    expect(args).toContain('mcp_servers.kimo.args=["--client","codex"]')
    expect(args).toContain('mcp_servers.kimo.default_tools_approval_mode="approve"')
    expect(args.at(-1)).toBe("-")
  })

  test("Codex: Kimo's prompt is the base instructions file, on new and resumed turns", () => {
    for (const cliSessionId of [undefined, "thr-1"]) {
      const inv = codexInvocation(
        input({
          ...(cliSessionId ? { cliSessionId } : {}),
          context: "ctx",
          mcp: shimLaunch("/k", "codex"),
        }),
      )
      expect(inv.args).toContain('model_instructions_file="/w/.kimo/instructions.md"')
      expect(inv.workspaceFiles).toEqual([
        { path: ".kimo/instructions.md", text: "You are Kimo.\n" },
      ])
      expect(inv.stdin).toBe("<kimo-context>\nctx\n</kimo-context>\n\nAdd a waitlist form")
    }
  })

  test("Gemini CLI: stream-json, workspace settings add Kimo MCP and exclude write/shell tools", () => {
    const inv = geminiInvocation(input({ mcp: shimLaunch("/k", "gemini-cli") }))
    expect(inv.args).toContain("stream-json")
    const settings = JSON.parse(inv.workspaceFiles?.[0]?.text ?? "{}")
    expect(settings.mcpServers.kimo.args).toEqual(["--client", "gemini-cli"])
    expect(settings.tools.exclude).toContain("run_shell_command")
    expect(inv.env).toEqual({ GEMINI_SYSTEM_MD: "/w/.gemini/system.md" })
    expect(inv.workspaceFiles?.[1]).toEqual({ path: ".gemini/system.md", text: "You are Kimo.\n" })
    expect(inv.args[inv.args.indexOf("--prompt") + 1]).toBe("Add a waitlist form")
    const events = geminiParser().push(
      JSON.stringify({
        type: "tool_use",
        tool_name: "kimo_apply_ops",
        tool_id: "t1",
        parameters: { docId: "d" },
      }),
    )
    expect(events[0]).toMatchObject({ type: "step_start", tool: "kimo_apply_ops" })
  })

  test("generic adapter fills the args template", () => {
    const a = genericAdapter({
      id: "my-cli",
      label: "My CLI",
      command: "mycli",
      args: ["run", "--json", "--model", "{model}", "--mcp", "{mcpConfigJson}", "{prompt}"],
      output: "claude-stream-json",
    })
    const { args } = a.invocation(input())
    expect(args).toEqual([
      "run",
      "--json",
      "--mcp",
      expect.stringContaining('"kimo"'),
      "Add a waitlist form",
    ])
  })

  test("envelope extraction from MCP tool result text", () => {
    const env = parseEnvelope(`${envelope.summary}\n${JSON.stringify(envelope)}`)
    expect(env?.ok && env.undoToken).toBe("u-cli-1")
    expect(parseEnvelope("plain text")).toBeNull()
  })
})

describe("running a turn through a fake CLI", () => {
  test("Claude Code: streams text, steps, op groups, usage; subscription shows no dollars", async () => {
    const [claude] = await detectClis(host(), [claudeCodeAdapter])
    if (!claude) throw new Error()
    const events: AgentEvent[] = []
    const streamed: string[] = []
    const rec = await runCliTurn({
      turnId: "t1",
      adapter: claudeCodeAdapter,
      detection: claude,
      host: host(),
      session: "abc123",
      model: { provider: "cli:claude-code", model: "default" },
      thinking: "high",
      user: { role: "user", content: [{ type: "text", text: "Add a waitlist form" }] },
      systemPrompt: "You are Kimo.",
      mcp: shimLaunch("/kimo-mcp", "claude-code"),
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
      // Streamed edits: the partial tool input goes to the document host as it streams.
      toolStream: (call) => {
        streamed.push(`open ${call.id} ${call.name} ${call.workspace.split("/").pop()}`)
        return {
          push: (j) => {
            streamed.push(j)
          },
          abort: (r) => {
            streamed.push(`abort ${r}`)
          },
          onProgress: () => () => {},
        }
      },
    })
    expect(streamed).toEqual([
      "open toolu_9 kimo_apply_ops abc123",
      '{"docId":"d_1","label":"Insert ',
      'Waitlist Form","ops":[]}',
    ])
    expect(rec.status).toBe("done")
    expect(
      events
        .filter((e) => e.type === "text_delta")
        .map((e) => (e as { text: string }).text)
        .join(""),
    ).toBe("Adding the form. Done.")
    // Board 31: the note before the tool call is status; the reply is the text after it.
    expect(replyOf(rec.messages)).toBe("Done.")
    const step = events.find((e) => e.type === "step_end")
    expect(step).toMatchObject({
      type: "step_end",
      tool: "kimo_apply_ops",
      ok: true,
      undoToken: "u-cli-1",
      // Board 31 "Agent cursor": the pointer target travels with the step.
      pointer: "Submit0001",
      summary: envelope.summary,
    })
    expect(rec.opGroups).toEqual([
      {
        docId: "d_1",
        undoToken: "u-cli-1",
        summary: envelope.summary,
        changed: ["Form000001"],
        tool: "kimo_apply_ops",
      },
    ])
    expect(rec.opsApplied).toBe(3)
    expect(rec.usage).toEqual({
      inputTokens: 3100,
      outputTokens: 1400,
      cacheReadTokens: 900,
      cacheWriteTokens: 0,
    })
    expect(rec.billing).toBe("subscription")
    expect(rec.cost.usd).toBeNull()
    expect(rec.cli).toEqual({
      id: "claude-code",
      sessionId: "sess-claude-1",
      reportedCostUsd: 0.042,
      turns: 2,
    })
    // The process ran in the session workspace with the expected flags.
    const inv = JSON.parse(
      readFileSync(join(home, ".kimo", "cli-workspaces", "abc123", "invocation.json"), "utf8"),
    )
    expect(inv.args).toContain("--strict-mcp-config")
    expect(JSON.parse(inv.stdin.trim()).type).toBe("user")
  })

  test("Codex: JSONL events map to the same panel events", async () => {
    const [codex] = await detectClis(host(), [codexAdapter])
    if (!codex) throw new Error()
    const events: AgentEvent[] = []
    const rec = await runCliTurn({
      turnId: "t2",
      adapter: codexAdapter,
      detection: codex,
      host: host(),
      session: "def456",
      model: { provider: "cli:codex", model: "default" },
      thinking: "high",
      user: { role: "user", content: [{ type: "text", text: "Add a waitlist form" }] },
      systemPrompt: "You are Kimo.",
      mcp: shimLaunch("/kimo-mcp", "codex"),
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })
    expect(rec.status).toBe("done")
    expect(rec.opGroups[0]?.undoToken).toBe("u-cli-1")
    expect(rec.cli?.sessionId).toBe("thr-1")
    expect(rec.usage.cacheReadTokens).toBe(500)
    expect(
      events.some((e) => e.type === "text_delta" && e.text === "Added the waitlist form."),
    ).toBe(true)
    const inv = JSON.parse(
      readFileSync(join(home, ".kimo", "cli-workspaces", "def456", "invocation.json"), "utf8"),
    )
    // Kimo's prompt replaces Codex's base instructions (workspace file), not the user message.
    expect(inv.stdin).not.toContain("You are Kimo.")
    expect(inv.args).toContain(
      `model_instructions_file=${JSON.stringify(join(home, ".kimo", "cli-workspaces", "def456", ".kimo/instructions.md"))}`,
    )
    expect(
      readFileSync(
        join(home, ".kimo", "cli-workspaces", "def456", ".kimo", "instructions.md"),
        "utf8",
      ),
    ).toBe("You are Kimo.\n")
  })

  test("Stop kills the CLI and ends the turn as stopped", async () => {
    const [claude] = await detectClis(host(), [claudeCodeAdapter])
    if (!claude) throw new Error()
    const ctl = new AbortController()
    const slowHost = createNodeCliHost({
      home,
      path: bin,
      env: { PATH: bin, FAKE_SLOW: "1" },
      workspacesRoot: join(home, ".kimo", "cli-workspaces"),
    })
    setTimeout(() => ctl.abort(), 150)
    const rec = await runCliTurn({
      turnId: "t3",
      adapter: claudeCodeAdapter,
      detection: claude,
      host: slowHost,
      session: "slow01",
      model: { provider: "cli:claude-code", model: "default" },
      thinking: "high",
      user: { role: "user", content: [{ type: "text", text: "x" }] },
      systemPrompt: "",
      mcp: shimLaunch("/kimo-mcp", "claude-code"),
      signal: ctl.signal,
      onEvent: () => {},
    })
    expect(rec.status).toBe("stopped")
    expect(rec.error?.kind).toBe("stopped")
  })

  test("not signed in → auth card, nothing spawned", async () => {
    const rec = await runCliTurn({
      turnId: "t4",
      adapter: claudeCodeAdapter,
      detection: {
        id: "claude-code",
        label: "Claude Code",
        installed: true,
        path: join(bin, "claude"),
        signedIn: false,
        billing: null,
      },
      host: host(),
      session: "nope01",
      model: { provider: "cli:claude-code", model: "default" },
      thinking: "high",
      user: { role: "user", content: [{ type: "text", text: "x" }] },
      systemPrompt: "",
      mcp: shimLaunch("/kimo-mcp", "claude-code"),
      signal: new AbortController().signal,
      onEvent: () => {},
    })
    expect(rec.status).toBe("error")
    expect(rec.error?.kind).toBe("auth")
  })
})
