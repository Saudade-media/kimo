# @kimo/templates

The starter templates that ship with Kimo. Everything is local, so the gallery works offline in
the web app and the desktop app.

| Template | Category | Screens |
|---|---|---|
| `saas-marketing`: Ledgerline marketing site | Website | Home, Pricing, Customers, Blog, Blog post, Sign up (1440 wide) |
| `saas-app`: Fieldwork project tracker | Web app | Overview, Projects, Fernway checkout redesign (kanban board), Team, Settings, Billing (1440×900) |

Every template has the same pages: **Cover** (one frame with the title, a description and a
preview), **Screens** (every screen left to right in flow order, or Desktop and Mobile), **Components** (the mains the
screens use, labeled by section) and **Foundations** (color tokens in light and dark, type scale,
spacing, radius, shadows). Every color is a token with a light and a dark value on the `mode`
axis, and every screen is built from component instances with auto layout.

## Contents

```
index.json                       gallery index: slug, name, category, description, pages,
                                 file, cover, screens [{name, page, preview, width, height}]
files/<slug>/<slug>.kimo         the document
files/<slug>/cover.png           720 px wide, from the Cover page
files/<slug>/screens/NN-name.png one per screen frame (480 px wide; mobile at 0.75×), cut at
                                 1200 px tall
src/index.ts                     the loader
```

All generated. Do not edit them by hand: change `scripts/templates/<slug>.ts` and rebuild.

## Using it in the app

```ts
import { listTemplates, loadTemplate } from "@kimo/templates"

listTemplates()            // TemplateInfo[]: metadata plus cover and preview URLs
await loadTemplate(slug)   // the .kimo text; open it as a new, unsaved document
```

URLs are `new URL("../files/…", import.meta.url)`. Vite globs those patterns at build time and
emits every `.kimo` and PNG as a hashed asset, so the web build carries them and the Tauri bundle
of that build has them offline. Nothing is inlined into the JavaScript (the loader is about 6 kB):
covers load as images when the gallery shows them, and a document is fetched only when it is
opened. Under Bun or Node the URLs are `file:` URLs and `loadTemplate` reads the file. A package
rather than a copy in `apps/web/public` keeps the documents, the index and the loader versioned
together and lets the desktop app and tests import the same thing.

Budget: the build fails when `files/` passes 6.5 MB. Two templates are about 0.9 MB.

## Rebuilding

```sh
bun run build:templates                     # all templates: documents, PNGs, index.json
bun scripts/build-templates.ts --only saas-app
bun run check:templates                     # --check plus kimo validate --strict
```

`--check` (also run by `bun run check` through this package's `check:generated`) fails when a
document differs from a fresh build, is not strictly valid, has a design-check problem, uses a raw
color, positions a layer absolutely outside an overlay, uses an unknown icon or banned copy, or
when a preview is missing. Adding a template: see `scripts/templates/README.md`.
