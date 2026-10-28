import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  applyConflictSide,
  applyDefaults,
  canonicalize,
  type KimoDocument,
  listConflicts,
  mergeDocuments,
  parse,
  serialize,
  validate,
} from "../src/index"
import { doc, HEADER, type Loose } from "./helpers"

const RUNS = Number(process.env.KIMO_PROPERTY_RUNS ?? 100)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const errorsOf = (d: unknown) => validate(d as KimoDocument, { lints: false }).errors

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
  test("generated documents validate and round-trip byte-stably, defaults included", () => {
    fc.assert(
      fc.property(docArb, (d) => {
        const r = validate(d, { lints: false })
        if (!r.ok) throw new Error(JSON.stringify(r.errors.slice(0, 3)))
        const s = serialize(d)
        expect(parse(s)).toEqual(canonicalize(d))
        expect(serialize(parse(s))).toBe(s)
        expect(serialize(applyDefaults(d))).toBe(s)
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

// --- Property tests -------------------------------------------------------------------------------

const POOL = [
  "Node000001",
  "Node000002",
  "Node000003",
  "Node000004",
  "Node000005",
  "Node000006",
  "Node000007",
  "Node000008",
  "Node000009",
  "Node000010",
]
const NEW_IDS = ["Add0000001", "Add0000002", "Add0000003", "Add0000004"]
const COLORS = ["#111111", "#222222", "#333333", "#FFFFFF", "#E8590C"]

type MergeKind = "frame" | "rect" | "text"
const isContainer = (n: Loose) => n.type === "frame"

const mergeBaseArb: fc.Arbitrary<KimoDocument> = fc
  .record({
    n: fc.integer({ min: 2, max: POOL.length }),
    kinds: fc.array(fc.constantFrom<MergeKind>("frame", "frame", "rect", "text"), {
      minLength: POOL.length,
      maxLength: POOL.length,
    }),
    parents: fc.array(fc.nat(), { minLength: POOL.length, maxLength: POOL.length }),
    fills: fc.array(fc.constantFrom(...COLORS, "brand"), {
      minLength: POOL.length,
      maxLength: POOL.length,
    }),
    gaps: fc.array(fc.option(fc.integer({ min: 0, max: 32 }), { nil: undefined }), {
      minLength: POOL.length,
      maxLength: POOL.length,
    }),
  })
  .map((g) => {
    const nodes: Record<string, Loose> = {}
    const ids = POOL.slice(0, g.n)
    ids.forEach((id, i) => {
      const kind = i === 0 ? "frame" : (g.kinds[i] as MergeKind)
      const containers = ids.slice(0, i).filter((x) => isContainer(nodes[x]))
      const pick = g.parents[i] as number
      const parent =
        containers.length > 0 && pick % 4 !== 0 ? containers[pick % containers.length] : null
      const fillV = g.fills[i] as string
      const fill = fillV === "brand" ? { $ref: "brand" } : fillV
      const n: Loose = { type: kind, parent, order: `a${i}` }
      if (kind === "frame") {
        n.fill = fill
        if (g.gaps[i] !== undefined) n.layout = { dir: "row", gap: g.gaps[i] }
      } else if (kind === "rect") Object.assign(n, { w: 10 + i, h: 10, fill })
      else n.content = `Text ${i}`
      nodes[id] = n
    })
    return doc(nodes, {
      meta: { name: "Doc" },
      themes: { mode: ["light", "dark"] },
      variables: {
        brand: {
          type: "color",
          value: [
            { value: "#E8590C", when: { mode: "light" } },
            { value: "#FF8A3D", when: { mode: "dark" } },
          ],
        },
        space: { type: "number", value: 8 },
      },
    })
  })

type MergeEdit =
  | { k: "fill"; i: number; c: number }
  | { k: "gap"; i: number; v: number }
  | { k: "name"; i: number; v: string }
  | { k: "content"; i: number; v: string }
  | { k: "delete"; i: number }
  | { k: "add"; i: number; id: number; kind: MergeKind }
  | { k: "move"; i: number; to: number; order: string }
  | { k: "brand"; entry: number; c: number }
  | { k: "space"; v: number }
  | { k: "meta"; v: string }

const mergeEditArb: fc.Arbitrary<MergeEdit> = fc.oneof(
  fc.record({ k: fc.constant("fill" as const), i: fc.nat(), c: fc.nat() }),
  fc.record({ k: fc.constant("gap" as const), i: fc.nat(), v: fc.integer({ min: 0, max: 40 }) }),
  fc.record({ k: fc.constant("name" as const), i: fc.nat(), v: fc.constantFrom("A", "B", "C") }),
  fc.record({ k: fc.constant("content" as const), i: fc.nat(), v: fc.constantFrom("x", "y") }),
  fc.record({ k: fc.constant("delete" as const), i: fc.nat() }),
  fc.record({
    k: fc.constant("add" as const),
    i: fc.nat(),
    id: fc.nat(),
    kind: fc.constantFrom<MergeKind>("frame", "rect", "text"),
  }),
  fc.record({
    k: fc.constant("move" as const),
    i: fc.nat(),
    to: fc.nat(),
    order: fc.constantFrom("a0", "b5", "z"),
  }),
  fc.record({ k: fc.constant("brand" as const), entry: fc.nat(), c: fc.nat() }),
  fc.record({ k: fc.constant("space" as const), v: fc.integer({ min: 0, max: 20 }) }),
  fc.record({ k: fc.constant("meta" as const), v: fc.constantFrom("X", "Y") }),
)

const subtree = (nodes: Record<string, Loose>, root: string): string[] => {
  const out = [root]
  for (let i = 0; i < out.length; i++)
    for (const [id, n] of Object.entries(nodes)) if (n.parent === out[i]) out.push(id)
  return out
}

/**
 * Applies edits to a copy of `d`, touching only `scope` (node ids it may edit, or null = any)
 * and the variables/meta when `header` is set. Keeps the document valid.
 */
function applyEdits(
  d: KimoDocument,
  edits: MergeEdit[],
  scope: Set<string> | null,
  header: boolean,
  addIds: string[],
): KimoDocument {
  const out = clone(d) as Loose
  const nodes = out.nodes as Record<string, Loose>
  const ids = () => Object.keys(nodes).filter((id) => scope === null || scope.has(id))
  for (const e of edits) {
    const list = ids()
    const pick = (i: number) => (list.length > 0 ? list[i % list.length] : undefined)
    switch (e.k) {
      case "fill": {
        const id = pick(e.i)
        if (id && nodes[id].type !== "text") nodes[id].fill = COLORS[e.c % COLORS.length]
        break
      }
      case "gap": {
        const id = pick(e.i)
        if (id && nodes[id].type === "frame")
          nodes[id].layout = { ...(nodes[id].layout ?? { dir: "row" }), gap: e.v }
        break
      }
      case "name": {
        const id = pick(e.i)
        if (id) nodes[id].name = e.v
        break
      }
      case "content": {
        const id = pick(e.i)
        if (id && nodes[id].type === "text") nodes[id].content = e.v
        break
      }
      case "delete": {
        const id = pick(e.i)
        if (!id) break
        const sub = subtree(nodes, id)
        if (scope && sub.some((x) => !scope.has(x))) break
        for (const x of sub) delete nodes[x]
        break
      }
      case "add": {
        const id = addIds[e.id % addIds.length] as string
        if (nodes[id]) break
        const containers = list.filter((x) => nodes[x].type === "frame")
        const parent = containers.length > 0 ? containers[e.i % containers.length] : null
        if (scope && parent === null) break
        nodes[id] =
          e.kind === "frame"
            ? { type: "frame", parent, order: "m0" }
            : e.kind === "rect"
              ? { type: "rect", parent, order: "m0", w: 3, h: 3 }
              : { type: "text", parent, order: "m0", content: "new" }
        scope?.add(id)
        break
      }
      case "move": {
        const id = pick(e.i)
        if (!id) break
        const targets = list.filter((x) => nodes[x].type === "frame")
        const to = targets.length > 0 ? targets[e.to % targets.length] : undefined
        if (!to || subtree(nodes, id).includes(to)) break
        nodes[id].parent = to
        nodes[id].order = e.order
        break
      }
      case "brand":
        if (header) out.variables.brand.value[e.entry % 2].value = COLORS[e.c % COLORS.length]
        break
      case "space":
        if (header) out.variables.space.value = e.v
        break
      case "meta":
        if (header) out.meta.name = e.v
        break
    }
  }
  return out as KimoDocument
}

const mergeEditsArb = fc.array(mergeEditArb, { maxLength: 6 })

describe("property: three-way merge", () => {
  test("random base + two edit sequences: the result validates and its conflicts apply", () => {
    fc.assert(
      fc.property(mergeBaseArb, mergeEditsArb, mergeEditsArb, (base, ea, eb) => {
        const ours = applyEdits(base, ea, null, true, NEW_IDS.slice(0, 2))
        const theirs = applyEdits(base, eb, null, true, NEW_IDS.slice(1))
        fc.pre(errorsOf(ours).length === 0 && errorsOf(theirs).length === 0)
        const r = mergeDocuments({ base, ours, theirs })
        const errors = errorsOf(r.doc)
        if (errors.length > 0) throw new Error(JSON.stringify(errors.slice(0, 3)))
        expect(serialize(canonicalize(r.doc))).toBe(serialize(r.doc))
        // Every stored side can be applied (or is refused cleanly).
        for (const { id } of listConflicts(r.doc)) {
          for (const side of ["ours", "theirs", "base"] as const) {
            try {
              applyConflictSide(r.doc, id, side)
            } catch (e) {
              if ((e as { code?: string }).code !== "CANNOT_APPLY") throw e
            }
          }
        }
      }),
      { numRuns: RUNS },
    )
  })

  test("a side equal to the base or to the other side merges to the other without conflicts", () => {
    fc.assert(
      fc.property(mergeBaseArb, mergeEditsArb, (base, ea) => {
        const a = applyEdits(base, ea, null, true, NEW_IDS)
        fc.pre(errorsOf(a).length === 0)
        const same = (r: { doc: KimoDocument; conflicts: object }) => {
          expect(r.conflicts).toEqual({})
          expect(serialize(r.doc)).toBe(serialize(a))
        }
        same(mergeDocuments({ base, ours: a, theirs: a }))
        same(mergeDocuments({ base, ours: a, theirs: base }))
        same(mergeDocuments({ base, ours: base, theirs: a }))
      }),
      { numRuns: RUNS },
    )
  })

  test("clean merges of disjoint edits commute (and equal applying both)", () => {
    fc.assert(
      fc.property(
        mergeBaseArb,
        mergeEditsArb,
        mergeEditsArb,
        fc.boolean(),
        (base, ea, eb, headerToA) => {
          const nodes = (base as Loose).nodes as Record<string, Loose>
          // Partition by root subtree.
          const roots = Object.keys(nodes)
            .filter((id) => nodes[id].parent === null)
            .sort()
          const sa = new Set<string>()
          const sb = new Set<string>()
          roots.forEach((r, i) => {
            for (const x of subtree(nodes, r)) (i % 2 === 0 ? sa : sb).add(x)
          })
          const sbFirst = new Set(sb)
          const ours = applyEdits(base, ea, sa, headerToA, NEW_IDS.slice(0, 2))
          const theirs = applyEdits(base, eb, sb, !headerToA, NEW_IDS.slice(2))
          fc.pre(errorsOf(ours).length === 0 && errorsOf(theirs).length === 0)
          const ab = mergeDocuments({ base, ours, theirs })
          const ba = mergeDocuments({ base, ours: theirs, theirs: ours })
          expect(ab.conflicts).toEqual({})
          expect(ba.conflicts).toEqual({})
          expect(serialize(ab.doc)).toBe(serialize(ba.doc))
          expect(ab.changes).toBe(ba.changes)
          // Applying both edit sequences one after the other gives the same document.
          const both = applyEdits(ours, eb, sbFirst, !headerToA, NEW_IDS.slice(2))
          expect(serialize(ab.doc)).toBe(serialize(both))
        },
      ),
      { numRuns: RUNS },
    )
  })
})
