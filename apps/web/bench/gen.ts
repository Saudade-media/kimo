/**
 * Synthetic documents for the scale benches. `generate` is self-contained (no imports, no
 * module scope) because the browser bench serializes it into the page.
 *
 * Shapes: screens (roots of ~500 nodes, auto layout cards), small (roots of 10), flat (every
 * node a root), mega (10 roots holding everything).
 */
export type BenchShape = "screens" | "small" | "flat" | "mega" | "instances"

export function generate(shape: string, N: number): Record<string, unknown> {
  type Rec = Record<string, unknown>
  const nodes: Record<string, Rec> = {}
  const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  const key = (i: number) => {
    let s = ""
    for (let k = 0; k < 5; k++) {
      s = B62[i % 62] + s
      i = Math.floor(i / 62)
    }
    return s
  }
  let count = 0
  const add = (id: string, n: Rec) => {
    nodes[id] = n
    count++
  }
  const leaf = (id: string, parent: string | null, i: number, x: number, y: number) => {
    const k = i % 5
    if (k === 4)
      add(id, {
        type: "text",
        parent,
        order: key(i),
        x,
        y,
        content: `Item ${i % 97}`,
        style: { size: 11 },
      })
    else if (k === 3)
      add(id, { type: "ellipse", parent, order: key(i), x, y, w: 40, h: 40, fill: "#2F6BFF" })
    else
      add(id, {
        type: "rect",
        parent,
        order: key(i),
        x,
        y,
        w: 42,
        h: 42,
        radius: k * 4,
        fill: k === 1 ? "#E0457B" : "#1A1A1A",
        ...(k === 2 ? { stroke: { paint: "#000000", width: 1 } } : {}),
      })
  }
  const COLS = (per: number, total: number) => Math.max(1, Math.ceil(Math.sqrt(total / per)))
  if (shape === "flat") {
    const cols = Math.ceil(Math.sqrt(N))
    for (let i = 0; i < N; i++)
      leaf(`node00${i}`, null, i, (i % cols) * 50, Math.floor(i / cols) * 50)
  } else if (shape === "small" || shape === "mega") {
    const per = shape === "small" ? 9 : Math.max(1, Math.floor(N / 10) - 1)
    const roots = Math.ceil(N / (per + 1))
    const cols = COLS(1, roots)
    const side = Math.ceil(Math.sqrt(per))
    const size = side * 50 + 8
    for (let f = 0; f < roots; f++) {
      const fid = `frame0${f}`
      add(fid, {
        type: "frame",
        parent: null,
        order: key(f),
        x: (f % cols) * (size + 20),
        y: Math.floor(f / cols) * (size + 20),
        w: size,
        h: size,
        fill: "#F4F2EE",
        clip: true,
        radius: 8,
      })
      for (let i = 0; i < per && count < N; i++)
        leaf(`${fid}n${i}`, fid, i, (i % side) * 50 + 4, Math.floor(i / side) * 50 + 4)
    }
  } else if (shape === "instances") {
    // Three components (a title in a font that is fetched, a bar, a label) and screens of 120
    // instances: some override the label, a few hold an override whose layer does not exist.
    for (let c = 0; c < 3; c++) {
      const cid = `cmpcard${c}`
      add(cid, {
        type: "frame",
        parent: null,
        order: key(c),
        x: -400,
        y: c * 120,
        component: true,
        fill: "#FFFFFF",
        radius: 8,
        layout: { dir: "column", gap: 4, pad: 8 },
      })
      add(`${cid}t`, {
        type: "text",
        parent: cid,
        order: key(0),
        content: `Card ${c}`,
        style: { font: "Fraunces", size: 16, weight: 600 },
      })
      add(`${cid}b`, { type: "rect", parent: cid, order: key(1), w: 96, h: 8, fill: "#2F6BFF" })
      add(`${cid}l`, {
        type: "text",
        parent: cid,
        order: key(2),
        content: "Label",
        style: { size: 11 },
      })
    }
    const PER = 120
    const roots = Math.ceil((N - count) / (PER + 1))
    const cols = COLS(1, roots)
    for (let f = 0; f < roots && count < N; f++) {
      const fid = `screen${f}`
      add(fid, {
        type: "frame",
        parent: null,
        order: key(f + 3),
        x: (f % cols) * 1540,
        y: Math.floor(f / cols) * 1100,
        w: 1440,
        h: 1000,
        fill: "#F4F2EE",
        clip: true,
        layout: { dir: "row", gap: 8, pad: 16, wrap: true },
      })
      for (let k = 0; k < PER && count < N; k++) {
        const c = k % 3
        const overrides =
          k % 50 === 49
            ? { missing00: { set: { fill: "#FF0000" } } }
            : k % 4 === 0
              ? { [`cmpcard${c}l`]: { set: { content: `Label ${k}` } } }
              : undefined
        add(`${fid}i${k}`, {
          type: "instance",
          parent: fid,
          order: key(k),
          of: `cmpcard${c}`,
          ...(overrides ? { overrides } : {}),
        })
      }
    }
  } else {
    // screens: frame 1440 wide, a wrapping row of 20 auto layout cards, each a title + 7 rows of
    // (icon, label, badge) = 1 + 20 * (2 + 7 * 4) = 601 nodes... trimmed to ~500 with 6 rows.
    const CARDS = 19
    const ROWS = 6
    const per = 1 + CARDS * (2 + ROWS * 4)
    const roots = Math.ceil(N / per)
    const cols = COLS(1, roots)
    for (let f = 0; f < roots && count < N; f++) {
      const fid = `screen${f}`
      add(fid, {
        type: "frame",
        parent: null,
        order: key(f),
        x: (f % cols) * 1540,
        y: Math.floor(f / cols) * 1100,
        w: 1440,
        h: 1000,
        fill: "#F4F2EE",
        clip: true,
        layout: { dir: "row", wrap: true, gap: 16, crossGap: 16, pad: 32 },
      })
      for (let c = 0; c < CARDS && count < N; c++) {
        const card = `${fid}c${c}`
        add(card, {
          type: "frame",
          parent: fid,
          order: key(c),
          w: 260,
          fill: "#FFFFFF",
          radius: 12,
          layout: { dir: "column", gap: 6, pad: [12, 16] },
        })
        add(`${card}t`, {
          type: "text",
          parent: card,
          order: key(0),
          content: `Card ${c}`,
          style: { size: 16 },
        })
        for (let r = 0; r < ROWS && count < N; r++) {
          const row = `${card}r${r}`
          add(row, {
            type: "frame",
            parent: card,
            order: key(r + 1),
            w: { mode: "fill" },
            layout: { dir: "row", gap: 4, align: "center" },
          })
          add(`${row}i`, {
            type: "ellipse",
            parent: row,
            order: key(0),
            w: 12,
            h: 12,
            fill: "#2F6BFF",
          })
          add(`${row}x`, {
            type: "text",
            parent: row,
            order: key(1),
            content: `Row ${r} label`,
            grow: "fixed-width",
            w: { mode: "fill" },
            style: { size: 11 },
          })
          add(`${row}b`, {
            type: "rect",
            parent: row,
            order: key(2),
            w: 24,
            h: 12,
            radius: 6,
            fill: "#E0457B",
          })
        }
      }
    }
  }

  return {
    $schema: "https://getkimo.design/schema/kimo-1.0.json",
    format: "1.0.0",
    features: ["layout/wrap"],
    nodes,
  }
}
