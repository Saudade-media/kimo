/**
 * Strict-schema CI (ADR 0013 §3): every tool's input and output schema conforms to the portable
 * profile and compiles under Ajv strict mode; the registry is consistent.
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
  test("every tool's input and output schema is portable and compiles under Ajv strict", () => {
    for (const def of TOOLS) {
      const d = toMcpDescriptor(def)
      expect(checkPortable(d.inputSchema), `${def.name} input`).toEqual([])
      expect(checkPortable(validationSchemaOf(def)), `${def.name} validation`).toEqual([])
      expect(checkPortable(d.outputSchema), `${def.name} output`).toEqual([])
      expect(() => ajv.compile(d.inputSchema), def.name).not.toThrow()
      expect(() => ajv.compile(validationSchemaOf(def)), def.name).not.toThrow()
      expect(() => ajv.compile(d.outputSchema), def.name).not.toThrow()
      const s = toJsonSchema(outputSchemaOf(def))
      expect(s.type).toBe("object")
      expect(s.required).toEqual(["ok", "summary"])
    }
  })

  test("names are unique; docId is required exactly when the tool needs a document; writes carry baseRevision and dryRun", () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length)
    for (const def of TOOLS) {
      const d = toMcpDescriptor(def)
      expect(def.name).toMatch(/^kimo_[a-z_]{2,40}$/)
      const req = (d.inputSchema.required as string[] | undefined) ?? []
      const props = d.inputSchema.properties as Record<string, unknown>
      if (def.doc === "required") expect(req, def.name).toContain("docId")
      if (def.doc === "optional") expect(props.docId, def.name).toBeDefined()
      if (def.doc === "none") expect(props.docId, def.name).toBeUndefined()
      if (def.name === "kimo_apply_ops" || def.name === "kimo_import") {
        expect(props.baseRevision, def.name).toBeDefined()
        expect(props.dryRun, def.name).toBeDefined()
      }
      if (def.annotations.readOnlyHint) {
        expect(def.mutating, def.name).toBe(false)
        expect(def.annotations.destructiveHint, def.name).toBe(false)
        expect(def.scope, def.name).toBe("read")
      }
    }
  })

  test("hosts see their own tool list; kimo_script is offered; no stubs are left", () => {
    const names = listTools({ host: "desktop" }).map((t) => t.name)
    expect(names).toContain("kimo_script")
    expect(listTools({ host: "desktop", includeStubs: true }).map((t) => t.name)).toEqual(names)
    expect(listTools({ host: "web" }).map((t) => t.name)).not.toContain("kimo_open")
  })

  test("wire op kinds match the op union", () => {
    const tags = WIRE_OP_SCHEMAS.map((s) => {
      const op = (toJsonSchema(s).properties as Record<string, { enum: string[] }>).op
      return op?.enum[0]
    })
    expect(tags).toEqual([...WIRE_OP_KINDS])
  })

  // Every model call re-sends the tool list, so its size is a standing cost. Details belong in
  // the guides (kimo_read_docs). Raise the cap only with a reason.
  test("context budget: the whole tools/list stays small", () => {
    const total = listTools({ host: "desktop" })
      .map((t) => toMcpDescriptor(t))
      .reduce(
        (a, d) => a + JSON.stringify({ n: d.name, d: d.description, i: d.inputSchema }).length,
        0,
      )
    expect(total).toBeLessThan(21_000)
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
})
