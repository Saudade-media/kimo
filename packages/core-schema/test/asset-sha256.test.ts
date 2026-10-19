/** `sha256` in the asset manifest (multiplayer spec §16.7, format spec §12 rule 2). */
import { describe, expect, test } from "bun:test"
import { type KimoDocument, validate } from "../src/index"
import { doc } from "./helpers"

const KEY = "9f2c41ab03d1e7a2.png"
const SHA = `${KEY.slice(0, 16)}${"0".repeat(48)}`

const withAsset = (entry: object): KimoDocument =>
  doc(
    {
      N000001: {
        type: "rect",
        parent: null,
        order: "a0",
        w: 1,
        h: 1,
        fill: { kind: "image", src: `./assets/${KEY}` },
      },
    },
    { assets: { [KEY]: { mime: "image/png", ...entry } } },
  )

const codesOf = (d: KimoDocument) => {
  const r = validate(d)
  return [...r.errors, ...r.warnings].map((i) => i.code)
}

describe("asset sha256", () => {
  test("a full digest whose prefix is the key is accepted", () => {
    expect(codesOf(withAsset({ sha256: SHA }))).toEqual([])
  })

  test("a malformed digest is a schema error", () => {
    expect(codesOf(withAsset({ sha256: "ABC" }))).toContain("SCHEMA")
    expect(codesOf(withAsset({ sha256: SHA.toUpperCase() }))).toContain("SCHEMA")
  })

  test("a digest whose prefix is another key is ASSET_HASH_MISMATCH", () => {
    const other = `${"1".repeat(16)}${"0".repeat(48)}`
    const result = validate(withAsset({ sha256: other }))
    expect(result.ok).toBe(false)
    expect(result.errors.map((i) => i.code)).toContain("ASSET_HASH_MISMATCH")
  })
})
