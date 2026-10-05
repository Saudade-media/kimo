/**
 * Strict-schema CI (teardown 12 M5 exit "strict-schema CI", ADR 0013 §3): every tool's input
 * and output schema conforms to the portable profile and compiles under Ajv strict mode; the
 * registry is complete and consistent.
 */
import { describe, expect, test } from "bun:test"
import { Ajv } from "@modelcontextprotocol/server/validators/ajv"
import {
  advertisedInputSchema,
  checkPortable,
  listTools,
  outputSchemaOf,
  TOOL_NAMES,
  TOOLS,
  toJsonSchema,
  toMcpDescriptor,
  validationSchemaOf,
  WIRE_OP_KINDS,
  WIRE_OP_SCHEMAS,
} from "../src/index"
import { validateInput } from "../src/server"

const ajv = new Ajv({ strict: true, allErrors: true })

describe("tool schemas", () => {
  for (const def of TOOLS) {
    const d = toMcpDescriptor(def)
    test(`${def.name}: input is portable`, () => {
      expect(checkPortable(d.inputSchema)).toEqual([])
      expect(checkPortable(validationSchemaOf(def))).toEqual([])
    })
    test(`${def.name}: output is portable`, () => {
      expect(checkPortable(d.outputSchema)).toEqual([])
    })
    test(`${def.name}: Ajv strict compiles input and output`, () => {
      expect(() => ajv.compile(d.inputSchema)).not.toThrow()
      expect(() => ajv.compile(validationSchemaOf(def))).not.toThrow()
      expect(() => ajv.compile(d.outputSchema)).not.toThrow()
    })
    test(`${def.name}: metadata`, () => {
      expect(def.name).toMatch(/^kimo_[a-z_]{2,40}$/)
      expect(def.description.length).toBeGreaterThan(60)
      expect(def.description.length).toBeLessThanOrEqual(420)
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

  /**
   * Board 31 token pass: every model call re-sends the tool list, so each tool has a budget for
   * what the model sees (name + description + advertised input schema, as JSON characters).
   * Details belong in the guides (kimo_read_docs path=tools / ops). Raise a budget only with a
   * reason; the whole list was ~48.7k characters before the pass and is ~17.7k after.
   */
  const BUDGET: Record<string, number> = {
    kimo_get_state: 450,
    kimo_read_docs: 560,
    kimo_open: 420,
    kimo_query: 2300,
    // Patch-retry fields (retryId, edits): a fix costs a few find/replace pairs, not the call.
    kimo_apply_ops: 4050,
    kimo_render: 1250,
    kimo_get_variables: 1100,
    kimo_list_components: 650,
    kimo_find_space: 750,
    kimo_validate: 550,
    kimo_history: 680,
    kimo_save: 720,
    kimo_focus: 640,
    kimo_import: 1500,
    kimo_assets: 1080,
    kimo_export: 1420,
    kimo_create: 500,
    kimo_close: 500,
    kimo_styles: 1130,
    kimo_script: 1600,
  }
  for (const def of TOOLS)
    test(`${def.name}: model-facing size stays within its budget`, () => {
      const d = toMcpDescriptor(def)
      const size = JSON.stringify({ n: d.name, d: d.description, i: d.inputSchema }).length
      expect(BUDGET[def.name]).toBeDefined()
      expect(size).toBeLessThanOrEqual(BUDGET[def.name] as number)
    })

  test("context budget: the whole tools/list stays small", () => {
    const total = listTools({ host: "desktop" })
      .map((t) => toMcpDescriptor(t))
      .reduce(
        (a, d) => a + JSON.stringify({ n: d.name, d: d.description, i: d.inputSchema }).length,
        0,
      )
    expect(total).toBeLessThan(19_500)
  })

  test("the advertised schema drops validation-only keywords; the server keeps them", () => {
    for (const def of TOOLS) {
      const text = JSON.stringify(advertisedInputSchema(def))
      expect(text).not.toContain('"pattern"')
      expect(text).not.toContain('"maxLength"')
    }
    expect(
      JSON.stringify(validationSchemaOf(TOOLS.find((t) => t.name === "kimo_open") as never)),
    ).toContain('"pattern"')
  })

  test("kimo_apply_ops advertises every op kind and its fields; validation stays strict", () => {
    const def = TOOLS.find((t) => t.name === "kimo_apply_ops") as never
    const ops = (advertisedInputSchema(def).properties as Record<string, Record<string, unknown>>)
      .ops as {
      items: { properties: { op: { enum: string[] } }; description: string }
    }
    expect(ops.items.properties.op.enum).toEqual([...WIRE_OP_KINDS])
    for (const k of WIRE_OP_KINDS) expect(ops.items.description).toContain(`\n${k} {`)
    expect(ops.items.description).toContain("insert {key?, parent, at?, index?, node}")
    const docId = "d_abc_def"
    // Accepted by the advertised schema (open op object), refused by the strict union.
    const loose = {
      docId,
      ops: [{ op: "insert", parent: "root", node: { type: "frame" }, bogus: 1 }],
    }
    expect(ajv.validate(advertisedInputSchema(def), loose)).toBe(true)
    expect(validateInput(def, loose).length).toBeGreaterThan(0)
    expect(validateInput(def, { docId, ops: [{ op: "update", id: "bad id!" }] })[0]?.code).toBe(
      "INVALID_INPUT",
    )
    // Every strictly valid input is valid against the advertised schema.
    const ok = {
      docId,
      ops: [
        { op: "copy", id: "Abc12345", key: "v", parent: "root" },
        { op: "insert", parent: "@v/Def67890", node: { type: "text", content: "x" } },
      ],
    }
    expect(validateInput(def, ok)).toEqual([])
    expect(ajv.validate(advertisedInputSchema(def), ok)).toBe(true)
  })

  test("outputSchemaOf root is an object with ok/summary required", () => {
    for (const def of TOOLS) {
      const s = toJsonSchema(outputSchemaOf(def))
      expect(s.type).toBe("object")
      expect(s.required).toEqual(["ok", "summary"])
    }
  })
})
