/**
 * Plain `git merge` of canonical serializations: independent edits merge cleanly into a
 * valid document, a real clash conflicts. Runs `git merge-file`, no merge driver involved.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type KimoDocument, parse, serialize, validate } from "../src/index"
import { doc, type Loose } from "./helpers"

const hasGit = Bun.spawnSync(["git", "--version"]).exitCode === 0

/** Returns [conflict count, merged text]. */
function merge(base: string, ours: string, theirs: string): [number, string] {
  const dir = mkdtempSync(join(tmpdir(), "kimo-merge-"))
  try {
    for (const [n, t] of [
      ["base", base],
      ["ours", ours],
      ["theirs", theirs],
    ] as const)
      writeFileSync(join(dir, n), t)
    const p = Bun.spawnSync([
      "git",
      "merge-file",
      "-p",
      join(dir, "ours"),
      join(dir, "base"),
      join(dir, "theirs"),
    ])
    return [p.exitCode, p.stdout.toString()]
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const frame = (order: string, extra: object = {}) => ({
  type: "frame",
  parent: "Root000001",
  order,
  ...extra,
})
const baseDoc = (): KimoDocument =>
  doc(
    {
      Root000001: {
        type: "frame",
        parent: null,
        order: "a0",
        name: "Root",
        layout: { dir: "column" },
      },
      Bnode00001: frame("a1", { name: "B" }),
      Dnode00001: frame("a2", { name: "D" }),
      Fnode00001: frame("a3", { name: "F" }),
      Hnode00001: frame("a4", { name: "H" }),
    },
    { variables: { gap: { type: "number", value: 8 }, ink: { type: "color", value: "#111" } } },
  )
const edit = (f: (d: Loose) => void): string => {
  const d = structuredClone(baseDoc()) as Loose
  f(d)
  return serialize(d)
}

type Scenario = {
  name: string
  ours: (d: Loose) => void
  theirs: (d: Loose) => void
  conflicts: number
}
const scenarios: Scenario[] = [
  {
    name: "inserts at different positions",
    ours: (d) => (d.nodes.Cnode00001 = frame("a1V", { name: "C" })),
    theirs: (d) => (d.nodes.Gnode00001 = frame("a3V", { name: "G" })),
    conflicts: 0,
  },
  {
    name: "edits to adjacent nodes",
    ours: (d) => (d.nodes.Bnode00001.name = "B2"),
    theirs: (d) => (d.nodes.Dnode00001.name = "D2"),
    conflicts: 0,
  },
  {
    name: "delete one node, edit the node two lines below it",
    ours: (d) => delete d.nodes.Dnode00001,
    theirs: (d) => (d.nodes.Hnode00001.fill = "#FF0000"),
    conflicts: 0,
  },
  {
    name: "reparent (move) one node, edit another",
    ours: (d) => Object.assign(d.nodes.Hnode00001, { parent: "Bnode00001", order: "a0" }),
    theirs: (d) => (d.nodes.Dnode00001.opacity = 0.5),
    conflicts: 0,
  },
  {
    name: "edit a variable, add a node",
    ours: (d) => (d.variables.gap.value = 12),
    theirs: (d) => (d.nodes.Enode00001 = frame("a2V", { name: "E" })),
    conflicts: 0,
  },
  {
    name: "both edit the same node (true conflict)",
    ours: (d) => (d.nodes.Dnode00001.name = "ours"),
    theirs: (d) => (d.nodes.Dnode00001.name = "theirs"),
    conflicts: 1,
  },
]

describe.skipIf(!hasGit)("plain git merge of canonical files", () => {
  const base = serialize(baseDoc())
  for (const s of scenarios) {
    test(`${s.name}: ${s.conflicts} conflict(s)`, () => {
      const [conflicts, merged] = merge(base, edit(s.ours), edit(s.theirs))
      expect(conflicts).toBe(s.conflicts)
      if (conflicts === 0) {
        // The textual merge is a canonical, valid document containing both sides' changes.
        const expected = edit((d) => {
          s.ours(d)
          s.theirs(d)
        })
        expect(merged).toBe(expected)
        expect(validate(parse(merged)).errors).toEqual([])
      }
    })
  }
})
