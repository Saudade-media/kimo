/**
 * Strict-schema CI (teardown 12 M5 exit "strict-schema CI", ADR 0013 §3): every tool's input
 * and output schema conforms to the portable profile and compiles under Ajv strict mode; the
 * registry is complete and consistent.
 */
import { describe, expect, test } from "bun:test"
import { Ajv } from "@modelcontextprotocol/server/validators/ajv"
import {
  checkPortable,
  listTools,
  outputSchemaOf,
  TOOL_NAMES,
  TOOLS,
  toJsonSchema,
  toMcpDescriptor,
  WIRE_OP_KINDS,
  WIRE_OP_SCHEMAS,
} from "../src/index"

const ajv = new Ajv({ strict: true, allErrors: true })

describe("tool schemas", () => {
  for (const def of TOOLS) {
    const d = toMcpDescriptor(def)
    test(`${def.name}: input is portable`, () => {
      expect(checkPortable(d.inputSchema)).toEqual([])
    })
    test(`${def.name}: output is portable`, () => {
      expect(checkPortable(d.outputSchema)).toEqual([])
    })
    test(`${def.name}: Ajv strict compiles input and output`, () => {
      expect(() => ajv.compile(d.inputSchema)).not.toThrow()
      expect(() => ajv.compile(d.outputSchema)).not.toThrow()
    })
    test(`${def.name}: metadata`, () => {
      expect(def.name).toMatch(/^kimo_[a-z_]{2,40}$/)
      expect(def.description.length).toBeGreaterThan(60)
      expect(def.description.length).toBeLessThanOrEqual(1200)
      expect(def.title.length).toBeGreaterThan(0)
      expect(def.annotations.openWorldHint).toBe(false)
      if (def.annotations.readOnlyHint) {
        expect(def.mutating).toBe(false)
        expect(def.annotations.destructiveHint).toBe(false)
        expect(def.scope).toBe("read")
      }
      // Explicit targeting (11.1): docId is required exactly when doc === "required".
      const req = (d.inputSchema.required as string[] | undefined) ?? []
      const props = d.inputSchema.properties as Record<string, unknown>
      if (def.doc === "required") expect(req).toContain("docId")
      if (def.doc === "optional") expect(props.docId).toBeDefined()
      if (def.doc === "none") expect(props.docId).toBeUndefined()
      // Mutating tools expose baseRevision or are history/assets/styles style tools.
      if (def.name === "kimo_apply_ops" || def.name === "kimo_import") {
        expect(props.baseRevision).toBeDefined()
        expect(props.dryRun).toBeDefined()
      }
    })
  }

  test("names are unique", () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length)
  })

  test("M5 set: teardown 11.3 minus browser/spawn, plus split read tools", () => {
    expect([...TOOL_NAMES].sort() as string[]).toEqual(
      [
        "kimo_apply_ops",
        "kimo_assets",
        "kimo_close",
        "kimo_create",
        "kimo_export",
        "kimo_find_space",
        "kimo_focus",
        "kimo_get_state",
        "kimo_get_variables",
        "kimo_history",
        "kimo_import",
        "kimo_list_components",
        "kimo_open",
        "kimo_query",
        "kimo_read_docs",
        "kimo_render",
        "kimo_save",
        "kimo_script",
        "kimo_styles",
        "kimo_validate",
      ].sort(),
    )
    expect(TOOL_NAMES).not.toContain("kimo_browser")
    expect(TOOL_NAMES).not.toContain("kimo_spawn_agents")
  })

  test("stub tools are hidden unless requested", () => {
    const names = listTools({ host: "desktop" }).map((t) => t.name)
    expect(names).not.toContain("kimo_script")
    expect(listTools({ host: "desktop", includeStubs: true }).map((t) => t.name)).toContain(
      "kimo_script",
    )
    expect(listTools({ host: "web" }).map((t) => t.name)).not.toContain("kimo_open")
  })

  test("wire op kinds match the op union", () => {
    const tags = WIRE_OP_SCHEMAS.map((s) => {
      const op = (toJsonSchema(s).properties as Record<string, { enum: string[] }>).op
      return op?.enum[0]
    })
    expect(tags).toEqual([...WIRE_OP_KINDS])
  })

  test("context budget: tools/list stays small", () => {
    const sizes = Object.fromEntries(
      listTools({ host: "desktop" }).map((t) => {
        const d = toMcpDescriptor(t)
        return [t.name, JSON.stringify({ n: d.name, d: d.description, i: d.inputSchema }).length]
      }),
    )
    const total = Object.values(sizes).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThan(64_000)
    expect(sizes.kimo_apply_ops).toBeLessThan(28_000)
  })

  test("outputSchemaOf root is an object with ok/summary required", () => {
    for (const def of TOOLS) {
      const s = toJsonSchema(outputSchemaOf(def))
      expect(s.type).toBe("object")
      expect(s.required).toEqual(["ok", "summary"])
    }
  })
})
