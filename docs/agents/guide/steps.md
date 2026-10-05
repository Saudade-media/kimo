<!-- Generated from packages/mcp-server/guides/guide/steps.md by scripts/gen-guides.ts. Agents read the same text with kimo_read_docs {path: "guide/steps"}. MIT licence. -->

# Building step by step

The person watches the canvas while you work, so show progress early and often, and leave the
canvas finished-looking after every call. A `kimo_apply_ops` call may insert at most 40 new
layers (`BATCH_TOO_LARGE` otherwise, nothing applied); `copy`, `instantiate`, page duplicates and
edits of existing layers are never counted. 40 is a ceiling, not a target.

## Plan, then one finished section per call

1. **Plan the sections** (Nav, Hero, Features, Pricing, Footer) before the first call.
2. **First call:** the page frame (`placeholder: true`) with its first finished section. Never
   an empty shell or empty, named section frames to fill later.
3. **One finished section per call**, with its real content, sized to what it needs (often 8 to
   25 new layers). Write a one-line note before each call ("Building the pricing section"):
   Kimo shows it as your live status. A section that needs more than 40 becomes complete
   sub-blocks, one per call (its heading row, then its card grid), each finished on its own.
4. **Fix what the result reports.** `data.problems` lists problems in the layers you just
   changed (`<id> <kind>: <fix>`: empty frame, text overflowing or clipped, zero size, outside
   its parent, missing variable, invisible shape). Fix them in the next call, before moving on.
   `kimo_render` the section and fix what looks wrong.
5. **Finish clean:** `unset` the page's `placeholder`, run `kimo_validate {check: true}` until it
   lists no problems, then reply in one to three short sentences: what changed and where.

## Writing to the person

Status lines and replies read like a colleague's chat message: plain, specific, short. Quote
layer names exactly ("Landing · Desktop"). Skip openers and closers ("Great question", "Let me
know if…"), don't narrate checks unless one found a problem, and avoid hype words (seamless,
robust, elevate, comprehensive, vibrant), emoji and em-dash asides. Bullets only for 3 or more
parallel items, bold only for names, no headings.

## Read less

Inside the Kimo app the turn context gives the `docId` and a page outline (ids, names, types,
boxes, the selected subtree in detail). Use those ids directly; query only what the outline
leaves out (field values you need to match, a truncated subtree).

## Reuse, don't regenerate

Content that already exists is copied, never written out again. A variant, an alternative, a
restructure or "the same page with …" starts with one `copy` of the existing frame or page
(any number of layers, never limited), then only the new or changed parts are edited.

"Create a variant of this page with a pricing table" (the outline says the Home frame is
`Home0001` at 0,0 1440×3200 and its 4th child is the footer). One call copies the page next to
the original and adds the pricing section with its finished heading:

```json
[{"op":"copy","id":"Home0001","key":"v2","parent":"root",
  "set":{"name":"Home · Pricing variant","x":1540,"placeholder":true}},
 {"op":"insert","key":"pricing","parent":"@v2","index":3,
  "node":{"type":"frame","name":"Pricing","w":{"mode":"fill"},
    "layout":{"dir":"column","align":"center","gap":48,"pad":[96,24]}}},
 {"op":"insert","parent":"@pricing","node":{"type":"text","name":"Title",
   "content":"Simple pricing","style":{"size":40,"weight":700}}}]
```

`@v2/<original id>` addresses a node inside the copy in the same call; `created[]` lists
`v2/<original id>` for later calls. The next call adds the plan cards: build the first card
completely (name, price, features, button), copy it twice and edit the copies' text, well
under 40 inserts. Render once, `unset` the variant's `placeholder` and finish with
`kimo_validate {check: true}`.
