# 0004. CanvasKit for rendering and text, Yoga for layout, both behind interfaces

- **Status:** Accepted
- **Date:** 2026-10-02
- **Teardown refs:** 9.1 (`layout`, `renderer` packages), 9.2 (renderer, future GPU path, layout, text, fonts), 8.1 principle 8, 12 (M1, M2, M7), 13.3 (bundle size, WebGL quirks, text drift)

## Context

Kimo needs a canvas that renders thousands of layers smoothly with every blend mode, gradient,
blur, shadow, path boolean and real text shaping, and it needs the browser canvas, the headless
MCP renderer and PNG export to produce identical raster output (principle 8). Text measured by
one engine and drawn by another drifts (Penpot #9574, cited in 9.2). Layout is single-axis flex
with fit/fill/fixed sizing and, as an extension, wrap.

## Decision

1. **Renderer: CanvasKit** (`canvaskit-wasm`, standard build, BSD-3), lazy-loaded, WebGL, in a
   worker with OffscreenCanvas where possible, behind a Kimo-owned `Renderer` interface in
   `packages/renderer`. The same implementation renders interactively and headlessly (Node/Bun
   raster for MCP renders and PNG export).
2. **Text: CanvasKit Paragraph** for shaping, wrapping, measuring and drawing. The layout engine's
   text measure callback calls Paragraph, so measurement and drawing share one engine.
3. **Layout: Yoga** (`yoga-layout`, MIT, async wasm) behind a `LayoutEngine` interface in
   `packages/layout`. `fill_container` maps to flexGrow/stretch on the parent axis, `fit_content`
   to auto, and text sizes via the measure callback. Yoga's wrap support backs the `layout/wrap`
   feature (M2).
4. **SVG and PDF do not come from CanvasKit.** The npm build exposes no SVG canvas or PDF API
   (checked in `canvaskit-wasm@0.42.0` typings). SVG is emitted from the exporter IR; PDF uses a
   JS library such as pdf-lib unless a later ADR accepts a custom CanvasKit build (M7).
5. **Interfaces are the boundary.** Nothing outside `renderer` imports CanvasKit types, and nothing
   outside `layout` imports Yoga types. Fonts are loaded before layout; the fallback chain is
   explicit and deterministic.

## Consequences

- One engine gives identical raster output in browser, Tauri and headless paths, so MCP
  screenshots match the canvas, and renders can be golden-tested (M2).
- Bundle cost: the standard `canvaskit.wasm` is ~7.0 MiB uncompressed, ~2.9 MB gzip (brotli to be
  measured). It must be lazy-loaded, cached by a service worker, shipped once per install (shared
  by desktop and the MCP/CLI path), and its measured size recorded in CI (13.3).
- WebGL driver quirks (cf. pen.dev's gray screen on macOS 26 / Metal 4) need per-OS GPU smoke tests
  and a Canvas2D software fallback for viewing (13.3).
- HTML/React export is laid out by the browser, so it matches canvas geometry exactly but text only
  within a tolerance; M7's comparison tests are tolerance-based for text.
- The thin `Renderer` interface keeps a WebGPU path open when CanvasKit's WebGPU backend matures.
- Third-party notices must include Skia and the natives compiled into the wasm (FreeType, HarfBuzz,
  ICU, expat/libpng/zlib) once CanvasKit is installed (13.4).

## Alternatives considered

- **PixiJS v8** (MIT, WebGPU): game-oriented; strokes, booleans and typography would have to be
  built.
- **Raw WebGL2/WebGPU:** years of work at Figma scale.
- **Konva** (Canvas2D): CPU-bound at thousands of layers (INFERRED).
- **tldraw:** requires a production licence key, incompatible with MIT distribution.
- **harfbuzzjs / opentype.js / SDF text:** missing line breaking, bidi and fallback, or small-size
  quality; and a second text engine reintroduces measure/draw drift.
- **Taffy** for layout (block/flex/grid): immature JS bindings today; revisit when grid lands.

## Revisit when

Grid layout is scheduled (Taffy), CanvasKit WebGPU becomes stable, or bundle-size measurements
exceed the startup budget.
