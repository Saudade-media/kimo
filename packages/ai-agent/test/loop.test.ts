import { describe, expect, test } from "bun:test"
import { ProviderError } from "../src/errors"
import { type AgentEvent, type RunTurnOptions, runTurn } from "../src/loop"
import { MODEL_CATALOG } from "../src/models"
import { AnthropicProvider } from "../src/providers/anthropic"
import {
  anthropicConfig,
  anthropicTextStream,
  anthropicToolStream,
  applied,
  failure,
  fakeToolHost,
  mockFetch,
  runtime,
  scriptedProvider,
  streamResponse,
  textTurn,
  toolTurn,
  U,
} from "./helpers"

const opus = MODEL_CATALOG.anthropic[0] as (typeof MODEL_CATALOG.anthropic)[number]

function opts(
  extra: Partial<RunTurnOptions> & Pick<RunTurnOptions, "provider" | "tools">,
): RunTurnOptions & { events: AgentEvent[] } {
  const events: AgentEvent[] = []
  return {
    turnId: "t1",
    model: { provider: "anthropic", model: "claude-opus-5-5" },
    info: opus,
    thinking: "auto",
    system: { stable: "Kimo" },
    history: [],
    user: { role: "user", content: [{ type: "text", text: "Add a waitlist form" }] },
    origin: "agent:kimo.abc123.0",
    signal: new AbortController().signal,
    onEvent: (e) => events.push(e),
    retry: { maxAttempts: 5, baseMs: 1, maxMs: 5, jitter: 0 },
    events,
    ...extra,
  }
}

