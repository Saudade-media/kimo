# Prompts and placeholders

## Prompt nodes

A prompt is a node on the canvas that holds an instruction for the agent, so the request lives next to the design it is about and is saved in the file. Draw one with the **Prompt** tool (`⇧P`), or right-click a note and choose **Convert to prompt**. See [Notes and prompts](../editor/notes-and-prompts.md) for editing them.

Run a prompt with **Run** in its footer, the play button on its layer row, or **Run prompt** in the canvas context menu. A run is always one Single-mode turn, whatever mode the composer is in:

- With a **target** (right-click a frame › **Set as target**), the run is scoped to that frame.
- Without one, Kimo creates a frame named `<prompt> · result` to the right of the prompt and the agent builds into it.

A prompt can name its own model; otherwise the run uses the composer's model. Notes attached to the target are included, with their authors. Select several prompts and choose **Run N prompts** to run them one after another: the waiting ones show as running, and **Stop** on a waiting prompt takes it out of the line. A prompt can't start while a chat turn is running; its row then shows the failure. Its run status (running, failed, last run with edits and cost) is kept on this device, not in the file, so the last run and a failure are still shown after a reload.

Prompts and notes are not design: the [Code tab](../export/code-tab.md) and exports skip them.

## Placeholders

While an agent builds a frame, the frame carries a **placeholder** flag. Its row in the Layers panel shows a loader and a lock, and on the canvas the agent's cursor and section outline show where it works ([On the canvas](agent-tab.md#on-the-canvas)); the frame itself gets no tag or tint. The flag is a signal for people and other agents, not a lock: you can still edit the frame.

An agent clears its placeholders when its turn ends, whether it finished, was stopped or failed. This holds for local CLI agents too, including flags they set through MCP. When an MCP client disconnects, its placeholders are cleared. If a placeholder stays behind and its agent is no longer running, right-click the frame on the canvas or its layer row for **Clear flag**, **Resume agent**, or **Ask Kimo to finish** when the session is gone.

A placeholder never survives closing Kimo. Quitting or closing the window while an agent works stops the turn, clears its placeholders and saves the file. If Kimo is killed or crashes mid-turn, the placeholders still in the file are cleared the next time the file opens, because no agent can still be working on it.

> [!NOTE]
> When a **Side by side** turn ends (finished, stopped or failed), Kimo clears the flag on every variant frame an agent built into, and removes the frames that are still empty. Their rows read **Discarded**.
