# 0009. M1 render pipeline: DocStore → resolve → Yoga layout → CanvasKit → overlays

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** maintainers (M1 contracts)
- **Teardown refs:** 9.1 (`layout`, `renderer`), 9.2 (renderer, layout, text, fonts), 9.3 (runtime
  data flow), 12 (M1 row; Yoga layout pulled forward from M2), 13.3; builds on [0004](0004-renderer-canvaskit-layout-yoga.md)

## Context

M1 needs a canvas that shows frames, rects, ellipses, text and image fills from a live
`DocStore`, at 60 fps for 5k nodes, with selection, move/resize and undo. Four builders work
in parallel (layout, renderer, canvas host, shell), so the seams must be fixed first. ADR 0004
chose CanvasKit and Yoga behind interfaces; this ADR fixes the interfaces, the data flow, dirty
tracking, how wasm is loaded, and where fonts come from.

Facts checked locally (2026-10-02):

- `canvaskit-wasm@0.42.0` initializes in Bun in ~67 ms from `bin/canvaskit.wasm`
  (`locateFile`), and `MakeSurface` (CPU raster) works headless. Paragraph measures
  "Hello Kimo canvas" in Inter 13px as 113.66 × 16.
- `Typeface.MakeTypefaceFromData` and `TypefaceFontProvider.registerFont` accept TTF and WOFF2
  in the standard build (typings: ".ttf, .woff and .woff2"; both decoded in a probe). The
  CHANGELOG notes WOFF2 can be compiled out (`no_woff2`); the npm build keeps it.
- Google Fonts CSS2 returns one full static TTF per face to a non-browser user agent
  (`Inter:wght@400` → 324,820 bytes, `format('truetype')`), but `unicode-range`-split WOFF2
  subsets to browsers (23,804 bytes for the latin subset only).
- `yoga-layout@3` ships its wasm base64-embedded in an ESM module (`yoga-layout/load`,
  `loadYoga()`), so it needs no URL or bundler configuration.

## Decision

### Pipeline

```
DocStore.onChange(change)
  └─ CanvasHost (apps/web/src/canvas) — the only orchestrator
       ├─ classify change.nodes: keys ∈ LAYOUT_KEYS (or added/removed) → layout-dirty, else paint-dirty
       ├─ change.header → resolver.invalidate(); layout-dirty = all bound nodes
       ├─ LayoutEngine.update({nodes: store, resolve, measureText: renderer.textMeasurer()}, dirty)
       ├─ Renderer.setLayout(result); Renderer.invalidate(paintDirty)
       └─ Renderer.requestFrame()        (coalesced to one rAF)
uiStore (selection, hovered, viewport) → Renderer.setOverlay / setViewport → requestFrame
```

1. **Contracts.** `@kimo/layout/src/types.ts` (`LayoutEngine`, `LayoutInput`, `LayoutResult`,
   `NodeLayout`, `TextMeasurer`, `Resolver`, `LayoutIssue`), `@kimo/renderer/src/types.ts`
   (`Renderer`, `FontProvider`, `FontSource`, `AssetSource`, `Overlay`, `RenderStats`) and
   `apps/web/src/canvas/contract.ts` (`CanvasHostProps`, `CanvasHandle`, toolbar tools) are the
   seams. Changing them needs a note in this ADR.
2. **Resolve.** `createResolver(header, nodes)` in `@kimo/layout` wraps core-schema's
   `defaultTheme`/`resolveVariable` with a per-node effective-theme cache. Layout and renderer
   share one resolver instance, and both build text input with `resolveText()`, so the
   measured and the drawn text are the same runs and styles.
3. **Layout (Yoga, in M1).** Frames with `layout` map to Yoga flex (`fit` → auto, `fill` →
   flexGrow `weight` on the main axis / stretch on the cross axis, `pad`, `gap`, `justify`,
   `align`, `wrap`); everything else is placed by `x`/`y`. Text uses a Yoga measure function
   that calls `TextMeasurer.measure` (CanvasKit Paragraph). Output per node: `local` box
   (parent space), axis-aligned `world` bounds, and a `transform` matrix (rotation is CCW
   degrees about the top-left, per the spec `rotation` row). Layout never throws on content; it reports
   `LayoutIssue`s and falls back.
