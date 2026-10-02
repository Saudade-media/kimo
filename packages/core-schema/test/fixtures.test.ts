import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Schema from "typebox/schema"
import { KimoParseError, openDocument, parse, serialize, validate } from "../src/index"
import { codes, FIXTURES, fixtureFiles, readFixture, uiLibrary } from "./helpers"

const libraries = { ui: uiLibrary() }
const jsonSchema = JSON.parse(
  readFileSync(join(FIXTURES, "..", "schema", "kimo-0.1.schema.json"), "utf8"),
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
    test(`${file} validates with no errors and no warnings`, () => {
      const r = validate(parse(text), { libraries })
      expect(r.errors).toEqual([])
      expect(r.warnings).toEqual([])
      expect(r.ok).toBe(true)
    })
    test(`${file} is canonical (serialize(parse(s)) === s)`, () => {
      expect(serialize(parse(text))).toBe(text)
    })
    test(`${file} is accepted by the generated JSON Schema`, () => {
      expect(schemaValidator.Check(parse(text))).toBe(true)
    })
  }

  test("the 10.5 example without its library warns LIBRARY_NOT_LOADED only", () => {
    const r = validate(parse(readFixture("valid/example-10-5.kimo")))
    expect(r.ok).toBe(true)
    expect(codes(r.warnings)).toEqual(["LIBRARY_NOT_LOADED"])
  })

  test("the 10.5 example keeps the teardown's node lines (minus the default fit)", () => {
    const text = readFixture("valid/example-10-5.kimo")
    expect(text).toContain(
      `, "F6btn00001": {"type":"instance","parent":"E5card0001","at":"ui:CardActns1","order":"a0","of":"ui:BtnGhost01","overrides":{"ui:BtnLabel01":{"set":{"content":"Learn more"}}}}`,
    )
    expect(text).toContain(`"content":"Get Kimo — $49/mo"`)
    expect(text).not.toContain(`"fit":"cover"`)
  })
})

describe("invalid fixtures", () => {
  for (const [file, text] of fixtureFiles("invalid")) {
    const expected = file.split("--")[0] as string
    test(`${file} reports ${expected}`, () => {
      const r = validate(parse(text), { libraries })
      expect(r.ok).toBe(false)
      expect(codes(r.errors)).toContain(expected)
    })
    if (STRUCTURAL.has(expected)) {
      test(`${file} is rejected by the generated JSON Schema`, () => {
        expect(schemaValidator.Check(parse(text))).toBe(false)
      })
    } else {
      test(`${file} is structurally valid (semantic rule only)`, () => {
        expect(schemaValidator.Check(parse(text))).toBe(true)
      })
    }
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
    })
  }
  for (const [file, text] of fixtureFiles("lint")) {
    test(`${file} is accepted by the generated JSON Schema`, () => {
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

describe("forward fixtures", () => {
  test("newer minor opens read-only", () => {
    const r = openDocument(readFixture("forward/newer-minor.kimo"))
    expect(r.readOnly).toBe(true)
    expect(r.readOnlyReasons.map((x) => x.code)).toEqual(["FORMAT_NEWER"])
    expect(r.validation).toBeNull()
  })
  test("newer major opens read-only", () => {
    expect(openDocument(readFixture("forward/newer-major.kimo")).readOnly).toBe(true)
  })
  test("newer patch is current", () => {
    const r = openDocument(readFixture("forward/newer-patch.kimo"))
    expect(r.readOnly).toBe(false)
    expect(r.validation?.ok).toBe(true)
  })
  test("unknown feature opens read-only and validates with FEATURE_UNKNOWN", () => {
    const r = openDocument(readFixture("forward/unknown-feature.kimo"))
    expect(r.readOnly).toBe(true)
    expect(r.readOnlyReasons.map((x) => x.code)).toEqual(["FEATURE_UNSUPPORTED"])
    expect(codes(r.validation?.warnings ?? [])).toEqual(["FEATURE_UNKNOWN"])
  })
})
