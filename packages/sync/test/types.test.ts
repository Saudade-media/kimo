import { describe, expect, test } from "bun:test"
import { classifySaveError } from "../src/index"

describe("classifySaveError", () => {
  test("maps OS codes and read-back failures", () => {
    expect(classifySaveError({ code: "ENOSPC" })).toBe("DISK_FULL")
    expect(classifySaveError({ code: "EDQUOT" })).toBe("DISK_FULL")
    expect(classifySaveError({ code: "EACCES" })).toBe("PERMISSION")
    expect(classifySaveError({ code: "EROFS" })).toBe("PERMISSION")
    expect(classifySaveError({ name: "SaveVerifyError" })).toBe("READ_BACK_MISMATCH")
    expect(classifySaveError({ code: "READ_BACK_MISMATCH" })).toBe("READ_BACK_MISMATCH")
    expect(classifySaveError(new Error("boom"))).toBe("IO")
    expect(classifySaveError(null)).toBe("IO")
  })
})