4. **Render (CanvasKit, WebGL).** Paint order is `LayoutResult.order`. Per node the renderer
   concatenates `transform` and draws in `[0, 0, w, h]`; `clip` frames clip children. Nodes
   whose `world` box misses the visible world rect are culled. Paint-only state (paints,
   paragraphs, decoded images) is cached per node id and dropped by `invalidate(ids)`.
   WebGL is the default surface; on failure or a second context loss it falls back to a
   software surface and reports `WEBGL_UNAVAILABLE` / `CONTEXT_LOST` through `onError`.
5. **Overlays** are drawn last in screen space, in the same frame, from `setOverlay`:
   hover outline, selection outline + corner handles + size badge, marquee, and (M2) guides.
   Geometry is `OVERLAY_SPEC`, taken from `desing.pen` board 03 (outline 1.5, handles 8×8
   radius 2 stroke 1.5, badge pill padding [2, 8] mono 11/500); colors come from design tokens
   via `OverlayTheme` (`selection`, `on-accent`). Overlays are never exported.
6. **Hit testing** runs against `LayoutResult` (world boxes, then exact shape tests for
   ellipses/rounded rects) in reverse paint order, so it needs no GPU readback and works
   headless. The selection policy (top-level vs deep select, locked nodes) belongs to the host.

### Dirty tracking

- A change is **layout-dirty** when a node is added/removed or one of `LAYOUT_KEYS` changed
  (`x y w h layout content style grow rotation visible parent order …`); otherwise it is
  **paint-only** and skips layout. `StoreChange.nodes` gives the ids; the host diffs keys
  against the previous `NodeData` (frozen objects make identity checks cheap).
- `LayoutEngine.update` must equal `compute` on the same input (property test with
  fast-check). It re-lays-out only the Yoga subtrees containing dirty nodes, up to the first
  ancestor whose size cannot change (fixed `w`/`h`, or not in a flex parent).
- `LayoutResult.changed` lists nodes whose world box moved, so the renderer drops only those
  cached pictures. `LayoutResult.version` lets it skip identical layouts.
- A font finishing load (`FontProvider.onFontLoaded`) marks every text node using that family
  layout-dirty.

### Where wasm comes from

- **CanvasKit, browser:** the renderer's browser entry imports
  `canvaskit-wasm/bin/canvaskit.wasm?url` (resolved from `packages/renderer`, which owns the
  dependency) and passes it to `CanvasKitInit({ locateFile })`. Vite emits it as a hashed asset
  and the app lazy-loads it on the first canvas mount, never at startup. `RendererInitOptions.
  canvaskitWasmUrl` overrides it (Tauri custom protocol, a CDN, tests).
- **CanvasKit, headless (Bun/Node):** `locateFile` resolves `bin/canvaskit.wasm` next to the
  resolved `canvaskit-wasm/bin/canvaskit.js`; no URL needed.
- **Yoga:** `loadYoga()` from `yoga-layout/load` (wasm embedded); same code everywhere.
- The standard build (`bin/`), not `bin/full`, is used. Its size is measured in CI (ADR 0004).

### Fonts

- **Bundled (deterministic, offline):** Inter (400, 500, 600, 700 + 400 italic) and JetBrains
  Mono (400, 500) as static **TTF** files under `packages/renderer/assets/fonts/`, with their
  OFL-1.1 licenses in third-party notices. Inter is the reader default font
  (`TEXT_STYLE_DEFAULTS`: Inter 16/400, font-default line height) and the `fallbackFamily`;
  both families are what the editor chrome and board 03 use, and golden/headless tests need
  them without network. They load during `Renderer.init`.
- **On demand:** other families come from `FontSource`s tried in order: a persistent cache
  (IndexedDB on web; `~/.kimo/cache/fonts` on desktop/CLI), then Google Fonts. The Google
  source requests the CSS2 API with a non-browser user agent and downloads the single **TTF**
  per face, avoiding the browser-only, `unicode-range`-split WOFF2 subsets (which would need
  per-script fetches to cover a document). Nearest weight wins when the exact one is missing.
- **Privacy:** `offlineFonts: true` (the "no third-party fetch" setting) disables network
  sources; missing families render with Inter and report a `FontLoadResult.loaded: false`.
- **Measure before fonts:** text measured with the fallback is laid out immediately, then
  re-laid-out when `onFontLoaded` fires. Hosts that need exact output (export, MCP render,
  tests) `await fonts.ensureFont(...)` for every face in the document first; `exportRaster`
  does this itself.
