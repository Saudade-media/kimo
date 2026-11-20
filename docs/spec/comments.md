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
- A 1.1 reader treats 1.0 files as current: 1.1 only adds a member, so there is no migration and
  no upgrade consent.
- A 1.0 reader opens a 1.1 file read-only (format §16.3). A 1.1 reader MUST preserve `comments`
  byte for byte when it does not render them (for example the CLI).
- Ids follow the node id grammar (format §3). Thread and message ids MUST NOT collide with node
  ids, nor with each other, in the same file (`COMMENT_ID_COLLISION`).

**Thread**

| Field | Required | Type | Meaning |
|---|---|---|---|
| `anchor` | yes | Anchor | Where the pin is (§2). |
| `first` | yes | Id | The opening message. Set once and never changed. |
| `messages` | yes | record Id → Message (non-empty) | The thread's messages, shown by `at`, ties by id. |
| `resolved` | no | `{by: Author, at: Time}` | Present while resolved. Unresolving removes it. |

**Message**

| Field | Required | Type | Meaning |
|---|---|---|---|
| `author` | yes | Author | Who wrote it. |
| `at` | yes | Time | When it was posted. |
| `text` | yes | string, 1 to 5,000 code points | Message text (§3). |
| `edited` | no | Time | Last edit. |
| `attachments` | no | Attachment[] (1 to 5) | Images attached to the message. |
| `reactions` | no | record Emoji → AuthorId[] (unique, non-empty) | Who reacted with which emoji. |

**Attachment**: `{file, mime, sha256, width?, height?}`. `file` is a content-addressed asset file
name under `assets/` (format §12), `mime` is `image/png`, `image/jpeg` or `image/gif`, `sha256` is
the full lowercase hex digest. The entry lives in the message, not in the root `assets` manifest,
because comment-only participants cannot write the design document. Asset garbage collection
counts attachments as references.

