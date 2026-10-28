import { describe, expect, test } from "bun:test"
import { registryToolSpecs } from "../src/toolhost"

describe("tool registry exposure", () => {
  test("the agent sees the registry in order, minus excluded tools", () => {
    const specs = registryToolSpecs("desktop")
    expect(specs[0]?.name).toBe("kimo_get_state")
    expect(specs.some((s) => s.name === "kimo_script")).toBe(true)
    expect(specs.every((s) => (s.inputSchema as { type: string }).type === "object")).toBe(true)
    expect(registryToolSpecs("desktop", ["kimo_save"]).some((s) => s.name === "kimo_save")).toBe(
      false,
    )
  })
})
