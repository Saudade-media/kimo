import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { outputs, readSources } from "../scripts/gen-guides"
import { GUIDES, guidePathFromUri, readGuide } from "../src/guides"
import { DOC_PATHS } from "../src/tools/session"

/** Per-topic budget: ~1k tokens, so reading a guide never crowds the agent's context. */
const TOPIC_BUDGET_BYTES = 4096

describe("agent guides (kimo_read_docs)", () => {
  test("generated module and docs/agents copies are up to date", () => {
    for (const o of outputs()) {
      expect(existsSync(o.path)).toBe(true)
      expect(readFileSync(o.path, "utf8")).toBe(o.text)
    }
  })

  test("every DOC_PATHS entry has a guide, and nothing else", () => {
    expect(Object.keys(GUIDES).sort()).toEqual([...DOC_PATHS].sort())
  })

  test("each topic stays within the token budget and starts with a title", () => {
    for (const s of readSources()) {
      expect(new TextEncoder().encode(s.markdown).length).toBeLessThanOrEqual(TOPIC_BUDGET_BYTES)
      expect(s.markdown.startsWith(`# ${s.title}\n`)).toBe(true)
    }
  })

  test("related links point at real guides; the index lists every guide", () => {
    const index = GUIDES.index.markdown
    for (const p of DOC_PATHS) {
      for (const r of GUIDES[p].related) expect(DOC_PATHS as readonly string[]).toContain(r)
      if (p !== "index") expect(index).toContain(`\`${p}\``)
    }
  })

  test("readGuide and resource URIs", () => {
    expect(readGuide()?.path).toBe("index")
    expect(readGuide("guide/web")?.title).toBe("Designing web pages")
    expect(readGuide("nope")).toBeNull()
    expect(readGuide("toString")).toBeNull()
    expect(guidePathFromUri("kimo://docs/ops")).toBe("ops")
    expect(guidePathFromUri("kimo://docs/../x")).toBeNull()
  })

  test("examples only use wire op kinds that exist", async () => {
    const { WIRE_OP_KINDS } = await import("../src/ops")
    const kinds = new Set<string>(WIRE_OP_KINDS)
    for (const p of DOC_PATHS)
      for (const m of GUIDES[p].markdown.matchAll(/"op":"([a-z_]+)"/g))
        expect(kinds.has(m[1] as string)).toBe(true)
  })
})
