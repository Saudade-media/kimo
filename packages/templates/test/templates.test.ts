import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { openDocument } from "../../editor-state/src/index"
import { getTemplate, listTemplates, loadTemplate } from "../src/index"

describe("@kimo/templates", () => {
  const list = listTemplates()

  test("lists every template with its cover and screen previews on disk", () => {
    expect(list.length).toBeGreaterThan(0)
    expect(list.map((t) => t.slug)).toEqual([...list.map((t) => t.slug)].sort())
    for (const t of list) {
      expect(t.pages[0]).toBe("Cover")
      expect(t.pages).toContain("Components")
      expect(existsSync(fileURLToPath(t.cover))).toBe(true)
      expect(t.screens.length).toBeGreaterThanOrEqual(3)
      for (const s of t.screens) expect(existsSync(fileURLToPath(s.preview))).toBe(true)
    }
  })

  test("every document opens editable and strictly valid", async () => {
    for (const t of list) {
      const text = await loadTemplate(t.slug)
      const r = openDocument(text, { libraries: {}, lints: true, allowInvalid: true })
      expect(r.readOnly).toBe(false)
      expect(r.validation?.errors ?? []).toEqual([])
      expect(r.validation?.warnings ?? []).toEqual([])
    }
  })

  test("unknown slugs", async () => {
    expect(getTemplate("nope")).toBeNull()
    await expect(loadTemplate("nope")).rejects.toThrow("Unknown template")
  })
})
