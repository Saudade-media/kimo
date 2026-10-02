import { describe, expect, test } from "bun:test"
import { parseRoute } from "../src/router"

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
  test("unknown", () => {
    expect(parseRoute("#/nope")).toEqual({ name: "not-found", path: "/nope" })
    expect(parseRoute("#/file/")).toEqual({ name: "not-found", path: "/file/" })
  })
})
