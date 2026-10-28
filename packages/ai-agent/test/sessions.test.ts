import { describe, expect, test } from "bun:test"
import type { TurnRecord } from "../src/loop"
import {
  appendTurn,
  createMemorySessionStore,
  groupSessions,
  historyOf,
  newSession,
  planRegenerate,
  undoCallInputs,
} from "../src/session"

const turn = (id: string, groups: number): TurnRecord => ({
  id,
  model: { provider: "anthropic", model: "claude-opus-5-5" },
  thinking: "high",
  startedAt: 0,
  endedAt: 1,
  messages: [
    { role: "user", content: [{ type: "text", text: `prompt ${id}` }] },
    { role: "assistant", content: [{ type: "text", text: "done" }] },
  ],
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
  cost: { usd: 0.01, estimated: true, priceVersion: "v" },
  opGroups: Array.from({ length: groups }, (_, i) => ({
    docId: "d_1",
    undoToken: `${id}-${i}`,
    summary: "",
    changed: [],
    tool: "kimo_apply_ops",
  })),
  opsApplied: groups,
  status: "done",
  servedBy: "claude-opus-5-5",
  skillsUsed: [],
})

describe("sessions", () => {
  test("store: per file newest first, search by content", async () => {
    const store = createMemorySessionStore()
    let s = newSession({
      id: "s1",
      fileId: "f1",
      fileName: "Marketing",
      model: { provider: "anthropic", model: "claude-opus-5-5" },
      now: 1,
    })
    s = appendTurn(s, turn("t1", 1), 5)
    await store.put(s)
    await store.put(
      newSession({ id: "s2", fileId: "f2", fileName: "Other", model: s.model, now: 3 }),
    )
    expect((await store.list("f1")).map((m) => m.id)).toEqual(["s1"])
    expect((await store.list()).map((m) => m.id)).toEqual(["s1", "s2"])
    expect((await store.search("prompt t1")).map((m) => m.id)).toEqual(["s1"])
    expect(s.costUsd).toBeCloseTo(0.01)
    expect(historyOf(s)).toHaveLength(2)
    const g = groupSessions(await store.list(), "f2")
    expect(g.thisFile.map((m) => m.id)).toEqual(["s2"])
  })

  test("regenerate = undo the last turn's op groups newest first, then resend the same prompt and model", () => {
    let s = newSession({
      fileId: "f",
      fileName: "F",
      model: { provider: "anthropic", model: "claude-opus-5-5" },
    })
    s = appendTurn(appendTurn(s, turn("t1", 1)), turn("t2", 2))
    expect(planRegenerate(s, "t1")).toBeNull()
    const plan = planRegenerate(s, "t2")
    expect(plan?.undo.map((u) => u.token)).toEqual(["t2-1", "t2-0"])
    expect(undoCallInputs(plan?.undo ?? [])[0]).toEqual({
      docId: "d_1",
      action: "undo",
      token: "t2-1",
    })
    expect(plan?.prompt.content[0]).toEqual({ type: "text", text: "prompt t2" })
    expect(plan?.rest.turns).toHaveLength(1)
  })
})
