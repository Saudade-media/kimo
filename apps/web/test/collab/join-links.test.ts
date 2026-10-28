/**
 * Join and pairing links: how a link is read from a web location, the in-app hash route, the
 * desktop deep link and the browser hand-off, and that error details never carry the link.
 */
import { describe, expect, test } from "bun:test"
import { parseJoinDeepLink } from "@kimo/platform"
import { detailsText } from "../../src/join/copy"
import { appLinkOf, startupLinkOf } from "../../src/join/handoff-link"
import { isJoinPath, joinLinkFromLocation, joinPath, parseJoinPath } from "../../src/join/link"
import type { JoinState } from "../../src/multiplayer/model"
import { isPairDeepLink, pairLinkFromLocation, pairPath } from "../../src/pair/link"
import { parseRoute } from "../../src/router"

const FRAGMENT = "https://relay.maya.studio/room1/token/key"

const loc = (pathname: string, hash: string) => ({
  pathname,
  hash,
  href: `https://kimo.app${pathname}${hash}`,
})

describe("join route", () => {
  test("the web route is /join with a fragment, under any base path", () => {
    expect(isJoinPath("/join")).toBe(true)
    expect(isJoinPath("/kimo/join")).toBe(true)
    expect(isJoinPath("/rejoin")).toBe(false)
    expect(isJoinPath("/join/x")).toBe(false)
    expect(joinLinkFromLocation(loc("/join", `#${FRAGMENT}`))).toBe(
      `https://kimo.app/join#${FRAGMENT}`,
    )
    // No fragment: the screen says the link is incomplete (empty link).
    expect(joinLinkFromLocation(loc("/join", ""))).toBe("")
    expect(joinLinkFromLocation(loc("/", `#${FRAGMENT}`))).toBeNull()
  })

  test("the in-app hash route round-trips a link, and parseRoute returns it", () => {
    const link = `kimo://join#${FRAGMENT}`
    const path = joinPath(link)
    expect(path.startsWith("/join/")).toBe(true)
    expect(path.includes("#")).toBe(false)
    expect(parseJoinPath(path)).toBe(link)
    expect(parseRoute(`#${path}`)).toEqual({ name: "join", link })
    expect(parseJoinPath("/file/abc")).toBeNull()
    expect(parseJoinPath("/join/%E0%A4%A")).toBe("")
  })

  test("the desktop deep link kimo://join#... carries the whole link", () => {
    const link = `kimo://join#${FRAGMENT}`
    expect(parseJoinDeepLink(link)).toBe(link)
    expect(parseJoinDeepLink("kimo://join")).toBeNull()
    expect(parseJoinDeepLink("kimo://open?path=%2Fa.kimo")).toBeNull()
    expect(parseJoinDeepLink("https://kimo.app/join#x")).toBeNull()
  })
})

describe("pairing link routes", () => {
  test("/pair#... on web, #/pair/<link> in the app, kimo://pair#... on desktop", () => {
    const link = "https://getkimo.design/pair#https://relay.maya.studio/token"
    expect(pairLinkFromLocation({ pathname: "/pair", hash: "#x", href: link })).toBe(link)
    expect(pairLinkFromLocation({ pathname: "/join", hash: "#x", href: link })).toBeNull()
    expect(parseRoute(`#${pairPath(link)}`)).toEqual({ name: "pair", link })
    const deep = "kimo://pair#https://relay.maya.studio/token"
    expect(parseJoinDeepLink(deep)).toBe(deep)
    expect(isPairDeepLink(deep)).toBe(true)
    expect(isPairDeepLink("kimo://join#https://r/room/token/key")).toBe(false)
  })
})

describe("browser hand-off to the app", () => {
  const where = (href: string) => {
    const u = new URL(href)
    return { href, pathname: u.pathname, hash: u.hash }
  }

  test("only a browser page opened at /join# or /pair# hands off, with the same fragment", () => {
    const join = startupLinkOf(
      where("https://relay.maya.studio/join#https://relay.maya.studio/r/t/k"),
      false,
    )
    expect(join).toEqual({
      kind: "join",
      fragment: "https://relay.maya.studio/r/t/k",
      href: "https://relay.maya.studio/join#https://relay.maya.studio/r/t/k",
    })
    expect(startupLinkOf(where("https://r.example/kimo/pair#x"), false)?.kind).toBe("pair")
    // Inside the desktop app, another path, or no fragment: no hand-off.
    expect(startupLinkOf(where("https://r.example/join#x"), true)).toBeNull()
    expect(startupLinkOf(where("https://r.example/#/join/x"), false)).toBeNull()
    expect(startupLinkOf(where("https://r.example/join"), false)).toBeNull()
    expect(appLinkOf({ kind: "join", fragment: "https://r.example/a/b/c" })).toBe(
      "kimo://join#https://r.example/a/b/c",
    )
    expect(appLinkOf({ kind: "pair", fragment: "x" })).toBe("kimo://pair#x")
  })
})

describe("join error details", () => {
  const failed = (message: string): JoinState => ({
    phase: "error",
    steps: { reachedRelay: false, linkValid: false, decrypted: false },
    showCard: true,
    relayHost: "relay.maya.studio",
    role: null,
    expiresAt: null,
    progress: null,
    room: null,
    key: null,
    session: null,
    error: { kind: "unreachable", code: "CODE", message },
  })

  test("Copy details never carries the link or the key", () => {
    const text = detailsText(
      failed(`no answer for ${FRAGMENT} or #abc/def`),
      new Date("2026-10-19T10:00:00Z"),
    )
    expect(text).toContain("Relay: relay.maya.studio")
    expect(text).toContain("Error: CODE")
    expect(text).toContain("<link>")
    expect(text).not.toContain("token")
    expect(text).not.toContain("room1")
  })
})
