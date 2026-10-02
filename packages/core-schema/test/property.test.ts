import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  applyDefaults,
  canonicalize,
  type KimoDocument,
  parse,
  serialize,
  validate,
} from "../src/index"
import { HEADER } from "./helpers"

const RUNS = Number(process.env.KIMO_PROPERTY_RUNS ?? 200)

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("")
const idArb = fc
  .array(fc.constantFrom(...BASE62), { minLength: 6, maxLength: 12 })
  .map((cs) => cs.join(""))
const orderArb = fc
  .array(fc.constantFrom(...BASE62), { minLength: 1, maxLength: 5 })
  .map((cs) => cs.join(""))
const hexArb = fc
  .tuple(
    fc.constantFrom(3, 6, 8),
    fc.array(fc.constantFrom(..."0123456789abcdefABCDEF".split("")), {
      minLength: 8,
      maxLength: 8,
    }),
  )
  .map(([n, cs]) => `#${cs.slice(0, n).join("")}`)
const unit = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
const colorLitArb = fc.oneof(
  hexArb,
  fc.record(
    {
      space: fc.constant("oklch"),
      l: unit,
      c: fc.double({ min: 0, max: 0.5, noNaN: true }),
      h: fc.double({ min: 0, max: 359.9, noNaN: true }),
    },
    { requiredKeys: ["space", "l", "c", "h"] },
  ),
  fc.record(
    { space: fc.constant("display-p3"), r: unit, g: unit, b: unit, alpha: unit },
    { requiredKeys: ["space", "r", "g", "b"] },
  ),
)
const finite = fc
  .double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true })
  .map((n) => (Object.is(n, -0) ? 0 : n))
const nonNeg = fc
  .double({ min: 0, max: 1e4, noNaN: true, noDefaultInfinity: true })
  .map((n) => (Object.is(n, -0) ? 0 : n))
const textArb = fc.string({ unit: "grapheme", maxLength: 20 })

interface Env {
  colorVars: string[]
  numberVars: string[]
}

const colorArb = (env: Env) =>
  env.colorVars.length > 0
    ? fc.oneof(
        colorLitArb,
        fc.constantFrom(...env.colorVars).map(($ref) => ({ $ref })),
      )
    : colorLitArb
const numArb = (env: Env, base: fc.Arbitrary<number>) =>
  env.numberVars.length > 0
    ? fc.oneof(
        base,
        fc.constantFrom(...env.numberVars).map(($ref) => ({ $ref })),
      )
    : base

const paintArb = (env: Env) =>
  fc.oneof(
    colorArb(env),
    fc.record(
      {
        kind: fc.constant("solid"),
        color: colorArb(env),
        blend: fc.constantFrom("normal", "multiply", "screen"),
        visible: fc.boolean(),
      },
      { requiredKeys: ["kind", "color"] },
    ),
    fc.record(
      {
        kind: fc.constantFrom("linear", "radial", "angular"),
        stops: fc.array(fc.record({ color: colorArb(env), at: unit }), {
          minLength: 2,
          maxLength: 3,
        }),
        rotation: finite,
        interpolation: fc.constantFrom("srgb", "oklab"),
      },
      { requiredKeys: ["kind", "stops"] },
    ),
  )
const sizeArb = (env: Env) =>
  fc.oneof(
    numArb(env, nonNeg),
    fc.record({ mode: fc.constant("fit"), fallback: nonNeg }, { requiredKeys: ["mode"] }),
    fc.record(
      {
        mode: fc.constant("fill"),
        fallback: nonNeg,
        weight: fc.double({ min: 0.1, max: 10, noNaN: true }),
      },
      { requiredKeys: ["mode"] },
    ),
  )
const metaArb = fc.option(
  fc.dictionary(
    fc.constantFrom("acme.a", "kimo.export.tag", "x.y-z"),
    fc.jsonValue({ maxDepth: 2 }),
    { maxKeys: 2 },
  ),
  { nil: undefined },
)

