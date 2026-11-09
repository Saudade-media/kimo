# 0020. Comments: threads live in the file, sync on their own room channel, and viewers can write them

- **Status:** Proposed
- **Date:** 2026-11-10
- **Deciders:** project owner
- **Teardown refs:** 12 (v2 multiplayer)
- **Builds on:** [0005](0005-kimo-file-format.md) (file format), [0016](0016-multiplayer-transport-and-sessions.md)
  (relay, capability links), [0019](0019-kimo-cloud-workspaces.md) (Kimo Cloud holds the keys)
- **Design:** board 51 "Comments" in `desing.kimo` (page Editor)
- **Contract:** [docs/spec/comments.md](../spec/comments.md)

## Context

People review designs in Figma by pinning comments to the canvas: press C, click or drag, write,
reply, react, resolve. Kimo has sticky notes (`note` nodes) but nothing that a reviewer without
edit rights can leave, nothing threaded and nothing that tells you someone answered. The owner
asked for comments "exactly like Figma" and settled the product questions on 2026-11-10:

- Comments live in the file. A local file keeps them on disk; a shared file (self-hosted room or
  Kimo Cloud) keeps them in its room. They work on unshared files too.
- Editors and viewers comment. Authors edit and delete their own messages; anyone who can comment
  resolves; file owners and Cloud admins may delete any thread.
- v1 has pins and area comments, replies, emoji reactions, @mentions, up to 5 images, rich text,
  unread state, sort and filters, links to a thread, Shift+C to hide, a guest name prompt.
- Pins attach to top-level frames, components and groups, as in Figma.
- Agents read, reply and resolve through MCP. They never delete a person's comment.
- Exports never include comments.
- Notifications: in the app, plus a Kimo Cloud email digest sent after the comments go quiet.

Facts that shape the answer:

- **The relay is blind.** It stores encrypted Yjs updates (spec §9) and checks only the token
  role: `view` reads, `edit` appends (§11.2). It cannot tell a comment from a layer inside one
  encrypted update, so "viewers may comment but not edit" cannot be enforced on the design log.
- **The role is already reserved.** Capability tokens define `role = 3` "comment", which v2.0
  relays reject with `ROLE_UNSUPPORTED` (§4).
- **Older readers are safe by rule.** A reader that sees a newer format minor, or a feature it
  does not know, opens the file read-only (format spec §13, §16.3). It never saves and so never
  drops data it cannot read.
- **Kimo Cloud already decrypts rooms** it holds keys for (0019), so it can read comment text to
  send email. Self-hosted relays cannot.

## Decision

Comments are a new optional root member of the `.kimo` file, `comments`, behind the feature
`doc/comments` and format 1.1. In a room they travel on a second encrypted channel next to the
design log, so the relay can let `comment` tokens write comments and nothing else.

1. **File.** Root `comments` is a record of threads keyed by id. A thread holds its anchor, an
   optional resolution, and a record of messages keyed by id. Message text is a small Markdown
   subset with mention tokens. The exact schema is in the contract. A writer emits format
   `1.1.0` and lists `doc/comments` only when the file has at least one thread, so files without
   comments stay `1.0.x` and keep opening for editing in older Kimo.
2. **Anchors.** A pin or area dropped inside a top-level frame, component or group stores that
   node id and an offset within it, so it moves with the node. Anywhere else it stores page
   coordinates. When a client deletes an anchored node it also writes a `fallback` position on
   each affected thread; a thread whose node is gone shows at its fallback and is listed as
   Detached. Undo of the delete reattaches it because the node id is kept. Copying or cutting a
   frame does not move its comments, as in Figma.
3. **Room channel.** Comments are a separate Yjs document per room with their own envelope kinds
   (`comments-update`, `comments-snapshot`), their own sequence and their own compaction. Relays
   accept a comment append from `comment` and `edit` tokens and refuse it from `view`. A `comment`
   token can read everything a `view` token reads. This is a protocol minor bump: the relay
   advertises support in `welcome`; a client that meets an older relay keeps view links
   read-only and says so in the Share popover.
4. **Links.** On a relay that supports it, "view" links minted from now on carry role `comment`
   (shown as "Can view and comment"). Links minted before keep role `view`. Kimo Cloud mints
   view links the same way.
5. **Rights.** The relay enforces only "who may write comments". Authorship rules (edit and
   delete your own, owners delete any, agents never delete people's comments) are enforced by
   every Kimo client and by the MCP server, the same trust model as presence and claims. A
   malicious client with a comment token can still rewrite other people's comments; the room
   owner's remedy is to revoke the link.
6. **Undo and export.** Comment changes never enter the document undo stack; delete asks for
   confirmation instead. Every exporter ignores `comments`.
7. **Read state** is local to each person and device (a per-file map of thread id to the last
   message seen), never in the file or the room.
8. **Agents.** The MCP server gets one `kimo_comments` tool (list, read, reply, resolve,
   unresolve) and the built-in agent the same capability. Agent messages carry the agent as
   author. Agents may not edit or delete messages they did not write.
9. **Notifications.** In the app: a count on the Comment tool, a toast for live comments in the
   room, desktop notifications for mentions and replies to you while Kimo is in the background.
   Kimo Cloud email: one digest per file and recipient, sent 15 minutes after the last new comment
   in that file and at most once an hour, mentions first. Default: mentions and replies to your
   threads; Settings offers All comments and Off. Only workspace members get email. Self-hosted
   relays send none.
10. **Attachments** are file assets (format §12), synced as room blobs (multiplayer §10), at most
    5 per message, PNG, JPEG or GIF. Deleting the message drops the reference; the bytes go at the
    next owner-triggered asset sweep.

## Consequences

- Reviewers without edit rights can finally give feedback inside Kimo, which matches how
  Figma teams already work and is a reason to pick Kimo Cloud.
- The relay gains a second log per room, a new role, two envelope kinds and a client message.
  Room storage, quotas, compaction and the owner sweep each count both logs. Relay tests must
  cover a `view` token refused on the comment channel and a `comment` token refused on the
  design channel.
- Kimo Cloud starts reading comment text to build the digest, a new processing purpose. The
  kimo-site Privacy page must say so before the digest ships.
- Files with comments need the Kimo release that ships comments to edit; older versions open
  them read-only. The
  release notes must say this.
- Authorship is not cryptographically enforced. Signing each message with the author's device
  key would fix that later without a format break (an optional `sig` field).
- The editor gains a tool mode, a right panel, canvas overlays and new keyboard shortcuts
  (C, Shift+C), all designed on board 51 before any code.

## Alternatives considered

- **Comments inside the design Yjs document.** One log, no protocol change. Rejected: the blind
  relay could not stop a view link from editing layers, and comments would share undo and
  compaction with the design.
- **A Kimo Cloud comment service.** Simplest for email and moderation, as in Figma. Rejected:
  local files and self-hosted rooms would have no comments, and the owner wants them in the file.
- **A sidecar file (`.kimo-comments`).** Keeps the design file clean. Rejected: it gets lost when
  a file is moved or sent, and git diffs would split one review across two files.
- **A third "Can comment" link type next to view and edit.** Rejected by the owner: view links
  comment, as in Figma.
- **Immediate email per mention.** Rejected by the owner in favour of a debounced digest.

## Revisit when

- Kimo needs comments from people outside a workspace on Kimo Cloud (email would need guests'
  addresses).
- Message signing is wanted to prove authorship on self-hosted relays.
- Agents should start threads on their own (for example a review pass), not only reply.
