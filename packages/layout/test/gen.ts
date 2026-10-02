import fc from "fast-check"
import type { LayoutNodeData } from "../src/index"

export type Table = Record<string, LayoutNodeData>

// --- Arbitraries ----------------------------------------------------------------------------

export const size = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 200 }) },
  {
    weight: 2,
    arbitrary: fc.record(
      { mode: fc.constant("fit"), fallback: fc.integer({ min: 0, max: 80 }) },
      { requiredKeys: ["mode"] },
    ),
  },
  {
    weight: 2,
    arbitrary: fc.record(
      {
        mode: fc.constant("fill"),
        weight: fc.integer({ min: 1, max: 3 }),
        fallback: fc.integer({ min: 0, max: 80 }),
      },
      { requiredKeys: ["mode"] },
    ),
  },
)

const pad = fc.oneof(
  fc.integer({ min: 0, max: 12 }),
  fc.tuple(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 12 })),
  fc.tuple(...Array.from({ length: 4 }, () => fc.integer({ min: 0, max: 12 }))),
)

export const layout = (opts: { negativeGap: boolean; wrap: boolean }) =>
  fc.record(
    {
      dir: fc.constantFrom("row", "column"),
      gap: fc.integer({ min: opts.negativeGap ? -10 : 0, max: 20 }),
      pad,
      justify: fc.constantFrom("start", "center", "end", "between", "around", "evenly"),
      align: fc.constantFrom("start", "center", "end", "stretch"),
      wrap: opts.wrap ? fc.boolean() : fc.constant(false),
    },
    { requiredKeys: ["dir"] },
  )

export const words = fc
  .array(fc.constantFrom("a", "bb", "ccc", "dddd", "e\nf"), { minLength: 0, maxLength: 6 })
  .map((w) => w.join(" "))

type Kind = "frame" | "layout" | "group" | "rect" | "text"
const kinds: Kind[] = ["frame", "layout", "layout", "group", "rect", "rect", "text"]

const nodeSpec = (opts: { negativeGap: boolean; wrap: boolean }) =>
  fc.record({
    kind: fc.constantFrom(...kinds),
    parent: fc.nat(),
    w: size,
    h: size,
    x: fc.integer({ min: -50, max: 200 }),
    y: fc.integer({ min: -50, max: 200 }),
    layout: layout(opts),
    hidden: fc.integer({ min: 0, max: 9 }).map((v) => v === 0),
    absolute: fc.integer({ min: 0, max: 7 }).map((v) => v === 0),
    rotation: fc.constantFrom(0, 0, 0, 90, 30),
    content: words,
    grow: fc.constantFrom("auto", "fixed-width", "fixed"),
  })

type Spec = {
  kind: Kind
  parent: number
  w: unknown
  h: unknown
  x: number
  y: number
  layout: Record<string, unknown>
  hidden: boolean
  absolute: boolean
  rotation: number
  content: string
  grow: string
}

/** Turns generated specs into a node table (parents are earlier containers, or roots). */
export function toTable(specs: readonly Spec[]): Table {
  const table: Table = {}
  const containers: string[] = []
  specs.forEach((s, i) => {
    const id = `n${String(i).padStart(4, "0")}`
    const pi = s.parent % (containers.length + 2)
    const parent = pi < containers.length ? (containers[pi] as string) : null
    const n: Record<string, unknown> = {
      type: s.kind === "layout" ? "frame" : s.kind,
      parent,
      order: `a${String(i).padStart(4, "0")}`,
      x: s.x,
      y: s.y,
    }
    if (s.hidden) n.visible = false
    if (s.absolute) n.position = "absolute"
    if (s.rotation) n.rotation = s.rotation
    if (s.kind === "layout") n.layout = s.layout
    if (s.kind === "rect" || s.kind === "frame" || s.kind === "layout") {
      n.w = s.w
      n.h = s.h
    }
    if (s.kind === "text") {
      n.content = s.content
      n.style = { size: 10 }
      n.grow = s.grow
      n.w = s.w
      n.h = s.h
    }
    table[id] = n as LayoutNodeData
    if (s.kind !== "rect" && s.kind !== "text") containers.push(id)
  })
  return table
}

export const docs = (opts: { negativeGap: boolean; wrap: boolean }) =>
  fc.array(nodeSpec(opts), { minLength: 1, maxLength: 30 }).map((s) => toTable(s as Spec[]))

// --- update ≡ compute -----------------------------------------------------------------------

export type Mutation =
  | { op: "size"; pick: number; axis: "w" | "h"; size: unknown }
  | { op: "layout"; pick: number; layout: Record<string, unknown> | null }
  | { op: "visible"; pick: number }
  | { op: "absolute"; pick: number }
  | { op: "text"; pick: number; content: string }
  | { op: "move"; pick: number; to: number }
  | { op: "delete"; pick: number }
  | { op: "add"; to: number; w: unknown; h: unknown; kind: "rect" | "text" | "layout" }
  | { op: "order"; pick: number; key: string }
  | { op: "xy"; pick: number; x: number; y: number }
  | { op: "rotate"; pick: number; deg: number; flip: boolean }

