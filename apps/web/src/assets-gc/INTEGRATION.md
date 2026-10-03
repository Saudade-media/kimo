# Clean up assets (board 19 Vqeu7) — integration

Same rules as `kimo gc`. The pure logic is `logic.ts` (`planAssetGc`, `referencedAssets`,
`prunedManifest`, copy helpers). **Builder 3 (CLI):** `kimo gc` should share it; move
`logic.ts` to `@kimo/core-schema` (e.g. `src/assets/gc.ts`, it has no imports) and re-export it
from here.

## Menu item "Clean up assets…" (File menu)

```tsx
const folder = platform.capabilities.fileAccess === "native" || platform.capabilities.fileAccess === "fsa"
  ? platformAssetFolder(platform, session.ref)   // assets/ beside the .kimo
  : indexedDbAssetFolder(fileId)                  // browser library
{gcOpen && (
  <CleanUpAssetsHost folder={folder} fileName={fileName}
    doc={() => store.toDocument()}
    apply={(ops, label) => store.apply(ops, { origin: "user", label })}
    onDone={(removed) => setGcOpen(false)} />
)}
```

The host calls `onDone(0)` immediately when nothing is unused (show a toast if wanted). Removing
deletes the files and drops their manifest entries in one undoable `setHeader` (the files are
not restored by undo; git history keeps them, as the dialog says).

## Rules

- Candidates: `<sha256-16>.<ext>` files directly in `assets/` only (README, sub-folders ignored).
- Referenced: `./assets/<name>` or `assets/<name>` anywhere in nodes, variables, themes,
  imports, components, meta. The `assets` manifest is not a reference.
- Fonts are kept unless their family (read from the file) is not used by any text.
