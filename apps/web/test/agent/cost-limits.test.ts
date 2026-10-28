/**
 * Spend guards: the per-turn warning decides when a send is held, and the monthly limit stops the
 * agent before it calls the provider.
 */
import { describe, expect, test } from "bun:test"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import { createAgentPanelController, createInWindowTools } from "../../src/agent-panel"
import { estimateTurn, shouldWarn } from "../../src/agent-panel/cost-warning"
import { createTestRuntime } from "../../src/agent-panel/testing"
import { AGENT_USAGE_DEFAULTS, type AgentUsageSettings } from "../../src/platform/contract"
import { setupPanel } from "./helpers"

describe("per-turn warning", () => {
  test("0 or empty threshold never warns; only a strictly higher estimate does", () => {
    expect(shouldWarn({ usd: 5 }, 0)).toBe(false)
    expect(shouldWarn({ usd: 5 }, null)).toBe(false)
    expect(shouldWarn({ usd: 5 }, Number.NaN)).toBe(false)
    expect(shouldWarn({ usd: 0.25 }, 0.25)).toBe(false)
    expect(shouldWarn({ usd: 0.42 }, 0.25)).toBe(true)
  })

  test("free and unpriced models never warn", () => {
    const base = { text: "x", history: [], frames: 0, images: 0 }
    const free = estimateTurn({ ...base, kind: "custom", model: "llama", free: true })
    expect(free.usd).toBe(0)
    expect(shouldWarn(free, 0.01)).toBe(false)
    const unpriced = estimateTurn({ ...base, kind: "openrouter", model: "x/y" })
    expect(unpriced.usd).toBeNull()
    expect(shouldWarn(unpriced, 0.01)).toBe(false)
  })

  test("above the threshold the send is held, and Send anyway sends it", async () => {
    const store = importDocument(createEmptyDocument("P"))
    const tools = createInWindowTools({ store, path: "/u/me/P.kimo" })
    const usage: AgentUsageSettings = { ...AGENT_USAGE_DEFAULTS, warnPerTurnUsd: 0.05 }
    const rt = createTestRuntime({
      tools: tools.factory,
      script: () => ({ text: "Done." }),
      usage: () => ({ ...usage, monthUsd: 0 }),
    })
    const c = createAgentPanelController({
      runtime: rt,
      fileId: "f",
      fileName: "P.kimo",
      docId: () => tools.docId(),
    })
    await c.refresh()
    await c.send("Redesign everything")
    expect(c.state.messages).toEqual([])
    expect(c.state.costWarning?.text).toBe("Redesign everything")
    await c.sendAnyway()
    expect(c.state.costWarning).toBeNull()
    expect(c.state.messages.map((m) => m.kind)).toEqual(["user", "agent"])
  })
})

describe("monthly limit", () => {
  test("a reached limit pauses the turn with a budget card", async () => {
    const { c } = setupPanel(() => ({ text: "x" }), {
      usage: () => ({
        monthlyLimitUsd: 50,
        warnPerTurnUsd: 1,
        showCost: true,
        defaultModel: null,
        monthUsd: 50,
      }),
    })
    await c.refresh()
    await c.send("go")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error("no agent message")
    expect(a.card?.kind).toBe("budget")
  })
})
