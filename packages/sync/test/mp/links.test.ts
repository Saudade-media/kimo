import { describe, expect, test } from "bun:test"
import {
  deriveRoomId,
  exportPublicKey,
  formatJoinLink,
  generateRoomKey,
  generateSigningKeyPair,
  httpUrlFor,
  type JoinLink,
  mintToken,
  normalizeRelayUrl,
  parseJoinLink,
  randomBytes,
  syncUrlFor,
  toBase64Url,
} from "../../src/mp"
import { expectCode } from "./helpers"

async function roomToken() {
  const root = await generateSigningKeyPair()
  const link = await generateSigningKeyPair()
  const room = await deriveRoomId(await exportPublicKey(root.publicKey))
  const token = await mintToken(link.privateKey, {
    room,
    role: "edit",
    kid: 1,
    iat: 1_800_000_000,
    exp: 0,
    jti: randomBytes(16),
    origin: "user",
  })
  return { room: room.id, token }
}

async function sample(relayUrl = "https://relay.example.com"): Promise<JoinLink> {
  const { room, token } = await roomToken()
  return { webOrigin: "https://app.kimo.design", relayUrl, room, token, roomKey: generateRoomKey() }
}

describe("normalizeRelayUrl", () => {
  const table: [string, string][] = [
    ["https://relay.example.com", "https://relay.example.com"],
    ["https://relay.example.com/", "https://relay.example.com"],
    ["https://relay.example.com///", "https://relay.example.com"],
    ["HTTPS://Relay.Example.COM", "https://relay.example.com"],
    ["wss://relay.example.com", "https://relay.example.com"],
    ["WSS://relay.example.com:443/", "https://relay.example.com"],
    ["https://relay.example.com:443", "https://relay.example.com"],
    ["https://relay.example.com:8443", "https://relay.example.com:8443"],
    ["wss://relay.example.com:80", "https://relay.example.com:80"],
    ["https://relay.example.com/kimo/", "https://relay.example.com/kimo"],
    ["https://relay.example.com/Kimo/Relay", "https://relay.example.com/Kimo/Relay"],
    ["https://user:pass@relay.example.com/?x=1#y", "https://relay.example.com"],
    ["  https://relay.example.com  ", "https://relay.example.com"],
    ["http://localhost:8787", "http://localhost:8787"],
    ["ws://localhost:8787/", "http://localhost:8787"],
    ["ws://localhost:80", "http://localhost"],
    ["ws://127.0.0.1:443", "http://127.0.0.1:443"],
    ["http://127.0.0.1:8787", "http://127.0.0.1:8787"],
    ["http://[::1]:8787", "http://[::1]:8787"],
    ["http://studio.local", "http://studio.local"],
    ["http://10.1.2.3", "http://10.1.2.3"],
    ["http://172.16.0.1", "http://172.16.0.1"],
    ["http://172.31.255.255:9000", "http://172.31.255.255:9000"],
    ["http://192.168.1.20:8787", "http://192.168.1.20:8787"],
    ["https://bücher.example", "https://xn--bcher-kva.example"],
  ]
  for (const [input, output] of table)
    test(`${input} -> ${output}`, () => expect(normalizeRelayUrl(input)).toBe(output))

  test("rejects other schemes, http on public hosts and junk", async () => {
    for (const bad of [
      "",
      "relay.example.com",
      "//relay.example.com",
      "ftp://relay.example.com",
      "file:///tmp",
      "javascript:alert(1)",
      "http://relay.example.com",
      "http://8.8.8.8",
      "http://172.32.0.1",
      "http://172.15.0.1",
      "http://192.169.0.1",
      "http://127.0.0.2",
      "http://local",
      "http://localhost.evil.com",
      "https://",
      "https://exa mple.com",
    ])
      await expectCode(() => normalizeRelayUrl(bad), "BAD_RELAY_URL")
  })

  test("is idempotent", () => {
    for (const url of ["https://a.example/x", "http://localhost:1", "https://a.example:444"])
      expect(normalizeRelayUrl(normalizeRelayUrl(url))).toBe(normalizeRelayUrl(url))
  })
})

