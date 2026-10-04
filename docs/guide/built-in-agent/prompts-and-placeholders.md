# Prompts and placeholders

## Prompt nodes

A prompt is a node on the canvas that holds an instruction for the agent, so the request lives next to the design it is about and is saved in the file. Draw one with the **Prompt** tool (`⇧P`), or right-click a note and choose **Convert to prompt**. See [Notes and prompts](../editor/notes-and-prompts.md) for editing them.

Run a prompt with **Run** in its footer, the play button on its layer row, or **Run prompt** in the canvas context menu. A run is always one Single-mode turn, whatever mode the composer is in:

- With a **target** (right-click a frame › **Set as target**), the run is scoped to that frame.
- Without one, Kimo creates a frame named `<prompt> · result` to the right of the prompt and the agent builds into it.

A prompt can name its own model; otherwise the run uses the composer's model. Notes attached to the target are included, with their authors. A prompt can't run while another turn is running. Its run status (running, failed, last run with edits and cost) lasts until you reload.

Prompts and notes are not design: the [Code tab](../export/code-tab.md) and exports skip them.

## Placeholders

While an agent builds a frame, the frame carries a **placeholder** flag and the canvas shows who is working on it (`<agent> · building <name>`). It is a signal for people and other agents, not a lock: you can still edit the frame.

An agent clears its placeholders when its turn ends, whether it finished, was stopped or failed. If a placeholder stays behind and its agent is no longer running, the tag reads **Interrupted**; right-click it for **Clear flag**, **Resume agent**, or **Ask Kimo to finish** when the session is gone.

> [!NOTE]
> The frames Kimo prepares for **Side by side** are cleared by each variant's agent when it finishes. If an agent stops early, its frame may be left **Interrupted**; clear the flag from the context menu.
