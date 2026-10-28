import { describe, expect, test } from "bun:test"
import { type KimoDocument, validate } from "@kimo/core-schema"
import { createDocStore, type DocStore } from "@kimo/editor-state"
import { altDragCloneOps, duplicateMainOps } from "../../src/editor/m3/component-actions"
import {
  rowsOf,
  storedOf,
  targetsByOption,
  withOptionRenamed,
  withOptionTargets,
} from "../../src/editor/m3/enum-targets"
import { SCHEMA } from "./doc-fixture"

describe("enum property targets", () => {
  const types: Record<string, string> = { Btn: "frame", Lbl: "text", Ico: "icon" }
  const typeOf = (id: string) => types[id] ?? ""

  test("a legacy opacity enum reads as one opacity target per option; the first edit rewrites it", () => {
    const legacy = {
      type: "enum",
      target: "Btn",
      field: "opacity",
      options: { full: 1, half: 0.5 },
    }
    expect(targetsByOption(legacy)).toEqual({
      full: [{ target: "Btn", field: "opacity", value: 1 }],
      half: [{ target: "Btn", field: "opacity", value: 0.5 }],
    })
    const next = withOptionTargets(legacy, "half", [
      { target: "Btn", field: "opacity", value: 0.5 },
      { target: "Lbl", field: "style/size", value: 12 },
    ])
    expect(next.target).toBeUndefined()
    expect(next.options).toEqual({ full: null, half: null })
    expect((next.targets as Record<string, unknown[]>).full).toEqual([
      { target: "Btn", field: "opacity", value: 1 },
    ])
  })

  test("w + h group into one Size row and write both back", () => {
    const stored = [
      { target: "Ico", field: "w", value: 16 },
      { target: "Ico", field: "h", value: 16 },
      { target: "Btn", field: "layout/pad", value: [8, 14] },
    ]
    const rows = rowsOf(stored, typeOf)
    expect(rows.map((r) => r.property)).toEqual(["size", "pad"])
    expect(storedOf(rows, typeOf)).toEqual(stored)
  })

  test("renaming or removing an option keeps at least one option", () => {
    const def = {
      type: "enum",
      options: { sm: null, md: null },
      targets: {
        sm: [{ target: "Lbl", field: "style/size", value: 12 }],
        md: [{ target: "Lbl", field: "style/size", value: 14 }],
      },
    }
    expect(Object.keys(withOptionRenamed(def, "sm", "xs")?.options as object)).toEqual(["xs", "md"])
    const one = withOptionRenamed(def, "sm", null)
    expect(Object.keys(one?.options as object)).toEqual(["md"])
    expect(withOptionRenamed(one as never, "md", null)).toBeNull()
  })
})

describe("duplicating a main", () => {
  function doc(): KimoDocument {
    return {
      $schema: SCHEMA,
      format: "1.0.0",
      nodes: {
        Button0001: {
          type: "frame",
          parent: null,
          order: "a0",
          name: "Button",
          x: 10,
          y: 20,
          w: 80,
          h: 32,
          component: { props: { label: { type: "text", target: "BtnLabel01", field: "content" } } },
        },
        BtnLabel01: { type: "text", parent: "Button0001", order: "a0", content: "Go" },
        Plain00001: { type: "rect", parent: null, order: "a1", x: 200, y: 0, w: 10, h: 10 },
      },
    } as unknown as KimoDocument
  }
  let n = 0
  const ids = () => `Id${String(++n).padStart(8, "0")}`
  const names = (s: DocStore) => () =>
    new Set(s.nodeIds().map((id) => String(s.getNode(id)?.name ?? "")))

  test("as a new component: numbered name, props re-pointed at its own layers", () => {
    const store = createDocStore(doc())
    const r = duplicateMainOps(store, ["Button0001"], "component", new Set(["Button"]), ids)
    store.apply(r.ops, { origin: "user" })
    const copy = store.getNode(r.created[0] as string) as Record<string, unknown>
    expect(copy.name).toBe("Button 2")
    const target = (copy.component as { props: { label: { target: string } } }).props.label.target
    expect(target).not.toBe("BtnLabel01")
    expect(store.getNode(target)?.parent).toBe(r.created[0])
    expect(validate(store.toDocument()).errors).toEqual([])
  })

  test("option-drag of a main: the instance and component answers reuse the same copy root ids", () => {
    const s = createDocStore(doc())
    const r = altDragCloneOps(s, ["Button0001", "Plain00001"], "ask", names(s), ids)
    expect(r?.main).toBe("Button0001")
    const root = r?.pairs.get("Button0001") as string
    const plain = r?.pairs.get("Plain00001") as string
    // A drag step on the copies, replayed on top of the "As a new component" clone.
    const move = [
      { op: "update", id: root, set: { x: 300, y: 300 } },
      { op: "update", id: plain, set: { x: 400 } },
    ] as const
    const a = createDocStore(doc())
    expect(a.apply([...(r?.ops ?? []), ...move], { origin: "user" }).ok).toBe(true)
    expect(a.getNode(root)?.type).toBe("instance")
    const b = createDocStore(doc())
    expect(b.apply([...(r?.component ?? []), ...move], { origin: "user" }).ok).toBe(true)
    const c = b.getNode(root) as Record<string, unknown>
    expect([c.type, c.name, c.x, c.y]).toEqual(["frame", "Button 2", 300, 300])
    const target = (c.component as { props: { label: { target: string } } }).props.label.target
    expect(b.getNode(target)?.parent).toBe(root)
    expect(b.getNode(plain)?.x).toBe(400)
    expect(validate(b.toDocument()).errors).toEqual([])
  })
})
