# @kimo/design-tokens

Design tokens for the Kimo editor chrome. They are transcribed 1:1 from the design system in
`desing.pen` (boards **01 Foundations** and **02 Components**) and compiled into CSS custom
properties, a typed TypeScript map and a Tailwind v4 theme.

```ts
import "@kimo/design-tokens/editor.css"            // --kimo-* custom properties, light + dark
import { cssVar, tokenValue, tokens } from "@kimo/design-tokens"

cssVar("bg-app")                // "var(--kimo-bg-app)"
tokenValue("bg-app", "dark")    // "#0A0A0A"
```

```css
/* Tailwind v4 */
@import "tailwindcss";
@import "@kimo/design-tokens/editor.css";
@import "@kimo/design-tokens/tailwind-theme.css";
```

## Files

| Path | What |
|---|---|
| `src/tokens.json` | **Source of truth.** W3C DTCG (2025.10) format. Edit this, then run `bun run build:tokens`. |
| `src/build.ts` | Pure build functions (`collectTokens`, `buildCssEntries`, `buildTokens`). |
| `scripts/build-tokens.ts` | Writes `src/generated/*`; `--check` exits 1 when they are stale. |
| `src/generated/editor.css` | `--kimo-*` properties. Exported as `@kimo/design-tokens/editor.css`. |
| `src/generated/tokens.ts` | Typed map: name → css var, path, source `.pen` variable, declared and resolved value per mode. |
| `src/generated/tailwind-theme.css` | Tailwind v4 `@theme inline` block pointing at the `--kimo-*` properties. |

Scripts: `build:tokens`, `check:generated` (part of the root `bun run check`), `test`, `typecheck`.

## Token architecture

Three layers, each a top-level group in `tokens.json`:

1. **`primitive`**: mode-independent scales. `font` (sans, mono), `space` (1–12),
   `radius` (sm, md, lg, xl, 2xl, pill), `text` (font sizes xs–3xl), `font-weight`
   (regular 400, medium 500, semibold 600).
2. **`semantic`**: meaning-bearing tokens.
   - `color`: every color variable in the `.pen` file. This is the **only mode-dependent layer**.
   - `type`: the nine type styles of the Typography board (display, heading, title, subtitle, body,
     ui, small, caption, mono), read from each style's sample node.
   - `elevation`: `popover` and `dialog` shadows from the Elevation board (`flat` has no shadow).
3. **`component`**: per-component values from the Components board (`control` heights,
   `button`, `icon-button`, `tooltip`, `menu`). They alias primitive and semantic tokens wherever
   the `.pen` node binds a variable, and hold literals (e.g. button padding 14, gap 6) where it does not.

### Naming

A token's CSS name is its path without the layer segment, joined with `-`, prefixed `--kimo-`:
`primitive.space.4` → `--kimo-space-4`, `component.button.primary.bg` → `--kimo-button-primary-bg`.
A group marked `$extensions["kimo.flatten"]: true` contributes no segment; `semantic.color` is
flattened so color names equal the `.pen` variable names (`semantic.color.bg-app` → `--kimo-bg-app`).
Every `.pen` variable keeps its exact name: `$bg-app` in the design is `--kimo-bg-app` in code.
Typography composites expand to `--kimo-type-<style>-font-family|font-size|font-weight|letter-spacing`.

### Modes

The design has one theme axis, `mode`, with values `light` (default) and `dark`.

- A mode-dependent token's `$value` is its **light** value. `$extensions["kimo.modes"]` holds the
  value for **every** mode: `{ "light": …, "dark": … }`.
- Aliases (`"{semantic.color.accent}"`) are emitted as `var(--kimo-accent)`, so they follow the mode.
- `editor.css` puts every token on `:root` (light). Dark values apply under `[data-theme="dark"]`, and
  under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])`.
  `[data-theme="light"]` forces light on a subtree.
- Theme blocks redeclare aliases as well as literals. A custom property's `var()` resolves on the
  element that declares it, so a nested `[data-theme]` subtree has to redeclare aliases to pick up
  its own mode.

### Value encoding

- Colors use the DTCG 2025.10 object form (`colorSpace`, `components`, `alpha`, `hex`). `hex` and
  `alpha` round-trip exactly to the `.pen` value, including 8-digit hex such as `#B26A0024`.
- Dimensions are `{ "value": n, "unit": "px" }`. The `.pen` numbers are pixel values.
- Font families keep the `.pen` value (`"Inter"`). Generic fallbacks used only in code live in
  `$extensions["kimo.fallback"]`.
- `$extensions["kimo.pen"]` names the `.pen` variable a token mirrors. `kimo.penNode` names the node
  that composite and component values were read from.

## The monochrome rule

The editor is **monochrome**: ink on warm greys, pill actions, large flat cards, and shadows only on
floating surfaces (popover, dialog, menu, tooltip). **Color carries meaning, never decoration:**

| Hue | Tokens | Reserved for |
|---|---|---|
| Blue | `selection`, `selection-soft` | Canvas selection: bounds, handles, hover outlines |
| Teal → indigo | `agent`, `agent-soft`, `agent-2` | Anything the AI agent is doing (cursors, activity, the AgentMark body) |
| Persona hues | `agent-<p>`, `agent-<p>-2`, `agent-<p>-soft` for p = iris, violet, rose, ember, moss | Identity of the 2nd–6th parallel agent only (board 24 PqjaS): AgentMark body, split-mode cursor + label, session dot. Never status, diffs or selection |
| Note yellow | `note`, `note-edge`, `note-text` | Note nodes on the canvas (board 22) |
| Green / amber / red | `success*`, `warning*`, `danger*` | Status: results, warnings, errors, destructive actions |

Everything else, including primary actions, uses the neutral `accent` ink and the `bg-*`, `border*`
and `text-*` greys. Do not use a hue to make something look "primary" or "active": use `accent`,
`accent-soft` and `accent-text`. To keep this enforceable, the Tailwind theme resets Tailwind's
default palette (`--color-*: initial`), so only Kimo's color tokens exist as utilities.

## Tests

`scripts/safe-test.sh ./packages/design-tokens` checks that:

- the generated files are up to date and every token resolves in both modes;
- the dark theme blocks redeclare every mode-dependent alias;
- the build rejects unknown aliases and duplicate names;
- body text and on-accent text keep at least 4.5:1 contrast in both modes.

## Updating from the design

1. Read the variables from the design file and update `src/tokens.json` to match.
2. Run `bun run build:tokens`, then `scripts/safe-test.sh ./packages/design-tokens`.
