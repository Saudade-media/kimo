/** Envelope shape tests (teardown 11.2, ADR 0013 §4). */
import { describe, expect, test } from "bun:test"
import { Ajv } from "@modelcontextprotocol/server/validators/ajv"
import {
  failure,
  kimoApplyOps,
  kimoQuery,
  outputSchemaOf,
  success,
  toCallToolResult,
  toJsonSchema,
} from "../src/index"

const ajv = new Ajv({ strict: true, allErrors: true })
const rev = (seq: number) => ({ epoch: "k9", seq })

describe("envelope", () => {
  const applyOut = ajv.compile(toJsonSchema(outputSchemaOf(kimoApplyOps)))
  const queryOut = ajv.compile(toJsonSchema(outputSchemaOf(kimoQuery)))

  test("a mutating success validates against the tool's output schema", () => {
    const r = success(
      { applied: 2, inserted: 2, updated: 0, deleted: 0, notes: [] },
      "Inserted 2 nodes.",
      {
        doc: { id: "d_3f00aa11bb22cc33_k9", path: "/repo/app.kimo", dirty: true, readOnly: false },
        revision: { before: rev(42), after: rev(43) },
        ops: [{ op: "insert", id: "A1hero0001", node: { type: "frame" } }],
        inverse: [{ op: "delete", id: "A1hero0001" }],
        created: [{ key: "hero", id: "A1hero0001" }],
        changed: ["A1hero0001"],
        undoToken: "u_1",
        warnings: [{ code: "TEXT_NO_FILL", message: "Text has no fill", nodeId: "A1hero0001" }],
      },
    )
    expect(applyOut(r)).toBe(true)
    expect(r.ok).toBe(true)
  })

  test("a failure validates, is rolled back and keeps codes", () => {
    const r = failure(
      {
        code: "REVISION_CONFLICT",
        message: "Document moved on",
        detail: { kind: "revision", current: rev(45), changed: ["X1"] },
      },
      { revision: { before: rev(45), after: rev(45) } },
    )
    expect(applyOut(r)).toBe(true)
    expect(r.rolledBack).toBe(true)
    expect(r.summary).toStartWith("REVISION_CONFLICT")
  })

  test("retryable codes are flagged", () => {
    const r = failure({ code: "TIMEOUT", message: "slow" })
    expect(r.errors[0]?.retryable).toBe(true)
    expect(failure({ code: "NODE_NOT_FOUND", message: "x" }).errors[0]?.retryable).toBeUndefined()
  })

  test("unknown codes are rejected by the output schema", () => {
    const bad = {
      ok: false,
      summary: "x",
      errors: [{ code: "WAT", message: "x" }],
      rolledBack: true,
    }
    expect(applyOut(bad)).toBe(false)
  })

  test("read tools reject mutating fields", () => {
    const r = { ...success({ nodes: [], matched: 0 }, "0 nodes"), ops: [] }
    expect(queryOut(r)).toBe(false)
    expect(queryOut(success({ nodes: [], matched: 0 }, "0 nodes"))).toBe(true)
  })

  test("MCP mapping: summary first, JSON second, images after; isError on failure", () => {
    const ok = toCallToolResult(success({ images: [] }, "Rendered"), [
      { mimeType: "image/png", data: "AAAA" },
    ])
    expect(ok.content[0]).toEqual({ type: "text", text: "Rendered" })
    expect(JSON.parse((ok.content[1] as { text: string }).text).ok).toBe(true)
    expect(ok.content[2]).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" })
    expect(ok.isError).toBeUndefined()
    const bad = toCallToolResult(failure({ code: "DOCUMENT_NOT_OPEN", message: "stale" }))
    expect(bad.isError).toBe(true)
    expect(bad.structuredContent.ok).toBe(false)
  })
})
