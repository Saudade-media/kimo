import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Schema from "typebox/schema"
import { KimoParseError, parse, serialize, validate } from "../src/index"
import { codes, FIXTURES, fixtureFiles, readFixture, uiLibrary } from "./helpers"

const libraries = { ui: uiLibrary() }
const jsonSchema = JSON.parse(
  readFileSync(join(FIXTURES, "..", "schema", "kimo-1.0.schema.json"), "utf8"),
)
const schemaValidator = Schema.Compile(jsonSchema)

/** Codes that are purely structural: the generated JSON Schema must reject such documents too. */
const STRUCTURAL = new Set([
  "SCHEMA",
  "UNKNOWN_PROPERTY",
  "UNKNOWN_NODE_TYPE",
  "INSTANCE_VISUAL_FIELD",
  "FORMAT_INVALID",
])

describe("valid fixtures", () => {
  for (const [file, text] of [
    ...fixtureFiles("valid"),
    ...fixtureFiles("valid/libs").map(([f, t]) => [`libs/${f}`, t] as [string, string]),
  ]) {
    test(`${file} validates clean`, () => {
      const r = validate(parse(text), { libraries })
      expect(r.errors).toEqual([])
      expect(r.warnings).toEqual([])
      expect(r.ok).toBe(true)
    })
    test(`${file} is canonical and accepted by the generated JSON Schema`, () => {
      expect(serialize(parse(text))).toBe(text)
      expect(schemaValidator.Check(parse(text))).toBe(true)
    })
  }

  test("the 10.5 example without its library warns LIBRARY_NOT_LOADED only", () => {
    const r = validate(parse(readFixture("valid/example-10-5.kimo")))
    expect(r.ok).toBe(true)
    expect(codes(r.warnings)).toEqual(["LIBRARY_NOT_LOADED"])
  })
})

describe("invalid fixtures", () => {
  for (const [file, text] of fixtureFiles("invalid")) {
    const expected = file.split("--")[0] as string
    test(`${file} reports ${expected}`, () => {
      const r = validate(parse(text), { libraries })
      expect(r.ok).toBe(false)
      expect(codes(r.errors)).toContain(expected)
      // Structural codes are caught by the generated JSON Schema too; semantic rules are not.
      expect(schemaValidator.Check(parse(text))).toBe(!STRUCTURAL.has(expected))
    })
  }
})

describe("lint fixtures", () => {
  for (const [file, text] of fixtureFiles("lint")) {
    const expected = file.split("--")[0] as string
    test(`${file} warns ${expected} and stays ok`, () => {
      const r = validate(parse(text))
      expect(r.errors).toEqual([])
      expect(r.ok).toBe(true)
      expect(codes(r.warnings)).toContain(expected)
      expect(schemaValidator.Check(parse(text))).toBe(true)
    })
  }
  test("lints can be turned off", () => {
    const r = validate(parse(readFixture("lint/VARIABLE_UNUSED--orphan-token.kimo")), {
      lints: false,
    })
    expect(r.warnings).toEqual([])
  })
})

describe("parse errors", () => {
  const expected: Record<string, string> = {
    "duplicate-node-id.kimo": "DUPLICATE_KEY",
    "trailing-comma.kimo": "PARSE_ERROR",
    "not-an-object.kimo": "NOT_AN_OBJECT",
    "truncated.kimo": "PARSE_ERROR",
  }
  for (const [file, text] of fixtureFiles("parse-errors")) {
    test(`${file} throws ${expected[file]}`, () => {
      let err: unknown
      try {
        parse(text)
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(KimoParseError)
      expect((err as KimoParseError).code).toBe(expected[file] as KimoParseError["code"])
    })
  }
  test("duplicate key error carries path and position", () => {
    try {
      parse(readFixture("parse-errors/duplicate-node-id.kimo"))
      throw new Error("expected a parse error")
    } catch (e) {
      const err = e as KimoParseError
      expect(err.path).toBe("/nodes/Frame00001")
      expect(err.line).toBe(7)
    }
  })
})
