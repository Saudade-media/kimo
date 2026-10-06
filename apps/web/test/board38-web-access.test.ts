/**
 * Board 38 "Web access" (qPPXu): the setting's default and the privacy override, the composer's
 * per-session globe (state, reasons, reset), web steps in the thread and the transcript, and the
 * Activity row of a web step.
 */
import { describe, expect, test } from "bun:test"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import type { ActivityEntry } from "@kimo/mcp-server"
import {
  isValidSetting,
  normalizeSettings,
  SETTINGS_DEFAULTS,
  webAccessAllowed,
} from "@kimo/platform"
import { createAgentPanelController, createInWindowTools } from "../src/agent-panel"
import { createTestRuntime, MOCK_ANTHROPIC, type Script } from "../src/agent-panel/testing"
import { activityRowView, matchesKind } from "../src/agents/model"

describe("setting", () => {
  test("Allow web access is on by default; No third-party fetch turns it off", () => {
    expect(SETTINGS_DEFAULTS["ai.webAccess"]).toBe(true)
    expect(normalizeSettings({})["ai.webAccess"]).toBe(true)
    expect(normalizeSettings({ "ai.webAccess": "no" })["ai.webAccess"]).toBe(true)
    expect(isValidSetting("ai.webAccess", false)).toBe(true)
    const s = normalizeSettings({})
    expect(webAccessAllowed(s)).toBe(true)
    expect(webAccessAllowed({ ...s, "privacy.noThirdPartyFetch": true })).toBe(false)
    expect(webAccessAllowed({ ...s, "ai.webAccess": false })).toBe(false)
  })
})

const script: Script = (req) =>
  req.responseSchema
    ? { text: '{"title":"Fonts"}' }
    : {
        web: [
          { tool: "web_search", input: { query: "tailwind v4 fonts" } },
          { tool: "web_fetch", input: { url: "https://tailwindcss.com/docs/font-family" } },
        ],
        text: "Body uses the stack.\n\nSources:\nhttps://tailwindcss.com/docs/font-family",
      }

function setup(
  o: { blocked?: boolean; enabled?: boolean; providers?: (typeof MOCK_ANTHROPIC)[] } = {},
) {
  const store = importDocument(createEmptyDocument("Fonts"))
  const tools = createInWindowTools({ store, path: "/u/me/Fonts.kimo" })
  const flags = { enabled: o.enabled ?? true, blocked: o.blocked ?? false }
  const rt = createTestRuntime({
    tools: (spec) => tools.factory(spec),
    script,
    ...(o.providers ? { providers: o.providers } : {}),
    webAccess: () => flags,
  })
  const c = createAgentPanelController({
    runtime: rt,
    fileId: "f-fonts",
    fileName: "Fonts.kimo",
    docId: () => tools.docId(),
  })
  return { c, rt, flags }
}

describe("composer globe", () => {
  test("starts from the setting; the session can turn it off; a new session starts again", async () => {
    const { c } = setup()
    await c.refresh()
    expect(c.state.webAccess).toEqual({ on: true, disabled: null })
    c.setWebAccess(false)
    expect(c.state.webAccess.on).toBe(false)
    c.newSession()
    expect(c.state.webAccess.on).toBe(true)
  })

  test("setting off: the session starts off and can turn it on", async () => {
    const { c } = setup({ enabled: false })
    await c.refresh()
    expect(c.state.webAccess).toEqual({ on: false, disabled: null })
    c.setWebAccess(true)
    expect(c.state.webAccess.on).toBe(true)
  })

  test("No third-party fetch: off and disabled with the privacy reason; the toggle is ignored", async () => {
    const { c } = setup({ blocked: true })
    await c.refresh()
    expect(c.state.webAccess).toEqual({ on: false, disabled: "privacy" })
    c.setWebAccess(true)
    expect(c.state.webAccess.on).toBe(false)
  })

  test("a model without web tools: disabled with the model reason", async () => {
    const { c } = setup({
      providers: [{ ...MOCK_ANTHROPIC, baseURL: "https://proxy.example" }],
    })
    await c.refresh()
    expect(c.state.webAccess).toEqual({ on: false, disabled: "model" })
  })
})

describe("thread", () => {
  test("each search and page read is a step; the transcript keeps them; the prompt asks for sources", async () => {
    const { c, rt } = setup()
    await c.refresh()
    await c.send("Find the current Tailwind v4 default font stack and use it")
    const req = rt.providersMade.flatMap((p) => p.calls).find((r) => !r.responseSchema)
    expect(req?.webAccess).toBe(true)
    expect(req?.system.stable).toContain("Sources:")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.steps.map((s) => [s.tool, s.label, s.state])).toEqual([
      ["web_search", "Searched the web for “tailwind v4 fonts”", "done"],
      ["web_fetch", "Read tailwindcss.com", "done"],
    ])
    expect(a.text).toContain("https://tailwindcss.com/docs/font-family")
    // Reopening the session rebuilds the steps from the transcript.
    const id = c.state.session?.id as string
    c.newSession()
    await c.openSession(id)
    const again = c.state.messages.find((m) => m.kind === "agent")
    if (again?.kind !== "agent") throw new Error()
    expect(again.steps.map((s) => s.label)).toEqual([
      "Searched the web for “tailwind v4 fonts”",
      "Read tailwindcss.com",
    ])
  })

  test("turned off for the session: no web tools and no web prompt", async () => {
    const { c, rt } = setup()
    await c.refresh()
    c.setWebAccess(false)
    await c.send("Make the title bigger")
    const req = rt.providersMade.flatMap((p) => p.calls).find((r) => !r.responseSchema)
    expect(req?.webAccess).toBeUndefined()
    expect(req?.system.stable).not.toContain("Sources:")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.steps).toHaveLength(0)
  })
})

describe("Activity", () => {
  test("a web step is one row: label, tool, the query or URL, no Undo; shown by default", () => {
    const e: ActivityEntry = {
      seq: 3,
      time: 0,
      origin: "agent:kimo.s.1",
      actor: "Kimo",
      kind: "web",
      tool: "web_fetch",
      summary: "Read tailwindcss.com",
      detail: "https://tailwindcss.com/docs/font-family",
    }
    const row = activityRowView(e, (id) => id)
    expect([row.label, row.tool, row.target, row.undoable]).toEqual([
      "Read tailwindcss.com",
      "web_fetch",
      "https://tailwindcss.com/docs/font-family",
      false,
    ])
    expect(matchesKind("web", "writes-errors")).toBe(true)
    expect(matchesKind("web", "writes")).toBe(false)
  })
})
