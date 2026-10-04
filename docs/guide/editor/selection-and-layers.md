# Selection and layers

## Selecting on the canvas

- **Click** selects the layer directly inside a top-level frame; click a frame's name label above it to select the frame itself. Once something is selected, clicks on its siblings stay at the same depth.
- **Double-click** (or `↵`) goes one level deeper: into a frame or group, into an instance, into a text to edit it, or into a path to edit its points.
- **`Esc`** selects the parent; at the top it deselects.
- **`⌘`-click** selects the deepest layer under the pointer.
- **`⇧`-click** adds a layer to the selection or removes it.
- **Drag on empty canvas** to select with a marquee (`⇧` adds to the selection). Inside a single frame the marquee picks that frame's children. Dragging on the empty background of an unselected frame also starts a marquee over its children rather than moving the frame.

Locked layers can't be clicked or moved on the canvas; select them in the Layers panel.

## Moving and resizing

- Drag to move; `⇧` keeps the move on one axis. Children of an auto layout frame are placed by the layout and can't be dragged freely (turn on **Absolute position** to take one out of the flow).
- Drag a handle to resize; `⇧` keeps the aspect ratio and `⌥` resizes from the center.
- Arrow keys nudge by 1 px, `⇧` + arrow by 10 px.
- `⌘D` duplicates; `⌘G` wraps the selection (layers with the same parent) in a new frame. `⌫` deletes.

## The Layers panel

The **Layers** tab shows the layer tree. **Search layers** filters by name or type.

- **Select:** click; `⌘`-click toggles; `⇧`-click selects a range. With the panel focused: `↑` `↓` move (with `⇧` to extend), `←` `→` collapse, expand or go to the parent, `Home` / `End`, and `↵` or `Space`.
- **Rename:** double-click a row or press `F2`; `↵` commits and `Esc` cancels.
- **Hide / show:** the eye button, or `⇧⌘H`. **Lock / unlock:** the lock button, or `⇧⌘L`.
- **Expand:** top-level frames start open and instances collapsed. Selecting on the canvas opens the tree down to the selection and scrolls to it.

Rows show what a layer is: components and instances have their own icons, overridden layers inside an instance have a dot, notes and prompts have their own rows (a prompt row has a play button to run it), and frames an agent is building show a spinner.

Right-click an instance row, or a layer inside an instance, for the [instance menu](../components/components.md#the-instance-panel).

> [!NOTE]
> Layers can't be reordered by dragging in the panel yet. Use **Bring to front** in the canvas context menu, or let auto layout order a frame's children.
