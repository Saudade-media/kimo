/**
 * Runs one agent turn through a local CLI (ADR 0014 §11). One process per turn; follow-up turns
 * resume the CLI's own session (`--resume` / `exec resume`). The CLI's stdout is parsed into
 * the same {@link AgentEvent}s the API loop emits, so the panel cannot tell them apart.
 *
 * Attribution: the CLI reaches Kimo through the MCP shim, so its edits carry origin
 * `mcp:<cli>.<session>` and go through M5 policy, approvals and activity. The shim's working
 * directory is the session workspace (`~/.kimo/cli-workspaces/<session>/`); the document host
 * matches `hello.cwd` (and `hello.ppid` = the spawned CLI pid) to apply the agent session's
 * policy (scope for modes) and label its presence chip.
 *
 * Stop: SIGINT, then SIGTERM after 3 s, SIGKILL after 6 s. Ops already applied stay.
 */
import type { ToolResult } from "@kimo/mcp-server"
import { errorCard } from "../cards"
import { ProviderError } from "../errors"
import type { AgentEvent, OpGroup, TurnRecord, TurnStatus } from "../loop"
import { type StepNames, stepLabel } from "../progress"
import { LineSplitter } from "../providers/sse"
import type { ToolStream } from "../toolhost"
import {
  type AssistantMessage,
  addUsage,
  type ModelSelection,
  type ThinkingMode,
  type Usage,
  type UserMessage,
  ZERO_USAGE,
} from "../types"
import { type WebNote, type WebStep, webStep, webToolOf } from "../web"
import type {
  CliAdapter,
  CliBilling,
  CliDetection,
  CliEvent,
  CliProcessHost,
  KimoMcpLaunch,
} from "./types"

export interface RunCliTurnOptions {
  turnId: string
  adapter: CliAdapter
  detection: CliDetection
  host: CliProcessHost
  session: string
  cliSessionId?: string
  model: ModelSelection
  thinking: ThinkingMode
  user: UserMessage
  /** Stable instructions: the CLI's system prompt. */
  systemPrompt: string
  /** This turn's volatile context (document, selection, outline): top of the user message. */
  context?: string
  /** How the CLI launches Kimo's MCP server; the client slug should be the CLI id. */
  mcp: KimoMcpLaunch
  signal: AbortSignal
  onEvent(e: AgentEvent): void
  now?: () => number
  /** Layer names for step labels ("Editing 6 layers in Pricing"). */
  names?: StepNames
  /**
   * Streamed edits (ADR 0013 §4.7): opens the provisional stream of a tool call the CLI's model
   * is writing. The editor forwards it to the document host, which serves the CLI's MCP
   * connection (`workspace` identifies it) and commits it when the call arrives. Absent: the
   * CLI's calls apply when they arrive, as before.
   */
  toolStream?: (call: { id: string; name: string; workspace: string }) => ToolStream | undefined
  /** Board 38: the CLI's web tools are allowed this turn. */
  webAccess?: boolean
  /**
   * Board 38: a web search or page read the CLI ran. The editor writes it to the Activity log
   * under the CLI's MCP connection (`workspace` identifies it).
   */
  webNote?: (entry: WebNote & { workspace: string }) => void
}

/** The MCP launch for a CLI: bundled shim with `--client <cli>` (ADR 0013 §9 entry shape). */
export function shimLaunch(shimPath: string, cli: string): KimoMcpLaunch {
  return { command: shimPath, args: ["--client", cli] }
}

