/** The AI-tell lint (scripts/writing-style.test.ts runs it over UI copy and docs). */
import { describe, expect, test } from "bun:test"
import { aiTellPhrases } from "../src/index"

const BEFORE = `I added a pricing table and an FAQ section to "Landing \u2014 Desktop (Analytics)", between the analytics section and the footer. I checked the result in a render and the layout looks right.

- **Pricing:** This is a copy of the pricing section from your Pricing page, unchanged: three plans.
- **FAQ:** It uses the same heading style as the rest of the page \u2014 a seamless fit.

Let me know if you'd like any changes! 🎉`

const AFTER = `Added a Pricing table and an FAQ section to "Landing \u2014 Desktop (Analytics)", between the analytics section and the footer. Pricing is the section from your Pricing page, unchanged; the FAQ uses the page's heading style.`

describe("aiTellPhrases", () => {
  test("flags narration, hype, em-dash asides, closers and emoji; a clean reply passes", () => {
    const kinds: string[] = aiTellPhrases(BEFORE).map((t) => t.kind)
    for (const k of ["narration", "hype", "em-dash", "closer", "emoji"]) expect(kinds).toContain(k)
    // An em dash inside a quoted layer name is fine.
    expect(aiTellPhrases(AFTER)).toEqual([])
  })

  test("openers, not-just and word boundaries", () => {
    expect(aiTellPhrases("Great question! Here it is.")[0]?.kind).toBe("opener")
    expect(aiTellPhrases("It's not just a header but a hero.")[0]?.kind).toBe("not-just")
    // "robustness" is not "robust"; "unlocked" is.
    expect(aiTellPhrases("Checked robustness.")).toEqual([])
    expect(aiTellPhrases("This unlocked the grid.")[0]?.match).toBe("unlocked")
  })
})
