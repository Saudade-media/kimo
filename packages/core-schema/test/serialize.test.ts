import { describe, expect, test } from "bun:test"
import { isCanonical, KimoParseError, parse, parseJson, serialize, validate } from "../src/index"
import { doc, readFixture } from "./helpers"

describe("canonical layout", () => {
  test("one node per line, sorted by id, leading comma, blank line between", () => {
    const text = serialize(
      doc({
        Zed0000001: { type: "text", parent: null, order: "a1", content: "z" },
        Abc0000001: { type: "frame", parent: null, order: "a0", name: "A" },
      }),
    )
    const nodes = text.slice(text.indexOf(`"nodes": {\n`) + `"nodes": {\n`.length)
    expect(nodes).toBe(
      `"Abc0000001": {"type":"frame","parent":null,"order":"a0","name":"A"}\n\n, "Zed0000001": {"type":"text","parent":null,"order":"a1","content":"z"}\n}\n}\n`,
    )
  })

  test("empty tables stay on one line", () => {
    expect(serialize(doc({}))).toBe(
      `{\n"$schema": "https://getkimo.design/schema/kimo-1.0.json",\n"format": "1.0.0",\n"nodes": {}\n}\n`,
    )
  })
})

describe("canonical key order", () => {
  test("node keys follow KEY_ORDER, unknown keys last by code unit", () => {
    const out = serialize(
      doc({
        Frame00001: {
          zeta: 1,
          fill: "#FFF",
          layout: { align: "center", dir: "row" },
          Alpha: 2,
          name: "F",
          order: "a0",
          parent: null,
          type: "frame",
        },
      }),
    )
    expect(out).toContain(
      `{"type":"frame","parent":null,"order":"a0","name":"F","fill":"#FFF","layout":{"dir":"row","align":"center"},"Alpha":2,"zeta":1}`,
    )
  })

  test("records (keys are data) sort by code unit; struct keys inside them keep KEY_ORDER", () => {
    const out = serialize(
      doc({
        Inst000001: {
          type: "instance",
          parent: null,
          order: "a0",
          of: "Comp000001",
          theme: { mode: "dark", brand: "x" },
          overrides: { b: { set: { visible: false, content: "x" } }, a: { slot: true } },
        },
      }),
    )
    expect(out).toContain(
      `"theme":{"brand":"x","mode":"dark"},"overrides":{"a":{"slot":true},"b":{"set":{"content":"x","visible":false}}}`,
    )
  })

  test("component prop declarations are a record; instance props are a struct", () => {
    const out = serialize(
      doc({
        Comp000001: {
          type: "frame",
          parent: null,
          order: "a0",
          component: {
            props: {
              zz: { target: "Text000001", type: "slot" },
              aa: { type: "slot", target: "T00000001" },
            },
          },
        },
        Inst000001: {
          type: "instance",
          parent: null,
          order: "a1",
          of: "Comp000001",
          props: { visible: false, w: 10 },
        },
      }),
    )
    expect(out).toContain(
      `"component":{"props":{"aa":{"type":"slot","target":"T00000001"},"zz":{"type":"slot","target":"Text000001"}}}`,
    )
    expect(out).toContain(`"props":{"w":10,"visible":false}`)
  })

  test("values under unknown keys and meta are ordered purely by code unit", () => {
    const out = serialize(
      doc({
        Frame00001: {
          type: "frame",
          parent: null,
          order: "a0",
          meta: { "x.y": { type: 1, a: 2 } },
          future: { type: 1, a: 2 },
        },
      }),
    )
    expect(out).toContain(`"meta":{"x.y":{"a":2,"type":1}}`)
    expect(out).toContain(`"future":{"a":2,"type":1}`)
  })

  test("header: unknown members sort after known ones, before nodes", () => {
    const out = serialize({
      nodes: {},
      zz: 1,
      aa: [1],
      format: "1.0.0",
      $schema: "https://getkimo.design/schema/kimo-1.0.json",
    })
    expect(out).toBe(
      `{\n"$schema": "https://getkimo.design/schema/kimo-1.0.json",\n"format": "1.0.0",\n"aa": [1],\n"zz": 1,\n"nodes": {}\n}\n`,
    )
  })

  test("features are sorted", () => {
    expect(serialize(doc({}, { features: ["text/runs", "layout/wrap"] }))).toContain(
      `"features": ["layout/wrap","text/runs"],`,
    )
  })
})

