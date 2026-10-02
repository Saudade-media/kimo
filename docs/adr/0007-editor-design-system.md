# 0007. Editor design system: monochrome, tokens transcribed from `desing.pen`

- **Status:** Accepted
- **Date:** 2026-10-02 (decision recorded in teardown 9.4 on the same date)
- **Teardown refs:** 9.4 (editor design system), 9.1 (`design-tokens`, `ui`), 3.1 (selection colors, light/dark UI), 8.1 principle 8

## Context

The editor chrome is the frame around users' designs. It must not compete with their colors, it
must make AI activity and canvas selection unmistakable, and it needs a single source of truth
that designers can iterate on visually while code stays in sync without hand-copying values.

## Decision

1. **Source of truth: `desing.pen`** at the repo root, boards 01 Foundations, 02 Components,
   03–05 Editor (light / agent / dark), 06 Home and 07 Export dialog. Until Kimo can open its own
   design, this file is edited with pen.dev/Pencil and read by tooling only through the Pencil MCP
   (it is not hand-edited or parsed directly).
2. **Aesthetic: monochrome, inspired by x.ai / bot.** Ink on warm greys, pill-shaped actions, big
   flat cards, mostly no shadows. Type: Inter for UI, JetBrains Mono for values and code, 13 px UI
   base size.
3. **Color is reserved for meaning:**
   - `selection` (blue): canvas selection and related affordances;
   - `agent` (teal plus a gradient orb): anything the AI is doing;
   - status colors (success, warning, danger).
   Nothing else in the chrome uses hue.
4. **Token architecture:** primitive → semantic → component layers with a **single theme axis,
   `mode`** (`light` / `dark`). No brand or density axes in the editor's own tokens.
5. **Transcribed 1:1, then generated.** The variables in `desing.pen` are transcribed into
   `packages/design-tokens/src/tokens.json` (W3C DTCG) and verified by tests against a snapshot
   of the Pencil MCP's `GetVariables()` (`test/fixtures/pen-variables.json`). The editor's CSS
   variables and TS constants are generated from `tokens.json`; `packages/ui` components consume
   only those tokens. Generated files are committed and verified by `check:generated`. Hand-edits
   to generated files are not allowed. Because tooling cannot read `desing.pen` in CI, a design
   change is only caught once the snapshot is refreshed (see CONTRIBUTING, "Design changes").
6. Canvas selection semantics follow pen.dev's convention (normal, component origin, instance)
   but use Kimo's own palette (3.1).

## Consequences

- Users' designs are the only colorful thing on screen; agent activity is recognizable at a glance.
- Every visual change to the chrome starts in `desing.pen` and lands as a regenerated token diff
  plus component changes (see CONTRIBUTING).
- The project depends on a proprietary tool for its own design source during bootstrap. This is
  stated in the README and ends when Kimo can open the design (target: after M3, when components
  and variables land); the migration then moves the source to a `.kimo` file.
- Adding a second theme axis later would be a new ADR.

## Alternatives considered

- **Hand-written CSS variables in code:** fast to start, but drifts from the design immediately.
- **A colorful brand-led chrome:** competes with user content and dilutes the meaning of selection
  and agent colors.
- **An off-the-shelf component kit (Radix Themes, shadcn defaults):** quick, but not monochrome by
  default and not generated from our design source; primitives may still be used underneath.

## Revisit when

Kimo can open and edit its own design file, or a second theme axis is requested.
