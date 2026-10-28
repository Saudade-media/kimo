import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildJsonSchema } from "../src/index"
import { FIXTURES } from "./helpers"

const file = JSON.parse(
  readFileSync(join(FIXTURES, "..", "schema", "kimo-1.0.schema.json"), "utf8"),
)

describe("generated JSON Schema", () => {
  test("the committed file matches the TypeBox source (run build:schema if this fails)", () => {
    expect(file).toEqual(buildJsonSchema())
  })
})
