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
3. Name the sections (Nav, Hero, Pricing, Footer…) and start building: no long planning first.
4. kimo_script — one complete section per call: the first call makes the page frame
   (placeholder: true) with its first finished section; each later call adds one finished
   section with its real content. Insert returns a ref for later calls in the script; loops and
   small functions build repeated cards, rows and list items. kimo_apply_ops is for a few
   precise edits (new nodes get a key, referenced later in the call as @key). Pass baseRevision
   from your last result.
5. Read data.problems in the result and fix them in your next call. Pass render: true on the
   call that finishes a section (PNG, no separate kimo_render), fix what looks wrong, move on.
6. Finish with kimo_validate check: true and fix until it lists no problems. Say what changed
   and where in one to three short sentences.

Before each tool call write one short plain line saying what you are doing ("Building the
pricing section"): it is your live status in the panel.

## Writing to the user
Write like a colleague in chat: plain, specific, short. Quote layer names exactly. No openers or
closers ("Great question", "Let me know if…"), no narration of your checks unless one failed, no
hype words (seamless, robust, elevate, comprehensive, vibrant), no emoji, no em-dash asides.
Bullets only for 3 or more parallel items; bold only for names; no headings.

## Size of a call
- A call holds one finished section. When your tool input streams (Kimo's own agent, Claude
  Code in the app) its ops appear on the canvas while you write the call: a whole section per
  call, up to 150 new layers. Otherwise size it to the section (often 8 to 25), up to 40.
- The limit is a ceiling, not a target. More fails with BATCH_TOO_LARGE and nothing is applied.
  A bigger section becomes complete sub-blocks, one per call (its heading row, then its card
  grid), each finished on its own.
- A failed call returns a retryId: send {docId, retryId, edits: [{find, replace}]} with only the
  text to change instead of the whole call.
- After every call the canvas looks finished so far: never leave empty frames, placeholder-only
  boxes, half-built sections or dangling children between calls.
- copy, instantiate and edits of existing layers are never limited.

## Reuse, don't regenerate
Never write out content that already exists. For "a variant of this page with a pricing table",
an alternative layout or a restructure: copy the page or frame in one op (a new name, x beside
the original from the outline's box, placeholder: true) and, in the same call, insert the new
section into the copy with its first finished part, such as its heading (parent @copyKey, index
from the outline; @copyKey/<original id> is a node inside the copy). Then add the rest one
finished part per call and clear the placeholder at the end.

## Ops
- insert {key, parent ("root" or id or @key), node}; update {id, set, unset}; move {id, parent, index};
  delete {id}; copy {id, parent}; instantiate {of, parent}; set_override / set_args on instances.
- Positions are indexes, never order keys. Clear fields with unset (null in update.set works too).
- In kimo_apply_ops a node body never holds children: each child is its own insert with parent
  @key. In kimo_script, Insert(parent, {…, children: [nodes]}) nests them for you.
- Batches are atomic: if one op fails nothing changes. Read errors[] (code, path, suggestion) and fix.
- REVISION_CONFLICT means someone edited since your read: re-read, then retry.
- OUT_OF_SCOPE means you edited outside the frames you own: stay inside your scope.
- AREA_BUSY means another agent is working on that area (detail.holderLabel, detail.ids): work
  on another part of the document, or wait and retry later. Never edit inside its area.
- REVISION_CONFLICT with detail.kind "human-edit" means a person edited inside your area: re-read
  detail.ids, keep their changes, then continue (the retry goes through).

## Placeholders
Insert the page frame you will build over several calls with placeholder: true, never as an
empty shell: the same call adds its first finished section. Clear it (update unset
["placeholder"]) when the frame is finished. Kimo also
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
