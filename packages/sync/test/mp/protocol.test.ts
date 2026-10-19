import { describe, expect, test } from "bun:test"
import * as encoding from "lib0/encoding"
import {
  type ClientMessage,
  ClientType,
  DEFAULT_LIMITS,
  decodeClientMessage,
  decodeRelayMessage,
  encodeClientMessage,
  encodeRelayMessage,
  type RelayMessage,
  RelayType,
  utf8,
} from "../../src/mp"
import { expectCode } from "./helpers"

const MAX = Number.MAX_SAFE_INTEGER
const env = new Uint8Array([1, 4, 9, 16, 25])

const clientMessages: ClientMessage[] = [
  { type: "hello", proto: 1, token: "AQECAQ-_", since: 0, client: "kimo-web/2.0.0" },
  { type: "hello", proto: 7, token: "", since: MAX, client: "" },
  { type: "append", cid: 1, env },
  { type: "append", cid: MAX, env: new Uint8Array(0) },
  { type: "awareness", clock: 3, env },
  { type: "awareness", clock: 4, env: new Uint8Array(0) },
  { type: "caught-up", seq: 42 },
  { type: "refresh", token: "abc" },
  { type: "ping", n: 0 },
]

const relayMessages: RelayMessage[] = [
  {
    type: "welcome",
    peer: 3,
    role: "edit",
    origin: "user",
    exp: 0,
    kid: 2,
    head: 100,
    base: 40,
    from: 61,
    needSnapshot: true,
    snapshot: { upTo: 60, gen: 4, bytes: 12345 },
    limits: DEFAULT_LIMITS,
    peers: [
      { peer: 1, role: "view", origin: "user" },
      { peer: 2, role: "edit", origin: "agent:claude" },
    ],
  },
  {
    type: "welcome",
    peer: 1,
    role: "view",
    origin: "mcp:x",
    exp: MAX,
    kid: 1,
    head: 0,
    base: 0,
    from: 1,
    needSnapshot: false,
    snapshot: null,
    limits: { ...DEFAULT_LIMITS, awarenessHz: 5 },
    peers: [],
  },
  {
    type: "entries",
    entries: [
      { seq: 1, origin: "user", env },
      { seq: MAX, origin: "agent:a/b", env: new Uint8Array(0) },
    ],
  },
  { type: "entries", entries: [] },
  { type: "ack", cid: 7, seq: 99 },
  { type: "awareness", peer: 2, clock: 5, env },
  { type: "awareness", peer: 2, clock: 6, env: new Uint8Array(0) },
  { type: "peer-joined", peer: { peer: 9, role: "edit", origin: "agent:bot" } },
  { type: "peer-left", peer: 9 },
  { type: "snapshot", info: { upTo: 10, gen: 2, bytes: 3000 }, carriesNew: true },
  { type: "snapshot", info: { upTo: 0, gen: 1, bytes: 30 }, carriesNew: false },
  { type: "compact", upTo: 1000 },
  { type: "denied", code: "VIEW_ONLY", cid: 3, message: "view-only link" },
  { type: "denied", code: "TOO_LARGE", cid: 0, message: "" },
  { type: "token", exp: 1_800_000_000 },
  { type: "pong", n: MAX },
]

