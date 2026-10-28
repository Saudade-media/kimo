import { describe, expect, test } from "bun:test"
import {
  encodePng,
  MOTION,
  motionParams,
  pngPayload,
  REDUCED,
  reducedParams,
  renderFrame,
  unfilterScanlines,
} from "../scripts/dock-frames"

// Freshness of the committed frames and the include_bytes! table is checked by
// `bun run check:generated` (scripts/dock-frames.ts --check).
describe("dock frames", () => {
  test("PNG payload round-trips to the same pixels", () => {
    const rgba = renderFrame(motionParams(10), 32)
    const { data } = pngPayload(encodePng(rgba, 32, 32))
    expect(unfilterScanlines(data, 32, 32)).toEqual(rgba)
  })

  test("the loops are seamless: frame N equals frame 0, the static icon", () => {
    const f0 = renderFrame(motionParams(0), 64)
    expect(renderFrame(motionParams(MOTION.frames), 64)).toEqual(f0)
    expect(renderFrame(reducedParams(REDUCED.frames), 64)).toEqual(f0)
    expect(renderFrame(motionParams(21), 64)).not.toEqual(f0)
  })
})
