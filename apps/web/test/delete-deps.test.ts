import { expect, test } from "bun:test"
import { deleteDependents, deletedRoots } from "../src/editor/m3/delete-deps"

const nodes = {
  pageA: { parent: null, type: "frame", name: "A" },
  nav: { parent: "pageA", type: "frame", component: true, name: "Nav" },
  navKid: { parent: "nav", type: "text" },
  inA: { parent: "pageA", type: "instance", of: "nav" },
  pageB: { parent: null, type: "frame", name: "B" },
  inB: { parent: "pageB", type: "instance", of: "nav" },
  plain: { parent: "pageB", type: "rect" },
}

test("instances outside the deleted subtree are reported, inside ones are not", () => {
  const d = deleteDependents(nodes, ["pageA"])
  expect(d.instances).toEqual(["inB"])
  expect(d.components).toEqual(["Nav"])
})

test("deleting both frames needs no detaching", () => {
  expect(deleteDependents(nodes, ["pageA", "pageB"]).instances).toEqual([])
})

test("deleting layers without a component needs no detaching", () => {
  expect(deleteDependents(nodes, ["plain"]).instances).toEqual([])
  expect(deleteDependents(nodes, ["inB"]).instances).toEqual([])
})

test("deletedRoots keeps only delete ops", () => {
  expect(
    deletedRoots([
      { op: "delete", id: "a" },
      { op: "set", id: "b", set: { visible: false } },
    ] as never),
  ).toEqual(["a"])
})
