import { describe, expect, test } from "bun:test"
import { formatDeepLink, isOpenableUrl, parseDeepLink, resolveAgainstFile } from "../src/index"

describe("openable links", () => {
  test("web, mail and phone links open; other schemes never do", () => {
    for (const ok of ["https://kimo.dev/docs", "mailto:hi@kimo.dev", "tel:+15551234567"])
      expect(isOpenableUrl(ok)).toBe(true)
    for (const bad of [
      "mailto:",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "kimo://open?path=/a.kimo",
      "not a url",
    ])
      expect(isOpenableUrl(bad)).toBe(false)
  })
})

describe("deep links", () => {
  test("round-trips open links with a node or a page, including Windows paths", () => {
    const link = { action: "open" as const, path: "/Users/me/my file.kimo", node: "Abc123xyz9" }
    expect(parseDeepLink(formatDeepLink(link))).toEqual(link)
    const onPage = { action: "open" as const, path: "/a.kimo", page: "Page000002" }
    expect(parseDeepLink(formatDeepLink(onPage))).toEqual(onPage)
    expect(parseDeepLink("kimo://open?path=C%3A%5Cdesign%5Ca.kimoz")?.path).toBe(
      "C:\\design\\a.kimoz",
    )
  })

  test("rejects other actions, non-kimo paths, traversal and malformed ids", () => {
    for (const bad of [
      "https://open?path=/a.kimo",
      "kimo://delete?path=/a.kimo",
      "kimo://open?path=a.kimo",
      "kimo://open?path=/etc/passwd",
      "kimo://open?path=/a/../b.kimo",
      "kimo://open?path=/a.kimo&node=bad/id",
      "kimo://open",
    ])
      expect(parseDeepLink(bad)).toBeNull()
  })
})

describe("URI resolver", () => {
  test("resolves against the file's directory on posix, Windows and fsa refs", () => {
    expect(resolveAgainstFile("/a/b/doc.kimo", "../lib/ui.lib.kimo")).toBe("/a/lib/ui.lib.kimo")
    expect(resolveAgainstFile("C:\\w\\d\\doc.kimo", "./assets/x.png")).toBe(
      "C:\\w\\d\\assets\\x.png",
    )
    expect(resolveAgainstFile("fsa:abc-1/design/doc.kimo", "./assets/x.png")).toBe(
      "fsa:abc-1/design/assets/x.png",
    )
  })

  test("rejects non-relative references and escapes above the root", () => {
    expect(() => resolveAgainstFile("/a/doc.kimo", "/etc/passwd")).toThrow()
    expect(() => resolveAgainstFile("/a/doc.kimo", "https://x/y.png")).toThrow()
    expect(() => resolveAgainstFile("/a/doc.kimo", "./a\\b")).toThrow()
    expect(() => resolveAgainstFile("/a/doc.kimo", "../../x.kimo")).toThrow()
  })
})