const placement = () =>
  fc.record(
    {
      name: textArb,
      x: finite,
      y: finite,
      locked: fc.boolean(),
      meta: metaArb,
      position: fc.constantFrom("auto", "absolute"),
    },
    { requiredKeys: [] },
  )
const visual = (env: Env) =>
  fc.record(
    { opacity: numArb(env, unit), rotation: finite, visible: fc.boolean(), flipX: fc.boolean() },
    { requiredKeys: [] },
  )
const graphics = (env: Env) =>
  fc.record(
    {
      fill: fc.oneof(paintArb(env), fc.array(paintArb(env), { maxLength: 2 })),
      stroke: fc.record(
        {
          paint: paintArb(env),
          width: numArb(env, nonNeg),
          align: fc.constantFrom("inside", "center", "outside"),
        },
        { requiredKeys: ["paint"] },
      ),
      effects: fc.array(
        fc.oneof(
          fc.record(
            {
              kind: fc.constant("shadow"),
              x: numArb(env, finite),
              y: finite,
              blur: nonNeg,
              spread: finite,
              color: colorArb(env),
            },
            { requiredKeys: ["kind", "x", "y", "blur", "color"] },
          ),
          fc.record({ kind: fc.constantFrom("blur", "backdrop-blur"), radius: nonNeg }),
        ),
        { maxLength: 2 },
      ),
    },
    { requiredKeys: [] },
  )

type Kind = "frame" | "group" | "rect" | "ellipse" | "text" | "icon" | "path" | "polygon" | "note"
const nodeBody = (kind: Kind, env: Env): fc.Arbitrary<Record<string, unknown>> => {
  const common = fc.tuple(placement(), visual(env))
  const merge = (...parts: object[]) => Object.assign({ type: kind }, ...parts)
  switch (kind) {
    case "frame":
      return fc
        .tuple(
          common,
          graphics(env),
          fc.record(
            {
              w: sizeArb(env),
              h: sizeArb(env),
              clip: fc.boolean(),
              radius: numArb(env, nonNeg),
              layout: fc.record(
                {
                  dir: fc.constantFrom("row", "column"),
                  gap: numArb(env, finite),
                  pad: fc.oneof(nonNeg, fc.tuple(nonNeg, nonNeg)),
                  justify: fc.constantFrom("start", "center", "between"),
                  align: fc.constantFrom("start", "center", "end"),
                },
                { requiredKeys: ["dir"] },
              ),
            },
            { requiredKeys: [] },
          ),
        )
        .map(([[p, v], g, f]) => merge(p, v, g, f))
    case "group":
      return common.map(([p, v]) => merge(p, v))
    case "rect":
      return fc
        .tuple(common, graphics(env), sizeArb(env), sizeArb(env))
        .map(([[p, v], g, w, h]) => merge(p, v, g, { w, h }))
    case "ellipse":
      return fc
        .tuple(
          common,
          graphics(env),
          nonNeg,
          nonNeg,
          fc.double({ min: 0, max: 0.99, noNaN: true }),
          fc.double({ min: -360, max: 360, noNaN: true }),
        )
        .map(([[p, v], g, w, h, innerRadius, sweepAngle]) =>
          merge(p, v, g, { w, h, innerRadius, sweepAngle }),
        )
    case "polygon":
      return fc
        .tuple(common, nonNeg, fc.integer({ min: 3, max: 12 }))
        .map(([[p, v], w, sides]) => merge(p, v, { w, h: w, sides }))
    case "path":
      return fc
        .tuple(common, graphics(env), fc.constantFrom("M0 0 L10 10", "M0 0 C1 2 3 4 5 6 Z"))
        .map(([[p, v], g, d]) => merge(p, v, g, { d }))
    case "text":
      return fc
        .tuple(
          common,
          graphics(env),
          textArb,
          fc.record(
            {
              font: fc.constantFrom("Inter", "JetBrains Mono"),
              size: fc.double({ min: 1, max: 200, noNaN: true }),
              weight: fc.integer({ min: 100, max: 900 }),
              align: fc.constantFrom("left", "center"),
            },
            { requiredKeys: [] },
          ),
          fc.constantFrom("auto", "fixed-width", "fixed"),
        )
        .map(([[p, v], g, content, style, grow]) => merge(p, v, g, { content, style, grow }))
    case "icon":
      return fc
        .tuple(
          common,
          nonNeg,
          fc.constantFrom("lucide", "phosphor", "material-rounded"),
          fc.constantFrom("bell", "x", "arrow-right"),
          colorArb(env),
        )
        .map(([[p, v], w, set, icon, color]) => merge(p, v, { w, h: w, set, icon, color }))
    case "note":
      return fc.tuple(common, textArb).map(([[p, v], content]) => merge(p, v, { content }))
  }
}

