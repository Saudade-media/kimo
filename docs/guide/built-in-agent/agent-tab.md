# The Agent tab

Open the **Agent** tab in the right panel, or press `⌘K` (`Ctrl+K`) for **Ask Kimo**. Type what you want and press `↵` to send (`⇧↵` for a new line).

## Context

- **Selection.** The layers selected on the canvas appear as chips in the composer. They tell the agent what to work on and set its [scope](#scope). Remove a chip to leave a layer out.
- **Images.** Paste, drop or attach PNG, JPEG or WebP images up to 5 MB each.
- **Follow-ups.** While a turn runs you can keep typing: messages are queued and sent when the turn ends.

## While the agent works

The agent builds in steps you can watch: first a skeleton (the frame and its empty sections), then one section at a time. Each edit lands on the canvas as soon as it is made, and the layers it changed flash briefly in the agent's color. The canvas never moves by itself.

Instead of streaming text, the thread shows one status line that updates in place:

- **What it is doing now** — the agent's own short note for the current step ("Building the pricing section"), or, when it wrote none, what the tool is doing ("Adding 12 layers in Pricing", "Reading the Home page"). Its reasoning is never shown.
- **Elapsed time** and the number of steps so far.
- **Follow** — zooms the canvas to the layers the agent just changed. It jumps once per click.

The written reply appears when the turn ends.

## Replies

Under each reply, **N steps** opens the list of tool steps the agent took. It is folded by default and opens by itself when a step failed. Hover a reply to see its tokens, cost and time (`3.1k in · 1.4k out · $0.034 · 11.2s`), **Copy** and **Regenerate**. **Regenerate** reruns the last turn and **Undo turn** reverts everything a turn changed.

## Edit size

One agent edit can add at most 40 new layers. Bigger designs are built in several edits, which is what lets you watch them grow. Copies, duplicates and component instances don't count, so "make a variant of this page with a pricing table" copies the page in one step and then adds only the pricing section. The limit applies to every agent — the built-in one and Claude Code, Codex or Gemini CLI connected over MCP — and never to your own paste, import or duplicate.

## Modes

The mode menu in the composer picks how many agents work and how:

| Mode | What happens |
|---|---|
| **Single** | One agent, scoped to the selection (or the page when nothing is selected). |
| **Side by side** | Select a frame. Kimo places 1 to 6 empty copies of its size (`<name> · v1`, `v2` …) to its right, and one agent drafts a variant in each, in parallel. Choose one model for all or one per agent, and whether they explore **Layout**, **Style** or **Both**. Each finished variant has **Keep** and **Discard** (which undoes it and deletes the frame). |
| **Split** | The lead agent divides the work into placeholder frames, then one agent builds each frame in parallel. Only the lead may change variables and components. |
| **Iterate** | Select a frame. The agent refines it in place one pass per turn (3 passes by default), and shows a review card after each: run the next pass with an optional steer, stop, compare **Before / After**, or go back to the original or an earlier pass. |

Agents that work on one frame (side by side, split) can only edit inside their own frame and never ask for more; **Stop all** stops them. Side by side and split need an API model, because Kimo runs their agents itself; Single and Iterate also work with a CLI.

## Scope

An agent's scope is the part of the page it may change: the selection in Single mode (the whole page when nothing is selected), the frame in Iterate, or its own frame for agents started by side by side and split. Kimo checks every edit against the scope, not the prompt.

## Approvals

Edits inside the scope apply directly, and each is undoable. Kimo asks first, in a card in the thread (**Kimo wants to …**), before the agent:

- edits layers outside its area (Single mode),
- opens, creates, saves or exports a file,
- changes document-wide things such as variables or components, when the mode doesn't allow them (Iterate).

Answer with **Allow once**, **Always this session** or **Deny**. **Always this session** never covers file access or edits outside the area; those ask every time. The card waits as long as you need, the header shows **N waiting**, and **Stop** denies everything pending.

> [!NOTE]
> CLIs are started so that their own permission prompts don't interrupt (Codex runs with its tool approvals set to approve, Claude Code in its don't-ask mode), because Kimo's approvals above apply to every edit they make.

## Sessions

Each conversation is a session. **New** starts one; **History** lists the sessions for this file first, then those of other files, with search over titles and messages. Opening a session restores its model, thinking, mode and skills. After the first turn the session is named automatically.

Sessions are stored on this device (in the app's browser storage), not in the `.kimo` file.

## Costs and limits

The header pill shows the session's estimated cost and tokens (`$0.38 · 41k tok`). Costs are estimated from token usage and a dated price table; models without a known price show `—`. CLIs on a subscription show **subscription** instead of dollars, and local runtimes cost `$0.00`.

**Settings › AI providers › Usage & limits** shows the estimated spend this month per provider and sets a **monthly limit**. When the limit is reached, the turn pauses after its current batch of edits (`Monthly limit reached`).
