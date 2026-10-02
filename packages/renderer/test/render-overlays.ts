// Scratch preview (not a test).
import { writeFileSync } from "node:fs"
import { CanvasKitRenderer } from "../src"
import { VIGNETTES } from "./fixtures/overlays"
import { sceneOf, simpleLayout } from "./helpers/scene"

const OUT = process.argv[2] as string
const r = new CanvasKitRenderer()
await r.init({ offlineFonts: true })
for (const [name, vg] of Object.entries(VIGNETTES)) {
  const scene = sceneOf(vg.doc)
  r.setDocument(scene)
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
  r.attachRaster(vg.width, vg.height, vg.dpr ?? 1)
  r.setViewport(vg.viewport)
  r.setOverlay(vg.overlay)
  writeFileSync(`${OUT}/${name}.png`, r.snapshot())
  r.detach()
}
