<!-- related: tokens, components, envelope -->
# Export and design-to-code

## Exports

`kimo_export {docId, target, ids:[…], outDir}` exports the given nodes (default: the page's
top-level frames).

- `png` writes one `<nodeId>.png` per node (`scale`, default 2). `kimo` writes the subtrees as a
  standalone `.kimo` with the variables they use. Both need `outDir`.
- Code and token targets: `react-tailwind` (`<Root>.tsx` pages, one `<Component>.tsx` per
  component, `tokens.css`), `html-css` (`index.html`, `styles.css`, `tokens.css`), `tokens-dtcg`
  (`tokens.json`), `tokens-css`, `tailwind-theme` (`@theme`). Variables stay CSS custom properties
  unless `variables:false`.
- `svg` (one file per root) and `pdf` (one page per root, fonts embedded) use the committed layout
  and the canvas's text measurement, so line breaks match the canvas.

With `outDir` the files are written there; without it, code/token/svg/pdf files come back inline
in `files[].contents` (pdf as base64). Existing files with other contents are never replaced
unless you pass `overwrite:true` (otherwise `FILE_EXISTS`, nothing written). The result lists
`issues`: the places an exporter approximated (unsupported effect, blend mode, and so on). Read
them before you ship the code.

`kimo_render {format:"svg"}` returns SVG text instead of a PNG for a quick look.

The exporter output is a faithful starting point. When you implement a design in an existing
codebase, translate it with that codebase's components and conventions, as below.

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
