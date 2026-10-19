import { describe, expect, test } from "bun:test"
import { createFontGuard, fontShareDecision, PACK_FONT_FAMILIES } from "../../src/mp"

describe("font policy", () => {
  test("bundled and pack families share, case and spacing insensitive", () => {
    expect(fontShareDecision({ family: "Inter", source: "bundled" })).toBe("share")
    expect(fontShareDecision({ family: " jetbrains  mono ", source: "bundled" })).toBe("share")
    for (const family of PACK_FONT_FAMILIES)
      expect(fontShareDecision({ family, source: "pack" })).toBe("share")
  })

  test("a non-pack family labelled pack is name-only", () => {
    expect(fontShareDecision({ family: "Helvetica Neue", source: "pack" })).toBe("name-only")
  })

  test("a known family name without a known source fails closed", () => {
    expect(fontShareDecision({ family: "Inter" })).toBe("name-only")
    expect(fontShareDecision({ family: "Roboto" })).toBe("name-only")
    expect(fontShareDecision({ family: "Roboto", source: "bundled" })).toBe("name-only")
  })

  test("google-sourced faces share; unknown and user files are name-only", () => {
    expect(fontShareDecision({ family: "Anybody", source: "google" })).toBe("share")
    expect(fontShareDecision({ family: "Acme Sans" })).toBe("name-only")
    expect(fontShareDecision({ family: "Inter", source: "user" })).toBe("name-only")
  })

  test("the guard filters and warns once per family", () => {
    const warned: string[][] = []
    const guard = createFontGuard((families) => warned.push(families))
    const faces = [
      { family: "Inter", weight: 400, source: "bundled" as const },
      { family: "Acme Sans", weight: 400 },
      { family: "Acme Sans", weight: 700 },
      { family: "Other Co", weight: 400 },
    ]
    expect(guard.filter(faces).map((f) => f.family)).toEqual(["Inter"])
    expect(warned).toEqual([["Acme Sans", "Other Co"]])
    guard.filter(faces)
    expect(warned.length).toBe(1)
  })
})
