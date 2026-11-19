/**
 * `kimo_comments` (docs/spec/comments.md §8): agents read, reply, resolve and react. They start a
 * thread only when a person asked them to comment. There is no edit or delete. Input
 * descriptions are short: every model call carries them (details in the tools guide).
 */
import { Arr, Bool, Enum, Int, Num, Obj, Opt, Str } from "../schema"
import { ALL_HOSTS, defineTool, docId, WRITE } from "./define"

export const COMMENT_ACTIONS = [
  "list",
  "read",
  "create",
  "reply",
  "resolve",
  "unresolve",
  "react",
] as const

const Author = Obj(
  {
    name: Str({ description: "Display name." }),
    kind: Enum(["person", "agent"], { description: "Person or agent." }),
    id: Str({ description: "Author id (acct:, dev: or agent:)." }),
  },
  { description: "Who wrote it." },
)

const Message = (description: string) =>
  Obj(
    {
      id: Str({ description: "Message id." }),
      author: Author,
      at: Str({ description: "Posted at (RFC 3339)." }),
      text: Str({ description: "Text: Markdown subset, mentions as @[Name](id)." }),
      edited: Opt(Str({ description: "Last edit." })),
      reactions: Opt(
        Arr(
          Obj(
            {
              emoji: Str({ description: "Emoji." }),
              count: Int({ description: "How many reacted.", minimum: 1 }),
            },
            { description: "One reaction." },
          ),
          { description: "Reactions." },
        ),
      ),
      images: Opt(Int({ description: "Attached images.", minimum: 1 })),
    },
    { description },
  )

const Anchor = Obj(
  {
    page: Opt(Str({ description: "Page id." })),
    node: Opt(Str({ description: "Top-level frame, component or group the pin moves with." })),
    x: Num({ description: "With node: offset from its top-left. Without: page coordinates." }),
    y: Num({ description: "Y, as x." }),
    w: Opt(Num({ description: "Area width.", minimum: 0 })),
    h: Opt(Num({ description: "Area height.", minimum: 0 })),
    detached: Opt(Bool({ description: "The anchored node was deleted." })),
  },
  { description: "Where the pin is." },
)

export const kimoComments = defineTool({
  name: "kimo_comments",
  title: "Comments",
  description: "Canvas comments (guide tools). create only when the person asked you to comment.",
  input: Obj({
    docId,
    action: Enum(COMMENT_ACTIONS, { description: "Action." }),
    threadId: Opt(Str({ description: "Thread." })),
    messageId: Opt(Str({ description: "Message." })),
    text: Opt(Str({ description: "Text.", minLength: 1, maxLength: 5000 })),
    emoji: Opt(Str({ description: "Emoji.", minLength: 1, maxLength: 32 })),
    node: Opt(Str({ description: "Pin frame." })),
    page: Opt(Str({ description: "Page." })),
    x: Opt(Num({ description: "X." })),
    y: Opt(Num({ description: "Y." })),
    w: Opt(Num({ description: "Area w.", minimum: 1 })),
    h: Opt(Num({ description: "Area h.", minimum: 1 })),
    includeResolved: Opt(Bool({ description: "list." })),
    unreadOnly: Opt(Bool({ description: "list." })),
  }),
  data: Obj({
    threads: Opt(
      Arr(
        Obj(
          {
            id: Str({ description: "Thread id." }),
            number: Int({ description: "Display number (#n).", minimum: 1 }),
            anchor: Anchor,
            resolved: Bool({ description: "Resolved." }),
            messageCount: Int({ description: "Messages.", minimum: 1 }),
            first: Message("The opening message."),
            last: Opt(Message("The latest reply.")),
          },
          { description: "One thread." },
        ),
        { description: "list." },
      ),
    ),
    thread: Opt(
      Obj(
        {
          id: Str({ description: "Thread id." }),
          number: Int({ description: "Display number.", minimum: 1 }),
          anchor: Anchor,
          resolved: Bool({ description: "Resolved." }),
          messages: Arr(Message("One message."), { description: "Opening message first." }),
        },
        { description: "read." },
      ),
    ),
    threadId: Opt(Str({ description: "create: the new thread." })),
    messageId: Opt(Str({ description: "create / reply: the new message." })),
    reacted: Opt(Bool({ description: "react: the reaction is now on." })),
  }),
  annotations: WRITE,
  scope: "read",
  scopeFor: (i) => (i.action === "list" || i.action === "read" ? "read" : "edit"),
  doc: "required",
  mutating: false,
  timeoutMs: 30_000,
  availability: ALL_HOSTS,
  status: "m5",
})
