# Fonts (board 19) — integration

Everything here is mountable; nothing is wired into `App.tsx` / `editor/*` yet.

## 1. Font system per editor window (replaces `lib/settings.ts` `webFonts`)

```ts
import { createFontSystem, loadDocumentFontFaces } from "../fonts"

const faces = await loadDocumentFontFaces(doc.assets, await assets.keys(), (k) => assets.bytes(k))
const fonts = createFontSystem({
  platform,                               // KimoPlatform from the session manager
  documentFaces: () => faces,             // refresh + fonts.invalidate() when assets change
  onRemoteFetched: (face, bytes) => {/* optional: store as document asset (spec §12 rule 3) */},
})
```

- `editor/Editor.tsx`: replace `FONT_SOURCES = [googleFontsSource()]` with `fonts.sources` and
  `offlineFonts={!webFonts}` with `offlineFonts={fonts.offline()}`; re-render on
  `fonts.subscribe(...)` (fires on font settings, a fetch, `invalidate()`; deliberately not on
  reconnect: 02d "no layout reflow on reconnect until the user reloads").
- `editor/Topbar.tsx` "Web fonts" menu item: drive `platform.settings` `fonts.google` (or remove
  it; the setting now lives in Settings › Fonts & privacy). `lib/settings.ts` can then go.
- Resolution order is Document → Local → Cache → Google. Google goes only through
  `platform.fonts.fetchRemote` (BLOCKED when No third-party fetch is on / Google off).
- `CkFontProvider` now forgets known-missing families when `sources` or `offline` change, and
  has `retryMissing()`; the canvas re-init on `offlineFonts` change already triggers a retry.

## 2. Missing fonts dialog (opens once per file per session)

Mount next to the editor once the document is loaded:

```tsx
<MissingFontsHost
  platform={platform}
  system={fonts}
  fileKey={session.ref /* or file id on the web */}
  fileName={fileName}
  doc={() => store.toDocument()}
  apply={(ops, label) => store.apply(ops, { origin: "user", label })}
  addDocumentFont={async (f) => {/* put f.bytes as ./assets/<hash>.<ext> + manifest entry */}}
/>
```

"Replace N fonts" is one `store.apply` (one undo step). "Install …" puts the file in the font
cache (`source: "file"`), "Choose font file…" calls `addDocumentFont`.

## 3. Font picker (Text section › Font)

```tsx
const { entries, google } = useFontPickerEntries(platform, fonts, doc)
<FontPicker value={family} entries={entries} google={google} anchor={trigger}
  onPick={(f) => setFont(f)} onClose={close} />
```

## Notes

- 02d "Font rules" says document fonts live in `assets/fonts/<sha256-16>.woff2`; spec §12 says
  `assets/<sha256-16>.<ext>`. `loadDocumentFontFaces` accepts either key; the GC never touches
  sub-folders. Needs a spec/design decision.
- The shared `Dialog` / `DialogScrim` come from `@kimo/ui` (builder 2).
