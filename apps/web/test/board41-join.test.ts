/**
 * Board 41 sections 5 and 9: the join route (location and hash forms), the join card copy and
 * rows, and what a View link may do (keys, tools, File menu, context menu).
 */
import { describe, expect, test } from "bun:test"
import { parseJoinDeepLink } from "@kimo/platform"
import {
  detailsText,
  errorCard,
  joinedToast,
  joinSteps,
  linkStepLabel,
  progressMeta,
  retryDelay,
  timeLeft,
} from "../src/join/copy"
import {
  homeUrlFromJoin,
  isJoinPath,
  joinLinkFromLocation,
  joinPath,
  parseJoinPath,
} from "../src/join/link"
import type { JoinErrorKind, JoinState } from "../src/multiplayer/model"
import { parseRoute } from "../src/router"

const FRAGMENT = "https://relay.maya.studio/room1/token/key"

const state = (patch: Partial<JoinState> = {}): JoinState => ({
  phase: "connecting",
  steps: { reachedRelay: false, linkValid: false, decrypted: false },
  showCard: true,
  relayHost: "relay.maya.studio",
  role: null,
  expiresAt: null,
  progress: null,
  room: null,
  key: null,
  session: null,
  error: null,
  ...patch,
})

const failed = (kind: JoinErrorKind, patch: Partial<JoinState> = {}, message = "boom") =>
  state({ phase: "error", error: { kind, code: "CODE", message }, ...patch })

describe("join route", () => {
  test("the web route is /join with a fragment, under any base path", () => {
    expect(isJoinPath("/join")).toBe(true)
    expect(isJoinPath("/join/")).toBe(true)
    expect(isJoinPath("/kimo/join")).toBe(true)
    expect(isJoinPath("/")).toBe(false)
    expect(isJoinPath("/rejoin")).toBe(false)
    expect(isJoinPath("/join/x")).toBe(false)
    const loc = (pathname: string, hash: string) => ({
      pathname,
      hash,
      href: `https://kimo.app${pathname}${hash}`,
    })
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

  test("Open Kimo goes to the app root", () => {
    expect(homeUrlFromJoin({ href: "https://kimo.app/join#x", pathname: "/join" })).toBe(
      "https://kimo.app/#/",
    )
    expect(homeUrlFromJoin({ href: "https://x.dev/kimo/join#x", pathname: "/kimo/join" })).toBe(
      "https://x.dev/kimo/#/",
    )
  })

  test("the desktop deep link kimo://join#... carries the whole link", () => {
    const link = `kimo://join#${FRAGMENT}`
    expect(parseJoinDeepLink(link)).toBe(link)
    expect(parseJoinDeepLink(`kimo:join#${FRAGMENT}`)).toBe(`kimo:join#${FRAGMENT}`)
    expect(parseJoinDeepLink("kimo://join")).toBeNull()
    expect(parseJoinDeepLink("kimo://open?path=%2Fa.kimo")).toBeNull()
    expect(parseJoinDeepLink("https://kimo.app/join#x")).toBeNull()
  })
})

describe("join card copy", () => {
  test("steps tick in place", () => {
    const now = 1_000_000
    const s1 = joinSteps(state(), now)
    expect(s1.map((s) => s.status)).toEqual(["active", "pending", "pending"])
    const s2 = joinSteps(
      state({
        phase: "decrypting",
        role: "edit",
        expiresAt: now + 6 * 86_400_000,
        steps: { reachedRelay: true, linkValid: true, decrypted: false },
      }),
      now,
    )
    expect(s2.map((s) => s.status)).toEqual(["done", "done", "active"])
    expect(s2[1]?.label).toBe("Link is valid · Edit · expires in 6 days")
    expect(s2[0]?.label).toBe("Reached the relay")
    expect(s2[2]?.label).toBe("Decrypting the file")
  })

  test("link step label: role and expiry", () => {
    expect(linkStepLabel({ role: "view", expiresAt: null }, 0)).toBe(
      "Link is valid · View · never expires",
    )
    expect(timeLeft(90 * 60_000)).toBe("2 hours")
    expect(timeLeft(10 * 60_000)).toBe("10 minutes")
  })

  test("progress meta: indeterminate when null", () => {
    expect(progressMeta(null)).toBe("images load as you scroll")
    expect(progressMeta(0.4)).toBe("40 % · images load as you scroll")
  })

  test("each error kind maps to a board card", () => {
    const expired = errorCard(failed("expired", { expiresAt: new Date(2026, 9, 12).getTime() }))
    expect(expired).toMatchObject({
      icon: "clock-alert",
      tone: "neutral",
      title: "This link has expired",
      actions: ["open-kimo"],
    })
    expect(expired.desc).toBe(
      "It stopped working on 12 Oct. Ask the person who shared it for a new link.",
    )
    expect(errorCard(failed("revoked"))).toMatchObject({
      icon: "link-2-off",
      tone: "neutral",
      title: "This link was turned off",
      desc: "The owner revoked it or reset all links. Ask them for a new one.",
      actions: ["open-kimo"],
    })
    const unreachable = errorCard(failed("unreachable", {}, "ECONNREFUSED · 5 s"))
    expect(unreachable).toMatchObject({
      icon: "wifi-off",
      tone: "danger",
      title: "Couldn't reach the relay",
      desc: "relay.maya.studio did not answer. It may be down, or blocked on this network.",
      meta: "ECONNREFUSED · 5 s",
      actions: ["copy-details", "try-again"],
    })
    expect(errorCard(failed("not-a-relay", {}, "404"))).toMatchObject({
      icon: "server-off",
      title: "This is not a Kimo relay",
      meta: "relay.maya.studio · 404",
      actions: ["copy-details"],
    })
    expect(errorCard(failed("decrypt-failed", {}, ""))).toMatchObject({
      icon: "key-round",
      title: "Couldn't open this file",
      meta: "AEAD tag mismatch",
      actions: ["paste-link", "try-again"],
    })
    expect(errorCard(failed("bad-link")).actions).toEqual(["paste-link", "try-again"])
    expect(errorCard(failed("failed")).actions).toEqual(["copy-details", "try-again"])
    expect(errorCard(failed("relay-too-old")).title).toBe("This relay is too old")
  })

  test("Copy details never carries the link or the key", () => {
    const text = detailsText(
      failed("unreachable", {}, `no answer for ${FRAGMENT}`),
      new Date("2026-10-19T10:00:00Z"),
    )
    expect(text).toContain("Relay: relay.maya.studio")
    expect(text).toContain("2026-10-19T10:00:00.000Z")
    expect(text).toContain("Error: CODE")
  })

  test("retry backs off and caps; the toast names the role", () => {
    expect([0, 1, 2, 3, 4, 9].map(retryDelay)).toEqual([500, 1000, 2000, 4000, 8000, 8000])
    expect(joinedToast("edit", "Marketing site")).toBe("You joined Marketing site · you can edit")
    expect(joinedToast("view", "Marketing site")).toBe("You joined Marketing site · view only")
  })
})

describe("Copy details redaction", () => {
  test("a link inside an error message is replaced", () => {
    const text = detailsText(
      failed("unreachable", {}, `no answer for ${FRAGMENT} or #abc/def`),
      new Date(0),
    )
    expect(text).not.toContain("token")
    expect(text).not.toContain("room1")
    expect(text).toContain("<link>")
  })
})
