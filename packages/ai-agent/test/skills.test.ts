import { describe, expect, test } from "bun:test"
import { activeSkills, loadSkills, parseSkill, parseSlash } from "../src/skills/index"

describe("skills", () => {
  test("SKILL.md parsing: front matter, quoted and folded values, errors", () => {
    const ok = parseSkill(
      "---\nname: brand-voice\ndescription: >\n  Rewrite copy in\n  our voice.\n---\n# Voice\nShort.",
      "user",
      "/h/.kimo/skills/brand-voice/SKILL.md",
    )
    expect(ok.ok && ok.skill).toMatchObject({
      name: "brand-voice",
      description: "Rewrite copy in our voice.",
      body: "# Voice\nShort.",
      source: "user",
    })
    const q = parseSkill(
      '---\nname: "pricing-pages"\ndescription: "Pricing \\"tables\\""\n---\nbody',
      "user",
    )
    expect(q.ok && q.skill.description).toBe('Pricing "tables"')
    expect(parseSkill("no front matter", "user").ok).toBe(false)
    expect(parseSkill("---\nname: Bad Name\ndescription: x\n---\n", "user").ok).toBe(false)
    expect(parseSkill("---\nname: x\n---\n", "user").ok).toBe(false)
  })

  test("user skills load sorted; a name clash with a built-in is reported", async () => {
    const cat = await loadSkills({
      list: async () => [
        {
          path: "/s/pricing-pages/SKILL.md",
          text: "---\nname: pricing-pages\ndescription: p\n---\nP",
        },
        { path: "/s/brand-voice/SKILL.md", text: "---\nname: brand-voice\ndescription: b\n---\nB" },
        {
          path: "/s/kimo-design/SKILL.md",
          text: "---\nname: kimo-design\ndescription: shadow\n---\nX",
        },
        { path: "/s/broken/SKILL.md", text: "oops" },
      ],
    })
    expect(cat.user.map((s) => s.name)).toEqual(["brand-voice", "pricing-pages"])
    expect(cat.errors).toHaveLength(2)
  })

  test("/name forces a skill for one turn; active skills are name-ordered", async () => {
    const cat = await loadSkills({
      list: async () => [{ path: "/b", text: "---\nname: brand-voice\ndescription: b\n---\nB" }],
    })
    const known = new Set([...cat.builtin, ...cat.user].map((s) => s.name))
    expect(parseSlash("/brand-voice rewrite the hero copy", known)).toEqual({
      forced: ["brand-voice"],
      text: "rewrite the hero copy",
    })
    expect(parseSlash("/unknown hi", known)).toEqual({ forced: [], text: "/unknown hi" })
    const act = activeSkills(cat, ["kimo-design"], ["brand-voice"])
    expect(act.map((s) => s.name)).toEqual(["brand-voice", "kimo-design"])
  })
})
