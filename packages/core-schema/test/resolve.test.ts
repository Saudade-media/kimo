import { describe, expect, test } from "bun:test"
import {
  defaultTextFill,
  defaultTheme,
  effectiveTheme,
  resolveVariable,
  selectThemedValue,
} from "../src/index"
import { doc, loadFixture, uiLibrary } from "./helpers"

const at = (theme: Record<string, string>) => (k: string) => theme[k]

describe("selectThemedValue (10.4 rules 3–4)", () => {
  test("plain values apply under every theme", () => {
    expect(selectThemedValue(8, at({}))).toEqual({ value: 8, matched: true })
    expect(selectThemedValue([1, 2], at({}))).toEqual({ value: [1, 2], matched: true })
  })
  test("partial `when` matches; unnamed axes are ignored", () => {
    const v = [{ value: "a", when: { mode: "dark" } }]
    expect(selectThemedValue(v, at({ mode: "dark", density: "compact" }))).toEqual({
      value: "a",
      matched: true,
    })
  })
  test("the last matching entry wins (no specificity ranking)", () => {
    const v = [
      { value: "specific", when: { mode: "dark", brand: "acme" } },
      { value: "general", when: { mode: "dark" } },
    ]
    expect(selectThemedValue(v, at({ mode: "dark", brand: "acme" })).value).toBe("general")
  })
  test("entries without `when` (or `when: {}`) are fallbacks, never candidates", () => {
    const v = [
      { value: "fallback" },
      { value: "dark", when: { mode: "dark" } },
      { value: "empty", when: {} },
    ]
    expect(selectThemedValue(v, at({ mode: "dark" }))).toEqual({ value: "dark", matched: true })
    expect(selectThemedValue(v, at({ mode: "light" }))).toEqual({ value: "empty", matched: false })
  })
  test("fallback position: first or last in the list, the last fallback is used", () => {
    const first = [{ value: "fb" }, { value: "d", when: { mode: "dark" } }]
    const last = [{ value: "d", when: { mode: "dark" } }, { value: "fb" }]
    expect(selectThemedValue(first, at({ mode: "light" }))).toEqual({ value: "fb", matched: false })
    expect(selectThemedValue(last, at({ mode: "light" }))).toEqual({ value: "fb", matched: false })
  })
  test("no candidate and no fallback: the first entry, unmatched", () => {
    const v = [
      { value: "l", when: { mode: "light" } },
      { value: "d", when: { mode: "dark" } },
    ]
    expect(selectThemedValue(v, at({ mode: "sepia" }))).toEqual({ value: "l", matched: false })
  })
  test("`when` keys may be library axes", () => {
    const v = [{ value: "x", when: { "ui:mode": "dark" } }]
    expect(selectThemedValue(v, at({ "ui:mode": "dark" })).matched).toBe(true)
  })
})

describe("effective theme (10.4 rule 1)", () => {
  const d = loadFixture("valid/themes-multi-axis.kimo")
  test("defaults are the first value of each axis", () => {
    expect(defaultTheme(d)).toEqual({ mode: "light", density: "regular", brand: "kimo" })
  })
  test("pins overwrite only their axes, inherited down the placement path", () => {
    expect(effectiveTheme(d, "Head000001")).toEqual({
      mode: "dark",
      density: "compact",
      brand: "kimo",
    })
    expect(effectiveTheme(d, "Promo00001")).toEqual({
      mode: "light",
      density: "regular",
      brand: "acme",
    })
  })
  test("instances inherit from where they are placed; library axes get library defaults", () => {
    const ex = loadFixture("valid/example-10-5.kimo")
    const libs = { ui: uiLibrary() }
    expect(effectiveTheme(ex, "F6btn00001", libs)).toEqual({ mode: "dark", "ui:mode": "light" })
    expect(effectiveTheme(ex, "D4cta00001", libs)).toEqual({ mode: "light", "ui:mode": "light" })
  })
  test("parent cycles do not hang", () => {
    const c = doc({
      A00000: { type: "frame", parent: "B00000", order: "a0" },
      B00000: { type: "frame", parent: "A00000", order: "a0" },
    })
    expect(effectiveTheme(c, "A00000")).toEqual({})
  })
})

describe("resolveVariable (10.4 rules 3–6)", () => {
  const d = loadFixture("valid/themes-multi-axis.kimo")
  test("aliases resolve recursively", () => {
    const r = resolveVariable(d, "bg-alias", { mode: "dark", density: "regular", brand: "kimo" })
    expect(r).toEqual({
      ok: true,
      value: "#0B0B0F",
      type: "color",
      matched: true,
      chain: ["bg-alias", "bg"],
    })
  })
  test("missing variables and alias cycles", () => {
    expect(resolveVariable(d, "nope", {})).toMatchObject({ ok: false, reason: "VARIABLE_MISSING" })
    const c = doc(
      {},
      {
        variables: {
          a: { type: "color", value: { $ref: "b" } },
          b: { type: "color", value: { $ref: "a" } },
        },
      },
    )
    expect(resolveVariable(c, "a", {})).toMatchObject({
      ok: false,
      reason: "VARIABLE_CYCLE",
      chain: ["a", "b", "a"],
    })
  })
  test("library variables resolve inside the library with the consumer's alias:axis values", () => {
    const ex = loadFixture("valid/example-10-5.kimo")
    const libs = { ui: uiLibrary() }
    expect(resolveVariable(ex, "ui:accent", { "ui:mode": "light" }, libs)).toMatchObject({
      ok: true,
      value: "#4F46E5",
    })
    expect(resolveVariable(ex, "ui:accent", { "ui:mode": "dark" }, libs)).toMatchObject({
      ok: true,
      value: { space: "oklch", l: 0.7, c: 0.15, h: 275 },
    })
    expect(resolveVariable(ex, "ui:accent", {}, libs)).toMatchObject({ ok: true, value: "#4F46E5" })
    expect(resolveVariable(ex, "ui:accent", {})).toMatchObject({
      ok: false,
      reason: "LIBRARY_NOT_LOADED",
    })
    expect(resolveVariable(ex, "zz:accent", {})).toMatchObject({
      ok: false,
      reason: "ALIAS_UNKNOWN",
    })
  })
})

describe("default text fill", () => {
  test("binds text/default when declared, else black", () => {
    expect(defaultTextFill(doc({}))).toBe("#000000")
    expect(
      defaultTextFill(doc({}, { variables: { "text/default": { type: "color", value: "#111" } } })),
    ).toEqual({ $ref: "text/default" })
  })
})
