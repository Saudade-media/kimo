/** Shared asset GC rules (`kimo gc` and the editor's Clean up assets, spec §12 rule 1). */
import { describe, expect, test } from "bun:test"
import { isContentAddressed, planAssetGc, prunedManifest, referencedAssets } from "../src/index"

const USED = "aaaaaaaaaaaaaaaa.png"
const UNUSED = "9f2c41ab03d1e7a2.png"
const FONT = "cccccccccccccccc.ttf"

const doc = {
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
    expect([...referencedAssets(doc)]).toEqual([USED])
  })

  test("plans unused files, ignores others, keeps fonts of unknown or used family", () => {
    const files = [
      { name: USED, bytes: 1 },
      { name: UNUSED, bytes: 5 },
      { name: FONT, bytes: 9 },
      { name: "README.md", bytes: 2 },
    ]
    const plan = planAssetGc(doc, files)
    expect(plan.unused.map((f) => f.name)).toEqual([UNUSED])
    expect(plan.unusedBytes).toBe(5)
    expect(plan.kept.map((f) => f.name).sort()).toEqual([USED, FONT].sort())
    expect(plan.ignored.map((f) => f.name)).toEqual(["README.md"])
    expect(planAssetGc(doc, files, () => "Inter").kept.map((f) => f.name)).toContain(FONT)
    expect(planAssetGc(doc, files, () => "Lora").unused.map((f) => f.name)).toEqual([FONT, UNUSED])
  })

  test("reports referenced names with no file", () => {
    expect(planAssetGc(doc, []).missing).toEqual([USED])
  })

  test("prunedManifest drops removed entries, null when nothing changes", () => {
    expect(prunedManifest(doc.assets, [UNUSED])).toEqual({ [USED]: { mime: "image/png" } })
    expect(prunedManifest(doc.assets, ["0000000000000000.png"])).toBeNull()
    expect(prunedManifest(null, [UNUSED])).toBeNull()
  })
})
