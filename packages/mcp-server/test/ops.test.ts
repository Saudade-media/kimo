/** Wire op → editor-state op / command mapping (ADR 0013 §5). */
import { describe, expect, test } from "bun:test"
import { createEmptyDocument, importDocument, planCommand } from "@kimo/editor-state"
import { isDestructive, toCommand, toStoreOp, WIRE_OP_COMPILE, WIRE_OP_KINDS } from "../src/index"

const keys = new Map<string, string>()
const resolve = (r: string) => (r.startsWith("@") ? (keys.get(r.slice(1)) ?? r) : r)
let n = 0
const newId = () => `Gen${String(++n).padStart(7, "0")}`

describe("wire ops", () => {
  test("every kind has a compile strategy", () => {
    for (const k of WIRE_OP_KINDS) expect(WIRE_OP_COMPILE[k]).toBeDefined()
  })

  test("insert/update/move/delete map 1:1 and apply to a store", () => {
    const store = importDocument(createEmptyDocument())
    const ins = toStoreOp(
      { op: "insert", key: "hero", parent: "root", node: { type: "frame", name: "Hero" } },
      resolve,
      newId,
    )
    if (ins.op !== "insert") throw new Error("expected insert")
    keys.set("hero", ins.id as string)
    const txt = toStoreOp(
      { op: "insert", parent: "@hero", node: { type: "text", content: "Hi" } },
      resolve,
      newId,
    )
    const upd = toStoreOp({ op: "update", id: "@hero", set: { name: "Hero 2" } }, resolve, newId)
    const r = store.apply([ins, txt, upd], { origin: "mcp:claude-code.abc123" })
    expect(r.ok).toBe(true)
    expect(store.getNode(ins.id as string)?.name).toBe("Hero 2")
    const del = toStoreOp({ op: "delete", id: "@hero" }, resolve, newId)
    expect(store.apply(del, { origin: "mcp:claude-code.abc123", dryRun: true }).ok).toBe(true)
  })

  test("commands map to editor-state commands that plan", () => {
    const doc = createEmptyDocument()
    const cmd = toCommand(
      { op: "theme_axis", action: "create", axis: "mode", values: ["light", "dark"] },
      resolve,
      newId,
    )
    expect(cmd).toEqual({ cmd: "createAxis", axis: "mode", values: ["light", "dark"] })
    expect(planCommand(doc, cmd).ok).toBe(true)
  })

  test("destructive classification", () => {
    expect(isDestructive({ op: "delete", id: "Abcdef1234" })).toBe(true)
    expect(isDestructive({ op: "update", id: "Abcdef1234", set: { name: "x" } })).toBe(false)
    expect(isDestructive({ op: "set_variables", unset: ["a"] })).toBe(true)
    expect(isDestructive({ op: "set_variables", set: [] })).toBe(false)
    expect(
      isDestructive({ op: "theme_axis", action: "remove_value", axis: "mode", value: "dark" }),
    ).toBe(true)
  })
})
