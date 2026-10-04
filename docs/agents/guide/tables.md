<!-- Generated from packages/mcp-server/guides/guide/tables.md by scripts/gen-guides.ts. Agents read the same text with kimo_read_docs {path: "guide/tables"}. MIT licence. -->

# Tables and lists

Kimo has no table node. Build tables from layout frames, so columns line up through shared
widths.

## Structure

```
Table   (column, w fixed or fill, stroke 1 inside, radius 8, clip)
├─ Header row   (row, align center, pad [0,16], h 44, fill subtle)
│   ├─ Cell "Name"    (w fill, weight 2)
│   ├─ Cell "Status"  (w 120)
│   └─ Cell "Amount"  (w 120, text align right)
└─ Row × n      (row, same cell widths, h 52, stroke bottom {b:1})
```

- Give every cell in a column **the same sizing** (`w:120`, or `fill` with the same `weight`).
  That is what keeps columns aligned.
- Cells are frames with `layout:{dir:"row", align:"center"}` holding a text with
  `grow:"fixed-width"` and `w:{"mode":"fill"}`, so long values wrap or clip predictably.
- Row dividers: `stroke:{paint:"#E5E7EB", width:{b:1}}` on rows, not separate line nodes.
- Numbers: right-aligned, with `features:{"tnum":true}` in the text style for tabular digits.

## Rows as a component

Make one row a component, with declared props for each cell text (`declare_prop` type `text`),
then `instantiate` it n times and `set_args` per row. 20 rows then take one call: 20
`instantiate` plus 20 `set_args` ops, using `@key` to link them.

## Lists

Lists are a column of row instances with `gap:0` and dividers, or `gap:8` with card-style rows.
For long data, show 8–12 representative rows, not hundreds.

## Check

`kimo_query {select:{under:tableId, type:["frame"]}, include:["bounds"], depth:2}`. Cells in the
same column must report the same x and width.
