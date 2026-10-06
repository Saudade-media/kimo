# Components

A component is a reusable piece of design. Its **instances** follow the main component and keep their own changes as **overrides**, so a fix to the main reaches every copy.

## Create a component

Select one or more layers and press `⌥⌘K` (`Ctrl+Alt+K`), or click the **Component** button in the toolbar.

- One layer becomes a main component in place.
- Several sibling layers are wrapped in a new frame around them, and that frame becomes the component.
- One instance becomes a [derived component](#derived-components).

A toast confirms `Created component <name>` with **Undo**. The **Component** section of the right panel holds its name and a description.

> [!NOTE]
> Duplicating a main component (`⌘D`) makes a second, independent main component, not an instance. To get an instance, insert it from Assets.

## Insert instances

The **Assets** tab in the left panel lists **Local components** (grouped by the part of the name before the last `/`) and the components of linked [libraries](libraries.md). Switch between grid and list, or search. In list view each row shows how often the component is used (`3×`).

- **Double-click** a component to place an instance in the middle of the view.
- **Drag** it onto the canvas. A hint follows the pointer and says what the drop will do: `Insert into <frame>`, `Place on the page`, `Insert into <slot> · slot` over a slot, or `Replace <layer> in <instance>` over a layer inside an instance. Hold `⌥` to drop beside an instance instead of into it.

On the canvas, a click selects the whole instance; double-click or `⌘`-click goes one level deeper. Components and instances carry labels on the canvas.

## The instance panel

With one instance selected, the right panel shows the component it comes from (local, or the library alias) and:

- **↗ Go to main component** (`⌥↵`): selects the main and zooms to it. A main from a library can't be edited here; edit it in the library's own file.
- **Swap**: replace the instance with another component, from this file or a library. Overrides carry over to layers with matching ids; if some can't, Kimo asks first.
- **Detach** (`⌥⌘B`): turns the instance into a plain frame that no longer follows the main. Overrides become local values and props are dropped (their values stay). Detach goes one level deep: nested instances stay instances.
- **Reset**: removes every override.
- An override summary (`props N · args N · overrides N`) that opens the **Overrides** list.

The **…** menu, and a right-click on the instance in the Layers panel, add **Select all instances** and **Create derived component**.

## Overrides

Edit an instance the way you edit anything else: select a layer inside it and change its fill, text, size and so on. Kimo stores each change as an override on the instance and leaves the main untouched.

- An overridden layer has a dot in the Layers panel, and an overridden section (Fill, Stroke …) has a dot on its title. Click that dot to **Reset to main**.
- The **Overrides** popover lists every override with its own reset, and **Reset all**.
- Right-click a layer inside an instance for **Replace with component…** (swap just that layer) and **Reset overrides on** that layer. **Replace with selection** swaps it for the component you had selected before the right-click (a main component, or an instance of one).
- You can't delete a layer inside an instance: deleting hides it instead. You can't add layers to an instance either, except into a [slot](#slots).

## Props

Props are the knobs an instance exposes, so you don't need to dig into its layers. Add them in the main's **Component** section with **+**:

| Type | Targets | Default |
|---|---|---|
| **Text** | A text layer's content (the first text layer) | Its current text |
| **Boolean** | A layer's visibility | Shown |
| **Enum** | A property of the root, with named options | — |
| **Instance swap** | A nested instance | — |
| **Slot** | A frame you pick with **Slot (mark a frame)**, which also makes it a slot, or a slot exposed with the Slot section's **Expose as prop** | — |

Each prop row lets you rename it, change its type, point it at another layer (or **Root**), edit its default, reorder it by dragging, and remove it. Enum props list their options; add, edit or delete options in the row.

On an instance, the **Properties** section shows one control per prop with a reset each. The gear icon jumps to the main to edit the props.

## Slots

A slot is a frame inside a main component whose children each instance can replace. Select the frame (inside the main) and turn on **Slot** in the right panel. You can expose the slot as a prop and list **suggested** components; suggestions are advisory, any layer can go in.

Fill a slot on an instance by dragging a component onto it, or with the quick-insert chips Kimo shows under the slot for its suggestions. Turning a slot off while instances have content in it asks before deleting that content.

## Derived components

A derived component is an instance that is itself a component: a variant such as `Button/Secondary` built on `Button`. It inherits the base's props and can redeclare them, and its own instances follow it.

Select an instance and press `⌥⌘K`, or choose **Create derived component** from the instance menu. Its Component section shows **Instance of <base>** with **Go to base component**, and Assets labels it `Name · from Base`.

## Shortcuts

| Action | macOS | Windows · Linux |
|---|---|---|
| Create component | `⌥⌘K` | `Ctrl+Alt+K` |
| Detach instance | `⌥⌘B` | `Ctrl+Alt+B` |
| Go to main component | `⌥↵` | `Alt+↵` |
| Variables | `⌥⇧⌘V` | `Ctrl+Alt+Shift+V` |

For the format behind all this, see the spec's [components, instances, overrides and slots](../../spec/kimo-format-1.0.md#9-components-instances-overrides-and-slots).