describe("client messages", () => {
  test("every type round trips", () => {
    for (const message of clientMessages)
      expect(decodeClientMessage(encodeClientMessage(message))).toEqual(message)
  })

  test("the first varUint is the type number", () => {
    expect(encodeClientMessage({ type: "ping", n: 5 })).toEqual(
      new Uint8Array([ClientType.ping, 5]),
    )
    expect(encodeClientMessage({ type: "caught-up", seq: 300 })).toEqual(
      new Uint8Array([4, 0xac, 0x02]),
    )
  })

  test("unknown types, truncation and trailing bytes are BAD_MESSAGE", async () => {
    await expectCode(() => decodeClientMessage(new Uint8Array([0])), "BAD_MESSAGE")
    await expectCode(() => decodeClientMessage(new Uint8Array([16, 1])), "BAD_MESSAGE")
    await expectCode(() => decodeClientMessage(new Uint8Array([99])), "BAD_MESSAGE")
    await expectCode(() => decodeClientMessage(new Uint8Array()), "BAD_MESSAGE")
    for (const message of clientMessages) {
      const bytes = encodeClientMessage(message)
      for (let n = 0; n < bytes.length; n++)
        await expectCode(() => decodeClientMessage(bytes.subarray(0, n)), "BAD_MESSAGE")
      await expectCode(() => decodeClientMessage(new Uint8Array([...bytes, 0])), "BAD_MESSAGE")
    }
  })

  test("over-long client info, over-long token and bad UTF-8 are BAD_MESSAGE", async () => {
    const hello = (client: string, token = "t") =>
      encodeClientMessage({ type: "hello", proto: 1, token, since: 0, client })
    expect(decodeClientMessage(hello("x".repeat(64)))).toMatchObject({ client: "x".repeat(64) })
    // Hand-encoded, since the encoder refuses these (see the next test).
    const raw = (type: number, ...strings: string[]) => {
      const e = encoding.createEncoder()
      encoding.writeVarUint(e, type)
      if (type === ClientType.hello) encoding.writeVarUint(e, 1)
      encoding.writeVarUint8Array(e, utf8(strings[0] as string))
      if (type === ClientType.hello) {
        encoding.writeVarUint(e, 0)
        encoding.writeVarUint8Array(e, utf8(strings[1] as string))
      }
      return encoding.toUint8Array(e)
    }
    await expectCode(
      () => decodeClientMessage(raw(ClientType.hello, "t", "x".repeat(65))),
      "BAD_MESSAGE",
    )
    await expectCode(
      () => decodeClientMessage(raw(ClientType.hello, "t".repeat(5000), "c")),
      "BAD_MESSAGE",
    )
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, ClientType.refresh)
    encoding.writeVarUint8Array(e, new Uint8Array([0xc3, 0x28]))
    await expectCode(() => decodeClientMessage(encoding.toUint8Array(e)), "BAD_MESSAGE")
  })

  test("the encoder enforces the limits the relay's decoder does", async () => {
    const hello = (token: string, client: string) =>
      encodeClientMessage({ type: "hello", proto: 1, token, since: 0, client })
    // 65 UTF-8 bytes in 33 characters: the limit is bytes, not characters.
    await expectCode(() => hello("t", "\u00e9".repeat(33)), "BAD_MESSAGE")
    await expectCode(() => hello("t", "x".repeat(65)), "BAD_MESSAGE")
    await expectCode(() => hello("t".repeat(4097), "c"), "BAD_MESSAGE")
    await expectCode(
      () => encodeClientMessage({ type: "refresh", token: "t".repeat(4097) }),
      "BAD_MESSAGE",
    )
    expect(decodeClientMessage(hello("t".repeat(4096), "x".repeat(64)))).toMatchObject({
      type: "hello",
    })
  })

  test("varUint values above 2^53 - 1 are BAD_MESSAGE", async () => {
    // 2^56 as a varUint: eight continuation bytes then 1.
    const big = new Uint8Array([ClientType.ping, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 1])
    await expectCode(() => decodeClientMessage(big), "BAD_MESSAGE")
  })

  test("encoding refuses values the codec cannot carry", async () => {
    await expectCode(() => encodeClientMessage({ type: "ping", n: -1 }), "BAD_MESSAGE")
    await expectCode(() => encodeClientMessage({ type: "ping", n: 1.5 }), "BAD_MESSAGE")
    await expectCode(() => encodeClientMessage({ type: "ping", n: 2 ** 53 }), "BAD_MESSAGE")
    await expectCode(
      () => encodeClientMessage({ type: "nope" } as unknown as ClientMessage),
      "BAD_MESSAGE",
    )
  })

  test("decoded byte fields are copies, not views into the frame", () => {
    const frame = encodeClientMessage({ type: "append", cid: 1, env })
    const decoded = decodeClientMessage(frame) as { env: Uint8Array }
    frame.fill(0)
    expect(decoded.env).toEqual(env)
  })
})

