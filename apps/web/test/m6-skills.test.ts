import { describe, expect, test } from "bun:test"
import { builtinSkills, loadSkills, type SkillSource } from "@kimo/ai-agent"
import { createMemoryPlatform } from "@kimo/platform/memory"

const skill = (name: string, description = "d") =>
  `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}\n`

describe("platform.skills → agent catalog (ADR 0014 §10)", () => {
  test("user skills load from the platform source; built-ins cannot be shadowed", async () => {
    const platform = createMemoryPlatform({
      skills: {
        "brand-voice": skill("brand-voice"),
        // A folder whose front matter names a built-in: reported, never loaded.
        impostor: skill("kimo-design", "shadow"),
        broken: "no front matter",
      },
    })
    // Structural compatibility: platform.skills is a SkillSource.
    const source: SkillSource = platform.skills
    const catalog = await loadSkills(source)
    expect(catalog.user.map((s) => s.name)).toEqual(["brand-voice"])
    expect(catalog.user[0]?.path).toBe("/home/me/.kimo/skills/brand-voice/SKILL.md")
    const design = catalog.builtin.find((s) => s.name === "kimo-design")
    expect(design?.body).toBe(builtinSkills().find((s) => s.name === "kimo-design")?.body)
    expect(catalog.errors.map((e) => e.message)).toEqual([
      "SKILL.md must start with --- front matter.",
      'A skill named "kimo-design" already exists.',
    ])
  })

  test("watch fires on change so the panel reloads", async () => {
    const platform = createMemoryPlatform()
    let reloads = 0
    const off = platform.skills.watch(() => reloads++)
    platform.skills.set("new-one", skill("new-one"))
    expect(reloads).toBe(1)
    expect((await loadSkills(platform.skills)).user.map((s) => s.name)).toEqual(["new-one"])
    off()
  })
})
