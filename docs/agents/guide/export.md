<!-- Generated from packages/mcp-server/guides/guide/export.md by scripts/gen-guides.ts. Agents read the same text with kimo_read_docs {path: "guide/export"}. MIT licence. -->

# Export and design-to-code

## PNG and .kimo exports

`kimo_export {docId, target:"png", ids:[…], outDir, scale}` writes one PNG per node.
`target:"kimo"` writes a standalone copy of the document. Existing files are never replaced
unless you pass `overwrite:true` (otherwise `FILE_EXISTS`). Code and token targets
(`react-tailwind`, `html-css`, `tokens-dtcg`, `tokens-css`, `tailwind-theme`, `svg`, `pdf`) are
listed but return `UNSUPPORTED` in this version. Write the code yourself from the data, as below.

## Implementing a design in code

1. `kimo_query {select:{ids:[frameId]}, depth:10, resolveVariables:false,
   include:["bounds"]}`. Keep bindings unresolved so you see token names.
2. `kimo_get_variables {docId, resolve:true}`. Map each variable to a CSS custom property or a
   theme token. Themed values become per-theme values (`[data-theme=dark]`).
3. Translate node by node:
   - `layout.dir/gap/pad/justify/align` → flex `direction/gap/padding/justify-content/align-items`
     (`between` → `space-between`);
   - `w/h` fixed → width/height; `fit` → auto; `fill` → `flex: 1` on the main axis, or
     `align-self: stretch` on the cross axis;
   - `position:"absolute"` + x/y → absolute positioning in a relative parent;
   - `radius`, `stroke` (align `inside` → border or inset box-shadow), `effects` → box-shadow /
     filter / backdrop-filter;
   - text `style` → font-family/size/weight, line-height (a multiplier stays unitless),
     letter-spacing px.
4. Instances: one code component per Kimo component, with declared props as typed props.
   `kimo_list_components` lists them.
5. Compare: render the frame with `kimo_render` and the implementation in a browser at the same
   width.

Keep the node tree's nesting and order in the DOM. Don't flatten containers. Their padding and
gap are where the spacing lives.
