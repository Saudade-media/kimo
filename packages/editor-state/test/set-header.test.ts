import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "@kimo/core-schema"
import { HEADER_OP_KEYS } from "../src/ops"
import { emptyStore, failed, frame, ok } from "./helpers"

const BOARD_18 = join(
  import.meta.dir,
  "../../core-schema/fixtures/lint/CONFLICT_OPEN--board-18.kimo",
)

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
    // An unlisted image is a warning (it renders as missing), never a refused edit.
    const missing = s.apply(
      { op: "update", id: F1, set: { fill: { kind: "image", src } } },
      { origin: "user", dryRun: true },
    )
    expect(missing.ok && missing.warnings.map((w) => w.code)).toEqual(["ASSET_MISSING"])
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

  test("merge and conflicts are header keys: a pick and finishing apply and undo as one step", () => {
    expect(HEADER_OP_KEYS).toContain("merge")
    expect(HEADER_OP_KEYS).toContain("conflicts")
    const s = emptyStore()
    s.loadDocument(parse(readFileSync(BOARD_18, "utf8")))
    s.clearHistory()
    const before = s.toDocument() as unknown as Record<
      string,
      Record<string, Record<string, unknown>>
    >
    const conflicts = before.conflicts as Record<string, Record<string, unknown>>
    // A pick: one conflicts entry becomes resolved (ConflictSession.choose's header half).
    ok(
      s.apply(
        {
          op: "setHeader",
          set: {
            conflicts: { ...conflicts, CfHeadlin1: { ...conflicts.CfHeadlin1, resolved: true } },
          },
        },
        { origin: "user" },
      ),
    )
    const picked = s.toDocument() as unknown as typeof before
    expect(picked.conflicts?.CfHeadlin1?.resolved).toBe(true)
    s.undo("user")
    expect(
      (s.toDocument() as unknown as typeof before).conflicts?.CfHeadlin1?.resolved,
    ).toBeUndefined()
    s.redo("user")
    expect((s.toDocument() as unknown as typeof before).conflicts?.CfHeadlin1?.resolved).toBe(true)
    // finishMerge's header half: drop merge, conflicts and the feature in one op group.
    ok(
      s.apply(
        { op: "setHeader", set: {}, unset: ["merge", "conflicts", "features"] },
        { origin: "user" },
      ),
    )
    const done = s.toDocument() as unknown as Record<string, unknown>
    expect(done.merge).toBeUndefined()
    expect(done.conflicts).toBeUndefined()
    s.undo("user")
    const restored = s.toDocument() as unknown as typeof before
    expect(restored.merge).toEqual(before.merge)
    expect(Object.keys(restored.conflicts ?? {})).toEqual(Object.keys(conflicts))
    s.redo("user")
    expect((s.toDocument() as unknown as Record<string, unknown>).conflicts).toBeUndefined()
  })
})