const CONTAINERS = new Set(["frame", "group"])

/** Arbitrary valid documents: a forest of nodes, variables, themes, components and instances. */
const docArb: fc.Arbitrary<KimoDocument> = fc
  .record({
    ids: fc.uniqueArray(idArb, { minLength: 0, maxLength: 14 }),
    kinds: fc.array(
      fc.constantFrom<Kind>(
        "frame",
        "frame",
        "group",
        "rect",
        "ellipse",
        "text",
        "icon",
        "path",
        "polygon",
        "note",
      ),
      { minLength: 14, maxLength: 14 },
    ),
    parentPicks: fc.array(fc.nat(), { minLength: 14, maxLength: 14 }),
    orders: fc.array(orderArb, { minLength: 14, maxLength: 14 }),
    colorVars: fc.uniqueArray(fc.constantFrom("ink", "surface", "accent", "text/default"), {
      maxLength: 3,
    }),
    numberVars: fc.uniqueArray(fc.constantFrom("space-m", "radius", "fade"), { maxLength: 2 }),
    themed: fc.boolean(),
    docMeta: fc.option(
      fc.record({ name: textArb, createdWith: fc.constant("kimo") }, { requiredKeys: [] }),
      { nil: undefined },
    ),
    seed: fc.integer(),
  })
  .chain((g) => {
    const env: Env = { colorVars: g.colorVars, numberVars: g.numberVars }
    const n = g.ids.length
    const bodies = g.ids.map((_, i) => nodeBody(g.kinds[i] as Kind, env))
    return fc
      .tuple(
        fc.tuple(...bodies),
        fc.array(colorLitArb, { minLength: 4, maxLength: 4 }),
        fc.array(fc.boolean(), { minLength: n, maxLength: n }),
        fc.array(textArb, { minLength: n, maxLength: n }),
      )
      .map(([bodyList, colors, compFlags, overrideTexts]) => {
        const nodes: Record<string, Record<string, unknown>> = {}
        const parents: (string | null)[] = []
        g.ids.forEach((id, i) => {
          const earlier = g.ids.slice(0, i).filter((_, j) => CONTAINERS.has(g.kinds[j] as string))
          const pick = g.parentPicks[i] as number
          const parent =
            earlier.length > 0 && pick % 3 !== 0 ? (earlier[pick % earlier.length] as string) : null
          parents.push(parent)
          nodes[id] = { ...(bodyList[i] as Record<string, unknown>), parent, order: g.orders[i] }
        })
        // Root frames may be components; instances of them go at the root (never inside a component).
        const components = g.ids.filter(
          (_id, i) => parents[i] === null && g.kinds[i] === "frame" && compFlags[i],
        )
        for (const c of components) (nodes[c] as Record<string, unknown>).component = true
        components.forEach((c, k) => {
          const textKid = g.ids.find((id) => nodes[id]?.parent === c && nodes[id]?.type === "text")
          const instId = `Inst${k}${c}`.slice(0, 24)
          if (nodes[instId]) return
          nodes[instId] = {
            type: "instance",
            parent: null,
            order: `z${k}`,
            of: c,
            props: { opacity: 1 },
            ...(textKid
              ? { overrides: { [textKid]: { set: { content: overrideTexts[k] ?? "" } } } }
              : {}),
          }
        })
        const variables: Record<string, unknown> = {}
        g.colorVars.forEach((name, i) => {
          variables[name] = g.themed
            ? {
                type: "color",
                value: [
                  { value: colors[i] },
                  { value: colors[(i + 1) % 4], when: { mode: "dark" } },
                  { value: colors[i], when: { mode: "light" } },
                ],
              }
            : { type: "color", value: colors[i] }
        })
        g.numberVars.forEach((name, i) => {
          variables[name] = { type: "number", value: name === "fade" ? 0.5 : i * 8 }
        })
        const d: Record<string, unknown> = { ...HEADER, nodes }
        if (g.docMeta) d.meta = g.docMeta
        if (g.themed) d.themes = { mode: ["light", "dark"] }
        if (Object.keys(variables).length > 0) d.variables = variables
        return d as unknown as KimoDocument
      })
  })

