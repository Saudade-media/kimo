# Your first file

## Home

Kimo opens on **Home**. In the desktop app, **Settings › General › On launch** set to **Last files** (the default) reopens the file that was open when you quit; a window you close yourself is not reopened. From there:

- **New file** (`⌘N`) starts a design. In the desktop app it opens an untitled file right away and asks where to save it the first time you press `⌘S`. The save panel starts in the folder you last saved to, else in **Settings › Files & autosave › New files go to** (`~/Documents/Kimo` by default). In the browser a new file starts from a sample design.
- **Open file** (`⌘O`) opens a `.kimo`, `.kimoz` or `.pen` file. In the browser this imports a copy into the browser's library.
- The sidebar switches what Home shows, and the search box searches that list:
  - **Recents**: the files you opened lately.
  - **All files**: every file Kimo knows. In the desktop app that is Recents plus every `.kimo` file in your local folders; in the browser, the browser's library.
  - **Templates**: the bundled examples. **Use template** (or a click on the card) copies one into a new file and opens it. In the desktop app the copy goes to the new-files folder (`landing.kimo`, then `landing 2.kimo`), and a template that imports a library brings a copy of the library along.
  - **Design systems**: files that other files import, or that publish components, with "N components · used by M files". Click one to open it.
  - **Trash**: files you moved to the Trash, with **Restore** and **Delete forever**. In the desktop app they sit in the macOS Trash until you empty it (**Empty trash…** deletes only the files Kimo moved there). In the browser they are deleted for good after 30 days.
- In the desktop app, **Local folders** (**+**) adds a folder whose files Kimo lists. Click a folder to list its files. Its **⋯** (or a right-click) has **Reveal in Finder** and **Remove from Kimo**, which stops listing it and leaves the files on disk.
- A file's **⋯** (or a right-click on a row or card) has **Open**, **Reveal in Finder**, **Rename**, **Duplicate**, **Remove from Recents** and **Move to Trash** (`⌘⌫`). Moving a file to the Trash never asks; the toast's **Undo** brings it back. In the browser the menu has **Download .kimo** instead of Reveal.
- In the grid view each card shows a preview of the file: the first frame on its first page (or everything on that page when it has no frame). Kimo renders it after a save, once the editor is idle, and skips the render when the file didn't change. A file made from a template shows the template's cover until its first save. A file without a preview yet shows a placeholder. In the desktop app previews are kept in `~/.kimo/thumbs`, never next to your files; in the browser they are kept with the library. List rows have no preview.
- A file that was moved or deleted outside Kimo shows as **Missing**. Its menu has **Locate…**, **Reveal folder** and **Remove from Recents**.
- On macOS, the menu bar's **File › New window** (`⇧⌘N`) opens another window on Home. In a file, **File › Back to files** returns to Home.
- The composer at the top creates a new file and hands your request to the [built-in agent](../built-in-agent/providers.md), which starts building in it.

For ready-made files to open, see the [examples](../../../examples/README.md).

## Make something

1. Press `F` and drag to draw a frame: that is your screen.
2. Press `T` and click inside it to add text; press `Esc` when done.
3. Select the frame and click **+** in **Auto layout** in the right panel to lay its children out, then pick the direction, gap and padding.
4. Press `⌘S` to save.

The [Editor](../editor/canvas.md) pages cover every tool and panel, and [Keyboard shortcuts](../editor/shortcuts.md) lists every key.

## The `.kimo` format

A `.kimo` file is plain UTF-8 JSON, written so that it diffs and merges well in git:

```json
{
  "$schema": "https://getkimo.design/schema/kimo-1.0.json",
  "format": "1.0.0",
  "variables": {
    "color/bg": { "type": "color", "value": "#FBFAF7" }
  },
  "nodes": {
    "heroFr": { "type": "frame", "parent": null, "order": "a0", "name": "Hero", "x": 0, "y": 0, "w": 1440, "fill": { "$ref": "color/bg" }, "layout": { "dir": "column", "gap": 24 } },
    "title1": { "type": "text", "parent": "heroFr", "order": "a0", "name": "Title", "content": "Hello" }
  }
}
```

- `nodes` is one flat table of every layer, keyed by id (6 to 24 letters and digits); each layer names its `parent` and its `order` among siblings. A change touches only the lines it changes.
- A value can be a binding to a variable (`{"$ref": "color/bg"}`).
- Variables, theme axes, components and imported libraries sit next to it at the top level.
- Images are stored beside the file in an `assets/` folder, named by their content hash. A `.kimoz` is the file and its assets zipped into one, for sending; Kimo works on the `.kimo` form.
- Kimo writes the same canonical form every time, so saving without changes changes nothing.

Opening a file made with an older format asks to **Upgrade and save** (or **Open read-only**). A file from a newer Kimo opens read-only.

### Opening `.pen` files

Kimo opens pen.dev `.pen` design files (the plain-JSON format, schema 2.x) like its own: pick one in **Open file**, drop it on the Dock icon, or choose Kimo in Finder's **Open With**. The first time, Kimo converts it into a `.kimo` with the same name in the same folder (`design.pen` → `design.kimo`) and stores its images in `assets/`; that `.kimo` is the file you edit and save. The `.pen` is never changed.

- Opening the same, unchanged `.pen` again reopens that `.kimo`, with your edits.
- If `design.kimo` already exists and did not come from this `.pen` (or the `.pen` changed since), Kimo writes `design 2.kimo` instead. It never replaces a file.
- Components, instances and their overrides, slots, variables and themes, auto layout, gradients, images, mesh gradients and shader fills all carry over. Shader files (`.glsl`) stay where they are and are referenced relative to the file.
- In the browser, only images linked by `https://` URL can be fetched; images next to the `.pen` show as missing.

The full definition is the [file format spec](../../spec/kimo-format-1.0.md). For merging `.kimo` files in git, see [`kimo merge`](../../../packages/cli/README.md#kimo-merge-the-git-merge-driver).
