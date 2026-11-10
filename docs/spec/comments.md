# Comments: implementation contract

Status: draft for [ADR 0020](../adr/0020-comments.md). Design: board 51 "Comments" in
`desing.kimo`. The key words MUST, SHOULD and MAY are used as in RFC 2119.

## Contents

1. Format addition (`.kimo` 1.1, feature `doc/comments`)
2. Anchors
3. Message text
4. Room channel (`kimo-mp/1` minor addition)
5. Rights
6. Read state
7. Editor behaviour
8. MCP and the built-in agent
9. Notifications and the Kimo Cloud digest

## 1. Format addition (`.kimo` 1.1, feature `doc/comments`)

Format 1.1 adds one optional root member. Everything else in the 1.0 spec is unchanged.

| Member | Required | Type | Meaning |
|---|---|---|---|
| `comments` | no | record Id → Thread (non-empty) | Comment threads. Feature `doc/comments`. |

- A writer MUST write `format: "1.1.0"` and list `doc/comments` in `features` when `comments` is
  present, and SHOULD keep writing `1.0.x` when it is absent, so comment-free files stay
  editable in 1.0 readers.
- A 1.0 reader opens a 1.1 file read-only (format §16.3). A 1.1 reader MUST preserve `comments`
  byte for byte when it does not render them (for example the CLI).
- Ids follow the node id grammar (format §3). Thread and message ids MUST NOT collide with node
  ids in the same file.

**Thread**

| Field | Required | Type | Meaning |
|---|---|---|---|
| `anchor` | yes | Anchor | Where the pin is (§2). |
| `messages` | yes | record Id → Message (non-empty) | The first message by `at` (ties by id) opens the thread. |
| `resolved` | no | `{by: Author, at: Time}` | Present while resolved. Unresolving removes it. |

**Message**

| Field | Required | Type | Meaning |
|---|---|---|---|
| `author` | yes | Author | Who wrote it. |
| `at` | yes | Time | When it was posted. |
| `text` | yes | string, 1 to 5,000 code points | Message text (§3). |
| `edited` | no | Time | Last edit. |
| `attachments` | no | string[] (1 to 5) | Asset file names (format §12): PNG, JPEG or GIF. |
| `reactions` | no | record Emoji → AuthorId[] (unique, non-empty) | Who reacted with which emoji. |

**Author**: `{id, name, kind}`. `id` is a stable author id: `acct:<account id>` on Kimo Cloud,
`dev:<device key id>` for a signed-in-free device, `agent:<origin>` for agents (the `LocalOrigin`
grammar of `@kimo/editor-state`). `name` is the display name at posting time (1 to 64 code
points). `kind` is `"person"` or `"agent"`.

**Time** is an RFC 3339 UTC timestamp with millisecond precision (`2026-11-10T09:42:07.120Z`).

Display numbers ("#12") are derived, never stored: threads sorted by their first message's `at`,
then id, numbered from 1. Comments are excluded from canonical node order, from `components`,
from validation of the node tree and from every exporter.

**Git merge** (`kimo merge`, format §18 and §21), three-way against the base:

- Threads and messages union by id. A thread or message deleted on one side and unchanged on the
  other is deleted; deleted on one side and changed on the other, the deletion wins.
- A field changed on one side only takes that side's value. Changed on both sides: for `text`
  the message with the later `edited` wins; for `resolved` the later `at` wins (an absent value
  loses to a present one); otherwise the value whose canonical JSON sorts higher wins, so the
  result is the same whichever side is "ours".
- Reaction lists merge as sets: additions from both sides, removals from both sides.
- Comments never produce stored conflicts.

New validation codes: `COMMENT_ANCHOR_INVALID` (error: anchor fields missing or out of range),
`COMMENT_EMPTY` (error: a thread with no messages), `COMMENT_ATTACHMENT_MISSING` (warning: an
attachment names no asset). A thread whose anchor node does not exist is not an error (§2).

## 2. Anchors

| Field | Required | Type | Meaning |
|---|---|---|---|
| `page` | yes | Id | Page of the pin. |
| `node` | no | Id | Top-level frame, component or group the pin moves with. |
| `x`, `y` | yes | number | With `node`: offset from the node's top-left corner. Without: page coordinates. |
| `w`, `h` | no | number > 0 | Present together for an area comment: the region's size. |
| `fallback` | no | `{x, y}` | Page coordinates written when `node` is deleted. |

- On placing a pin or area, the editor MUST set `node` when the point (or the area's top-left
  corner) lies inside a top-level frame, component or group of the current page, and otherwise
  omit it. Nested layers never anchor.
