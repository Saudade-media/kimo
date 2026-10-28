import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { sha256Sync } from "../src/sha256"

describe("sha256Sync", () => {
  test("matches node:crypto for empty, ASCII, UTF-8 and block-boundary inputs", () => {
    for (const s of [
      "",
      "abc",
      "héllo ✓",
      "a".repeat(55),
      "b".repeat(56),
      "c".repeat(64),
      "d".repeat(1000),
    ])
      expect(sha256Sync(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"))
  })
})
