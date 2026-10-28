/**
 * Home prompt: starting a design from the Home composer creates a new `.kimo` file for the agent
 * and never overwrites an existing one.
 */
import { describe, expect, test } from "bun:test"
import { parse } from "@kimo/core-schema"
import { importDocument } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  createDiskFile,
  FIRST_FRAME_ID,
  homeDocument,
  submitHomePrompt,
} from "../../src/home/submit"

describe("Home submit", () => {
  test("creates <title>.kimo in New files go to, never overwriting an existing file", async () => {
    const p = createMemoryPlatform({ settings: { "files.newFilesDir": "/Users/me/Kimo" } })
    await p.settings.ready
    await p.files.writeTextAtomic("/Users/me/Kimo/Pricing page.kimo", "{}", { mkdirs: true })
    const stashed: unknown[] = []
    const h1 = await submitHomePrompt(
      "A pricing page for a calm budgeting app, three tiers, soft greens",
      undefined,
      {
        platform: p,
        model: { provider: "anthropic", model: "claude-opus-5-5" },
        nameFile: async () => "Pricing page",
        stash: (x) => stashed.push(x),
      },
    )
    expect(h1.path).toBe("/Users/me/Kimo/Pricing page 2.kimo")
    expect(stashed).toHaveLength(1)
    expect((await p.files.readText("/Users/me/Kimo/Pricing page.kimo")).text).toBe("{}")
    // Valid: importDocument throws on schema errors.
    const store = importDocument(parse((await p.files.readText(h1.path)).text))
    expect(store.getNode(FIRST_FRAME_ID)?.type).toBe("frame")
    const r = await createDiskFile(p, "Pricing page", (n) =>
      homeDocument({ title: n, owner: null }),
    )
    expect(r.name).toBe("Pricing page 3")
  })
})
