/** Board 19 Clean up assets (same rules as `kimo gc`). */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  applyAssetGc,
  CleanUpAssetsDialog,
  formatBytes,
  gcCommand,
  gcConfirmLabel,
  gcDescription,
  gcMoreLabel,
  gcTitle,
  planAssetGc,
  planFolderGc,
  platformAssetFolder,
  prunedManifest,
  referencedAssets,
} from "../src/assets-gc"

const A = "9f2c41ab03d1e7a2.png"
const B = "1b77e0c9a4f25d13.jpg"
const C = "c30d8e1f6a9b2240.webp"
const D = "77aa10fe2b9c4d58.svg"
const USED = "aaaaaaaaaaaaaaaa.png"
const VAR = "bbbbbbbbbbbbbbbb.png"
const FONT = "cccccccccccccccc.ttf"

const doc = {
  $schema: "x",
  format: "0.1",
  assets: { [A]: { mime: "image/png" }, [USED]: { mime: "image/png" } },
  variables: { hero: { type: "string", value: `./assets/${VAR}` } },
  nodes: {
    n1: { type: "rect", w: 1, h: 1, fill: [{ kind: "image", src: `./assets/${USED}` }] },
    n2: { type: "text", content: "x", style: { font: "Fraunces" } },
  },
}

describe("gc logic", () => {
  test("references: nodes + variables, not the manifest", () => {
    expect([...referencedAssets(doc)].sort()).toEqual([USED, VAR])
  })

  test("plan: unused largest first, non-addressed ignored, fonts by family, missing listed", () => {
    const files = [
      { name: A, bytes: 6_200_000 },
      { name: B, bytes: 4_800_000 },
      { name: C, bytes: 3_100_000 },
      { name: D, bytes: 48_000 },
      { name: USED, bytes: 10 },
      { name: FONT, bytes: 200_000 },
      { name: "dddddddddddddddd.otf", bytes: 1 },
      { name: "README.md", bytes: 5 },
      { name: ".DS_Store", bytes: 5 },
    ]
    const plan = planAssetGc(doc, files, (n) =>
      n === FONT ? "Fraunces" : n.endsWith(".otf") ? "Unused Sans" : null,
    )
    expect(plan.unused.map((f) => f.name)).toEqual([A, B, C, D, "dddddddddddddddd.otf"])
    expect(plan.unusedBytes).toBe(6_200_000 + 4_800_000 + 3_100_000 + 48_000 + 1)
    expect(plan.kept.map((f) => f.name).sort()).toEqual([USED, FONT].sort())
    expect(plan.ignored.map((f) => f.name)).toEqual(["README.md", ".DS_Store"])
    expect(plan.missing).toEqual([VAR])
    // Unknown font family → kept (conservative).
    expect(planAssetGc(doc, [{ name: FONT, bytes: 1 }]).unused).toEqual([])
  })

  test("a name that only appears inside a longer token is not a reference", () => {
    const d = { nodes: { n: { note: `x./assets/${A}x`, other: `assets/${A}0` } } }
    expect(referencedAssets(d).has(A)).toBe(false)
    expect(referencedAssets({ nodes: { n: { src: `assets/${A}` } } }).has(A)).toBe(true)
  })

  test("manifest pruning", () => {
    expect(prunedManifest(doc.assets, [A])).toEqual({ [USED]: { mime: "image/png" } })
    expect(prunedManifest(doc.assets, [B])).toBeNull()
    expect(prunedManifest(undefined, [A])).toBeNull()
  })

  test("copy as designed (Vqeu7)", () => {
    expect(gcTitle(7)).toBe("Remove 7 unused assets?")
    expect(gcConfirmLabel(7)).toBe("Remove 7 files")
    expect(gcCommand("marketing.kimo")).toBe("kimo gc ./marketing.kimo")
    expect(gcDescription("marketing.kimo", 18_400_000)).toBe(
      "No node, fill, component or variable in marketing.kimo references these files. Removing them frees 18.4 MB in assets/. Git history keeps old versions.",
    )
    expect(formatBytes(6_200_000)).toBe("6.2 MB")
    expect(formatBytes(48_000)).toBe("48 KB")
    expect(
      gcMoreLabel([
        { name: "a", bytes: 4_300_000 },
        { name: "b", bytes: 0 },
        { name: "c", bytes: 0 },
      ]),
    ).toBe("+ 3 more · 4.3 MB")
  })
})

describe("gc on the memory platform", () => {
  test("lists assets/ beside the file, removes unused, prunes the manifest", async () => {
    const p = createMemoryPlatform({
      files: {
        "/p/marketing.kimo": "{}",
        [`/p/assets/${A}`]: "aaaa",
        [`/p/assets/${USED}`]: "b",
        "/p/assets/notes.txt": "keep me",
      },
    })
    const folder = platformAssetFolder(p, "/p/marketing.kimo")
    const plan = await planFolderGc(folder, doc)
    expect(plan.unused).toEqual([{ name: A, bytes: 4 }])
    const ops = await applyAssetGc(folder, plan, doc)
    expect(ops).toEqual([{ op: "setHeader", set: { assets: { [USED]: { mime: "image/png" } } } }])
    expect(p.control.readFile(`/p/assets/${A}`)).toBeNull()
    expect(p.control.readFile(`/p/assets/${USED}`)).toBe("b")
    expect(p.control.readFile("/p/assets/notes.txt")).toBe("keep me")
  })

  test("no assets/ folder → nothing to do", async () => {
    const p = createMemoryPlatform({ files: { "/q/a.kimo": "{}" } })
    expect((await planFolderGc(platformAssetFolder(p, "/q/a.kimo"), doc)).unused).toEqual([])
  })

  test("dialog renders 4 rows + more", () => {
    const unused = [
      A,
      B,
      C,
      D,
      "e000000000000000.png",
      "f000000000000000.png",
      "0000000000000000.png",
    ].map((name, i) => ({
      name,
      bytes: [6_200_000, 4_800_000, 3_100_000, 48_000, 4_000_000, 200_000, 100_000][i] ?? 0,
    }))
    const html = renderToString(
      h(CleanUpAssetsDialog, {
        fileName: "marketing.kimo",
        unused,
        onCancel: () => {},
        onConfirm: () => {},
        inline: true,
      }),
    )
    expect(html).toContain("Remove 7 unused assets?")
    expect(html).toContain(`assets/${A}`)
    expect(html).toContain("+ 3 more · 4.3 MB")
    expect(html).toContain("kimo gc ./marketing.kimo")
    expect(html).toContain("Remove 7 files")
    expect(html.match(/class="gc-row"/g)?.length).toBe(4)
  })
})