- Moving the node moves the pin; no comment write is needed.
- Deleting a node that anchors threads MUST, in the same user action, write `fallback` on each of
  them (on the comment channel, so it is not atomic with the deletion; §4). `node` is kept, so
  undoing the delete reattaches the pin.
- A thread whose `node` is missing is **detached**: it renders at `fallback` (or at the page
  origin if there is none) and the list marks it "Detached".
- Cut and paste, duplicate, and copy to another file create new node ids and leave comments where
  they were. Move to page keeps the node id; the editor MUST update `page` on its threads.

## 3. Message text

`text` is plain UTF-8 with this Markdown subset, chosen so it merges character by character in a
`Y.Text` and renders the same in the app and in email:

| Syntax | Meaning | Editor keys |
|---|---|---|
| `**bold**` | bold | ⌘B |
| `*italic*` | italic | ⌘I |
| `~strike~` | strikethrough | ⌘⇧X |
| `[label](https://…)` | link (http and https only) | ⌘K |
| `- item` / `1. item` at a line start | bullet / numbered list | ⌘⇧8 / ⌘⇧7 |
| `@[Name](author id)` | mention | `@`, then Tab or Enter |

Anything else is literal text. Renderers MUST escape HTML and MUST NOT follow other URL schemes.
A mention whose author id is unknown renders as its name without a link.

## 4. Room channel (`kimo-mp/1` minor addition)

Comments are a second Yjs document per room (the **comment doc**): a `Y.Map` of threads, each a
`Y.Map` whose `messages` hold `Y.Map`s with `text` as `Y.Text`. The local file's `comments`
member is its plain-JSON projection, written on save like the design doc.

Additions to [multiplayer.md](multiplayer.md):

- **§4 roles.** Role `3` comment becomes valid. Verification step 6 accepts 1, 2 and 3.
- **Wire role.** Kimo 1.2.x decoders accept only `view` and `edit` in `welcome`, `peers` and
  `peer-joined` (`protocol.ts` throws otherwise). The relay MUST therefore report a role 3
  connection as `view` in every relay message. A client knows it may comment from the role in its
  own token. A 1.2.x client opening a role 3 link joins as a viewer and cannot comment.
- **§9 envelopes.** Kind `5` comments-update (AAD `kimo/v1|<roomId>|comments-update`) and kind
  `6` comments-snapshot (AAD `kimo/v1|<roomId>|comments-snapshot|<upTo>`), encrypted with the
  `doc` key. The plaintext is a comment-doc update or state.
- **§11.3 `welcome`.** A trailing `varUint features` bit set; bit 0 means "comment channel".
  Client decoders already ignore trailing bytes after the known fields, so older clients are
  unaffected.
- **§11.2 client to relay.** Type `7` `append-comment` (`varUint cid`, `varUint8Array env`):
  allowed for roles comment and edit, `VIEW_ONLY` for view. Type `8` `comments-subscribe`
  (`varUint since`): sent once, after a `welcome` with bit 0. `append` (design log) from a
  comment token is `VIEW_ONLY`. Relays without the channel close on types 7 and 8
  (`BAD_MESSAGE`), so clients MUST NOT send them unless bit 0 was set.
- **§11.3 relay to client.** New types, sent only to connections that sent `comments-subscribe`:
  `27` `comment-entries` (as `entries`), `28` `comment-snapshot` (as `snapshot`), `29`
  `comment-compact` (as `compact`). Acks reuse `ack` with the shared `cid` space. Existing
  types keep their layout.
- **§14.** The relay stores a second log and snapshot per room with its own `seq`, compaction and
  quota share. Room size and the owner sweep count both. The relay cannot tell a new message from
  a reaction inside an encrypted update, so it limits comment appends to 600 an hour per token
  `jti` (`RATE_LIMITED`); clients limit new messages and replies to 100 an hour per author.
- A client that meets a relay without bit 0 keeps the comment doc local only, MUST NOT mint role
  3 links, and the Share popover says view links are read-only on this relay.

**Links.** On a relay with bit 0, the Share popover mints view links with role 3 and labels them
"Can view and comment". Existing role 1 links stay view-only until reset. Kimo Cloud mints role 3
view links for workspace files.

## 5. Rights

| Action | Who |
|---|---|
| Read comments | Anyone who can open the file |
| Start a thread, reply, react | Roles comment and edit; anyone on a local file |
| Resolve, unresolve | Roles comment and edit |
| Edit a message | Its author only |
| Delete a message | Its author; deleting a thread's first message deletes the thread |
| Delete any thread | Room owner devices (ADR 0017) and Kimo Cloud workspace owner and admins |
| Agents | Read, reply, resolve, unresolve, react; start a thread only when a person asked; never edit or delete another author's message |

