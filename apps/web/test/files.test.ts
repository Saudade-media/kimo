import { describe, expect, test } from "bun:test"
import { editedLabel, framesLabel } from "../src/lib/files"

describe("file meta labels", () => {
  const now = Date.UTC(2026, 9, 2, 12)
  const ago = (ms: number) => editedLabel(now - ms, now)
  const H = 3_600_000
  test("relative times", () => {
    expect(ago(10_000)).toBe("Edited just now")
    expect(ago(2 * H)).toBe("Edited 2 hours ago")
    expect(ago(30 * H)).toBe("Edited yesterday")
    expect(ago(3 * 24 * H)).toBe("Edited 3 days ago")
    expect(ago(8 * 24 * H)).toBe("Edited last week")
    expect(ago(15 * 24 * H)).toBe("Edited 2 weeks ago")
    expect(ago(40 * 24 * H)).toBe("Edited last month")
  })
  test("frames", () => {
    expect(framesLabel(1)).toBe("1 frame")
    expect(framesLabel(6)).toBe("6 frames")
  })
})
