/** Asset manifest rules: shared GC (`kimo gc`, spec §12 rule 1) and `sha256` digests (rule 2). */
import { describe, expect, test } from "bun:test"
import {
  isContentAddressed,
  type KimoDocument,
  planAssetGc,
  prunedManifest,
  referencedAssets,
  validate,
} from "../src/index"
import { doc as makeDoc } from "./helpers"

const USED = "aaaaaaaaaaaaaaaa.png"
const UNUSED = "9f2c41ab03d1e7a2.png"
const FONT = "cccccccccccccccc.ttf"

const gcDoc = {
  assets: { [USED]: { mime: "image/png" }, [UNUSED]: { mime: "image/png" } },
  nodes: { n: { type: "rect", fill: { kind: "image", src: `./assets/${USED}` }, font: "Inter" } },
}

describe("asset gc", () => {
  test("only content-addressed names are candidates", () => {
    expect(isContentAddressed(USED)).toBe(true)
    expect(isContentAddressed("README.md")).toBe(false)
    expect(isContentAddressed("AAAAAAAAAAAAAAAA.png")).toBe(false)
  })

  test("the manifest is not a reference", () => {
    expect([...referencedAssets(gcDoc)]).toEqual([USED])
  })

  test("plans unused files, ignores others, keeps fonts of unknown or used family", () => {
    const files = [
      { name: USED, bytes: 1 },
      { name: UNUSED, bytes: 5 },
      { name: FONT, bytes: 9 },
      { name: "README.md", bytes: 2 },
    ]
    const plan = planAssetGc(gcDoc, files)
    expect(plan.unused.map((f) => f.name)).toEqual([UNUSED])
    expect(plan.unusedBytes).toBe(5)
    expect(plan.kept.map((f) => f.name).sort()).toEqual([USED, FONT].sort())
    expect(plan.ignored.map((f) => f.name)).toEqual(["README.md"])
    expect(planAssetGc(gcDoc, files, () => "Inter").kept.map((f) => f.name)).toContain(FONT)
    expect(planAssetGc(gcDoc, files, () => "Lora").unused.map((f) => f.name)).toEqual([
      FONT,
      UNUSED,
    ])
  })

  test("prunedManifest drops removed entries, null when nothing changes", () => {
    expect(prunedManifest(gcDoc.assets, [UNUSED])).toEqual({ [USED]: { mime: "image/png" } })
    expect(prunedManifest(gcDoc.assets, ["0000000000000000.png"])).toBeNull()
    expect(prunedManifest(null, [UNUSED])).toBeNull()
  })
})

const KEY = "9f2c41ab03d1e7a2.png"
const SHA = `${KEY.slice(0, 16)}${"0".repeat(48)}`

const withAsset = (entry: object): KimoDocument =>
  makeDoc(
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
