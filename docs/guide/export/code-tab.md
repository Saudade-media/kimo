# Code tab

The Code tab shows the code for whatever you have selected, live, without opening the Export dialog. It sits in the right panel next to **Design** and **Agent**; the panel widens while it is open.

## Reading the code

- The header names the selection (or `N layers`) and its kind.
- The framework switch picks **React + Tailwind**, **HTML + CSS** or **Tokens**. Kimo remembers the choice per file; React is the default.
- Chips switch between the generated files, the frame's own `.tsx` or `.html` first. The meta line counts the lines, or for Tokens `N used · M total`.
- The copy icon copies the open file.

**Tokens** lists only the variables the selection uses, plus the variables they alias, as `tokens.json` and `tokens.css`.

The code comes from the same generator as the [Export dialog](export-dialog.md) and follows the dialog's option switches (variables as custom properties, split components, layer names) and, for React + Tailwind, its **Tailwind theme** and **Map variables to theme tokens** choices: the `@theme` block in `tokens.css` (v4, the default), a `tailwind.config.ts` file tab (v3), or no theme. It has no switches of its own; changing an option in Export updates the open Code tab.

## Live updates

The code regenerates as soon as the selection or framework changes, and 150 ms after an edit (`Live · updates as you edit`). Selecting a child of the frame on show highlights its lines without switching files; clicking a line selects that layer on the canvas.

The tab shows at most 400 lines of a file. A longer file shows `Showing 400 of N lines` with **Copy all N lines** and **Open export…**, and live updates pause until the file is shorter again.

## Nothing to show

With nothing selected the tab says **Select a layer to see its code** and offers **Export page…**. Notes and prompts are not part of the design, so they have no code (`Prompt nodes have no code`); in a mixed selection each one becomes a `skipped:` comment.
