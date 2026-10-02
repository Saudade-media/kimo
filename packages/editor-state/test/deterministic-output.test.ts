import { expect, test } from "bun:test"
import { YjsDocStore } from "../src/index"
import { emptyStore, ok, rect } from "./helpers"

test("toDocument output does not depend on the order Yjs updates arrived in", () => {
  const source = emptyStore()
  const base = source.encodeStateAsUpdate()
  const replica = () => {
    const r = new YjsDocStore()
    r.applyUpdate(base, "remote:a")
    return r
  }
  const updates: Uint8Array[] = []
  source.onUpdate((u) => updates.push(u))
  for (const name of ["Zeta", "Alpha", "Mid", "Beta"]) {
    ok(source.apply({ op: "insert", node: rect(name) }, { origin: "user" }))
  }
  ok(
    source.apply(
      {
        op: "setVariables",
        set: { zz: { type: "number", value: 1 }, aa: { type: "number", value: 2 } },
      },
      { origin: "user" },
    ),
  )

  const forward = replica()
  for (const u of updates) forward.applyUpdate(u, "remote:a")
  const reversed = replica()
  for (const u of [...updates].reverse()) reversed.applyUpdate(u, "remote:a")

  const expected = JSON.stringify(source.toDocument())
  expect(JSON.stringify(forward.toDocument())).toBe(expected)
  expect(JSON.stringify(reversed.toDocument())).toBe(expected)
  const ids = Object.keys(source.toDocument().nodes)
  expect(ids).toEqual([...ids].sort())
})
