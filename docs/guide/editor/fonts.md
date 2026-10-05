# Fonts

## Where fonts come from

When a text layer uses a family, Kimo looks for it in this order and uses the first match:

1. **The file's own fonts**: font files in the file's `assets/` folder.
2. **Installed fonts** on this computer, plus **Extra font folders** (desktop).
3. **The offline font pack**, if you downloaded it.
4. **The font cache**: every font Kimo fetched before.
5. **Google Fonts**, fetched on first use (unless you turned that off).

Inter and JetBrains Mono ship with Kimo and always work. A font no source has renders in **Inter** until you replace or install it; the file keeps the original name.

## Google fonts are stored in the file

The first time a file uses a Google font you don't have, Kimo fetches it and also stores it in the file's `assets/` folder, named by its content hash (like images). The next save lists it in the file's asset manifest. From then on the file renders the same everywhere with no network: on another computer, offline, in CI, with the `kimo` CLI and in headless renders and exports.

- Storing a font never changes the open document: there is nothing to undo, and opening a file doesn't mark it as changed. `⌘Z` still undoes your own last change.
- In the browser, **Download** carries the fonts in the `.kimoz` package when the design has images; a plain `.kimo` (no images) leaves them out.
- Commit the `assets/` folder with the file. **File › Clean up assets…** and `kimo gc` never remove a font a text layer still uses.
- Font files over 20 MB are not stored (they stay in the font cache), and neither are Inter and JetBrains Mono, which ship with Kimo.
- In the browser Kimo stores the compact WOFF2 version Google serves to browsers; the desktop app stores the full TTF.

## Offline font pack

**Settings › Fonts & privacy › Offline font pack** downloads a small set of popular Google families once, so they work with no network even in files that never used them:

Roboto, Open Sans, Lato, Montserrat, Poppins, Raleway, Nunito, Work Sans, DM Sans, IBM Plex Sans, Space Grotesk, Fira Sans, Playfair Display, Lora, Source Serif 4 and Roboto Mono, regular to bold (400–700, upright, Latin).

It is about 8 MB in the desktop app (kept in the app's data folder, in `font-pack`) and about 2 MB in the browser (kept in the site's storage). **Download** shows the progress and can be cancelled; downloading again skips what's already there. **Remove** deletes the pack only; the font cache is separate (**Font cache › Clear**).

The pack downloads from Google, so it is off while **No third-party fetch** is on. A pack you already downloaded keeps working.

## No third-party fetch

**Settings › Fonts & privacy › No third-party fetch** stops every request to Google: no font is fetched and the offline font pack can't be downloaded. Fonts already in the file, installed, in the pack or in the cache still work. See [Privacy](../getting-started/privacy.md).

When a file then uses fonts Kimo can't find, the **Missing fonts** dialog opens with a **Google Fonts are blocked** notice and **Open settings**. You can replace the fonts, install them, or keep them for now (they render in Inter).

## Settings › Fonts & privacy

| Setting | What it does |
|---|---|
| **No third-party fetch** | Blocks Google Fonts and the offline font pack download. Kimo never loads remote image URLs: images are always files in `assets/`. Off by default. |
| **Google Fonts** | Fetch Google fonts on first use (then store them in the file and the cache). Off while No third-party fetch is on. |
| **Offline font pack** | Download, cancel, or remove the curated families above. |
| **Font cache** | Fonts fetched so far and their size; **Clear** empties it. |
| **Extra font folders** (desktop) | More folders to scan for installed fonts. |
| **Embed fonts in .kimoz packages** | Put the fonts a file uses into `.kimoz` packages, when their license allows embedding. |
