# Your first file

## Home

Kimo opens on **Home** (or on your last files, see **Settings › General › On launch**). From there:

- **New file** (`⌘N`) starts a design. In the desktop app it opens an untitled file right away and asks where to save it the first time you press `⌘S` (new files go to `~/Documents/Kimo` by default). In the browser a new file starts from a sample design.
- **Open file** (`⌘O`) opens a `.kimo` or `.kimoz` file. In the browser this imports a copy into the browser's library.
- **Recents** and **All files** list your files, as a grid or a list, with **Search files**.
- In the desktop app, **Local folders** (**+**) adds a folder whose files Kimo lists.
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
  "$schema": "https://kimo.design/schema/kimo-1.0.json",
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

The full definition is the [file format spec](../../spec/kimo-format-1.0.md). For merging `.kimo` files in git, see [`kimo merge`](../../../packages/cli/README.md#kimo-merge-the-git-merge-driver).
