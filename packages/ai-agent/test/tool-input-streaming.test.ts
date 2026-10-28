/** The loop feeds streamed tool input to the host and rolls back calls that never run. */
import { describe, expect, test } from "bun:test"
import type { StreamProgress } from "@kimo/mcp-server"
import { ProviderError } from "../src/errors"
import { type AgentEvent, runTurn } from "../src/loop"
import { MODEL_CATALOG } from "../src/models"
import type { ToolHost, ToolStream } from "../src/toolhost"
import type { AssistantMessage, StreamEvent } from "../src/types"
import { applied, scriptedProvider, textTurn, U } from "./helpers"

const opus = MODEL_CATALOG.anthropic[0] as (typeof MODEL_CATALOG.anthropic)[number]

/** A host whose streams record what they got and report one applied op per pushed chunk. */
function streamingHost() {
  const log: string[] = []
  const host: ToolHost & { log: string[] } = {
    log,
    tools: () => [{ name: "kimo_apply_ops", description: "ops", inputSchema: { type: "object" } }],
    stream(call) {
      log.push(`open ${call.id}`)
      let n = 0
      const listeners = new Set<(p: StreamProgress) => void>()
      const s: ToolStream = {
        push(chunk) {
          log.push(`push ${call.id} ${chunk}`)
          n++
          for (const l of listeners)
            l({
              callId: call.id,
              state: "open",
              received: n,
              applied: n,
              inserted: n,
              changed: [`n${n}`],
              pointer: `n${n}`,
              name: `Layer ${n}`,
            })
        },
        abort(reason) {
          log.push(`abort ${call.id} ${reason}`)
        },
        onProgress(l) {
          listeners.add(l)
          return () => listeners.delete(l)
        },
      }
      return s
    },
    async call(c) {
      log.push(`call ${c.id}`)
      return { result: applied("Applied", 2, [{ key: "a", id: "n1" }]) }
    },
  }
  return host
}

const input = {
  docId: "d_1",
  ops: [
    { op: "insert", parent: "root", node: { type: "frame" } },
    { op: "insert", parent: "root", node: { type: "frame" } },
  ],
}
function streamedToolTurn(id: string, stop: "tool_use" | "max_tokens" = "tool_use"): StreamEvent[] {
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "tool_call", id, name: "kimo_apply_ops", input }],
  }
  return [
    { type: "tool_call_start", id, name: "kimo_apply_ops" },
    { type: "tool_call_delta", id, partialJson: '{"docId":"d_1","ops":[{"op":"insert"},' },
    { type: "tool_call_delta", id, partialJson: '{"op":"insert"}]}' },
    { type: "message_end", message, stopReason: stop, usage: U(10, 10), servedBy: "m" },
  ]
}

function run(provider: ReturnType<typeof scriptedProvider>, tools: ToolHost, signal?: AbortSignal) {
  const events: AgentEvent[] = []
  const p = runTurn({
    turnId: "t1",
    provider,
    model: { provider: "anthropic", model: "claude-opus-5-5" },
    info: opus,
    thinking: "high",
    system: { stable: "Kimo" },
    history: [],
    user: { role: "user", content: [{ type: "text", text: "Design a pricing page" }] },
    tools,
    origin: "agent:kimo.abc123.0",
    signal: signal ?? new AbortController().signal,
    onEvent: (e) => events.push(e),
    retry: { maxAttempts: 3, baseMs: 1, maxMs: 2, jitter: 0 },
  })
  return { p, events }
}

describe("streamed tool input in the loop", () => {
  test("deltas reach the host before the call; step_stream events carry name and pointer", async () => {
    const host = streamingHost()
    const provider = scriptedProvider((_r, n) =>
      n === 0 ? streamedToolTurn("c1") : textTurn("Done."),
    )
    const { p, events } = run(provider, host)
    const rec = await p
    expect(rec.status).toBe("done")
    expect(host.log.slice(0, 4)).toEqual([
      "open c1",
      'push c1 {"docId":"d_1","ops":[{"op":"insert"},',
      'push c1 {"op":"insert"}]}',
      "call c1",
    ])
    const streamed = events.filter((e) => e.type === "step_stream")
    expect(streamed.map((e) => (e as { name?: string }).name)).toEqual(["Layer 1", "Layer 2"])
    expect((streamed[1] as { pointer?: string }).pointer).toBe("n2")
    // step_stream comes before the call's step_start.
    const i = events.findIndex((e) => e.type === "step_start")
    expect(events.findIndex((e) => e.type === "step_stream")).toBeLessThan(i)
  })

  test("a retried model call rolls back what its partial calls streamed", async () => {
    const host = streamingHost()
    let calls = 0
    const provider = scriptedProvider(async () => {
      calls++
      if (calls === 1) return streamedToolTurn("c2")
      return textTurn("Done.")
    })
    // The first attempt streams part of a call, then fails.
    const original = provider.stream.bind(provider)
    let first = true
    provider.stream = async function* (req) {
      if (first) {
        first = false
        yield { type: "tool_call_start", id: "c1", name: "kimo_apply_ops" } as StreamEvent
        yield {
          type: "tool_call_delta",
          id: "c1",
          partialJson: '{"docId":"d_1","ops":[',
        } as StreamEvent
        throw new ProviderError("server", "Busy", { provider: "anthropic" })
      }
      yield* original(req)
    }
    const { p } = run(provider, host)
    await p
    expect(host.log).toContain("abort c1 The model call is retried.")
    expect(host.log).toContain("call c2")
    expect(host.log).not.toContain("call c1")
  })

  test("Stop mid-stream rolls the partial call back", async () => {
    const host = streamingHost()
    const ac = new AbortController()
    const provider = scriptedProvider(() => [])
    provider.stream = async function* () {
      yield { type: "tool_call_start", id: "c1", name: "kimo_apply_ops" } as StreamEvent
      yield {
        type: "tool_call_delta",
        id: "c1",
        partialJson: '{"docId":"d_1","ops":[{}',
      } as StreamEvent
      ac.abort()
      throw new DOMException("Aborted", "AbortError")
    }
    const { p } = run(provider, host, ac.signal)
    const rec = await p
    expect(rec.status).toBe("stopped")
    expect(host.log).toContain("abort c1 Stopped.")
  })

  test("a call cut off by max_tokens never runs and its stream rolls back", async () => {
    const host = streamingHost()
    const provider = scriptedProvider((_r, n) =>
      n === 0 ? streamedToolTurn("c1", "max_tokens") : textTurn("Done."),
    )
    const { p } = run(provider, host)
    await p
    expect(host.log).toContain("abort c1 The tool input was cut off.")
    expect(host.log).not.toContain("call c1")
  })
})