**Author**: `{id, name, kind}`. `id` is a stable author id: `acct:<account id>` on Kimo Cloud,
`dev:<device public key>` for a device without an account (base64url of its 32-byte Ed25519 key, ADR 0017), `agent:<origin>` for agents (the `LocalOrigin`
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
`COMMENT_EMPTY` (error: a thread with no messages, or whose `first` names no message),
`COMMENT_ID_COLLISION` (error: a thread or message id used twice, or by a node),
`COMMENT_ATTACHMENT_MISSING` (warning: an attachment's file is not in `assets/`). A thread whose anchor node does not exist is not an error (§2).

## 2. Anchors

| Field | Required | Type | Meaning |
|---|---|---|---|
| `page` | no | Id | Page of the pin. Absent: the first page (a file without `pages`). |
| `node` | no | Id | Top-level frame, component or group the pin moves with. |
| `x`, `y` | yes | number | With `node`: offset from the node's top-left corner. Without: page coordinates. |
| `w`, `h` | no | number > 0 | Present together for an area comment: the region's size. |
| `fallback` | with `node` | `{x, y}` | Page coordinates of the pin, used when `node` is gone. |

- On placing a pin or area, the editor MUST set `node` when the point (or the area's top-left
  corner) lies inside a top-level frame, component or group of the current page, and otherwise
  omit it. Nested layers never anchor.
- An anchored thread MUST get `fallback` when it is created and whenever its pin is dragged, so a
  thread created while another person deletes its node still has a sensible position.
- Moving the node moves the pin; no comment write is needed, so `fallback` can lag behind.
- Deleting a node that anchors threads MUST, in the same user action, refresh `fallback` on each
  of them (on the comment channel, so it is not atomic with the deletion; §4). `node` is kept,
  so undoing the delete reattaches the pin.
- A thread whose `node` is missing is **detached**: it renders at `fallback` (or at the page
  origin for files written without one) and the list marks it "Detached".
- Cut and paste, duplicate, and copy to another file create new node ids and leave comments where
  they were. Move to page keeps the node id; the editor MUST update `page` on its threads.

## 3. Message text

`text` is plain UTF-8 with this Markdown subset, chosen so it renders the same in the app and in
email. Only the author edits a message, so an edit replaces the whole text:

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

In a room, comments are a log of signed **changes** (the comment log), next to the design log. A
client's comment state is the fold of the changes it holds, in log order (4.3). The local file's
`comments` member is that state's plain-JSON projection, written on save like the design doc.
Local files have no changes and no signatures: the editor checks authorship by author id.

### 4.1 Changes

A change is canonical JSON (format §17 key order, no whitespace), UTF-8, at most 32 KiB:

| Field | Type | Meaning |
|---|---|---|
| `v` | `1` | Change version. |
| `id` | Id | Unique change id. |
| `n` | uint | Per signing key, strictly increasing (ms clock, bumped on ties). |
| `base` | uint | Highest comment position (4.3) the writer had applied. |
| `at` | Time | When it was written. |
| `op` | string | One of the operations below, with its fields. |

| `op` | Fields | Who may |
|---|---|---|
| `thread` | `thread, message, anchor, author, text, attachments?` | Any key. |
| `reply` | `thread, message, author, text, attachments?` | Any key. |
| `edit` | `thread, message, text` | The message's owner key. |
| `delete` | `thread, message?` | The message's owner key, or the root key. No `message`, or the first message: the thread (its first message's owner, or the root key). |
| `resolve` | `thread, by` (Author or null) | Any key. |
| `anchor` | `thread, anchor` | Any key. |
| `react` | `thread, message, emoji, author, on` | Any key, for its own reaction. |
| `import` | `thread, data` (a Thread, §1) | The root key only. |

- **Signature.** Ed25519 by the writer's device key over `"kimo/v1/comment|<roomId>\0" || body`,
  so a change signed for one room is invalid in every other. Receivers verify the bytes they
  received, then parse them; they never re-serialize to check a signature.
- **Root key.** A change whose key is the room root public key (`roomMatchesRootKey`) acts as
  the owner. Owner devices and Kimo Cloud admin clients hold it.
- **Owner key.** A message is owned by the key of the change that created it. In an `import`,
  a message whose author is `dev:X` is owned by key X, any other by the root key.
- **Authors.** In `thread`, `reply`, `resolve.by` and `react.author`, an author id `dev:X` MUST
  equal the signing key (X = base64url key); otherwise the change is invalid. `acct:` and
  `agent:` ids and display names are claims (the relay and Kimo Cloud do not attest them).

### 4.2 Wire

- **Envelope kind `5`** comments-update (AAD `kimo/v1|<roomId>|comments-update`), `doc` key.
  Plaintext: `varUint count` (1 to 256), then per change `key[32] || sig[64] ||
  varUint8Array body`.
- **Envelope kind `6`** comments-snapshot (AAD `kimo/v1|<roomId>|comments-snapshot|<upTo>`).
  Plaintext: `varUint count`, then per change `varUint position` followed by the change as in
  kind 5. A snapshot keeps every change's original position.

### 4.3 Fold

The position of change `i` (from 0) in comment log entry `seq` is `seq * 256 + i`. Changes are
applied in position order; a change already held (same `id`) is skipped, and so is an invalid
one, without stopping the fold.

- A change whose `base` is not below its own position is invalid.
- `thread` and `reply` create a message whose id is new (never held, never deleted, not a node
  id). `reply` needs a live thread.
- `delete` leaves a **tombstone** for each id it names. An id that is held must be deleted
  through its own thread by the key that wrote it, or by the root key; otherwise the delete is
  invalid. A delete of an id not held (after compaction its creating change is gone) is a
  tombstone for the deleting key only: it drops later creations of that id signed by that key.
  Root key and local file deletes drop every later change for the id. Deleting a thread
  tombstones the ids the change names, not its other messages, so a fold from a compacted
  snapshot agrees with a full fold.
- Reaction emoji are keys of a plain map in the file, so any string the parser accepts (even
  `constructor` or `__proto__`) is an ordinary key; readers MUST use own-property lookups.
- **Last writer, by log order.** `edit`, `resolve`, `anchor` and each reaction (message, emoji,
  key) hold one value set by one change S. A change C replaces it when `C.base >= position(S)`
  (C's writer had seen S), or when C and S have the same key and `C.n > S.n`. Otherwise C is
  ignored: of two concurrent writes the first in the log stays, and a replayed old change never
  wins.
- Local changes not yet acknowledged apply after every received change, in the order written.

### 4.4 Relay

Additions to [multiplayer.md](multiplayer.md):

- **§4 roles.** Role `3` comment becomes valid. Verification step 6 accepts 1, 2 and 3.
- **Wire role.** Kimo 1.2.x decoders accept only `view` and `edit` in `welcome`, `peers` and
  `peer-joined` (`protocol.ts` throws otherwise). The relay MUST therefore report a role 3
  connection as `view` in every relay message. A client knows it may comment from the role in its
  own token. A 1.2.x client opening a role 3 link joins as a viewer and cannot comment.
- **§11.3 `welcome`.** A trailing `varUint features`; bit 0 means "comment channel", followed
  (bit 0 only) by `varUint commentHead`, `varUint commentBase` and the comment snapshot as
  `flag`, then `upTo`, `gen`, `bytes`. Client decoders already ignore trailing bytes.
- **§11.2 client to relay.** Type `7` `append-comment` (`varUint cid`, `varUint8Array env`):
  roles comment and edit, `VIEW_ONLY` for view. Type `8` `comments-subscribe` (`varUint
  since`): sent once, after a `welcome` with bit 0. `append` (design log) from a comment token
  is `VIEW_ONLY`. Relays without the channel close on types 7 and 8 (`BAD_MESSAGE`), so
  clients MUST NOT send them unless bit 0 was set.
- **§11.3 relay to client.** Sent only to connections that sent `comments-subscribe`: `27`
  `comment-entries` (as `entries`), `28` `comment-snapshot` (as `snapshot`), `29`
  `comment-compact` (as `compact`). Acks of type 7 are type `30` `comment-ack` (`cid`, `seq`),
  so the two logs' sequences never mix. Existing types keep their layout.
- **§14.** The relay stores a second log and snapshot per room with its own `seq`. Room size and
  the owner sweep count both. The relay cannot tell a message from a reaction inside an envelope,
  so it limits comment appends to 600 an hour per token `jti`, and to 200 an hour per `jti` and
  client address, so one reviewer on a shared link cannot spend everyone's budget
  (`RATE_LIMITED`). Clients limit new messages and replies to 100 an hour per author.
- **Comment storage.** Writes by a comment token (comment log appends and blob uploads) count
  against a separate budget, `KIMO_COMMENT_QUOTA_MB` (default 50, at most the room quota): the
  comment log, the comment snapshot and blobs comment tokens uploaded. A comment token also may
  not take the comment log past half of `KIMO_LOG_MAX_MB`. Past either it gets
  `QUOTA_EXCEEDED`, so editors can always write and compact. Comment tokens' uploads have their
  own byte rate bucket per room.
- **§12 HTTP.** `GET /room/<room>/comments/snapshot` (any role) and `PUT
  /room/<room>/comments/snapshot?upTo=<n>` (edit only) work like the design snapshot routes,
  with the comment log's `seq`. A comment token MUST NOT upload a snapshot, because a snapshot
  could leave out other people's changes. `comment-compact` goes to the lowest subscribed edit
  peer. `comments-subscribe` answers with `comment-snapshot` when `since` is below the comment
  log's base; the client downloads it, then entries follow.
- **Compaction.** A snapshot keeps every tombstone change, every creating change of a live
  message, and each change that holds a current value (4.3). It drops the rest.
- **Re-append.** After catch-up a client appends again, unchanged, the changes it holds that
  created a live message or hold a current value and that the room lacks (a relay that lost
  data, or an edit peer's bad snapshot). They are verified like any change, and duplicates are
  skipped.
- **§12 blobs.** `PUT /blob` accepts comment tokens too, so a reviewer can upload an attachment.
  Receivers find the blob from the attachment's own `sha256` (§1), exactly as for a manifest entry
  (§10, §16.4), and store it in their asset store under `file`.
- **Authority.** In a room the comment log is authoritative. A client with a room replica ignores
  the file's `comments`. Without one, the owner device (root key) appends one `import` per
  thread the room lacks; other clients ignore the file's threads until then. A 1.2.x edit
  client never sees the log, so a file it saves has no `comments`, which never deletes anything.
- A client that meets a relay without bit 0 keeps comments local only, MUST NOT mint role 3
  links, and the Share popover says view links are read-only on this relay.

**Links.** On a relay with bit 0, the Share popover mints view links with role 3 and labels them
"Can view and comment". Existing role 1 links stay view-only until reset. Kimo Cloud mints role 3
view links for workspace files.

## 5. Rights

| Action | Who |
|---|---|
| Read comments | Anyone who can open the file |
| Start a thread, reply, react | Roles comment and edit; anyone on a local file |
| Resolve, unresolve, move a pin | Roles comment and edit |
| Edit a message | Its author, on the device that wrote it |
| Delete a message | Its author; deleting a thread's first message deletes the thread |
| Delete any thread | Holders of the room root key: owner devices and Kimo Cloud workspace owners and admins |
| Agents | Read, reply, resolve, unresolve, react; start a thread only when a person asked; never edit or delete another author's message |

The relay enforces the first three rows by role. The signatures of §4.1 enforce the rest on every
client: a change that breaks them is dropped. On a local file the editor and the MCP server check
the author id.

## 6. Read state

Per person and device, outside the file: `localStorage` key `kimo.comments.read.<fileKey>`, a map
of thread id to the ids of the messages seen. A thread is unread when it has a message from
someone else that is not in its list, so clock skew and late updates never hide a message. Opening a thread marks it read; "Mark as unread" removes
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

**Kimo Cloud email.** Kimo Cloud reads the comment log of workspace rooms (it holds their keys,
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
