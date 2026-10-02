import { describe, expect, test } from "bun:test"
import { emptyStore, failed, frame, ok } from "./helpers"

describe("setHeader op", () => {
  test("declares a feature in the same edit as the construct (one undo step)", () => {
    const s = emptyStore()
    const F1 = ok(s.apply({ op: "insert", parent: null, node: frame("F1") }, { origin: "user" }))
      .created[0] as string
    // Without the feature the edit is rejected (spec §13 FEATURE_NOT_DECLARED).
    const bad = failed(
      s.apply(
        { op: "update", id: F1, set: { layout: { dir: "row", wrap: true } } },
        { origin: "user" },
      ),
    )
    expect(bad.errors.some((e) => e.issue?.code === "FEATURE_NOT_DECLARED")).toBe(true)
    const r = ok(
      s.apply(
        [
          { op: "setHeader", set: { features: ["layout/wrap"] } },
          { op: "update", id: F1, set: { layout: { dir: "row", wrap: true } } },
        ],
        { origin: "user" },
      ),
    )
    expect(s.toDocument().features).toEqual(["layout/wrap"])
    expect(r.inverse.at(-1)).toEqual({ op: "setHeader", set: {}, unset: ["features"] })
    s.undo("user")
    expect(s.toDocument().features).toBeUndefined()
    expect((s.getNode(F1)?.layout as { wrap?: boolean } | undefined)?.wrap).toBeUndefined()
  })

  test("adds an asset manifest entry with the image reference", () => {
    const s = emptyStore()
    ok(
      s.apply(
        { op: "setHeader", set: { assets: { "0123456789abcdef.png": { mime: "image/png" } } } },
        { origin: "user" },
      ),
    )
    const F1 = ok(s.apply({ op: "insert", parent: null, node: frame("F1") }, { origin: "user" }))
      .created[0] as string
    const src = "./assets/fedcba9876543210.png"
    const missing = failed(
      s.apply({ op: "update", id: F1, set: { fill: { kind: "image", src } } }, { origin: "user" }),
    )
    expect(missing.errors[0]?.issue?.code).toBe("ASSET_MISSING")
    ok(
      s.apply(
        [
          {
            op: "setHeader",
            set: {
              assets: {
                "0123456789abcdef.png": { mime: "image/png" },
                "fedcba9876543210.png": { mime: "image/png", width: 2, height: 2 },
              },
            },
          },
          { op: "update", id: F1, set: { fill: { kind: "image", src } } },
        ],
        { origin: "user" },
      ),
    )
    expect(Object.keys(s.toDocument().assets ?? {})).toEqual([
      "0123456789abcdef.png",
      "fedcba9876543210.png",
    ])
  })

  test("only features and assets can be changed", () => {
    const s = emptyStore()
    const r = failed(s.apply({ op: "setHeader", set: { name: "x" } as never }, { origin: "user" }))
    expect(r.errors[0]?.code).toBe("INVALID_OP")
  })
})
