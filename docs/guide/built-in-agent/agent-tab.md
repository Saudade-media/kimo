# The Agent tab

Open the **Agent** tab in the right panel, or press `⌘K` (`Ctrl+K`) for **Ask Kimo**. Type what you want and press `↵` to send (`⇧↵` for a new line).

## Context

- **Selection.** The layers selected on the canvas appear as chips in the composer. They tell the agent what to work on and set its [scope](#scope). Remove a chip to leave a layer out.
- **Images.** Paste, drop or attach PNG, JPEG or WebP images up to 5 MB each.
- **Follow-ups.** While a turn runs you can keep typing. Queued messages show greyed in the thread, and you can edit or remove them before they run. They are sent when the turn ends.

- **Model.** The chip at the right of the composer shows the model's full name. Click it to pick a provider, a model and an effort level. See [The model chooser](providers.md#the-model-chooser).
- **More options.** The **…** button after the mode chip opens a menu with three items:
  - **Skills** (with the number turned on) opens the [skills](skills.md) menu. Typing `/` opens it too.
  - **Ask before changes** makes the agent [ask first](#ask-before-changes) in this session.
  - **Web access** lets the agent search the web and read pages in this session. It starts from **Settings › AI providers › Allow web access** (on by default). While **No third-party fetch** is on, or when the model has no web tools, the row is disabled and the reason shows under it. See [Web access](providers.md#web-access).

  A grey dot on **…** shows that web access is off. In the menu, `↑` and `↓` move, `↵` or `Space` turns a switch, and `Esc` closes it.

## While the agent works

The agent builds in steps you can watch: it plans the sections, then adds one finished section per edit, with its real content. After every edit the design looks complete so far, with no empty boxes waiting to be filled. Each edit lands on the canvas as soon as it is made. The canvas never moves by itself.

### On the canvas

While an agent works, the canvas shows two things for it:

- **A cursor**: a pointer and a pill with the agent's name, in the middle of the section it is editing. A section is a direct child of the top-level frame, such as Nav, Hero, Article or Footer; an edit to the top-level frame itself, or to a top-level frame with no children yet, uses that frame. The cursor floats gently while it stays in a section and glides to the next one in 600 ms. It stays on its section while you pan or zoom.
- **A thin outline** on that section, in the agent's color. Each edit that lands rings the section once.

Nothing else is drawn: no tint over frames, no labels on the layers being built, no outlines on small layers. The built-in agent always shows its own name ("Kimo", "Agent 2"), also when it runs on Claude Code or Codex. Agents connected over MCP on their own (Claude Code, Codex, Gemini CLI, Cursor…) get the same cursor and outline with their client's name while they write.

### New layers grow in

Layers an agent adds grow into place instead of popping in. This covers the built-in agent and agents connected over MCP. Each new layer fades in, scales up from 96 % and rises 6 px over 200 ms. Layers next to it in an auto-layout frame slide to their new places over the same 200 ms, and the frame grows with them. When an MCP client adds many layers in one call, they appear one after another in layer order, 16 ms apart, and the whole batch finishes within 600 ms. A call that adds more than 200 layers fades in the frame that holds them once instead.

The motion is drawn on screen only. The file holds the final values from the first frame, so exports, `kimo_render`, thumbnails and selection never see a layer halfway in. Your own edits, undo and redo, and edits from collaborators draw at once. With **Reduce motion** on (System Settings › Accessibility › Display, or the matching setting on Windows and Linux) layers appear at once and the cursor jumps between sections without floating; the ring on the section still plays.

After each edit Kimo tells the agent about clear problems in what it just built: an empty frame, text that doesn't fit its box or is cut off, a layer of zero size or outside its parent, a missing variable, a shape that draws nothing. The agent fixes them before it moves on and checks the whole page once more before it replies. You don't see these checks; they only shape what lands on the canvas.

Instead of streaming text, the thread shows one status line that updates in place:

- **What it is doing now:** the agent's own short note for the current step ("Building the pricing section"), or, when it wrote none, what the tool is doing ("Adding 12 layers in Pricing", "Reading the Home page", "Searching the web for “tailwind v4 fonts”", "Reading tailwindcss.com"). Its reasoning is never shown.
- **Elapsed time** and the number of steps so far.
- **Follow:** zooms the canvas to the last layer the agent added. It jumps once per click.

The written reply appears when the turn ends. Replies show formatted text: paragraphs, bullet and numbered lists, **bold**, *italic*, inline code, code blocks and links (http, https and mailto). Links open in your browser.

### In the Dock (macOS)

While any agent is working, Kimo's Dock icon animates: the outer shape of the mark turns clockwise and the opening in its centre turns the other way, one step every two seconds, with a soft glow behind the mark. It counts a built-in agent turn in any window, and an agent connected over MCP (Claude Code, Codex, Gemini CLI, Cursor…) while one of its tool calls is running and for 2 seconds after. The icon keeps going for another 1.5 seconds after the last activity, so a burst of calls doesn't make it flicker. It then finishes the current turn of the animation and goes back to the normal icon.

With **Reduce motion** on (System Settings › Accessibility › Display) nothing rotates: only the glow slowly brightens and fades. The animation is pre-rendered and uses no CPU while nothing is working. On Windows and Linux the icon doesn't change.

## Replies

Under each reply, **N steps** opens the list of tool steps the agent took, including each web search and page read ("Searched the web for “…”", "Read example.com"). A reply that used the web ends with **Sources:** and its links. It is always folded by default; if a step failed, the toggle shows how many in red. Hover a reply to see its tokens, cost and time (`4.5k new tokens · $0.034 · 11.2s`), **Copy** and **Regenerate**. Tokens count only what the turn really spent: input not served from the prompt cache plus output. Cached re-reads of the conversation are left out; the tooltip shows the split. **Regenerate** reruns the last turn and **Undo turn** reverts everything a turn changed. Regenerate can't start while another turn is running. If a later edit sits on top of the turn's changes, they leave the layers as they are, and the reply says why.

## Edit size

Layers appear on the canvas while the agent is still writing an edit: each one lands as soon as the agent has written it, and the status reads "Adding <layer>…" with the agent's pointer on that layer. When the edit is complete it becomes one undo step. If the agent is stopped or the edit turns out invalid, the layers it had added so far are removed again. This works for the built-in agent with every API provider and for Claude Code in the desktop app. Codex and Gemini CLI edits land when each edit is complete.

An edit that streams this way can add at most 150 new layers; other agents (Codex, Gemini CLI, any MCP client) at most 40. The limit is a ceiling, not a target: an edit holds one finished section, and a larger section is split into finished parts (its heading, then its cards). Copies, duplicates and component instances don't count, so "make a variant of this page with a pricing table" copies the page in one step and then adds only the pricing section. The limit never applies to your own paste, import or duplicate.

When an edit fails, the agent fixes it by sending only the changed text instead of the whole edit again.

## Modes

The mode menu in the composer picks how many agents work and how:

| Mode | What happens |
|---|---|
| **Single** | One agent, scoped to the selection (or the page when nothing is selected). |
| **Side by side** | Select a frame. Kimo places 1 to 6 empty copies of its size (`<name> · v1`, `v2` …) to its right, and one agent drafts a variant in each, in parallel. Choose one model for all or one per agent, and whether they explore **Layout**, **Style** or **Both**. Each finished variant has **Keep** and **Discard** (which undoes it and deletes the frame). |
| **Split** | The lead agent divides the work into placeholder frames, then one agent builds each frame in parallel. Only the lead may change variables and components. |
| **Iterate** | Select a frame. The agent refines it in place one pass per turn (3 passes by default), and shows a review card after each: run the next pass with an optional steer, stop, compare **Before / After** (Before undoes the pass on the canvas, After puts it back), or go back to the original or an earlier pass. |

Agents that work on one frame (side by side, split) can only edit inside their own frame and never ask for more. While they run, a summary pill at the bottom left of the canvas shows the mode, how many agents are done and the cost; its **Stop all** (and the one on the plan card) stops them. Each edit in the plan card's log has a **Revert** icon that undoes that edit alone. Side by side and split need an API model, because Kimo runs their agents itself; Single and Iterate also work with a CLI.

## Scope

An agent's scope is the part of the page it may change: the selection in Single mode (the whole page when nothing is selected), the frame in Iterate, or its own frame for agents started by side by side and split. Kimo checks every edit against the scope, not the prompt.

## Approvals

The agent works without stopping to ask. Every edit is undoable, turn by turn, and each request that would have needed your OK is written down: a line in the agent's turn (**Approved automatically: saved landing.kimo**) and, in the desktop app, a row in the Activity tab (**approved automatically**). A file Kimo saved or exported can't be undone by Kimo.

### Ask before changes

Turn on **Ask before changes** in the composer's **…** menu to review the agent's work for this session. Kimo then asks first, in a card in the thread (**Kimo wants to …**), before the agent:

- edits layers outside its area (Single mode, or a prompt node's target),
- opens, creates, saves or exports a file,
- changes document-wide things such as variables or components, when the mode doesn't allow them (Iterate).

Answer with **Allow once**, **Always this session** or **Deny**. **Always this session** never covers file access or edits outside the area; those ask every time. The card waits as long as you need, the header shows **N waiting**, and **Stop** denies everything pending. Turning the switch off again approves the cards already waiting, and the turn carries on.

Every new session, and an earlier one you reopen, starts with the switch off.

Some limits are not approvals, so they apply either way:

- agents never open, import, save or export files in system folders or hidden folders (such as `~/.ssh`), and exports stay inside their folder,
- one edit adds at most 150 new layers (40 for agents whose edits do not stream),
- file paths are checked (an absolute `.kimo` path for documents, `..` resolved, an existing file isn't overwritten unless the call says so),
- read-only and locked documents stay read-only,
- agents started by side by side and split stay inside their own frame.

> [!NOTE]
> CLIs are started so that their own permission prompts don't interrupt (Codex runs with its tool approvals set to approve, Claude Code in its don't-ask mode), because Kimo's approvals above apply to every edit they make.

## Sessions

Each conversation is a session. **New** starts one; **History** lists the sessions for this file first, then those of other files, with search over titles and messages. Opening a session restores its model, effort, mode and skills. After the first turn the session is named automatically.

Sessions are stored on this device (in the app's browser storage), not in the `.kimo` file.

## Costs and limits

The header pill shows the session's estimated cost and tokens (`$0.38 · 41k tok`). Costs are estimated from token usage and a dated price table; models without a known price show `—`. CLIs on a subscription show **subscription** instead of dollars, and local runtimes cost `$0.00`.

**Settings › AI providers › Usage & limits** shows the estimated spend this month per provider and sets a **monthly limit**. When the limit is reached, the turn pauses after its current batch of edits (`Monthly limit reached`).
