import { describe, expect, test } from "bun:test"
import { isDragRegionPath } from "../src/lib/titlebar"

class El {
  constructor(
    readonly tagName: string,
    private attrs: Record<string, string> = {},
  ) {}
  getAttribute(n: string) {
    return this.attrs[n] ?? null
  }
}
// `instanceof HTMLElement` needs a DOM; give the helper one without pulling in a browser.
;(globalThis as { HTMLElement?: unknown }).HTMLElement ??= El

const path = (...els: El[]) => els as unknown as EventTarget[]
const region = (v = "") => new El("DIV", { "data-tauri-drag-region": v })

describe("isDragRegionPath", () => {
  test("a bare region counts for clicks on itself only", () => {
    const r = region()
    expect(isDragRegionPath(path(r))).toBe(true)
    expect(isDragRegionPath(path(new El("SPAN"), r))).toBe(false)
  })
  test("deep covers the subtree but never interactive children", () => {
    const r = region("deep")
    expect(isDragRegionPath(path(new El("H2"), r))).toBe(true)
    expect(isDragRegionPath(path(new El("BUTTON"), r))).toBe(false)
    expect(isDragRegionPath(path(new El("DIV", { role: "tab" }), r))).toBe(false)
  })
  test("false disables and unmarked elements are not regions", () => {
    expect(isDragRegionPath(path(region("false")))).toBe(false)
    expect(isDragRegionPath(path(new El("DIV")))).toBe(false)
  })
})