export const mutation: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    op: fc.constant("size"),
    pick: fc.nat(),
    axis: fc.constantFrom("w", "h"),
    size,
  }),
  fc.record({
    op: fc.constant("layout"),
    pick: fc.nat(),
    layout: fc.option(layout({ negativeGap: true, wrap: true }), { nil: null }),
  }),
  fc.record({ op: fc.constant("visible"), pick: fc.nat() }),
  fc.record({ op: fc.constant("absolute"), pick: fc.nat() }),
  fc.record({ op: fc.constant("text"), pick: fc.nat(), content: words }),
  fc.record({ op: fc.constant("move"), pick: fc.nat(), to: fc.nat() }),
  fc.record({ op: fc.constant("delete"), pick: fc.nat() }),
  fc.record({
    op: fc.constant("add"),
    to: fc.nat(),
    w: size,
    h: size,
    kind: fc.constantFrom("rect", "text", "layout"),
  }),
  fc.record({ op: fc.constant("order"), pick: fc.nat(), key: fc.stringMatching(/^[a-z]{1,4}$/) }),
  fc.record({
    op: fc.constant("rotate"),
    pick: fc.nat(),
    deg: fc.constantFrom(0, 45, 90, -30),
    flip: fc.boolean(),
  }),
  fc.record({
    op: fc.constant("xy"),
    pick: fc.nat(),
    x: fc.integer({ min: -50, max: 200 }),
    y: fc.integer({ min: -50, max: 200 }),
  }),
) as fc.Arbitrary<Mutation>

let added = 0

/** Applies a mutation immutably; returns the new table and the dirty ids. */
export function apply(table: Table, m: Mutation): { table: Table; dirty: string[] } {
  const ids = Object.keys(table).sort()
  if (ids.length === 0 && m.op !== "add") return { table, dirty: [] }
  const pick = (i: number) => ids[i % ids.length] as string
  const containers = ids.filter((id) => {
    const t = table[id]?.type
    return t === "frame" || t === "group"
  })
  const set = (id: string, patch: Record<string, unknown>) => {
    const next = { ...(table[id] as LayoutNodeData), ...patch } as Record<string, unknown>
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k]
    return { table: { ...table, [id]: next as LayoutNodeData }, dirty: [id] }
  }
  const descendants = (id: string): Set<string> => {
    const out = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const [k, n] of Object.entries(table))
        if (!out.has(k) && n.parent !== null && out.has(n.parent)) {
          out.add(k)
          grew = true
        }
    }
    return out
  }
  switch (m.op) {
    case "size":
      return set(pick(m.pick), { [m.axis]: m.size })
    case "layout": {
      if (containers.length === 0) return { table, dirty: [] }
      const id = containers[m.pick % containers.length] as string
      if (table[id]?.type !== "frame") return { table, dirty: [] }
      return set(id, { layout: m.layout ?? undefined })
    }
    case "visible": {
      const id = pick(m.pick)
      return set(id, { visible: table[id]?.visible === false ? undefined : false })
    }
    case "absolute": {
      const id = pick(m.pick)
      return set(id, { position: table[id]?.position === "absolute" ? undefined : "absolute" })
    }
    case "text": {
      const id = pick(m.pick)
      if (table[id]?.type !== "text") return { table, dirty: [] }
      return set(id, { content: m.content })
    }
    case "rotate":
      return set(pick(m.pick), { rotation: m.deg || undefined, flipX: m.flip || undefined })
    case "xy":
      return set(pick(m.pick), { x: m.x, y: m.y })
    case "order":
      return set(pick(m.pick), { order: m.key })
    case "move": {
      const id = pick(m.pick)
      const banned = descendants(id)
      const targets = [null, ...containers.filter((c) => !banned.has(c))]
      return set(id, { parent: targets[m.to % targets.length] })
    }
    case "delete": {
      const gone = descendants(pick(m.pick))
      const next: Table = {}
      for (const [k, n] of Object.entries(table)) if (!gone.has(k)) next[k] = n
      return { table: next, dirty: [...gone] }
    }
    case "add": {
      const targets = [null, ...containers]
      const id = `x${String(added++).padStart(5, "0")}`
      const n: Record<string, unknown> = {
        type: m.kind === "layout" ? "frame" : m.kind,
        parent: targets[m.to % targets.length],
        order: `z${id}`,
        w: m.w,
        h: m.h,
      }
      if (m.kind === "layout") n.layout = { dir: "row", gap: 3 }
      if (m.kind === "text") Object.assign(n, { content: "new text", style: { size: 12 } })
      return { table: { ...table, [id]: n as LayoutNodeData }, dirty: [id] }
    }
  }
}
