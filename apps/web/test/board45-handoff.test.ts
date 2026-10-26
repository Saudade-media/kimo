import { describe, expect, test } from "bun:test"
import {
  deriveRoomId,
  exportPublicKey,
  formatJoinLink,
  generateRoomKey,
  generateSigningKeyPair,
  mintToken,
  randomBytes,
} from "@kimo/sync/mp"
import {
  appLinkOf,
  downloadLabel,
  handoffMeta,
  initialPhase,
  relayHostOf,
  startupLinkOf,
} from "../src/join/handoff-link"

const loc = (href: string) => {
  const u = new URL(href)
  return { href, pathname: u.pathname, hash: u.hash }
}

describe("board 45 · browser hand-off", () => {
  test("only a browser page opened at /join# or /pair# hands off", () => {
    expect(
      startupLinkOf(loc("https://relay.maya.studio/join#https://relay.maya.studio/r/t/k"), false),
    ).toEqual({
      kind: "join",
      fragment: "https://relay.maya.studio/r/t/k",
      href: "https://relay.maya.studio/join#https://relay.maya.studio/r/t/k",
    })
    expect(startupLinkOf(loc("https://r.example/kimo/pair#x"), false)?.kind).toBe("pair")
    // Inside the desktop app, another path, or no fragment: no hand-off.
    expect(startupLinkOf(loc("https://r.example/join#x"), true)).toBeNull()
    expect(startupLinkOf(loc("https://r.example/#/join/x"), false)).toBeNull()
    expect(startupLinkOf(loc("https://r.example/join"), false)).toBeNull()
  })

  test("the app link keeps the same fragment", () => {
    expect(appLinkOf({ kind: "join", fragment: "https://r.example/a/b/c" })).toBe(
      "kimo://join#https://r.example/a/b/c",
    )
    expect(appLinkOf({ kind: "pair", fragment: "x" })).toBe("kimo://pair#x")
  })

  test("an insecure page starts on D, others on A", () => {
    expect(initialPhase(false)).toBe("insecure")
    expect(initialPhase(true)).toBe("trying")
  })

  test("Get Kimo names desktop platforms only", () => {
    expect(downloadLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(
      "Get Kimo for Mac",
    )
    expect(downloadLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Get Kimo for Windows")
    expect(downloadLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Get Kimo for Linux")
    expect(downloadLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBeNull()
    expect(downloadLabel("Mozilla/5.0 (Linux; Android 14)")).toBeNull()
  })

  test("B's meta reads host, role and expiry from the signed link", async () => {
    const root = await generateSigningKeyPair()
    const signer = await generateSigningKeyPair()
    const room = await deriveRoomId(await exportPublicKey(root.publicKey))
    const now = 1_800_000_000_000
    const token = await mintToken(signer.privateKey, {
      room,
      role: "edit",
      kid: 1,
      iat: now / 1000,
      exp: now / 1000 + 6 * 86_400,
      jti: randomBytes(16),
      origin: "user",
    })
    const text = formatJoinLink({
      webOrigin: "",
      relayUrl: "https://relay.maya.studio",
      room: room.id,
      token,
      roomKey: generateRoomKey(),
    })
    const fragment = text.slice(1)
    expect(relayHostOf(fragment)).toBe("relay.maya.studio")
    expect(handoffMeta({ kind: "join", fragment }, now)).toBe(
      "relay.maya.studio · can edit · expires in 6 days",
    )
    expect(handoffMeta({ kind: "join", fragment: "https://relay.local:8787/bad" }, now)).toBe(
      "relay.local:8787",
    )
  })
})