describe("agent loop", () => {
  test("tool-use loop over a fake ToolHost: steps, op groups, history, cost", async () => {
    const provider = scriptedProvider((_r, n) =>
      n === 0
        ? toolTurn(
            [
              {
                id: "c1",
                name: "kimo_apply_ops",
                input: {
                  docId: "d_1",
                  label: "Insert Waitlist Form",
                  ops: [{ op: "insert", key: "form", parent: "root", node: { type: "frame" } }],
                },
              },
            ],
            U(1000, 100),
          )
        : textTurn("Added the form.", U(1200, 50)),
    )
    const tools = fakeToolHost(() =>
      applied("Inserted 1 node", 1, [{ key: "form", id: "Form000001" }]),
    )
    const o = opts({ provider, tools })
    const rec = await runTurn(o)
    expect(rec.status).toBe("done")
    expect(rec.opGroups).toHaveLength(1)
    expect(rec.opsApplied).toBe(1)
    expect(rec.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"])
    expect(rec.usage.inputTokens).toBe(2200)
    // Opus 5.5: $4 / $20 per MTok.
    expect(rec.cost.usd).toBeCloseTo((2200 * 4 + 150 * 20) / 1e6, 10)
    const step = o.events.find((e) => e.type === "step_start")
    expect(step && step.type === "step_start" && step.label).toBe("Editing · Insert Waitlist Form")
    const end = o.events.find((e) => e.type === "step_end")
    expect(end && end.type === "step_end" && end.undoToken).toBe(rec.opGroups[0]?.undoToken)
    // Second request carries the tool result (the envelope JSON).
    const second = provider.requests[1]
    const toolMsg = second?.messages.find((m) => m.role === "tool")
    expect(
      toolMsg && toolMsg.role === "tool" && JSON.parse(toolMsg.results[0]?.content ?? "{}").ok,
    ).toBe(true)
  })

  test("the full loop works with the real Anthropic adapter over mocked fetch", async () => {
    const { fetch } = mockFetch([
      () => streamResponse(anthropicToolStream("toolu_1", "kimo_query", { docId: "d_1" })),
      () => streamResponse(anthropicTextStream("Done reading")),
    ])
    const provider = new AnthropicProvider(anthropicConfig(), runtime(fetch))
    const tools = fakeToolHost(() => ({ ok: true, summary: "1 node", warnings: [], data: {} }))
    const rec = await runTurn(opts({ provider, tools }))
    expect(rec.status).toBe("done")
    expect(tools.calls[0]?.name).toBe("kimo_query")
    const last = rec.messages.at(-1)
    expect(last?.role === "assistant" && last.content[0]).toEqual({
      type: "text",
      text: "Done reading",
    })
  })

  test("retries a 429 with backoff, then succeeds; the card says attempt 2 of 5", async () => {
    const provider = scriptedProvider((_r, n) =>
      n === 0
        ? new ProviderError("rate_limit", "429", {
            provider: "anthropic",
            status: 429,
            retryAfterMs: 2,
          })
        : textTurn("ok"),
    )
    const o = opts({ provider, tools: fakeToolHost(() => applied("x", 0)) })
    const rec = await runTurn(o)
    expect(rec.status).toBe("done")
    const retry = o.events.find((e) => e.type === "retry")
    expect(retry && retry.type === "retry" && retry.card.retry).toEqual({
      attempt: 2,
      maxAttempts: 5,
      inMs: 2,
    })
    expect(retry && retry.type === "retry" && retry.card.kind).toBe("rate_limit")
    expect(o.events.some((e) => e.type === "discard_partial")).toBe(true)
  })

  test("gives up after maxAttempts and ends with an error card (ops kept)", async () => {
    const provider = scriptedProvider(
      () => new ProviderError("server", "500", { provider: "anthropic", status: 500 }),
    )
    const rec = await runTurn(opts({ provider, tools: fakeToolHost(() => applied("x", 0)) }))
    expect(rec.status).toBe("error")
    expect(provider.requests).toHaveLength(5)
    expect(rec.error?.kind).toBe("error")
  })

  test("auth errors are not retried", async () => {
    const provider = scriptedProvider(
      () => new ProviderError("auth", "401", { provider: "anthropic", status: 401 }),
    )
    const rec = await runTurn(opts({ provider, tools: fakeToolHost(() => applied("x", 0)) }))
    expect(provider.requests).toHaveLength(1)
    expect(rec.error?.kind).toBe("auth")
    expect(rec.error?.actions).toContain("open_settings")
  })

  test("offline pauses (not an attempt) and resumes", async () => {
    let online = false
    const provider = scriptedProvider((_r, n) =>
      n === 0 ? new ProviderError("offline", "off", { provider: "anthropic" }) : textTurn("back"),
    )
    const o = opts({
      provider,
      tools: fakeToolHost(() => applied("x", 0)),
      waitForOnline: async () => {
        online = true
      },
    })
    const rec = await runTurn(o)
    expect(online).toBe(true)
    expect(rec.status).toBe("done")
    expect(o.events.map((e) => e.type)).toContain("paused")
    expect(o.events.map((e) => e.type)).toContain("resumed")
  })

  test("cancellation: Stop after a tool call ends the turn as stopped and keeps applied op groups", async () => {
    const ctl = new AbortController()
    const provider = scriptedProvider(() =>
      toolTurn([
        { id: "c1", name: "kimo_apply_ops", input: { docId: "d_1", ops: [] } },
        { id: "c2", name: "kimo_apply_ops", input: { docId: "d_1", ops: [] } },
      ]),
    )
    const tools = fakeToolHost(() => {
      ctl.abort() // user presses Stop while the first batch runs; it still commits
      return applied("Inserted 2 of 3 cards", 2)
    })
    const rec = await runTurn(opts({ provider, tools, signal: ctl.signal }))
    expect(rec.status).toBe("stopped")
    expect(tools.calls).toHaveLength(1)
    expect(rec.opGroups).toHaveLength(1)
    expect(rec.error?.kind).toBe("stopped")
    expect(rec.error?.title).toBe("Stopped · 2 ops applied")
    // The unexecuted call still gets a result so history stays valid.
    const tool = rec.messages.find((m) => m.role === "tool")
    expect(tool && tool.role === "tool" && tool.results).toHaveLength(2)
  })

  test("abort during streaming stops without tool calls", async () => {
    const ctl = new AbortController()
    const provider = scriptedProvider(() => {
      ctl.abort()
      return textTurn("never")
    })
    const rec = await runTurn(
      opts({ provider, tools: fakeToolHost(() => applied("x", 0)), signal: ctl.signal }),
    )
    expect(rec.status).toBe("stopped")
  })

  test("budget guard pauses before the next model call", async () => {
    const provider = scriptedProvider((_r, n) =>
      n === 0
        ? toolTurn(
            [{ id: "c1", name: "kimo_apply_ops", input: { docId: "d_1", ops: [] } }],
            U(1_000_000, 0),
          )
        : textTurn("x"),
    )
    const rec = await runTurn(
      opts({
        provider,
        tools: fakeToolHost(() => applied("x", 1)),
        budget: { check: (usd) => (usd >= 1 ? "Monthly limit reached · $50.00" : null) },
      }),
    )
    expect(rec.status).toBe("budget")
    expect(provider.requests).toHaveLength(1)
    expect(rec.error?.kind).toBe("budget")
  })

  test("placeholders the turn set are cleared at turn end, even on error", async () => {
    const provider = scriptedProvider((_r, n) =>
      n === 0
        ? toolTurn([
            {
              id: "c1",
              name: "kimo_apply_ops",
              input: {
                docId: "d_1",
                ops: [
                  {
                    op: "insert",
                    key: "hero",
                    parent: "root",
                    node: { type: "frame", placeholder: true },
                  },
                ],
              },
            },
          ])
        : new ProviderError("auth", "401", { provider: "anthropic" }),
    )
    const tools = fakeToolHost((c) =>
      c.id.startsWith("clear-")
        ? applied("Cleared", 1)
        : applied("Inserted", 1, [{ key: "hero", id: "Hero000001" }]),
    )
    const rec = await runTurn(opts({ provider, tools }))
    expect(rec.status).toBe("error")
    const clear = tools.calls.find((c) => c.id.startsWith("clear-"))
    expect(clear?.input).toEqual({
      docId: "d_1",
      ops: [{ op: "update", id: "Hero000001", unset: ["placeholder"] }],
      label: "Clear placeholders",
    })
    expect(rec.opGroups).toHaveLength(2)
  })

  test("failed tool calls are returned to the model as error results", async () => {
    const provider = scriptedProvider((_r, n) =>
      n === 0
        ? toolTurn([{ id: "c1", name: "kimo_apply_ops", input: { docId: "d_1", ops: [] } }])
        : textTurn("fixed"),
    )
    const tools = fakeToolHost(() =>
      failure({
        code: "OUT_OF_SCOPE",
        message: "Edit outside your node scope.",
        nodeId: "Nav0000001",
      }),
    )
    const o = opts({ provider, tools })
    const rec = await runTurn(o)
    const toolMsg = rec.messages.find((m) => m.role === "tool")
    expect(toolMsg && toolMsg.role === "tool" && toolMsg.results[0]?.isError).toBe(true)
    const end = o.events.find((e) => e.type === "step_end")
    expect(end && end.type === "step_end" && end.errorCode).toBe("OUT_OF_SCOPE")
    expect(rec.opGroups).toHaveLength(0)
  })
})
