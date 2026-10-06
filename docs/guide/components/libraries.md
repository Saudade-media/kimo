# Libraries

A library is another `.kimo` file whose components and variables you use in this one. Linked libraries are read only here: you edit a library in its own file, and every file that links it picks up the change.

## Link a library

In the **Assets** tab choose **Link library…** and pick a `.kimo` or `.kimoz` file. Kimo names the link after the library's name (or its file name) and records it in the file's `imports`. Its components appear in Assets under **Libraries**, its variables in the Variables dialog sidebar, and its theme axes in the Theme section.

Library items are referenced as `alias:name`: a `ds:Button` instance, a binding to `ds:color/primary`, a pin on `ds:mode`. Kimo refuses edits to library content and tells you to edit it in its source file.

> [!NOTE]
> Kimo stores the library's path as `./<file name>`, so keep the library next to the file that links it, or use **Locate…** after moving it.

## When a library changes

Kimo reads each library from disk when you open the file and compares it with what it saw last time. If it changed, a toast says `<name> changed since last open: N changes`; **Review** lists the components and variables that were added, changed or removed. **Got it** accepts them. When a change left overrides on your instances pointing at layers that no longer exist, **Fix broken overrides** opens a dialog that lists them and lets you point each one at a matching layer or keep it.

If the library can't be found, the Assets tab shows a banner with **Locate…** and **Unlink**.

## Manage libraries

The settings icon in Assets opens the library manager: each link with its status (**Linked**, **Changed** or **Missing**) and counts. **Unlink** detaches every instance that comes from the library, after asking.

The [library-consumer example](../../../examples/library-consumer) links the [design-system example](../../../examples/design-system) as `ds`. The spec covers [imports and libraries](../../spec/kimo-format-1.0.md#11-imports-and-libraries).
