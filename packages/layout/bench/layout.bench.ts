/**
 * Layout benchmark (M1 perf gate input): a 5k-node document of cards in a wrapping page.
 * Run: `bun run --cwd packages/layout bench`. Uses the fake measurer (CanvasKit Paragraph cost
 * is the renderer's and is not included).
 */
import { createLayoutEngine, type LayoutNodeData } from "../src/index"
import { fakeMeasurer, inputFor } from "../test/helpers"

const CARDS = 100
const ROWS = 12
const table: Record<string, LayoutNodeData> = {}
let n = 0
const add = (id: string, node: Record<string, unknown>) => {
  table[id] = { order: `a${String(n++).padStart(6, "0")}`, ...node } as LayoutNodeData
}
add("page", {
  type: "frame",
  parent: null,
  w: 2400,
  layout: { dir: "row", wrap: true, gap: 16, crossGap: 16, pad: 32 },
})
for (let c = 0; c < CARDS; c++) {
  const card = `card${c}`
  add(card, {
    type: "frame",
    parent: "page",
    w: 220,
    layout: { dir: "column", gap: 6, pad: [12, 16] },
  })
  add(`${card}t`, { type: "text", parent: card, content: `Card number ${c}`, style: { size: 16 } })
  for (let r = 0; r < ROWS; r++) {
    const row = `${card}r${r}`
    add(row, {
      type: "frame",
      parent: card,
      w: { mode: "fill" },
      layout: { dir: "row", gap: 4, align: "center" },
    })
    add(`${row}i`, { type: "rect", parent: row, w: 12, h: 12 })
    add(`${row}x`, {
      type: "text",
      parent: row,
      content: `Item ${r} of card ${c} with a longer label`,
      grow: "fixed-width",
      w: { mode: "fill" },
      style: { size: 11 },
    })
    add(`${row}b`, { type: "rect", parent: row, w: 24, h: 12 })
  }
}

const count = Object.keys(table).length
const engine = createLayoutEngine()
await engine.init()

const time = (label: string, runs: number, fn: (i: number) => void) => {
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn(i)
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  const med = t[Math.floor(t.length / 2)] as number
  console.log(
    `${label.padEnd(44)} median ${med.toFixed(2).padStart(7)} ms   min ${(t[0] as number).toFixed(2)}   max ${(t[t.length - 1] as number).toFixed(2)}`,
  )
}

console.log(`nodes: ${count}`)
const cold = performance.now()
engine.compute(inputFor(table))
console.log(
  `first compute (cold JIT)                     ${(performance.now() - cold).toFixed(2)} ms`,
)
time("full compute", 20, () => engine.compute(inputFor(table)))

let t = table
time("update: one text content (re-wraps one row)", 50, (i) => {
  const id = "card50r5x"
  t = {
    ...t,
    [id]: { ...t[id], content: `Edited ${i} text that wraps a bit more` } as LayoutNodeData,
  }
  engine.update(inputFor(t), { nodes: [id] })
})
time("update: resize one card (re-flows the page)", 50, (i) => {
  const id = "card10"
  t = { ...t, [id]: { ...t[id], w: 200 + (i % 2) * 40 } as LayoutNodeData }
  engine.update(inputFor(t), { nodes: [id] })
})
time("update: move a page (root x)", 50, (i) => {
  t = { ...t, page: { ...t.page, x: i } as LayoutNodeData }
  engine.update(inputFor(t), { nodes: ["page"] })
})
console.log(`measure calls total: ${fakeMeasurer.calls}`)
engine.dispose()
