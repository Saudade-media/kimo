/**
 * Writes test/fixtures/pen-components-m3.json from a Pencil dump of the M3 component roots
 * (rows `[id, name, type, x, y, w, h, fill, fontSize, fontWeight, cornerRadius, opacity]`, read
 * with resolveVariables + resolveInstances, enabled:false layers skipped, x/y relative to the
 * root), keeping exactly the nodes mapped in measure-map-m3.ts.
 *
 *   bun run scripts/m3-fixture.ts <dump.json>
 */
import { join } from "node:path"
import { MAP_M3 } from "./measure-map-m3"

type Row = [string, ...unknown[]]
const src = process.argv[2]
if (!src) throw new Error("usage: m3-fixture.ts <dump.json>")
const dump = (await Bun.file(src).json()) as Record<string, Row[]>
const nodes: Record<string, Row[]> = {}
const missing: string[] = []
for (const [root, spec] of Object.entries(MAP_M3)) {
  const rows = dump[root]
  if (!rows) {
    missing.push(root)
    continue
  }
  const want = new Set([root, ...Object.keys(spec.nodes)])
  nodes[root] = rows.filter((r) => want.has(r[0]))
  for (const id of want) if (!rows.some((r) => r[0] === id)) missing.push(`${root} › ${id}`)
}
const out = {
  $comment:
    "desing.pen 02c Components — Systems (M3) (SD9TU), read via the Pencil MCP (resolveVariables + resolveInstances, enabled:false layers skipped). Per component root: [id, name, type, x, y, w, h, fill, fontSize, fontWeight, cornerRadius, opacity], x/y relative to the root; instance descendants keyed by their path below the root. Light theme. Also the M3 composites of boards 13–15 (Variables dialog EIkIk, Library manager KBZKl, Swap popover jFlfP, Confirms i8PfIC / ysXyK / fmB2B), trimmed to the nodes mapped in scripts/measure-map-m3.ts.",
  nodes,
}
const dest = join(import.meta.dir, "..", "test", "fixtures", "pen-components-m3.json")
await Bun.write(dest, `${JSON.stringify(out, null, 2)}\n`)
console.log(
  `wrote ${dest}: ${Object.keys(nodes).length} roots, ${Object.values(nodes).flat().length} nodes`,
)
if (missing.length) {
  console.log(`mapped but not in the dump (${missing.length}):`)
  for (const m of missing) console.log(`  ${m}`)
}
