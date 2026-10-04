# Variables and themes

Variables are named values (colors, numbers, strings, booleans) that layers bind to instead of holding a fixed value. Theme axes such as `mode` (light, dark) give a variable one value per theme, and a **pin** fixes a frame to a theme.

## The Variables tab

The **Variables** tab in the left panel lists the file's variables by group, each with its value (and a swatch for colors). Aliases are marked, and `no match` means no value fits the current theme. The **preview** pill switches which theme the list resolves under; it changes only the view, not the file.

From an empty file, start with **New variable** or **Import DTCG…** (a W3C design tokens `.json`; only names that don't exist yet are added).

## The Variables dialog

Press `⌥⇧⌘V` (`Ctrl+Alt+Shift+V`), or **Open variables** in the tab, for the full table:

- The sidebar lists groups, theme axes (click one to edit it, or **Add axis**) and linked libraries (read only).
- **New variable** creates a Color, Number, String or Boolean variable, a group or a theme axis.
- The table has one column per theme value. Move with the arrow keys and press `↵` or `F2` to edit a cell: a color picker, a text field, or an alias to another variable. Aliases that would loop are refused.
- A row's menu edits its name, group and description, shows its entries, moves, duplicates or deletes it. Deleting a variable that is in use asks to **Delete & detach**, which turns every use into its current fixed value.
- A column's menu renames, duplicates or deletes a theme value, or **Make default** (the first value of an axis is its default).
- **Export DTCG** saves the variables as `<name>.tokens.json`.

## Binding

**Colors.** Open the color picker of a fill, stroke or shadow and switch to its **Variables** tab to bind the color to a variable. A bound color shows the variable's name instead of a hex value. To unbind, pick a custom color.

**Numbers, text and booleans.** Hover or focus a bindable field and click the **variable** button at its right edge, or `⌥`-click the field's label. A picker opens under the field, listing only variables of the field's type: **This file** first, then each linked library by its alias with its path. Type to search across groups; `↑` `↓` and `↵` pick. Aliases show the variable they point to (`→ space/6`). The footer offers **Create variable from <value>**, which creates a variable holding the field's current value and binds it in one step.

A bound field shows a chip with a type glyph and the variable's name, and the resolved value on the right (hidden in half-width fields; it is in the chip's tooltip). The value follows the layer's theme. Click the chip to pick another variable. Hover the field and click the **unlink** button to **Detach**: the field keeps the current value as a plain number or text. The layer's right-click menu has **Detach all variables** for every binding on the selected layers at once, plus **Bind visibility to variable…** and **Bind text to variable…** (these two show only when matching variables exist).

Library variables are bound as `alias:name` and resolve through the library. If a variable is renamed or deleted, its chip turns red and the field keeps the last value it had.

Editing a text layer whose content is bound asks **Detach copy/cta?** first. Confirming replaces the binding with the current text.

With several layers selected, a field shows the chip only when every layer is bound to the same variable; otherwise it shows the value (or **Mixed**), and binding applies to all of them.

### What can be bound

| Type | Fields |
| --- | --- |
| Number | Width and height (fixed size), opacity, corner radius, stroke width, gap and row gap, padding (horizontal, vertical, and each side), font size, font weight, line height, letter spacing, icon stroke width or weight, shadow X, Y, blur and spread, blur radius |
| Text | Text content, font family |
| Boolean | Visibility, clip content |

Number fields accept `number` and `dimension` variables (a dimension binds as its px value). In the file format a corner radius and a stroke width can also be bound per corner or per side, and an icon's name to a string variable; those bindings render and export correctly but are set by agents or in the file, not from the panel.

> [!NOTE]
> X, Y, rotation, wrap, polygon sides and image URLs can't be bound: the file format 1.0 stores them as plain values, so their fields have no variable button.

Agents bind any of these fields with `{"$ref": "name"}` (or `{"$ref": "alias:name"}` for a library variable) through `kimo_apply_ops`; a binding to a variable of the wrong type is reported as `VARIABLE_TYPE_MISMATCH` (see [Variables and themes for agents](../../agents/tokens.md)).

## Themes and pins

A theme axis is a named list of values, for example `mode: light, dark` or `density: comfortable, compact`. A document can have several axes, and each variable can have a value per combination.

Select a frame or an instance to see its **Theme** section: one row per axis with **Inherit · <value>** or a pinned value. A pin applies to the layer and everything inside it; axes you don't pin inherit from the parent. **+ Pin another axis** adds a row, and a line underneath shows the effective theme. To show the light and dark version of a screen side by side, duplicate the frame and pin the copy to `mode: dark`.

Pinning a layer inside an instance is stored as an override of that instance. Axes from a library appear as `alias:axis`.

See the spec's [variables and themes](../../spec/kimo-format-1.0.md#10-variables-and-themes) for how values resolve.
