<!-- related: ops, guide/web, errors -->
# Building step by step

The person watches the canvas while you work, so show progress early and often. A
`kimo_apply_ops` call may insert at most 40 new layers (`BATCH_TOO_LARGE` otherwise, nothing
applied); `copy`, `instantiate`, page duplicates and edits of existing layers are never counted.

## Skeleton, then one section per call

1. **Skeleton first.** One call: the page frame (`placeholder: true`) and one empty, named frame
   per section (Nav, Hero, Features, Pricing, Footer). Before it, write one short line saying what
   you are about to do ("Laying out the page skeleton").
2. **One section per call**, ≤ 40 new layers each, inserted into its section frame. Write a
   one-line note before each call ("Building the pricing section"): Kimo shows it as your live
   status.
3. `kimo_render` the section, fix what looks wrong, move on.
4. `unset` the page's `placeholder` when the last section is done, then reply in one to three
   short sentences: what changed and where.

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
the original and adds the section skeleton inside the copy:

```json
[{"op":"copy","id":"Home0001","key":"v2","parent":"root",
  "set":{"name":"Home · Pricing variant","x":1540,"placeholder":true}},
 {"op":"insert","key":"pricing","parent":"@v2","index":3,
  "node":{"type":"frame","name":"Pricing","w":{"mode":"fill"},
    "layout":{"dir":"row","gap":24,"pad":64}}},
 {"op":"insert","key":"p1","parent":"@pricing","node":{"type":"frame","name":"Plan · Taster",
   "w":{"mode":"fill"},"layout":{"dir":"column","gap":12,"pad":24}}},
 {"op":"copy","id":"@p1","parent":"@pricing","set":{"name":"Plan · Daily"}},
 {"op":"copy","id":"@p1","parent":"@pricing","set":{"name":"Plan · Café"}}]
```

`@v2/<original id>` addresses a node inside the copy in the same call; `created[]` lists
`v2/<original id>` for later calls. Then fill the plan cards (one call, well under 40 inserts:
build the first card, copy it twice and edit the copies), render once, and `unset` the
variant's `placeholder` at the end.
