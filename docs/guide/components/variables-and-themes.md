# Variables and themes

Variables are named values (colors, numbers, strings, booleans) that layers bind to instead of holding a fixed value. Theme axes such as `mode` (light, dark) give a variable one value per theme, and a **pin** fixes a frame to a theme.

## The Variables tab

The **Variables** tab in the left panel lists the file's variables by group, each with its value (and a swatch for colors). Aliases are marked, and `no match` means no value fits the current theme. The **preview** pill switches which theme the list resolves under; it changes only the view, not the file.

From an empty file, start with **New variable** or **Import DTCG…** (a W3C design tokens `.json`; only names that don't exist yet are added).

## The Variables dialog

Press `⇧⌘V` (`Ctrl+Shift+V`), or **Open variables** in the tab, for the full table:

- The sidebar lists groups, theme axes (click one to edit it, or **Add axis**) and linked libraries (read only).
- **New variable** creates a Color, Number, String or Boolean variable, a group or a theme axis.
- The table has one column per theme value. Move with the arrow keys and press `↵` or `F2` to edit a cell: a color picker, a text field, or an alias to another variable. Aliases that would loop are refused.
- A row's menu edits its name, group and description, shows its entries, moves, duplicates or deletes it. Deleting a variable that is in use asks to **Delete & detach**, which turns every use into its current fixed value.
- A column's menu renames, duplicates or deletes a theme value, or **Make default** (the first value of an axis is its default).
- **Export DTCG** saves the variables as `<name>.tokens.json`.

## Binding

Open the color picker of a fill, stroke or shadow and switch to its **Variables** tab to bind the color to a variable. A bound color shows the variable's name instead of a hex value. To unbind, pick a custom color.

> [!NOTE]
> In the editor, only colors can be bound, and only to the file's own variables. Number, size and text bindings made by an agent or present in the file show as `$name` in their fields and render correctly, but there is no panel control to bind or unbind them yet. Agents bind any field with `{"$ref": "name"}` (see [Variables and themes for agents](../../agents/tokens.md)).

## Themes and pins

A theme axis is a named list of values, for example `mode: light, dark` or `density: comfortable, compact`. A document can have several axes, and each variable can have a value per combination.

Select a frame or an instance to see its **Theme** section: one row per axis with **Inherit · <value>** or a pinned value. A pin applies to the layer and everything inside it; axes you don't pin inherit from the parent. **+ Pin another axis** adds a row, and a line underneath shows the effective theme. To show the light and dark version of a screen side by side, duplicate the frame and pin the copy to `mode: dark`.

Pinning a layer inside an instance is stored as an override of that instance. Axes from a library appear as `alias:axis`.

See the spec's [variables and themes](../../spec/kimo-format-1.0.md#10-variables-and-themes) for how values resolve.
