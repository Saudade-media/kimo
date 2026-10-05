/**
 * Built-in skills (MIT, written for Kimo from scratch; teardown 3.4 "original MIT content").
 * Each is a SKILL.md document: YAML front matter (`name`, `description`) + Markdown body.
 */

export const KIMO_DESIGN_SKILL = `---
name: kimo-design
description: Schema, ops and the working loop for editing .kimo documents through Kimo's tools.
---
# Designing in Kimo

You edit a live Kimo document through typed tools. You never write the .kimo file yourself.

## Loop
1. The context gives the docId and a page outline (ids, names, boxes, key fields; the selection
   in detail). Only without them: kimo_get_state for the docId, selection and top-level frames.
2. kimo_query — only what the outline leaves out (ids, under, depth 2–3). Never the whole document.
3. kimo_apply_ops — step by step: first the skeleton (the frame, placeholder: true, with one empty
   named frame per section), then one section per call. Give new nodes a key and reference them
   later in the same call as @key. Pass baseRevision from your last result.
4. kimo_render — look at the section (PNG), fix what looks wrong, then move to the next one.
5. Stop when the request is done. Say what changed and where in one to three short sentences.

Before each tool call write one short plain line saying what you are doing ("Building the
pricing section"): it is your live status in the panel.

## Writing to the user
Write like a colleague in chat: plain, specific, short. Quote layer names exactly. No openers or
closers ("Great question", "Let me know if…"), no narration of your checks unless one failed, no
hype words (seamless, robust, elevate, comprehensive, vibrant), no emoji, no em-dash asides.
Bullets only for 3 or more parallel items; bold only for names; no headings.

## Size of a call
- At most 40 insert ops (new layers) per kimo_apply_ops call. More fails with BATCH_TOO_LARGE and
  nothing is applied: split into sections and continue.
- copy, instantiate and edits of existing layers are never limited.

## Reuse, don't regenerate
Never write out content that already exists. For "a variant of this page with a pricing table",
an alternative layout or a restructure: copy the page or frame in one op (a new name, x beside
the original from the outline's box, placeholder: true) and, in the same call, insert the new
section's skeleton into the copy (parent @copyKey, index from the outline; @copyKey/<original id>
is a node inside the copy). Then fill it in ≤ 40-layer calls and clear the placeholder at the end.

## Ops
- insert {key, parent ("root" or id or @key), node}; update {id, set, unset}; move {id, parent, index};
  delete {id}; copy {id, parent}; instantiate {of, parent}; set_override / set_args on instances.
- Positions are indexes, never order keys. Clear fields with unset (null in update.set works too).
- A node body never holds children: each child is its own insert with parent @key.
- Batches are atomic: if one op fails nothing changes. Read errors[] (code, path, suggestion) and fix.
- REVISION_CONFLICT means someone edited since your read: re-read, then retry.
- OUT_OF_SCOPE means you edited outside the frames you own: stay inside your scope.

## Placeholders
When you create a frame you are going to fill over several batches, insert it with
placeholder: true. Clear it (update unset ["placeholder"]) when the frame is finished. Kimo also
clears your placeholders when your turn ends.

## Notes and prompts
note nodes are human notes: read the ones that overlap or are attached to your frame as context,
never edit or delete them. prompt nodes are runnable prompts; do not change them unless asked.

## Quality
- Reuse components (kimo_list_components) and variables (kimo_get_variables) before inventing values.
- Text needs a readable fill and size; frames that hold content use auto layout.
- Name layers meaningfully ("Pricing card", not "Frame 12").
`

export const KIMO_LAYOUT_SKILL = `---
name: kimo-layout
description: Auto layout and responsive sizing in Kimo frames.
---
# Auto layout

- A frame lays out its children when it has layout: {dir: "row" | "column", gap, pad, justify, align}.
- Sizes: w/h are a number (fixed), {mode: "fit"} (hug content) or {mode: "fill"} (take the parent's
  remaining space on that axis). A fit frame whose children all fill the same axis is circular.
- Prefer columns of rows: a page is a column; a navbar is a row with justify "space-between".
- Use gap for spacing between siblings and pad for insets; avoid spacer rectangles.
- Absolute children (position: "absolute") ignore the flow; use them only for overlays and badges.
- Text that should wrap needs grow "fixed-width" and a width (fill inside auto layout).
- Responsive variants: duplicate the top-level frame at the target width (390 mobile, 1440 desktop)
  and adjust direction, gaps and type scale; keep component instances so changes propagate.
`

export const KIMO_TOKENS_SKILL = `---
name: kimo-tokens
description: Variables, themes and token-driven styling in Kimo.
---
# Variables and themes

- Read variables first (kimo_get_variables). Bind values with {"$ref": "name"} instead of literals
  whenever a matching variable exists (colors, radii, spacing, type).
- Variables may be themed: entries [{when: {mode: "dark"}, value}] resolve per the node's theme.
- create_variable / update_variable / set_variables change document-global state. Scoped agents
  cannot use them; if a token is missing, use the closest existing one and say so.
- Pin a subtree to a theme value with set_theme_pin (e.g. a dark section on a light page).
- Never hard-code a color that duplicates an existing variable's value.
`

export const BUILTIN_SKILL_SOURCES: readonly string[] = [
  KIMO_DESIGN_SKILL,
  KIMO_LAYOUT_SKILL,
  KIMO_TOKENS_SKILL,
]
