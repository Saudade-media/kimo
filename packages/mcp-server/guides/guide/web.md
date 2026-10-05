<!-- related: layout, components, tokens -->
# Designing web pages

## Setup

1. `kimo_get_state`, then `kimo_get_variables` and `kimo_list_components`. Reuse what exists:
   colors, type scale, spacing, buttons.
2. `kimo_find_space {docId, w:1440, h:900}` for a free spot.
3. Plan the sections. The first call inserts the page frame (`w:1440`, `h:{"mode":"fit"}`,
   `layout:{dir:"column"}`, a background fill, `placeholder:true`) together with its first
   finished section, never empty section frames to fill later. A variant of an existing page
   starts with one `copy` of that page instead.

## Section by section

Build one finished section per call (the new-layer limit, 40 or 150 when streamed, is a
ceiling, not a target; more fails with `BATCH_TOO_LARGE`). A bigger section becomes complete
sub-blocks, one per call. Write a one-line note before each call ("Building the pricing
section"), fix what `data.problems` reports, pass `render: true` on the call that finishes the
section, then continue:

- **Section frame:** `w:{"mode":"fill"}`, `layout:{dir:"column", align:"center", pad:[96,24]}`.
- **Content column** inside it: fixed `w:1200` (or 1120/960), `layout:{dir:"column", gap:24}`.
  Children use `w:{"mode":"fill"}`.
- **Grids** of cards: a row frame with `gap:24` and children `w:{"mode":"fill"}`. Use
  `wrap:true` (feature `layout/wrap`) only when the count varies.
- **Nav bar:** row, `justify:"between"`, `align:"center"`, `pad:[20,40]`.

## Sizing defaults that read well

- Type: hero 56–72 / h2 36–44 / h3 24 / body 16–18 / small 14. Line height 1.1–1.2 for
  headings, 1.5 for body.
- Spacing: a 4 or 8 px scale. 96–128 between sections, 24–48 inside them.
- Max text width for paragraphs: 640–720 px (`grow:"fixed-width"` with a fixed `w`).
- Buttons: height around 44–48 (pad `[12,20]`), radius consistent with the cards.

## Finish

1. Render the whole page at `maxSize` 1600 to check rhythm and alignment.
2. `kimo_validate {check: true}`, and fix lints and problems until it lists none.
3. `update {id:page, unset:["placeholder"]}`.
4. Turn repeated parts (cards, buttons, footer columns) into components if the user will
   iterate on them.