describe("relay messages", () => {
  test("every type round trips", () => {
    for (const message of relayMessages)
      expect(decodeRelayMessage(encodeRelayMessage(message))).toEqual(message)
  })

  test("type numbers", () => {
    for (const message of relayMessages) {
      const type = encodeRelayMessage(message)[0] as number
      expect(Object.values(RelayType) as number[]).toContain(type)
    }
  })

  test("an unknown relay type decodes to null", () => {
    expect(decodeRelayMessage(new Uint8Array([99, 1, 2, 3]))).toBeNull()
    expect(decodeRelayMessage(new Uint8Array([1]))).toBeNull()
  })

  test("truncated frames throw BAD_MESSAGE", async () => {
    await expectCode(() => decodeRelayMessage(new Uint8Array()), "BAD_MESSAGE")
    for (const message of relayMessages) {
      const bytes = encodeRelayMessage(message)
      for (let n = 1; n < bytes.length; n++)
        await expectCode(() => decodeRelayMessage(bytes.subarray(0, n)), "BAD_MESSAGE")
    }
  })

  test("trailing bytes after known fields are ignored (forward compatible)", () => {
    const bytes = encodeRelayMessage({ type: "ack", cid: 1, seq: 2 })
    expect(decodeRelayMessage(new Uint8Array([...bytes, 7, 7]))).toEqual({
      type: "ack",
      cid: 1,
      seq: 2,
    })
  })

  test("invalid roles, origins and flags are BAD_MESSAGE", async () => {
    const peerJoined = (role: string, origin: string) => {
      const e = encoding.createEncoder()
      encoding.writeVarUint(e, RelayType.peerJoined)
      encoding.writeVarUint(e, 1)
      encoding.writeVarString(e, role)
      encoding.writeVarString(e, origin)
      return encoding.toUint8Array(e)
    }
    expect(decodeRelayMessage(peerJoined("edit", "user"))).toBeTruthy()
    await expectCode(() => decodeRelayMessage(peerJoined("comment", "user")), "BAD_MESSAGE")
    await expectCode(() => decodeRelayMessage(peerJoined("edit", "system")), "BAD_MESSAGE")
    const snapshot = new Uint8Array([RelayType.snapshot, 1, 1, 1, 2])
    await expectCode(() => decodeRelayMessage(snapshot), "BAD_MESSAGE")
  })

  test("a count larger than the frame is BAD_MESSAGE without looping", async () => {
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, RelayType.entries)
    encoding.writeVarUint(e, MAX)
    await expectCode(() => decodeRelayMessage(encoding.toUint8Array(e)), "BAD_MESSAGE")
  })

  test("an unknown denied code decodes as INTERNAL and keeps the code in the message", () => {
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, RelayType.denied)
    encoding.writeVarString(e, "FUTURE_CODE")
    encoding.writeVarUint(e, 4)
    encoding.writeVarString(e, "later")
    expect(decodeRelayMessage(encoding.toUint8Array(e))).toEqual({
      type: "denied",
      code: "INTERNAL",
      cid: 4,
      message: "FUTURE_CODE: later",
    })
  })

  test("encoding validates roles, origins and codes", async () => {
    await expectCode(
      () =>
        encodeRelayMessage({
          type: "peer-joined",
          peer: { peer: 1, role: "comment" as never, origin: "user" },
        }),
      "BAD_MESSAGE",
    )
    await expectCode(
      () =>
        encodeRelayMessage({ type: "entries", entries: [{ seq: 1, origin: "x" as never, env }] }),
      "BAD_MESSAGE",
    )
    await expectCode(
      () => encodeRelayMessage({ type: "denied", code: "NOPE" as never, cid: 0, message: "" }),
      "BAD_MESSAGE",
    )
  })

  test("strings are UTF-8 (non-ASCII survives)", () => {
    const message: RelayMessage = { type: "denied", code: "INTERNAL", cid: 0, message: "olá ✓" }
    const bytes = encodeRelayMessage(message)
    expect(bytes.length).toBe(1 + 1 + "INTERNAL".length + 1 + 1 + utf8("olá ✓").length)
    expect(decodeRelayMessage(bytes)).toEqual(message)
  })
})