The relay enforces only the first three rows (by role). Clients and the MCP server enforce the
rest; a client that receives a remote change breaking these rules still applies it (CRDT) but the
editor SHOULD flag it in the thread ("Changed by another author") so tampering is visible.

## 6. Read state

Per person and device, outside the file: `localStorage` key `kimo.comments.read.<fileKey>`, a map
of thread id to the `at` of the newest message seen. A thread is unread when it has a message
newer than that value from someone else. Opening a thread marks it read; "Mark as unread" removes
its entry; "Mark all as read" sets every thread. `fileKey` is the room id for shared files and the
file's path hash for local ones.

## 7. Editor behaviour

- **C** toggles comment mode (tool button after Component in the floating toolbar). Esc or any
  other tool leaves it. In comment mode layers cannot be selected or edited, and the right card
  shows the Comments panel in place of Design, Code and Agent.
- **Shift+C** hides or shows all pins (view preference per file, stored like other view prefs).
- Click places a pin and opens the composer; drag (more than 4 px) places an area. Send is
  disabled until the text is non-empty. Enter sends, Shift+Enter adds a line or list item.
- Pins closer than 32 screen px merge into a count pin; clicking it zooms to fit them.
- Hovering a pin grows it into a preview (author, time, first line); clicking opens the thread.
- Dragging an existing pin moves it (its own pins only for comment-role users; any pin for
  editors), re-anchoring by the rules of §2.
- Panel: search (message text and author names), sort by date or unread, filters This page / All
  pages, Only your threads, Show resolved. Choices persist per file on the device.
- Copy link copies a link without any key or token: the room id (or, for a local file, its file
  id) plus the thread id. It opens only for people who already have the file, from their local
  registry or as a workspace member on Kimo Cloud, then selects the thread and zooms to its pin.
  Giving someone new access always goes through Share, never through a comment link.
- A guest (no account, no display name in Settings) is asked for a name once, on their first
  comment; Skip posts as their presence name ("Guest 2"). The name is saved on the device and also
  becomes their presence name.
- Comment writes never enter the document undo stack. Delete asks for confirmation.

## 8. MCP and the built-in agent

One tool, `kimo_comments`:

| Action | Input | Result |
|---|---|---|
| `list` | `{docId, page?, includeResolved?, unreadOnly?}` | Threads with anchor, resolved, message count, first and last message |
| `read` | `{docId, threadId}` | The thread with every message |
| `create` | `{docId, anchor: {node?, page?, x, y, w?, h?}, text}` | The new thread id. Only when a person asked for comments |
| `reply` | `{docId, threadId, text}` | The new message id |
| `resolve` / `unresolve` | `{docId, threadId}` | `ok` |
| `react` | `{docId, messageId, emoji}` | `ok` (toggles) |

The tool description MUST tell agents to use `create` only when the person asked them to comment
(for example "leave review comments on this page"), never on their own initiative; the built-in
agent follows the same rule. The author is the calling agent (`agent:<origin>`, kind `agent`). The tool MUST refuse edits and
deletes (it offers none) and MUST respect the room role: a session on a view-only room gets
`READ_ONLY`. Agent replies are rate-limited with the same budget as §4.

## 9. Notifications and the Kimo Cloud digest

**In the app.** Comment tool badge: unread threads on the current page while comment mode is off.
Toast for a new thread or reply from someone else while the file is open. Desktop notification
for a mention of you or a reply in a thread you wrote or replied to, only while Kimo is in the
background, per the Settings › Notifications "Desktop alerts" choice.

**Kimo Cloud email.** Kimo Cloud reads the comment doc of workspace rooms (it holds their keys,
ADR 0019) and, per file and recipient:

1. Collects events: mentions of the recipient, replies in threads they wrote or replied to, and
   (with "All comments") every new thread or reply. The recipient's own messages never count.
2. Sends one digest 15 minutes after the last new comment in that file, and at most once an hour
   per file and recipient. Mentions come first, then the other comments, each with author, frame
   name and text, and one "Open in Kimo" link.
3. Recipients are workspace members with "Comment emails" not Off. Guests on view links get no
   email. The unsubscribe link turns that member's Comment emails to Off for every file.

Self-hosted relays send no email. The digest is the only place Kimo Cloud uses comment text; the
privacy page MUST list it before the feature ships.
