# Scope checklist

> Derived from [teardown section 3](teardown.md#3-feature-inventory) (feature inventory, the single
> scope source), with milestones from [section 8.3](teardown.md#83-non-goals-for-v1) (non-goals)
> and [section 12](teardown.md#12-v1-milestones-and-roadmap) (roadmap). Generated 2026-10-02.
> When section 3 or 12 changes, regenerate this file (`bun run gen:scope-checklist`, mapping in
> `scripts/gen-scope-checklist.ts`) rather than editing rows by hand; tick a box
> only when the feature meets its milestone's exit criteria.

Milestone tags: `M0`–`M7` (v1 milestones), `v1.x`, `v2`, `Later` (after v1, not yet
scheduled in section 12), `non-goal` (explicitly out of scope). "v1:" repeats the teardown's
Yes / Partial / Later / No column, "plan:" is the milestone split, "teardown:" is the section 3 note. Where a feature is split across milestones, the tag is the first
milestone and the note gives the rest.

Totals: Later 4, M1 11, M2 10, M3 10, M4 3, M5 1, M6 9, M7 5, non-goal 2, v1.x 6, v2 5 (66 features).

## M0 Foundations

These are not section 3 features but are M0's own scope (section 12).

- [ ] **bun monorepo** incl. `apps/server` stub and `packages/sync` with the local provider · `M0`
- [ ] **CI**: lint, typecheck, test, schema validation, `check:generated` · `M0`
- [ ] **ADRs** incl. document authority (9.4) · `M0` · see [adr/](adr/README.md)
- [ ] **core-schema**: TS types, JSON Schema, normative defaults table, canonical serializer, validator · `M0`
- [ ] **Spec v0.1 draft** published · `M0` · [spec/kimo-format-v0.1.md](spec/kimo-format-v0.1.md)
- [ ] **Scope checklist** generated from section 3 · `M0` · this file
- [ ] **Exit: round-trip property tests** (parse → serialize byte-stable) · `M0`
- [ ] **Exit: forward-compat test** (10.2 rule 7) · `M0`
- [ ] **Exit: plain-`git merge` conflict-rate fixtures** · `M0`
- [ ] **Exit: schema published** · `M0`

## Non-goals for v1 (section 8.3)

Hosted models, cloud sharing, real-time multiplayer, Figma `.fig` import, the live browser node,
shaders, mesh gradients, slides, and `.pen` import. `.pen` import from public-schema JSON is
scheduled for v1.x (section 12):

- [x] **`.pen` import** (public-schema, plain-JSON files only; never decrypt) · `v1.x` · opening a `.pen` converts it to a `.kimo` beside it (`@kimo/core-schema` `importPen`)

## 3.1 Canvas and editing

- [ ] **Infinite canvas, WebGL** · `M1` · v1: Yes · teardown: CanvasKit on WebGL2 (section 9)
- [ ] **Frames, groups, clip** · `M1` · v1: Yes
- [ ] **Shapes** · `M1` · v1: Yes · plan: rect/ellipse in M1; polygon and icon primitive with icons in M2
- [ ] **Pen tool** · `M2` · v1: Yes · plan: pen tool basics M2; boolean ops v1.x · teardown: Boolean ops via Skia PathOps (Later)
- [ ] **Text** · `M1` · v1: Yes · plan: Paragraph text M1; rich-text runs UI v1.x (`text/runs`, format reserved) · teardown: Kimo adds rich-text runs (Later, format reserved in v1)
- [ ] **Custom fonts** · `M4` · v1: Yes · teardown: Fonts as content-hashed assets (M4)
- [ ] **Fills** · `M1` · v1: Partial · plan: color + image fills M1; linear/radial/angular gradients M2; mesh and shader fills v2 (non-goal v1) · teardown: v1: color, linear/radial/angular, image. Later: mesh, shader
- [ ] **Strokes** · `M2` · v1: Yes · teardown: Kimo adds dash patterns
- [ ] **Effects** · `M2` · v1: Yes · teardown: Kimo adds shadow spread
- [ ] **Scale tool** · `v1.x` · v1: Later
- [ ] **Image tools** · `Later` · v1: Later · plan: unscheduled · teardown: BYO-provider adapters only
- [ ] **Selection colors** · `M1` · v1: Yes · teardown: Same semantics, Kimo's own palette
- [ ] **Deep select** · `M1` · v1: Yes
- [ ] **Snapping, pixel grid, nudge** · `M2` · v1: Yes
- [ ] **Measurements** · `M2` · v1: Yes
- [ ] **Layers panel** · `M1` · v1: Yes
- [ ] **Light/dark UI** · `M1` · v1: Yes · plan: `mode` axis tokens from desing.pen land in M0 (ADR 0007)
- [ ] **Familiar shortcuts** · `M1` · v1: Yes

## 3.2 Layout

- [ ] **Flex layout** · `M2` · v1: Yes · teardown: Yoga
- [ ] **Hug / Fill / Fixed** · `M2` · v1: Yes · teardown: Stored as a structured object, not a string
- [ ] **Absolute escape hatch** · `M2` · v1: Yes
- [ ] **Remove layout** · `M2` · v1: Yes
- [ ] **Wrap** · `M2` · v1: Yes · teardown: Feature flag `layout/wrap`; ships in M2 (Yoga supports wrap)
- [ ] **Grid** · `Later` · v1: Later · plan: unscheduled; Taffy evaluation · teardown: Taffy evaluation
- [ ] **Min/max size** · `v1.x` · v1: Later · teardown: Schema fields exist only behind feature flag `size/min-max`
- [ ] **Baseline/stretch align** · `v1.x` · v1: Later · teardown: Schema values exist only behind feature flag `layout/stretch-baseline`; stretch is cheap with Yoga, so possibly v1.1

## 3.3 Components, variables, themes

- [ ] **Components** · `M3` · v1: Yes
- [ ] **Instances and overrides** · `M3` · v1: Yes · teardown: Same semantics, Kimo's own field names
- [ ] **Full replacement** · `M3` · v1: Yes
- [ ] **Detach** · `M3` · v1: Yes
- [ ] **Slots** · `M3` · v1: Yes
- [ ] **Variants** · `M3` · v1: Partial · plan: naming convention M3; first-class variant sets v1.x · teardown: v1 keeps naming; first-class variant sets Later
- [ ] **Design libraries** · `M3` · v1: Partial · plan: read-only `imports` link M3; publishing workflow later (unscheduled) · teardown: v1: import/link read-only libraries; publishing workflow Later
- [ ] **Variables** · `M3` · v1: Yes · plan: composite tokens v1.x (`tokens/composite`) · teardown: Kimo adds typed composites (typography, shadow, dimension) Later, behind feature flag `tokens/composite`
- [ ] **Themes** · `M3` · v1: Yes · teardown: Kimo specifies the no-match fallback
- [ ] **CSS variable sync** · `M7` · v1: Yes · plan: deterministic token exporters M7; token import via `kimo_import` M5 · teardown: Deterministic token exporter and importer
- [ ] **Color spaces** · `M3` · v1: Yes · teardown: Kimo adds OKLCH and Display-P3

## 3.4 AI and agents

- [ ] **Agent composer** · `M6` · v1: Yes
- [ ] **Permission prompts** · `M6` · v1: Yes · teardown: Canvas ops auto-approved and undoable; fs/shell/network ask
- [ ] **Token and cost display** · `M6` · v1: Yes
- [ ] **Skills** · `M6` · v1: Yes · teardown: Original MIT content
- [ ] **Parallel agents** · `M6` · v1: Partial · teardown: v1: Side by Side and Split with enforced scopes, cap configurable
- [ ] **Let it cook** · `M6` · v1: Yes · plan: "iterate" mode · teardown: Prompt template
- [ ] **Agent cursors** · `M6` · v1: Yes
- [ ] **Providers** · `M6` · v1: Yes · teardown: Anthropic default; OpenAI-compatible; Gemini; custom
- [ ] **Hosted models** · `non-goal` · v1: No · teardown: No backend
- [ ] **Prompt / note / context nodes** · `M6` · v1: Partial · plan: note and prompt M6; context node later (unscheduled) · teardown: note and prompt in v1 (M6); context Later
- [ ] **AI asset generation** · `Later` · v1: Later · plan: unscheduled; job ids via `kimo_assets` · teardown: Provider adapters; explicit job ids
- [ ] **Style archetypes** · `M5` · v1: Partial · plan: `kimo_styles` tool M5; small original preset set · teardown: A small original set in v1

## 3.5 Code, import, export, other

- [ ] **HTML export** · `M7` · v1: Yes
- [ ] **React / other frameworks** · `M7` · v1: Yes · teardown: Deterministic React+Tailwind emitter
- [ ] **Design tokens export** · `M7` · v1: Yes · teardown: W3C DTCG JSON + CSS vars + Tailwind v4 `@theme`
- [ ] **Raster/PDF export** · `M7` · v1: Yes · teardown: Plus SVG
- [ ] **Figma import** · `v2` · v1: Later · plan: non-goal for v1
- [ ] **SVG / image import** · `M4` · v1: Yes · teardown: M4; exposed to agents via `kimo_import`
- [ ] **HTML / web import** · `v1.x` · v1: Later
- [ ] **Browser node** · `v2` · v1: Later · plan: non-goal for v1 · teardown: Needs multi-webview in Tauri
- [ ] **Script nodes** · `v1.x` · v1: Later · teardown: Format reserved in v1
- [ ] **Shader fills** · `v2` · v1: Later · plan: non-goal for v1 · teardown: SkSL RuntimeEffect
- [ ] **Slides** · `v1.x` · v1: Later · plan: non-goal for v1
- [ ] **Share link** · `non-goal` · v1: No · plan: optional self-hostable share server v2 · teardown: Kimo: export `.kimoz` bundle; optional self-hosted share later
- [ ] **Multiplayer** · `v2` · v1: Later · plan: non-goal for v1 · teardown: Yjs; v2
- [ ] **Autosave** · `M1` · v1: Yes · plan: IndexedDB autosave M1; atomic file autosave + recovery M4 · teardown: Debounced atomic autosave from day one
- [ ] **CLI** · `M4` · v1: Partial · plan: `kimo merge`/`gc`/`migrate` M4; headless `kimo mcp` M5; `validate`/`export`/`render` with M5/M7 · teardown: `kimo` CLI: validate, export, render, merge, gc, mcp, migrate. No login
- [ ] **Embeddable editor** · `v2` · v1: Later
- [ ] **UI libraries** · `Later` · v1: Later · plan: unscheduled