export async function runCliTurn(o: RunCliTurnOptions): Promise<TurnRecord> {
  const now = o.now ?? Date.now
  const startedAt = now()
  const label = o.adapter.def.label
  const billing: CliBilling = o.detection.billing ?? "subscription"
  const fail = (kind: ProviderError["kind"], msg: string) =>
    new ProviderError(kind, msg, { provider: `cli:${o.adapter.def.id}` })
  o.onEvent({ type: "turn_start", turnId: o.turnId })

  let usage: Usage = { ...ZERO_USAGE }
  /** Text since the last tool call (board 31: notes before tool calls, the reply after the last). */
  let text = ""
  let lastNote = ""
  let cliSessionId = o.cliSessionId
  let reportedCostUsd: number | undefined
  let turns: number | undefined
  let status: TurnStatus = "done"
  let failure: ProviderError | undefined
  const opGroups: OpGroup[] = []
  let opsApplied = 0
  const stepTools = new Map<string, string>()
  /** Board 38: inputs of the CLI's running web calls, and the turn's finished ones. */
  const webInputs = new Map<string, Record<string, unknown>>()
  const web: WebStep[] = []
  /** Tool calls the CLI's model is writing (streamed edits), by tool-use id. */
  const live = new Map<string, ToolStream | null>()
  let workspace = ""

  const handle = (e: CliEvent) => {
    switch (e.type) {
      case "tool_input_delta": {
        let s = live.get(e.callId)
        if (s === undefined) {
          s = o.toolStream?.({ id: e.callId, name: e.tool, workspace }) ?? null
          live.set(e.callId, s)
          s?.onProgress((p) => {
            if (p.state !== "open" || !p.applied) return
            o.onEvent({
              type: "step_stream",
              callId: e.callId,
              tool: e.tool,
              state: p.state,
              applied: p.applied,
              changed: p.changed,
              ...(p.name ? { name: p.name } : {}),
              ...(p.pointer ? { pointer: p.pointer } : {}),
            })
          })
        }
        s?.push(e.partialJson)
        break
      }
      case "session":
        cliSessionId = e.id || cliSessionId
        if (e.mcpConnected === false)
          failure = fail("unknown", "The CLI could not connect to Kimo's MCP server.")
        break
      case "text_delta":
        text += e.text
        o.onEvent({ type: "text_delta", text: e.text })
        break
      case "text":
        text += (text ? "\n\n" : "") + e.text
        o.onEvent({ type: "text_delta", text: e.text })
        break
      case "thinking_delta":
        o.onEvent({ type: "thinking_delta", text: e.text })
        break
      case "step_start":
        if (text.trim()) lastNote = text
        text = ""
        stepTools.set(e.callId, e.tool)
        if (webToolOf(e.tool)) webInputs.set(e.callId, e.input)
        o.onEvent({
          type: "step_start",
          callId: e.callId,
          tool: e.tool,
          label: stepLabel({ id: e.callId, name: e.tool, input: e.input }, o.names),
          input: e.input,
        })
        break
      case "step_end": {
        // The call ran: the host committed or rolled back its stream.
        live.delete(e.callId)
        const tool = e.tool || stepTools.get(e.callId) || ""
        const webTool = webToolOf(tool)
        if (webTool) {
          const step = webStep(e.callId, webTool, e.input ?? webInputs.get(e.callId) ?? {}, e.ok)
          webInputs.delete(e.callId)
          web.push(step)
          o.onEvent({
            type: "step_end",
            callId: e.callId,
            tool: webTool,
            ok: step.ok,
            summary: step.label,
            changed: [],
          })
          o.webNote?.({
            tool: step.tool,
            summary: step.label,
            detail: step.detail,
            ok: step.ok,
            workspace,
          })
          break
        }
        const env = parseEnvelope(e.output)
        let summary = e.output.slice(0, 200)
        let changed: string[] = []
        let undoToken: string | undefined
        let pointer: string | undefined
        let ok = e.ok
        if (env) {
          ok = env.ok
          summary = env.summary
          if (env.ok) {
            changed = env.changed ?? []
            if (env.undoToken && !env.dryRun) {
              undoToken = env.undoToken
              pointer = env.pointer
              opsApplied += env.opCount ?? env.ops?.length ?? 0
              opGroups.push({
                docId: env.doc?.id ?? "",
                undoToken: env.undoToken,
                summary: env.summary,
                changed,
                tool,
              })
            }
          }
        }
        o.onEvent({
          type: "step_end",
          callId: e.callId,
          tool,
          ok,
          summary,
          changed,
          ...(pointer ? { pointer } : {}),
          ...(undoToken ? { undoToken } : {}),
          ...(env && !env.ok && env.errors[0] ? { errorCode: env.errors[0].code } : {}),
        })
        break
      }
      case "usage":
        o.onEvent({
          type: "usage",
          usage: addUsage(usage, e.usage),
          cost: { usd: null, estimated: true, priceVersion: "cli" },
        })
        break
      case "result":
        if (e.usage) usage = addUsage(usage, e.usage)
        if (e.sessionId) cliSessionId = e.sessionId
        if (e.costUsd !== undefined) reportedCostUsd = (reportedCostUsd ?? 0) + e.costUsd
        if (e.turns !== undefined) turns = e.turns
        if (!e.ok && !failure) failure = fail("unknown", e.message ?? `${label} reported an error.`)
        break
      case "error":
        failure ??= fail("unknown", e.message)
        break
    }
  }

  let stderr = ""
  try {
    if (!o.detection.installed || !o.detection.path)
      throw fail("unsupported_platform", `${label} is not installed.`)
    if (o.detection.signedIn === false)
      throw fail("auth", `${label} is not signed in. Run its login, then retry.`)
    workspace = await o.host.prepareWorkspace(o.session, [])
    const prompt = o.user.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n\n")
    const images = o.user.content.flatMap((p) =>
      p.type === "image" ? [{ mimeType: p.mimeType, data: p.data }] : [],
    )
    const inv = o.adapter.invocation({
      session: o.session,
      ...(cliSessionId ? { cliSessionId } : {}),
      model: o.model.model,
      thinking: o.thinking,
      prompt,
      ...(images.length ? { images } : {}),
      systemPrompt: o.systemPrompt,
      ...(o.context ? { context: o.context } : {}),
      mcp: o.mcp,
      workspace,
      ...(o.webAccess ? { webAccess: true } : {}),
    })
    if (inv.workspaceFiles?.length) await o.host.prepareWorkspace(o.session, inv.workspaceFiles)
    const proc = await o.host.spawn({
      path: o.detection.path,
      args: inv.args,
      cwd: workspace,
      ...(inv.env ? { env: inv.env } : {}),
    })
    const parser = o.adapter.parser()
    const split = new LineSplitter()
    const offOut = proc.onStdout((chunk) => {
      for (const line of split.push(chunk)) for (const e of parser.push(line)) handle(e)
    })
    const offErr = proc.onStderr((chunk) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    const onAbort = () => {
      void proc.kill("SIGINT")
      setTimeout(() => void proc.kill("SIGTERM"), 3_000)
      setTimeout(() => void proc.kill("SIGKILL"), 6_000)
    }
    o.signal.addEventListener("abort", onAbort, { once: true })
    if (inv.stdin !== undefined) await proc.write(inv.stdin)
    await proc.closeStdin()
    const exit = await proc.exited
    o.signal.removeEventListener("abort", onAbort)
    for (const line of split.flush()) for (const e of parser.push(line)) handle(e)
    offOut()
    offErr()
    if (o.signal.aborted) throw fail("aborted", "Stopped.")
    if (exit.code !== 0 && !failure)
      failure = fail(
        "unknown",
        `${label} exited with ${exit.code ?? exit.signal}${stderr ? `: ${stderr.trim().split("\n").pop()}` : ""}`,
      )
    if (failure) throw failure
  } catch (e) {
    const err =
      e instanceof ProviderError ? e : fail("unknown", e instanceof Error ? e.message : String(e))
    status = err.kind === "aborted" ? "stopped" : "error"
    failure = err
  }
  // Calls the CLI never made (stopped, crashed): undo what they streamed.
  for (const s of live.values()) s?.abort("The call never arrived.")
  live.clear()

  // The reply is the text after the last tool call; a turn that ended on a tool call keeps its
  // last note so the thread is never blank.
  const reply = text.trim() ? text : lastNote
  const message: AssistantMessage = {
    role: "assistant",
    content: reply ? [{ type: "text", text: reply }] : [],
  }
  const record: TurnRecord = {
    id: o.turnId,
    model: o.model,
    thinking: o.thinking,
    startedAt,
    endedAt: now(),
    messages: [o.user, message],
    usage,
    cost: {
      usd: billing === "subscription" ? null : (reportedCostUsd ?? null),
      estimated: true,
      priceVersion: "cli",
    },
    opGroups,
    opsApplied,
    status,
    ...(failure ? { error: errorCard(failure, { providerLabel: label, opsApplied }) } : {}),
    servedBy: o.model.model,
    skillsUsed: [],
    ...(web.length ? { web } : {}),
    billing,
    cli: {
      id: o.adapter.def.id,
      ...(cliSessionId ? { sessionId: cliSessionId } : {}),
      ...(reportedCostUsd !== undefined ? { reportedCostUsd } : {}),
      ...(turns !== undefined ? { turns } : {}),
    },
  }
  o.onEvent({ type: "message_end", message, stopReason: status === "done" ? "end_turn" : "other" })
  o.onEvent({ type: "turn_end", record })
  return record
}

/** A tool result's text is the M5 envelope JSON (ADR 0013 §4: summary first, JSON second). */
export function parseEnvelope(output: string): ToolResult | null {
  const tryParse = (s: string): ToolResult | null => {
    try {
      const v = JSON.parse(s) as ToolResult
      return v &&
        typeof v === "object" &&
        typeof v.ok === "boolean" &&
        typeof v.summary === "string"
        ? v
        : null
    } catch {
      return null
    }
  }
  const direct = tryParse(output.trim())
  if (direct) return direct
  // MCP content = [summary, envelope JSON, …] joined by newlines: try JSON-looking lines, last first.
  const lines = output.split("\n").filter((l) => l.trim().startsWith("{"))
  for (let i = lines.length - 1; i >= 0; i--) {
    const r = tryParse((lines[i] as string).trim())
    if (r) return r
  }
  return null
}
