# Canvas and tools

The editor is a canvas in the middle, the **Layers**, **Assets** and **Variables** tabs on the left, and the **Design**, **Code** and **Agent** tabs on the right. The toolbar floats at the bottom of the canvas.

Top-level frames on the canvas act as your screens or artboards; there is one canvas per file (no separate pages).

## Move around

| To | Do |
|---|---|
| Pan | Scroll with a mouse wheel or two fingers; `⇧`+scroll pans sideways. Or hold `Space` and drag, drag with the middle mouse button, or use the Hand tool (`H`) |
| Zoom | `⌘`+scroll, or pinch on a trackpad. Zoom follows the pointer |
| Zoom in / out | `=` and `-` (with or without `⌘`), twice or half the current zoom |
| Zoom to 100 % | `⌘0` or `⇧0` |
| Zoom to fit | `⇧1` fits everything, up to 100 % |
| Zoom to selection | `⇧2` |

The zoom percentage in the top bar opens the same commands. Zoom goes from 2 % to 25 600 %.

## Preview

**Preview** in the top bar (or `⇧Space`, or **View › Preview**) shows one frame on its own, in the same window: panels, toolbar, agent panel, selection and other canvas overlays are hidden, and the frame sits fitted on a dark stage. It opens the selected top-level frame, or the frame that contains the selection, or the first frame. The button is disabled when there is no top-level frame.

| To | Do |
|---|---|
| Previous / next frame | `←` `→`, or `‹` `›` in the bar (top-level frames in layer order) |
| Fit / 100 % | `0` / `1`, or the zoom menu (Fit · 50 · 100 · 200 %). `⌘`+scroll or pinch zooms, `Space`+drag pans |
| Light / dark | `T` or the sun/moon toggle; one menu per other theme axis |
| Exit | `Esc`, **Exit**, or `⇧Space` again |

Theme choices made in Preview only change the preview, never the file. Each frame starts with its own pinned themes. On exit the canvas is where you left it; if you stepped to other frames, the last one you saw becomes the selection. An agent run keeps going in the background and its edits show up live.

## Tools

| Tool | Key | Creates |
|---|---|---|
| Move | `V` | Select, move and resize |
| Frame | `F` | A frame (white fill): a container that can clip, hold auto layout and be a screen |
| Rectangle | `R` | A rectangle (grey fill) |
| Ellipse | `O` | An ellipse (grey fill) |
| Text | `T` | A text layer (Inter 16) |
| Pen | `P` | A vector path (see [Pen and paths](pen-and-paths.md)) |
| Image | `⇧⌘K` | Pick an image file, then click or drag to place it (see [Images, icons and SVG](images-icons-svg.md)) |
| Component | `⌥⌘K` | Turns the selection into a component (see [Components](../components/components.md)) |
| Note | `N` | A sticky note |
| Prompt | `⇧P` | A prompt for the built-in agent (see [Notes and prompts](notes-and-prompts.md)) |
| Icon picker | `I` | An icon at the pointer |
| Hand | `H` | Pans (no toolbar button) |

The toolbar ends with **Ask Kimo** (`⌘K`), which opens the [Agent tab](../built-in-agent/agent-tab.md).

### Drawing shapes

Drag to draw a frame, rectangle or ellipse; hold `⇧` for a square or circle. A click without dragging creates a 100 × 100 shape. After each shape the Move tool comes back.

A new shape goes into the frame under the pointer. Frames with auto layout, locked frames and instances are skipped: the shape lands in the nearest frame without auto layout, or on the canvas. To build an auto layout frame, draw its children first (inside a plain frame, or on the canvas), then add auto layout to that frame, or select the layers and click **+** in Auto layout to wrap them in a new auto layout frame. Moving a layer on the canvas doesn't change its parent.

### Text

With the Text tool, click to start a new text, or click an existing text to edit it. Press `⌘↵` or `Esc` to finish; an empty text is discarded. Double-click a text with the Move tool to edit it. Text formatting is in the [properties panel](properties.md#text).

While you edit, the text stays exactly where and how it is drawn: same width, same line breaks, same font, size and spacing, at any zoom. A text with **Auto height** or **Fixed size** keeps wrapping at its width.

You can style part of a text. Select some characters, then:

- press `⌘B` (bold), `⌘I` (italic), `⌘U` (underline), `⇧⌘X` (strikethrough) or `⌘K` (link), or
- change the font, weight, size, line height, letter spacing, decoration, case or link in the **Text** section, or the color in **Fill**.

Only the selected characters change. With nothing selected, the shortcuts style the next characters you type. New characters take the style of the character before the caret. Pasting inserts plain text. `⌘Z` inside the text undoes your last typing burst or style change; when you finish, the whole edit is one undo step. Clicking in the right panel keeps the text in edit mode, with the selection still highlighted.

## Undo

`⌘Z` undoes and `⇧⌘Z` (or `⌘Y`) redoes. Each drag or command is one step. Undo is per author: `⌘Z` undoes your own edits, never an agent's (an agent's turn has its own **Undo turn**).

## Context menu

Right-click a selected layer (or an unselected one, which selects it) for **Duplicate** (`⌘D`), **Bring to front**, **Lock** / **Unlock** and **Delete** (`⌫`), plus the note, prompt and placeholder actions when they apply.

> [!NOTE]
> Kimo has no layer clipboard yet: `⌘C` / `⌘V` don't copy layers. Use **Duplicate** (`⌘D`) within a file.

All keys are listed in [Keyboard shortcuts](shortcuts.md).
