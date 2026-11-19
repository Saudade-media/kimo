import { describe, expect, test } from "bun:test"
import { parseMessage, safeHref } from "../../src/comments/text"

// docs/spec/comments.md §3: renderers escape HTML and follow http(s) links only.
describe("comment message text", () => {
  test("only http and https links become links; markup stays text", () => {
    const [b] = parseMessage(
      '[a](javascript:alert(1)) [b](data:text/html,x) [c](https://kimo.dev/x) <img src=x onerror=1> @[Ana](dev:abc)',
    )
    const kinds = b?.inline.map((x) => x.kind)
    expect(kinds).toEqual(["text", "link", "text", "mention"])
    const link = b?.inline.find((x) => x.kind === "link")
    expect(link && link.kind === "link" && link.href).toBe("https://kimo.dev/x")
    const text = b?.inline.map((x) => (x.kind === "text" ? x.text : "")).join("")
    expect(text).toContain("[a](javascript:alert(1))")
    expect(text).toContain("<img src=x onerror=1>")
    expect(safeHref("javascript:alert(1)")).toBeNull()
    expect(safeHref("HTTPS://kimo.dev")).toBe("https://kimo.dev/")
  })
})
