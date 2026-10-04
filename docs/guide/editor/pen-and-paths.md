# Pen and paths

## Drawing with the Pen

Press `P` and click on the canvas: **Click to add points · Drag to curve · Enter to finish**.

- **Click** adds a corner point. **Drag** after clicking pulls out symmetric curve handles; hold `⌥` to move only the outgoing handle.
- `⇧` constrains the next segment to 45° steps.
- Click the first point to close the path (the cursor shows a ring near it).
- `↵` or `Esc` finishes an open path. `⌫` or `⌘Z` removes the last point.
- Points snap to nearby layers and to the path's own points.

The finished path is one layer and one undo step, with a 1 px stroke and no fill if it is open. A path needs at least two points. The Move tool comes back afterwards.

## Editing a path

Double-click a path (or select it and press `↵`) to edit its points: **Editing path · Esc or Enter to exit**.

- Click a point to select it; `⇧`-click adds or removes points from the selection.
- Drag points to move them (`⇧` keeps one axis; they snap).
- Drag a handle to reshape a curve; `⌥` breaks the symmetry, `⇧` constrains to 45°.
- Click a segment to add a point on it.
- `⌫` deletes the selected points; deleting every point deletes the path.
- `↵`, `Esc`, or a click away from the path leaves path editing.

Editing points resets the path's rotation. Locked paths and paths inside an instance can't be edited.
