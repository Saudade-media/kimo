/** The streamed tool-input parser: every element of `ops` as soon as it closes, any chunking. */
import { describe, expect, test } from "bun:test"
import { type PartialEvent, PartialJsonObject } from "../src/partial-json"

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NASTY = [
  'he said "hi"',
  "back\\slash",
  "tab\tnew\nline",
  "ünïcödé ✓ 😀",
  "}{][,:",
  "\u0000\u001f",
  "",
]

function randomValue(r: () => number, depth: number): unknown {
  const k = Math.floor(r() * (depth > 3 ? 5 : 8))
  switch (k) {
    case 0:
      return NASTY[Math.floor(r() * NASTY.length)]
    case 1:
      return Math.round((r() - 0.5) * 1e6) / 100
    case 2:
      return r() < 0.5
    case 3:
      return null
    case 4:
      return `s${Math.floor(r() * 1000)}`
    case 5:
    case 6: {
      const o: Record<string, unknown> = {}
      const n = Math.floor(r() * 4)
      for (let i = 0; i < n; i++) o[`k${i}${NASTY[i % NASTY.length]}`] = randomValue(r, depth + 1)
      return o
    }
    default:
      return Array.from({ length: Math.floor(r() * 4) }, () => randomValue(r, depth + 1))
  }
}

function randomInput(r: () => number): Record<string, unknown> {
  const ops = Array.from({ length: Math.floor(r() * 12) }, (_, i) => {
    if (r() < 0.1) return randomValue(r, 2)
    return {
      op: "insert",
      key: `n${i}`,
      parent: i ? `@n${i - 1}` : "root",
      node: { type: "frame", name: NASTY[i % NASTY.length], extra: randomValue(r, 2) },
    }
  })
  const fields: [string, unknown][] = [
    ["docId", "d_1:abc"],
    ["ops", ops],
    ["baseRevision", { epoch: "e1", seq: Math.floor(r() * 99) }],
    ["label", NASTY[Math.floor(r() * NASTY.length)]],
    ["render", r() < 0.5],
    ["dryRun", r() < 0.5 ? null : 3.5e-7],
  ]
  // Random key order (docId may come after ops).
  fields.sort(() => r() - 0.5)
  return Object.fromEntries(fields)
}

function chunks(text: string, r: () => number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; ) {
    const n = r() < 0.3 ? 1 : 1 + Math.floor(r() * 12)
    out.push(text.slice(i, i + n))
    i += n
  }
  return out
}

function run(parts: string[]) {
  const p = new PartialJsonObject("ops")
  const events: PartialEvent[] = []
  for (const c of parts) events.push(...p.push(c))
  return { p, events }
}

describe("PartialJsonObject", () => {
  test("fuzz: random inputs, random chunking, compact and pretty JSON", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed)
      const input = randomInput(r)
      const text =
        seed % 3 === 0 ? JSON.stringify(input, null, seed % 2 ? 2 : "\t") : JSON.stringify(input)
      const { p, events } = run(chunks(text, r))
      expect(p.failed).toBe(false)
      expect(p.done).toBe(true)
      const items = events
        .filter((e) => e.kind === "item")
        .map((e) => (e as { value: unknown }).value)
      expect(items).toEqual(input.ops as unknown[])
      const fields = Object.fromEntries(
        events
          .filter((e) => e.kind === "field")
          .map((e) => [(e as { key: string }).key, (e as { value: unknown }).value]),
      )
      const { ops: _ops, ...rest } = input
      expect(fields).toEqual(rest)
      expect(events.at(-1)).toEqual({ kind: "end" })
      expect(events.find((e) => e.kind === "items_end")).toEqual({
        kind: "items_end",
        count: (input.ops as unknown[]).length,
      })
    }
  })

  test("an element is reported the moment it closes, not at the end of the call", () => {
    const p = new PartialJsonObject()
    expect(p.push('{"docId":"d1","ops":[{"op":"insert","node":{"name":"A"')).toEqual([
      { kind: "field", key: "docId", value: "d1" },
    ])
    expect(p.push("}}")).toEqual([
      { kind: "item", index: 0, value: { op: "insert", node: { name: "A" } } },
    ])
    expect(p.push(',{"op":"delete","id":"x"}')).toEqual([
      { kind: "item", index: 1, value: { op: "delete", id: "x" } },
    ])
    expect(p.count).toBe(2)
    expect(p.push('],"render":tr')).toEqual([{ kind: "items_end", count: 2 }])
    expect(p.push("ue}")).toEqual([{ kind: "field", key: "render", value: true }, { kind: "end" }])
  })

  test("escapes split across chunks never end a string early", () => {
    const text = '{"ops":[{"t":"a\\"}],\\\\"}],"docId":"d\\u0031"}'
    for (let cut = 1; cut < text.length; cut++) {
      const { p, events } = run([text.slice(0, cut), text.slice(cut)])
      expect(p.failed).toBe(false)
      expect(events).toContainEqual({ kind: "item", index: 0, value: { t: 'a"}],\\' } })
      expect(events).toContainEqual({ kind: "field", key: "docId", value: "d1" })
    }
  })

  test("input that is not an object fails without reporting anything", () => {
    for (const bad of ["[1,2]", '"ops"', "nope", '{"ops":[1}']) {
      const { p, events } = run([bad])
      expect(p.failed || !p.done).toBe(true)
      expect(
        events.filter((e) => e.kind === "item" && (e as { value: unknown }).value !== 1),
      ).toEqual([])
    }
  })
})
