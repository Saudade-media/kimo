/**
 * Generates docs/scope-checklist.md from teardown section 3 (feature inventory) plus the
 * milestone mapping below. Fails on any unmapped or stale feature, so section 3 and the
 * checklist cannot drift apart.
 *
 *   bun scripts/gen-scope-checklist.ts          regenerate (keeps ticked boxes)
 *   bun scripts/gen-scope-checklist.ts --check  exit 1 if the file is stale (tick state ignored)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const target = join(root, "docs/scope-checklist.md")
const checkOnly = process.argv.includes("--check")
const md = readFileSync(`${root}/docs/teardown.md`, "utf8")
const s3 = md.slice(md.indexOf("## 3. Feature inventory"), md.indexOf("## 4. The"))
// milestone mapping per feature (teardown 8.3 + 12); [milestone, note?]
const M: Record<string, [string, string?]> = {
  "Infinite canvas, WebGL": ["M1"],
  "Frames, groups, clip": ["M1"],
  Shapes: ["M1", "rect/ellipse in M1; polygon and icon primitive with icons in M2"],
  "Pen tool": ["M2", "pen tool basics M2; boolean ops v1.x"],
  Text: ["M1", "Paragraph text M1; rich-text runs UI v1.x (`text/runs`, format reserved)"],
  "Custom fonts": ["M4"],
  Fills: [
    "M1",
    "color + image fills M1; linear/radial/angular gradients M2; mesh and shader fills v2 (non-goal v1)",
  ],
  Strokes: ["M2"],
  Effects: ["M2"],
  "Scale tool": ["v1.x"],
  "Image tools": ["Later", "unscheduled"],
  "Selection colors": ["M1"],
  "Deep select": ["M1"],
  "Snapping, pixel grid, nudge": ["M2"],
  Measurements: ["M2"],
  "Layers panel": ["M1"],
  "Light/dark UI": ["M1", "`mode` axis tokens from desing.pen land in M0 (ADR 0007)"],
  "Familiar shortcuts": ["M1"],
  "Flex layout": ["M2"],
  "Hug / Fill / Fixed": ["M2"],
  "Absolute escape hatch": ["M2"],
  "Remove layout": ["M2"],
  Wrap: ["M2"],
  Grid: ["Later", "unscheduled; Taffy evaluation"],
  "Min/max size": ["v1.x"],
  "Baseline/stretch align": ["v1.x"],
  Components: ["M3"],
  "Instances and overrides": ["M3"],
  "Full replacement": ["M3"],
  Detach: ["M3"],
  Slots: ["M3"],
  Variants: ["M3", "naming convention M3; first-class variant sets v1.x"],
  "Design libraries": [
    "M3",
    "read-only `imports` link M3; publishing workflow later (unscheduled)",
  ],
  Variables: ["M3", "composite tokens v1.x (`tokens/composite`)"],
  Themes: ["M3"],
  "CSS variable sync": [
    "M7",
    "deterministic token exporters M7; token import via `kimo_import` M5",
  ],
  "Color spaces": ["M3"],
  "Agent composer": ["M6"],
  "Permission prompts": ["M6"],
  "Token and cost display": ["M6"],
  Skills: ["M6"],
  "Parallel agents": ["M6"],
  "Let it cook": ["M6", '"iterate" mode'],
  "Agent cursors": ["M6"],
  Providers: ["M6"],
  "Hosted models": ["non-goal"],
  "Prompt / note / context nodes": ["M6", "note and prompt M6; context node later (unscheduled)"],
  "AI asset generation": ["Later", "unscheduled; job ids via `kimo_assets`"],
  "Style archetypes": ["M5", "`kimo_styles` tool M5; small original preset set"],
  "HTML export": ["M7"],
  "React / other frameworks": ["M7"],
  "Design tokens export": ["M7"],
  "Raster/PDF export": ["M7"],
  "Figma import": ["v2", "non-goal for v1"],
  "SVG / image import": ["M4"],
  "HTML / web import": ["v1.x"],
  "Browser node": ["v2", "non-goal for v1"],
  "Script nodes": ["v1.x"],
  "Shader fills": ["v2", "non-goal for v1"],
  Slides: ["v1.x", "non-goal for v1"],
  "Share link": ["non-goal", "optional self-hostable share server v2"],
  Multiplayer: ["v2", "non-goal for v1"],
  Autosave: ["M1", "IndexedDB autosave M1; atomic file autosave + recovery M4"],
  CLI: [
    "M4",
    "`kimo merge`/`gc`/`migrate` M4; headless `kimo mcp` M5; `validate`/`export`/`render` with M5/M7",
  ],
  "Embeddable editor": ["v2"],
  "UI libraries": ["Later", "unscheduled"],
}
const strip = (x: string) =>
  x
    .replace(/`\[[^\]]+\]`/g, "")
    .replace(/\s+/g, " ")
    .trim()
const out: string[] = []
const seen = new Set<string>()
const counts: Record<string, number> = {}
for (const block of s3.split(/^### /m).slice(1)) {
  const title = block.slice(0, block.indexOf("\n")).trim()
  out.push(`## ${title}`, "")
  for (const line of block.split("\n")) {
    if (!line.startsWith("| ") || line.startsWith("| Feature") || line.startsWith("|---")) continue
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim())
    const [feature, , v1, notes] = cells as [string, string, string, string]
    const m = M[feature]
    if (!m) throw new Error(`unmapped feature: ${feature}`)
    seen.add(feature)
    counts[m[0]] = (counts[m[0]] ?? 0) + 1
    const plan = m[1] ? ` · plan: ${m[1]}` : ""
    const note = strip(notes) ? ` · teardown: ${strip(notes)}` : ""
    out.push(`- [ ] **${feature}** · \`${m[0]}\` · v1: ${v1}${plan}${note}`)
  }
  out.push("")
}
const missing = Object.keys(M).filter((k) => !seen.has(k))
if (missing.length) throw new Error(`mapping has extra keys: ${missing}`)
const header = `# Scope checklist

> Derived from [teardown section 3](teardown.md#3-feature-inventory) (feature inventory, the single
> scope source), with milestones from [section 8.3](teardown.md#83-non-goals-for-v1) (non-goals)
> and [section 12](teardown.md#12-v1-milestones-and-roadmap) (roadmap). Generated 2026-10-02.
> When section 3 or 12 changes, regenerate this file (\`bun run gen:scope-checklist\`, mapping in
> \`scripts/gen-scope-checklist.ts\`) rather than editing rows by hand; tick a box
> only when the feature meets its milestone's exit criteria.

Milestone tags: \`M0\`–\`M7\` (v1 milestones), \`v1.x\`, \`v2\`, \`Later\` (after v1, not yet
scheduled in section 12), \`non-goal\` (explicitly out of scope). "v1:" repeats the teardown's
Yes / Partial / Later / No column, "plan:" is the milestone split, "teardown:" is the section 3 note. Where a feature is split across milestones, the tag is the first
milestone and the note gives the rest.

Totals: ${Object.entries(counts)
  .sort()
  .map(([k, v]) => `${k} ${v}`)
  .join(", ")} (${seen.size} features).

## M0 Foundations

These are not section 3 features but are M0's own scope (section 12).

- [ ] **bun monorepo** incl. \`apps/server\` stub and \`packages/sync\` with the local provider · \`M0\`
- [ ] **CI**: lint, typecheck, test, schema validation, \`check:generated\` · \`M0\`
- [ ] **ADRs** incl. document authority (9.4) · \`M0\` · see [adr/](adr/README.md)
- [ ] **core-schema**: TS types, JSON Schema, normative defaults table, canonical serializer, validator · \`M0\`
- [ ] **Spec v0.1 draft** published · \`M0\` · [spec/kimo-format-v0.1.md](spec/kimo-format-v0.1.md)
- [ ] **Scope checklist** generated from section 3 · \`M0\` · this file
- [ ] **Exit: round-trip property tests** (parse → serialize byte-stable) · \`M0\`
- [ ] **Exit: forward-compat test** (10.2 rule 7) · \`M0\`
- [ ] **Exit: plain-\`git merge\` conflict-rate fixtures** · \`M0\`
- [ ] **Exit: schema published** · \`M0\`

## Non-goals for v1 (section 8.3)

Hosted models, cloud sharing, real-time multiplayer, Figma \`.fig\` import, the live browser node,
shaders, mesh gradients, slides, and \`.pen\` import. \`.pen\` import from public-schema JSON is
scheduled for v1.x (section 12):

- [ ] **\`.pen\` import** (public-schema, plain-JSON files only; never decrypt) · \`v1.x\` · non-goal for v1

`
const generated = `${header + out.join("\n").trimEnd()}\n`
const current = existsSync(target) ? readFileSync(target, "utf8") : ""
/** Checkbox state is human-owned: normalize it away when comparing, carry it over when writing. */
const untick = (text: string) => text.replace(/^- \[[xX]\] /gm, "- [ ] ")
const ticked = new Set(
  current
    .split("\n")
    .filter((line) => /^- \[[xX]\] /.test(line))
    .map((line) => untick(line)),
)
const merged = generated
  .split("\n")
  .map((line) => (ticked.has(line) ? line.replace("- [ ] ", "- [x] ") : line))
  .join("\n")

if (checkOnly) {
  if (untick(current) !== generated) {
    console.error("docs/scope-checklist.md is stale; run `bun run gen:scope-checklist`.")
    process.exit(1)
  }
  console.log("docs/scope-checklist.md is up to date.")
} else {
  writeFileSync(target, merged)
  console.log(counts, seen.size)
}
