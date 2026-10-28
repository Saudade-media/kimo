/**
 * Web access policy: the privacy setting overrides the agent's own switch, and a session with it
 * off sends the model no web tools.
 */
import { describe, expect, test } from "bun:test"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import { normalizeSettings, webAccessAllowed } from "@kimo/platform"
import { createAgentPanelController, createInWindowTools } from "../../src/agent-panel"
import { createTestRuntime, type Script } from "../../src/agent-panel/testing"

describe("setting", () => {
  test("No third-party fetch and the Allow web access switch each turn web access off", () => {
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

function setup(o: { blocked?: boolean } = {}) {
  const store = importDocument(createEmptyDocument("Fonts"))
  const tools = createInWindowTools({ store, path: "/u/me/Fonts.kimo" })
  const rt = createTestRuntime({
    tools: (spec) => tools.factory(spec),
    script,
    webAccess: () => ({ enabled: true, blocked: o.blocked ?? false }),
  })
  const c = createAgentPanelController({
    runtime: rt,
    fileId: "f-fonts",
    fileName: "Fonts.kimo",
    docId: () => tools.docId(),
  })
  return { c, rt }
}

const turnRequest = (rt: ReturnType<typeof setup>["rt"]) =>
  rt.providersMade.flatMap((p) => p.calls).find((r) => !r.responseSchema)

describe("session", () => {
  test("on: the model gets web tools and the sources prompt, and each web call is a step", async () => {
    const { c, rt } = setup()
    await c.refresh()
    await c.send("Find the current Tailwind v4 default font stack and use it")
    const req = turnRequest(rt)
    expect(req?.webAccess).toBe(true)
    expect(req?.system.stable).toContain("Sources:")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error("no agent message")
    expect(a.steps.map((s) => s.tool)).toEqual(["web_search", "web_fetch"])
  })

  test("turned off for the session: no web tools and no web prompt", async () => {
    const { c, rt } = setup()
    await c.refresh()
    c.setWebAccess(false)
    await c.send("Make the title bigger")
    const req = turnRequest(rt)
    expect(req?.webAccess).toBeUndefined()
    expect(req?.system.stable).not.toContain("Sources:")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error("no agent message")
    expect(a.steps).toHaveLength(0)
  })

  test("No third-party fetch: the session cannot turn it on", async () => {
    const { c, rt } = setup({ blocked: true })
    await c.refresh()
    expect(c.state.webAccess).toEqual({ on: false, disabled: "privacy" })
    c.setWebAccess(true)
    expect(c.state.webAccess.on).toBe(false)
    await c.send("Look up a font")
    expect(turnRequest(rt)?.webAccess).toBeUndefined()
  })
})
