import { describe, expect, test } from "bun:test"
import { diskPath, homeFolderPath, homeSectionPath, parseRoute } from "../../src/router"

describe("parseRoute", () => {
  test("home and its sections, including a folder with characters that need escaping", () => {
    expect(parseRoute("")).toEqual({ name: "home", section: { kind: "recents" } })
    expect(parseRoute("#/")).toEqual({ name: "home", section: { kind: "recents" } })
    for (const kind of ["all", "templates", "libraries", "trash"] as const) {
      expect(parseRoute(`#/${kind}`)).toEqual({ name: "home", section: { kind } })
      expect(homeSectionPath({ kind })).toBe(`/${kind}`)
    }
    const ref = "/Users/me/Work/kimo site"
    expect(parseRoute(`#${homeFolderPath(ref)}`)).toEqual({
      name: "home",
      section: { kind: "folder", ref },
    })
    expect(homeSectionPath({ kind: "folder", ref })).toBe(homeFolderPath(ref))
    expect(parseRoute("#/folder/%E0%A4%A").name).toBe("not-found")
  })

  test("a file on disk carries its path and optional node; a page link keeps the route", () => {
    expect(parseRoute("#/file/abc123XYZ")).toEqual({ name: "file", id: "abc123XYZ" })
    expect(parseRoute("#/file/abc123/")).toEqual({ name: "file", id: "abc123" })
    expect(parseRoute("#/file/abc?page=PageHome01")).toEqual({ name: "file", id: "abc" })
    const ref = "/Users/me/Projects/loom/marketing kit.kimo"
    expect(parseRoute(`#${diskPath(ref)}`)).toEqual({ name: "disk", ref, node: null })
    expect(parseRoute(`#${diskPath(ref, "Hero000001")}`)).toEqual({
      name: "disk",
      ref,
      node: "Hero000001",
    })
    expect(parseRoute("#/disk/%2Fw%2Fa.kimo?page=PageHome01")).toMatchObject({
      name: "disk",
      node: null,
    })
    expect(parseRoute("#/disk/%E0%A4%A")).toEqual({ name: "not-found", path: "/disk/%E0%A4%A" })
  })

  test("settings default to General; unknown routes are not found", () => {
    expect(parseRoute("#/settings")).toEqual({ name: "settings", pane: "general" })
    expect(parseRoute("#/settings/fonts")).toEqual({ name: "settings", pane: "fonts" })
    expect(parseRoute("#/nope")).toEqual({ name: "not-found", path: "/nope" })
    expect(parseRoute("#/file/")).toEqual({ name: "not-found", path: "/file/" })
  })
})
