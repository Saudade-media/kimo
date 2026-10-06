# Writing a template

Each file here except `lib.ts` is one bundled template. `scripts/build-templates.ts` turns it into
`packages/templates/files/<slug>/` (the `.kimo`, `cover.png` and `screens/*.png`) and rewrites
`packages/templates/index.json`.

```sh
bun scripts/build-templates.ts --only <slug>   # build one template (documents, PNGs, index)
bun scripts/build-templates.ts                 # build all of them
bun scripts/build-templates.ts --check         # what CI runs (via check:generated): byte-identical
                                               # rebuild, strict validation and every rule below
```

Commit the `.kimo`, the PNGs and `index.json` together. Look at every PNG before you do.

## The module

```ts
import { FILL, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "saas-app",               // file name and folder, kebab-case
  name: "Fieldwork project tracker",
  category: "Web app",            // Website | Web app | Mobile | eCommerce | Dashboard | Design system | …
  description: "One plain sentence.",
  prefix: "sa",                   // 2 letters, unique across templates: every id starts with it
  build,
}
function build(b: TemplateBuilder) { … }
```

`saas-marketing.ts` (a website) and `saas-app.ts` (an app with a 1440×900 shell) are the
reference templates. Copy their structure.

## Pages are categories

Pages group frames the way a design team would, they are not one page per screen:

| Page | Made by | Holds |
|---|---|---|
| Cover | `b.cover({ eyebrow, title, description, preview })` | One 1440×900 frame; `preview(area)` fills the right panel with instances. Rendered to `cover.png`. |
| Screens | `b.page("Screens")`, then `b.screen(page, name, props)` | Every screen, left to right in flow order. Split into `b.page("Desktop")` and `b.page("Mobile")` when there are both. Each screen frame becomes `screens/NN-<name>.png`. |
| Components | automatic | Every main from `b.component` / `b.derive`, in labeled sections. |
| Foundations | automatic | Color swatches (light and dark), type scale, spacing, radius and shadow tokens. |

Desktop screens are `w: 1440` with a fitting height (websites) or `h: 900` (app shells). Mobile
screens are `w: 390, h: 844`.

## Builder API

Tokens (declare first; the kit itself needs colors `bg surface ink muted border accent` and type
`display heading body label`):

```ts
b.tokens({
  colors: { bg: ["#F6F7F9", "#0D0F14"], … },        // [light, dark] → color/<name>, axis "mode"
  numbers: { "space/4": 16, "radius/md": 8 },       // full names
  type: { body: { font: "Inter", size: 14, weight: 400, lineHeight: 1.5 } },  // type/<name>
  shadows: { card: [{ kind: "shadow", x: 0, y: 1, blur: 2, color: "#1118270D" }] },
})
b.c("accent")   b.n("space/4")   b.ty("body", { align: "center" })   b.shadow("card")
```

Only Inter and JetBrains Mono render offline in the headless previews, so stick to them.

Nodes (each returns the new id; `props.key` gives a stable id `<prefix><key>`, needed for
anything a prop, override or slot targets):

```ts
b.row(parent, name, { w: FILL, gap: 12, pad: [8, 16], align: "center", justify: "between", … })
b.col(parent, name, { … })              // layout shorthands go straight into the props
b.frame(parent, name, props)            // no auto layout
b.text(parent, content, b.ty("label"), b.c("ink"), props?)   // hugs its content
b.para(parent, content, style, fill, props?)                 // wraps, fills the width
b.icon(parent, "folder-kanban", 18, b.c("muted"))            // lucide names only
b.rect(parent, name, props)  b.ellipse(parent, name, props)  b.divider(parent, color, vertical?)
```

Components:

```ts
const button = b.component("Button", {
  key: "Btn", section: "Actions", description: "…",
  props: {
    label: p.text("BtnLabel", "Button"),            // text prop on a keyed text node
    icon: p.bool("BtnIcon", false),                 // boolean prop (visible)
    variant: p.variants({                           // enum prop: "<key>.<field>" → value
      primary: { "root.fill": b.c("accent"), "BtnLabel.fill": b.c("on-accent") },
      secondary: { "root.fill": b.c("surface"), "BtnLabel.fill": b.c("ink") },
    }),
    cta: p.swap("NestedKey", otherComponent),       // instance-swap prop
    cards: p.slot("SlotKey"),                       // slot prop (frame created with slot: {})
  },
  root: { dir: "row", gap: 8, pad: [8, 14], radius: b.n("radius/md"), fill: b.c("accent") },
}, (root) => { b.text(root, "Button", b.ty("label"), b.c("on-accent"), { key: "BtnLabel" }) })

const secondary = b.derive(button, "Button/Secondary", "BtnSec", { args: { variant: "secondary" } })

b.use(parent, button, {
  args: { label: "Save", variant: "secondary" },     // declared props
  props: { w: FILL },                                // root visual props
  set: { BtnIcon: { icon: "plus" }, "Nested/Inner": { … } },   // overrides by key path
  hide: ["BtnIcon"],
  slots: { SlotKey: (into) => b.use(into, card, { … }) },
})
```

Enum fields can address one key of a struct: `"root.layout/pad"`, `"Label.style/size"`. A `set`
on a nested instance's `args` replaces all of them, so restate the ones it had.

## Quality bar (enforced where a machine can check it)

- **Pages**: Cover, Screens (or Desktop and Mobile), Components, Foundations. 3 to 10 screens.
- **Components**: at least 8 mains, used as instances on the screens. Use text, boolean, enum,
  instance-swap and slot props where they fit. Screens are built from instances, not copies.
- **Tokens**: every fill, stroke, icon color and gradient stop binds a `color/*` token; effects
  bind `shadow/*`. Raw hex outside `b.tokens` fails the build. Light and dark values for every
  color. Spacing and radius from `space/*` and `radius/*`.
- **Auto layout everywhere**: a child of a frame without layout fails the build, and so does
  `position: "absolute"` unless the node has `meta: { "kimo.template.overlay": true }`.
- **Strict validation**: no errors and no warnings (`kimo validate --strict`). A fit-size frame
  whose children all fill that axis is a warning: give the parent a size or use
  `align: "stretch"`.
- **Design check**: zero problems from `checkDesign` (the MCP `kimo_validate {check: true}` pass:
  empty frames, zero sizes, text overflow, clipped or outside layers, overflowing auto layout,
  missing variables). The check skips the inside of instances, so look at the PNGs for overflow
  inside a component.
- **Copy**: real names, prices, dates and numbers, consistent across the template. Follow
  docs/style/writing.md; the build fails on the phrases it bans, on em dashes, on emoji (also ©)
  and on lorem ipsum.
- **Icons**: lucide names that exist in `packages/renderer/assets/icons/lucide`.
- **Images**: no image files. Use token gradients and shapes.
- **Size**: the whole package stays under about 6 MB for 10 templates. Keep screens to what a
  real product shows.

## Checklist before handing off

1. `bun scripts/build-templates.ts --only <slug>` prints only `wrote …` lines.
2. Open `cover.png` and every `screens/*.png`: nothing cut off, nothing overlapping, spacing
   consistent, text readable.
3. `bun scripts/build-templates.ts --check` passes, then `bun test packages/templates`.
