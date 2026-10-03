import { describe, expect, test } from "bun:test"
import { diskPath, parseRoute } from "../src/router"

describe("parseRoute", () => {
  test("home", () => {
    expect(parseRoute("")).toEqual({ name: "home" })
    expect(parseRoute("#/")).toEqual({ name: "home" })
  })
  test("file", () => {
    expect(parseRoute("#/file/abc123XYZ")).toEqual({ name: "file", id: "abc123XYZ" })
    expect(parseRoute("#/file/abc123/")).toEqual({ name: "file", id: "abc123" })
  })
  test("gallery", () => {
    expect(parseRoute("#/gallery")).toEqual({ name: "gallery" })
  })
  test("disk (a .kimo on disk, through the session manager)", () => {
    const ref = "/Users/me/Projects/loom/marketing kit.kimo"
    expect(parseRoute(`#${diskPath(ref)}`)).toEqual({ name: "disk", ref, node: null })
    expect(parseRoute(`#${diskPath(ref, "Hero000001")}`)).toEqual({
      name: "disk",
      ref,
      node: "Hero000001",
    })
    expect(parseRoute("#/disk/%E0%A4%A")).toEqual({ name: "not-found", path: "/disk/%E0%A4%A" })
  })
  test("settings (desktop Settings window)", () => {
    expect(parseRoute("#/settings")).toEqual({ name: "settings", pane: "general" })
    expect(parseRoute("#/settings/fonts")).toEqual({ name: "settings", pane: "fonts" })
  })
  test("unknown", () => {
    expect(parseRoute("#/nope")).toEqual({ name: "not-found", path: "/nope" })
    expect(parseRoute("#/file/")).toEqual({ name: "not-found", path: "/file/" })
  })
})
