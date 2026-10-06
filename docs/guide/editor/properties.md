# Properties panel

The **Design** tab of the right panel edits the selection. Sections appear only when they apply, in this order: the selection header, then (when relevant) **Theme**, **Instance** and **Properties**, **Component**, **Slot**, followed by **Layer**, **Position**, **Auto layout** or **Text**, **Icon**, **Fill**, **Stroke** and **Effects**. Component, slot and theme sections are covered in [Components](../components/components.md) and [Variables and themes](../components/variables-and-themes.md).

Number fields accept typed values and can be scrubbed: drag a field's label, with `⇧` for steps of 10.

## Layer

**Blend mode** (previewed as you hover: Normal, Pass through for frames, Darken, Multiply, Plus darker, Color burn, Lighten, Screen, Plus lighter, Color dodge, Overlay, Soft light, Hard light, Difference, Exclusion, Hue, Saturation, Color, Luminosity) and **opacity**.

## Position

- **X** and **Y** (fixed by the layout for children of an auto layout frame).
- **W** and **H**, each with a sizing mode:
  - **Fixed**: the number you type.
  - **Hug**: fit the content (frames, text and notes).
  - **Fill**: take the free space of the parent's auto layout (only inside an auto layout frame).
- **Rotation** in degrees.
- **Corner radius**: one value, or four values typed into the field for individual corners.
- **Absolute position** (inside an auto layout frame): takes the layer out of the flow so you can place it freely.

## Auto layout

Auto layout arranges a frame's children in a row or column, like CSS flexbox. Click **+** to add it; on layers that aren't frames, **+** wraps them in a new auto layout frame. **−** removes it.

- **Direction**: row or column, and **Wrap**.
- **Alignment**: the 3 × 3 grid places children on both axes.
- **Gap** between children, and **distribution**: Packed, Space between, Space around, Space evenly.
- **Padding**: horizontal and vertical, or **Individual padding** for top, right, bottom and left.

Children then size with Hug, Fill or Fixed in the Position section.

## Fill

A layer can stack several paints. **+** adds a **Solid**, **Gradient** or **Image…** paint. Each row has a visibility toggle and a remove button; drag rows (or `⌥↑` / `⌥↓`) to reorder.

- **Solid**: the color picker, with a **Variables** tab to [bind a color variable](../components/variables-and-themes.md#binding).
- **Gradient**: Linear, Radial or Angular, with stops you add and remove, **Rotate 90°** and **Reverse**.
- **Image**: Cover, Contain or Stretch, opacity, **Replace** (pick a file or drop one on the preview) and **Remove**.

A text layer's color is its fill.

## Stroke

Strokes take the same paints as fills, plus:

- **Weight** and **Align**: Inside, Center or Outside.
- **Individual sides**: separate widths for top, right, bottom and left.
- **Dashed**, with dash length and gap.
- **Cap** (Butt, Round, Square) and **Join** (Miter, Round, Bevel).

## Effects

**Drop shadow** and **Inner shadow** (X, Y, blur, spread, color), **Layer blur** and **Background blur** (radius). Each effect has a visibility toggle and a remove button.

## Text

Shown when only text layers are selected:

- **Font** family and **weight** (Kimo warns when a weight isn't installed), **size**, **line height** and **letter spacing** (%).
- **Align** left, center, right or justify, and vertical align top, middle or bottom (for fixed-size text).
- **Resizing**: **Auto width** (one line grows sideways), **Auto height** (wraps at its width and grows down) or **Fixed size**.
- **Decoration** (underline, strikethrough), **case** (upper, lower, title) and **italic** (`⌘I`).
- **More text options**: a link (`⌘K`; its **Open** opens web, `mailto:` and `tel:` links), OpenType features, stylistic sets `ss01`–`ss20`, a custom feature tag, and **Reset text style**.

While you edit a text, the Text and Fill sections show the selected characters' values and change only those characters ([styling part of a text](canvas.md#text)). **Mixed** means the selected characters differ. A text with mixed styles that is selected but not being edited also shows **Mixed**, and a change there applies to all of it. Alignment, vertical alignment and resizing always apply to the whole text.

## Icon

For icon layers: the icon (opens the picker), its **size**, and its **stroke** (Lucide, Feather) or **weight** (Material, Phosphor).
