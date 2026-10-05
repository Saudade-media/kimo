/** Reply style: the rules reach every model, and the AI-tell lint catches canned bad replies. */
import { describe, expect, test } from "bun:test"
import { readGuide } from "@kimo/mcp-server"
import { SERVER_INSTRUCTIONS } from "@kimo/mcp-server/server"
import {
  aiTellPhrases,
  BASE_SYSTEM_PROMPT,
  basePrompt,
  buildSystemPrompt,
  KIMO_DESIGN_SKILL,
  REPLY_STYLE,
} from "../src/index"

/** The reply the user saw before (board 33 §1 A). */
const BEFORE = `I added a pricing table and an FAQ section to "Landing — Desktop (Analytics)", between the analytics section and the footer. I checked the result in a render and the layout looks right.

- **Pricing:** This is a copy of the pricing section from your Pricing page, unchanged: three plans.
- **FAQ:** It uses the same heading style as the rest of the page — a seamless fit.

Let me know if you'd like any changes! 🎉`

const AFTER = `Added a Pricing table and an FAQ section to "Landing — Desktop (Analytics)", between the analytics section and the footer. Pricing is the section from your Pricing page, unchanged; the FAQ uses the page's heading style.`

describe("REPLY_STYLE in every prompt", () => {
  test("the built-in agent's system prompt carries the rules", () => {
    expect(BASE_SYSTEM_PROMPT).toContain(REPLY_STYLE)
    const p = buildSystemPrompt({ mode: "single", skills: [] })
    expect(p.stable).toContain("No openers or closers")
    expect(p.stable).toContain("no emoji")
    expect(p.stable).toContain("put layer names in double quotes")
  })

  test("the kimo-design skill and MCP clients get the short form", () => {
    expect(KIMO_DESIGN_SKILL).toContain("## Writing to the user")
    expect(SERVER_INSTRUCTIONS).toContain("Write to the user plainly")
    expect(readGuide("guide/steps")?.markdown).toContain("## Writing to the person")
  })

  test("the rules stay short (re-sent with every model call)", () => {
    expect(REPLY_STYLE.length).toBeLessThanOrEqual(700)
    expect(BASE_SYSTEM_PROMPT.length).toBeLessThanOrEqual(3200)
    expect(basePrompt({ streamed: true }).length).toBeLessThanOrEqual(3200)
  })

  test("streamed agents get the streamed call size; others the 40-layer one", () => {
    const streamed = buildSystemPrompt({ mode: "single", skills: [], streamed: true }).stable
    expect(streamed).toContain("one by one while you write the call")
    expect(streamed).toContain("150 new layers per call is a ceiling")
    expect(BASE_SYSTEM_PROMPT).toContain("40 new layers per call is a ceiling")
    for (const p of [streamed, BASE_SYSTEM_PROMPT]) {
      expect(p).toContain("Show work early")
      expect(p).toContain("render: true")
      expect(p).toContain("retryId")
    }
  })
})

describe("aiTellPhrases", () => {
  test("flags the old reply: narration, hype, em-dash aside, closer, emoji", () => {
    const kinds = aiTellPhrases(BEFORE).map((t) => t.kind)
    expect(kinds).toContain("narration")
    expect(kinds).toContain("hype")
    expect(kinds).toContain("em-dash")
    expect(kinds).toContain("closer")
    expect(kinds).toContain("emoji")
  })

  test("the rewritten reply is clean (em dash inside a quoted layer name is fine)", () => {
    expect(aiTellPhrases(AFTER)).toEqual([])
  })

  test("openers, not-just and word boundaries", () => {
    expect(aiTellPhrases("Great question! Here it is.")[0]?.kind).toBe("opener")
    expect(aiTellPhrases("It's not just a header but a hero.")[0]?.kind).toBe("not-just")
    // "robustness" is not "robust"; "unlocked" is.
    expect(aiTellPhrases("Checked robustness.")).toEqual([])
    expect(aiTellPhrases("This unlocked the grid.")[0]?.match).toBe("unlocked")
  })

  test("status lines the panel derives itself are clean", () => {
    for (const s of ["Thinking…", "Writing the reply…", "Adding 12 layers in Pricing"])
      expect(aiTellPhrases(s)).toEqual([])
  })
})