describe("values", () => {
  test("defaults are omitted", () => {
    const out = serialize(
      doc({
        Frame00001: {
          type: "frame",
          parent: null,
          order: "a0",
          visible: true,
          opacity: 1,
          clip: false,
          w: { mode: "fit" },
          layout: { dir: "row", gap: 0, justify: "start" },
        },
      }),
    )
    expect(out).toContain(`{"type":"frame","parent":null,"order":"a0","layout":{"dir":"row"}}`)
  })

  test("numbers use the shortest round-trip form", () => {
    const out = serialize(
      doc({
        Rect000001: { type: "rect", parent: null, order: "a0", w: 0.1 + 0.2, h: 1e21, x: -0 },
      }),
    )
    expect(out).toContain(`"x":0,"w":0.30000000000000004,"h":1e+21`)
  })

  test("non-finite numbers are rejected", () => {
    expect(() =>
      serialize(
        doc({ Rect000001: { type: "rect", parent: null, order: "a0", w: Number.NaN, h: 1 } }),
      ),
    ).toThrow(TypeError)
  })

  test("strings are JSON-escaped and stay on one line", () => {
    const out = serialize(
      doc({ Text000001: { type: "text", parent: null, order: "a0", content: 'a"b\\c\nd\u0001' } }),
    )
    expect(out).toContain(`"content":"a\\"b\\\\c\\nd\\u0001"`)
    expect(out.split("\n").filter((l) => l.includes("Text000001"))).toHaveLength(1)
  })
})

describe("parse", () => {
  test("rejects duplicate keys anywhere", () => {
    expect(() => parseJson(`{"a":{"b":1,"b":2}}`)).toThrow(KimoParseError)
  })
  test("accepts a BOM and CRLF line endings", () => {
    const text = serialize(doc({ Frame00001: { type: "frame", parent: null, order: "a0" } }))
    const crlf = `﻿${text.replace(/\n/g, "\r\n")}`
    expect(parse(crlf)).toEqual(parse(text))
    expect(serialize(parse(crlf))).toBe(text)
  })
  test("keeps __proto__ as data", () => {
    const d = parse(
      `{"format":"1.0.0","nodes":{},"__proto__":{"polluted":true}}`,
    ) as unknown as Record<string, unknown>
    expect(Object.hasOwn(d, "__proto__")).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(serialize(d)).toContain(`"__proto__": {"polluted":true}`)
  })
  test("rejects bad numbers and literals", () => {
    for (const bad of [
      `{"a":01}`,
      `{"a":.5}`,
      `{"a":tru}`,
      `{"a":1e999}`,
      `{"a":"\\x"}`,
      `{"a":"\u0001"}`,
      `{a:1}`,
      ``,
    ]) {
      expect(() => parseJson(bad)).toThrow(KimoParseError)
    }
  })
  test("rejects excessive nesting", () => {
    expect(() => parseJson(`${"[".repeat(1000)}${"]".repeat(1000)}`)).toThrow(KimoParseError)
  })
  test("isCanonical", () => {
    const text = readFixture("valid/minimal.kimo")
    expect(isCanonical(text)).toBe(true)
    expect(isCanonical(text.replace("\n}\n", "}\n"))).toBe(false)
    expect(isCanonical("not json")).toBe(false)
  })
})

describe("legacy $schema host (files written before the getkimo.design move)", () => {
  test("parse heals kimo.design to getkimo.design; the file validates and saves the new URL", () => {
    const fresh = serialize(doc({}))
    const legacy = fresh.replace(
      "https://getkimo.design/schema/kimo-1.0.json",
      "https://kimo.design/schema/kimo-1.0.json",
    )
    expect(legacy).not.toBe(fresh)
    const d = parse(legacy)
    expect(d.$schema).toBe("https://getkimo.design/schema/kimo-1.0.json")
    expect(validate(d).errors).toEqual([])
    expect(serialize(d)).toBe(fresh)
  })

  test("other hosts are left as they are", () => {
    const other = serialize(doc({})).replace(
      "https://getkimo.design/schema/kimo-1.0.json",
      "https://example.com/schema/kimo-1.0.json",
    )
    expect(parse(other).$schema).toBe("https://example.com/schema/kimo-1.0.json")
  })
})
