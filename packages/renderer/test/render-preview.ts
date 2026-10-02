// Scratch preview (not a test): renders M2 fixtures to the scratchpad.
import { writeFileSync } from "node:fs"
import { CanvasKitRenderer } from "../src"
import { loadCanvasKit } from "../src/ck"
import { blendDoc, effectsM2Doc, iconsDoc, paintsM2Doc, strokesM2Doc } from "./fixtures/m2"
import { quadrantPng } from "./helpers/png"
import { sceneOf, simpleLayout } from "./helpers/scene"

const OUT = process.argv[2] as string
const r = new CanvasKitRenderer()
await r.init({ offlineFonts: true })
const ck = await loadCanvasKit()
const png = quadrantPng(ck)
for (const [name, doc, root] of [
  ["strokes-m2", strokesM2Doc, "boardS001"],
  ["blend", blendDoc, "boardB001"],
  ["effects-m2", effectsM2Doc, "boardE001"],
  ["paints-m2", paintsM2Doc, "boardP001"],
  ["icons", iconsDoc, "boardI001"],
] as const) {
  const scene = sceneOf(doc, { "./assets/0123456789abcdef.png": png })
  r.setDocument(scene)
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
  writeFileSync(`${OUT}/${name}.png`, await r.exportRaster(root, { scale: 2 }))
}