describe("derived URLs", () => {
  const room = "5jbqciof3sh24vopwga56zxa5n5o4u3r"
  test("syncUrlFor maps the scheme and keeps the path prefix", () => {
    expect(syncUrlFor("https://relay.example.com/kimo", room)).toBe(
      `wss://relay.example.com/kimo/sync/${room}`,
    )
    expect(syncUrlFor("http://localhost:8787", room)).toBe(`ws://localhost:8787/sync/${room}`)
    expect(syncUrlFor("wss://relay.example.com/", room)).toBe(
      `wss://relay.example.com/sync/${room}`,
    )
  })

  test("syncUrlFor rejects a bad room", async () => {
    await expectCode(() => syncUrlFor("https://r.example", "ROOM"), "BAD_REQUEST")
  })

  test("httpUrlFor appends to the base", () => {
    expect(httpUrlFor("https://relay.example.com/kimo/", `/room/${room}/snapshot`)).toBe(
      `https://relay.example.com/kimo/room/${room}/snapshot`,
    )
    expect(httpUrlFor("https://relay.example.com", "version")).toBe(
      "https://relay.example.com/version",
    )
  })
})

describe("join links", () => {
  test("format and parse round trip, with a relay path prefix", async () => {
    const link = await sample("https://relay.example.com/kimo")
    const text = formatJoinLink(link)
    expect(text).toBe(
      `https://app.kimo.design/join#https://relay.example.com/kimo/${link.room}/${link.token}/${toBase64Url(link.roomKey)}`,
    )
    expect(text.split("#")[0]).not.toContain(link.token)
    const parsed = parseJoinLink(text)
    expect(parsed).toEqual(link)
  })

  test("desktop origin kimo: and an empty origin", async () => {
    const link = await sample()
    const desktop = formatJoinLink({ ...link, webOrigin: "kimo:" })
    expect(desktop.startsWith("kimo://join#https://relay.example.com/")).toBe(true)
    expect(parseJoinLink(desktop).webOrigin).toBe("kimo:")
    const bare = formatJoinLink({ ...link, webOrigin: "" })
    expect(bare.startsWith("#https://")).toBe(true)
    expect(parseJoinLink(bare)).toEqual({ ...link, webOrigin: "" })
  })

  test("format normalizes the relay URL and the origin's trailing slash", async () => {
    const link = await sample("WSS://Relay.Example.com:443/")
    const text = formatJoinLink({ ...link, webOrigin: "https://app.kimo.design/" })
    expect(text.startsWith("https://app.kimo.design/join#https://relay.example.com/")).toBe(true)
    expect(parseJoinLink(text).relayUrl).toBe("https://relay.example.com")
  })

  test("accepts a bare fragment with or without #, any origin, and a local relay", async () => {
    const link = await sample("http://localhost:8787")
    const fragment = formatJoinLink(link).split("#")[1] as string
    expect(parseJoinLink(fragment).room).toBe(link.room)
    expect(parseJoinLink(`#${fragment}`).room).toBe(link.room)
    const other = parseJoinLink(`https://kimo.example.org:8443/some/where?q=1#${fragment}`)
    expect(other.webOrigin).toBe("https://kimo.example.org:8443")
    expect(other.relayUrl).toBe("http://localhost:8787")
    expect(parseJoinLink(`not a url#${fragment}`).webOrigin).toBe("")
  })

  test("tolerates whitespace, a trailing slash and a percent-encoded fragment", async () => {
    const link = await sample("https://relay.example.com/kimo")
    const text = formatJoinLink(link)
    const wrapped = `  ${text.slice(0, 60)}\n  ${text.slice(60, 140)}\r\n${text.slice(140)}  `
    expect(parseJoinLink(wrapped)).toEqual(link)
    expect(parseJoinLink(`${text}/`)).toEqual(link)
    const [origin, fragment] = text.split("#") as [string, string]
    expect(parseJoinLink(`${origin}#${encodeURIComponent(fragment)}`)).toEqual(link)
  })

  test("a relay URL given as wss in the fragment is normalized", async () => {
    const link = await sample()
    const text = `https://app/join#wss://Relay.Example.com/${link.room}/${link.token}/${toBase64Url(link.roomKey)}`
    expect(parseJoinLink(text).relayUrl).toBe("https://relay.example.com")
  })

  test("a percent-encoded link resolves to the real relay, never the wrapper host", async () => {
    const link = await sample()
    const relay = `https://relay.example.com/${link.room}/${link.token}/${toBase64Url(link.roomKey)}`
    const inner = `https://app.kimo.design/join#${relay}`
    const texts = [
      encodeURIComponent(inner),
      `https://l.messenger.example/?u=${encodeURIComponent(inner)}`,
      `https://app.kimo.design/join%23${encodeURIComponent(relay)}`,
      `https://app.kimo.design/join#${encodeURIComponent(relay)}`,
    ]
    for (const text of texts) {
      const parsed = parseJoinLink(text)
      expect([text, parsed.relayUrl]).toEqual([text, "https://relay.example.com"])
      expect(parsed.room).toBe(link.room)
    }
    // Decoded once only: a doubly encoded link is not unwrapped further.
    await expectCode(() => parseJoinLink(encodeURIComponent(encodeURIComponent(inner))), "BAD_LINK")
  })

  test("BAD_LINK cases", async () => {
    const link = await sample()
    const other = await roomToken()
    const key = toBase64Url(link.roomKey)
    const r = "https://relay.example.com"
    const cases: Record<string, string> = {
      empty: "",
      "no fragment content": "https://app/join#",
      "missing segment": `https://app/join#${r}/${link.room}/${link.token}`,
      "missing relay": `https://app/join#${link.room}/${link.token}/${key}`,
      "wrong room in token": `https://app/join#${r}/${link.room}/${other.token}/${key}`,
      "short key": `https://app/join#${r}/${link.room}/${link.token}/${toBase64Url(new Uint8Array(16))}`,
      "long key": `https://app/join#${r}/${link.room}/${link.token}/${toBase64Url(new Uint8Array(33))}`,
      "padded key": `https://app/join#${r}/${link.room}/${link.token}/${key}=`,
      "uppercase room": `https://app/join#${r}/${link.room.toUpperCase()}/${link.token}/${key}`,
      "garbage token": `https://app/join#${r}/${link.room}/abc/${key}`,
      "http public relay": `https://app/join#http://relay.example.com/${link.room}/${link.token}/${key}`,
      "relay without scheme": `https://app/join#relay.example.com/${link.room}/${link.token}/${key}`,
      "segments swapped": `https://app/join#${r}/${link.token}/${link.room}/${key}`,
      "bad percent escape": `https://app/join#%E0%A4%A/${link.room}`,
      "relay with a query": `https://app/join#${r}/x?y=1/${link.room}/${link.token}/${key}`,
      "relay with a fragment": `https://app/join#${r}/x#y/${link.room}/${link.token}/${key}`,
      "relay with credentials": `https://app/join#https://user@relay.example.com/${link.room}/${link.token}/${key}`,
    }
    for (const [name, text] of Object.entries(cases)) {
      try {
        parseJoinLink(text)
      } catch (error) {
        expect([name, (error as { code: string }).code]).toEqual([name, "BAD_LINK"])
        continue
      }
      throw new Error(`${name} parsed`)
    }
  })

  test("format refuses invalid parts with BAD_LINK", async () => {
    const link = await sample()
    const other = await roomToken()
    await expectCode(() => formatJoinLink({ ...link, relayUrl: "ftp://x" }), "BAD_LINK")
    await expectCode(() => formatJoinLink({ ...link, token: other.token }), "BAD_LINK")
    await expectCode(() => formatJoinLink({ ...link, roomKey: new Uint8Array(31) }), "BAD_LINK")
    await expectCode(() => formatJoinLink({ ...link, room: "x" }), "BAD_LINK")
  })
})
