import { expect, test } from "bun:test"
import { deleteDependents } from "../../src/editor/m3/delete-deps"

const nodes = {
  pageA: { parent: null, type: "frame", name: "A" },
  nav: { parent: "pageA", type: "frame", component: true, name: "Nav" },
  navKid: { parent: "nav", type: "text" },
  inA: { parent: "pageA", type: "instance", of: "nav" },
  pageB: { parent: null, type: "frame", name: "B" },
  inB: { parent: "pageB", type: "instance", of: "nav" },
  plain: { parent: "pageB", type: "rect" },
}

test("deleting a main reports the instances outside the deleted subtree, not the ones inside", () => {
  const d = deleteDependents(nodes, ["pageA"])
  expect(d.instances).toEqual(["inB"])
  expect(d.components).toEqual(["Nav"])
  // Deleting both frames, or layers without a component, needs no detaching.
  expect(deleteDependents(nodes, ["pageA", "pageB"]).instances).toEqual([])
  expect(deleteDependents(nodes, ["plain"]).instances).toEqual([])
})