- **M4:** fetched faces are also written as content-hashed document assets (spec §12 rule 3)
  so files render offline elsewhere.

## Consequences

- Builders can work in parallel against stable types; stubs throw `not implemented` until each
  lands, but every package type-checks.
- Measure and draw share Paragraph and `resolveText`, so `fit` text matches render in browser,
  Tauri and headless.
- Bundled fonts add roughly 2 MB of TTFs to the web build (lazy-loaded with the renderer, not
  in the startup bundle); WOFF2 versions can replace them later since CanvasKit decodes WOFF2.
- Text re-layout on late font arrival can shift layout once per family; acceptable for the
  editor, avoided for exports by awaiting fonts.
- The renderer does not subscribe to stores: a second host (CLI, MCP) re-implements the small
  orchestration loop, which keeps the renderer free of editor-state and React.
- `@kimo/editor-state` `Tool` has no `image` mode; the toolbar's Image button is an action
  (file picker) until a later milestone needs a placement mode.
- Instances (M3) are not expanded in M1; `UNSUPPORTED_NODE` is reported and their box is
  drawn as a placeholder.

## Alternatives considered

- **Renderer subscribes to the DocStore directly:** simpler wiring, but couples the renderer
  to editor-state and duplicates change classification per host. Rejected.
- **Fetch every font on demand, bundle none:** smaller build, but headless tests and offline
  first launch would render with CanvasKit's built-in monospace face. Rejected.
- **Google Fonts WOFF2:** smaller per request, but only as `unicode-range` subsets meant for
  browsers' lazy font loading; covering a document means several fetches per face. TTF is
  one request per face and is decoded by the same FreeType path.
- **Measure text with the DOM/Canvas2D:** a second engine reintroduces measure/draw drift
  (ADR 0004). Rejected.
- **Keep layout for M2 (teardown 12):** M1 frames without auto-layout would need a throwaway
  positioning path; Yoga is cheap to integrate behind `LayoutEngine`. Pulled forward.

## Revisit when

Document fonts as assets land (M4), the 5k-node perf gate fails on the main-thread renderer
(move CanvasKit into a worker with OffscreenCanvas), or CanvasKit's WebGPU backend stabilizes.

## Amendments (M1 integration)

- **Instances are expanded in M1.** `@kimo/layout` ships `expandInstances`; the web CanvasHost
  passes the expanded source to the engine, the resolver and the renderer's `scene.nodes`, and
  maps synthetic ids (`<instance>/<IdPath>`) back to the instance for selection. Additive contract
  changes: `NodeSource.children(parent, at?)` and `LayoutEngineOptions.libraries`.
- **Handles.** The renderer draws the 4 corner handles of board 03; the host adds 4 invisible edge
  hit zones, so resizing has 8 handles.
- **Renderer assumptions to confirm:** gradient rotation 0 runs bottom → top, positive rotation
  is counter-clockwise, and angular gradients start pointing up and run clockwise. A frame's stroke
  is drawn above its children.
- **Host pipeline.** Store changes are coalesced per animation frame
  (`LayoutEngine.update` → `Renderer.invalidate + setLayout` → overlay). A gesture (move, resize
  or draw) is one undo step, made by undo-and-reapply within the gesture.
- **Gesture collapse is stack-checked.** A gesture step only undoes the entry it pushed itself,
  checked with `DocStore.topUndo(origin)`. A step that changes nothing pushes no entry, and an
  undo, nudge or other edit made mid-gesture puts another entry on top. In both cases the step is
  not undone. The canvas also swallows commands while a gesture runs, and the shell skips ⌘Z/⌘Y.
- **Variable fonts.** Text styles set the `wght` and `opsz` axes (opsz = font size in px), to
  match CSS `font-optical-sizing: auto`. Without them, variable families such as Fraunces drew
  at their default instance, which is heavier and wider.
- **Web fonts setting (M1).** The web app has a per-browser "Web fonts" toggle in the File menu
  (`kimo.webFonts`, default on). When it is off, the CanvasHost passes `offlineFonts`, so an
  imported document cannot make the editor fetch from fonts.googleapis.com. TODO (M1.x): ask the
  first time an imported file uses non-bundled families, and add the same setting on desktop.