describe("property: canonical serialization", () => {
  test("generated documents are valid (no errors)", () => {
    fc.assert(
      fc.property(docArb, (d) => {
        const r = validate(d, { lints: false })
        if (!r.ok) throw new Error(JSON.stringify(r.errors.slice(0, 3)))
      }),
      { numRuns: RUNS },
    )
  })

  test("parse(serialize(doc)) deep-equals the canonical document", () => {
    fc.assert(
      fc.property(docArb, (d) => {
        expect(parse(serialize(d))).toEqual(canonicalize(d))
      }),
      { numRuns: RUNS },
    )
  })

  test("serialize(parse(s)) === s (byte-stable)", () => {
    fc.assert(
      fc.property(docArb, (d) => {
        const s = serialize(d)
        expect(serialize(parse(s))).toBe(s)
      }),
      { numRuns: RUNS },
    )
  })

  test("applying defaults does not change the bytes", () => {
    fc.assert(
      fc.property(docArb, (d) => {
        expect(serialize(applyDefaults(d))).toBe(serialize(d))
      }),
      { numRuns: RUNS },
    )
  })

  test("serialization is independent of key insertion order", () => {
    const shuffle = (v: unknown, seed: number): unknown => {
      if (Array.isArray(v)) return v.map((x) => shuffle(x, seed))
      if (v && typeof v === "object") {
        const entries = Object.entries(v as Record<string, unknown>)
        entries.sort((a, b) => ((a[0].length * 31 + seed) % 7) - ((b[0].length * 17 + seed) % 7))
        return Object.fromEntries(entries.map(([k, x]) => [k, shuffle(x, seed)]))
      }
      return v
    }
    fc.assert(
      fc.property(docArb, fc.integer(), (d, seed) => {
        expect(serialize(shuffle(d, seed) as KimoDocument)).toBe(serialize(d))
      }),
      { numRuns: RUNS },
    )
  })
})

describe("property: unknown data", () => {
  const extraArb = fc.dictionary(
    fc
      .string({ minLength: 1, maxLength: 8 })
      .filter(
        (k) =>
          ![
            "nodes",
            "variables",
            "features",
            "$schema",
            "format",
            "assets",
            "meta",
            "themes",
            "imports",
            "components",
          ].includes(k),
      ),
    fc.jsonValue({ maxDepth: 3 }),
    { maxKeys: 4 },
  )

  test("unknown header members and node fields survive a round trip byte-stably", () => {
    fc.assert(
      fc.property(
        extraArb,
        fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.jsonValue({ maxDepth: 2 }), {
          maxKeys: 3,
        }),
        (extra, nodeExtra) => {
          const d = {
            ...extra,
            ...HEADER,
            nodes: { Future0001: { ...nodeExtra, type: "sticker", parent: null, order: "a0" } },
          }
          const s = serialize(d)
          const back = parse(s)
          expect(serialize(back)).toBe(s)
          expect(back).toEqual(JSON.parse(JSON.stringify(d)))
        },
      ),
      { numRuns: RUNS },
    )
  })

  test("validate never throws", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), extraArb, (v, extra) => {
        validate(v)
        validate({ ...HEADER, ...extra, nodes: typeof v === "object" && v !== null ? v : {} })
      }),
      { numRuns: RUNS },
    )
  })
})
