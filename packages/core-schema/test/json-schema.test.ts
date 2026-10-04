import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Schema from "typebox/schema"
import { buildJsonSchema, SCHEMA_ID } from "../src/index"
import { FIXTURES } from "./helpers"

const file = JSON.parse(
  readFileSync(join(FIXTURES, "..", "schema", "kimo-1.0.schema.json"), "utf8"),
)

describe("generated JSON Schema", () => {
  test("the committed file matches the TypeBox source (run build:schema if this fails)", () => {
    expect(file).toEqual(buildJsonSchema())
  })
  test("is draft 2020-12 with a stable $id", () => {
    expect(file.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(file.$id).toBe(SCHEMA_ID)
  })
  test("every $ref points at an existing $defs entry and every $defs entry is used", () => {
    const text = JSON.stringify(file)
    const refs = new Set(
      [...text.matchAll(/"\$ref":"#\/\$defs\/([A-Za-z0-9]+)"/g)].map((m) => m[1]),
    )
    for (const r of refs) expect(Object.keys(file.$defs)).toContain(r as string)
    for (const d of Object.keys(file.$defs)) expect(refs.has(d)).toBe(true)
  })
  test("compiles with a standard JSON Schema compiler", () => {
    const v = Schema.Compile(file)
    expect(v.Check({ $schema: SCHEMA_ID, format: "1.0.0", nodes: {} })).toBe(true)
    expect(v.Check({ $schema: SCHEMA_ID, format: "1.0.0" })).toBe(false)
  })
})
