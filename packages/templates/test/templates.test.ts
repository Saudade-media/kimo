import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { openDocument } from "../../editor-state/src/index"
import { listTemplates, loadTemplate } from "../src/index"

describe("@kimo/templates", () => {
  const list = listTemplates()

  test("every template ships its cover and screen previews", () => {
    expect(list.length).toBeGreaterThan(0)
    for (const t of list) {
      expect(existsSync(fileURLToPath(t.cover))).toBe(true)
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
})
