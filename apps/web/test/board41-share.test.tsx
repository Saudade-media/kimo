/**
 * Board 41 (desing.pen kCAYr) part A: the topbar while shared (sections 1, 2), the Share popover
 * (3), Settings › Multiplayer (4) and the people list (6 B). State mapping and copy are pure
 * (`multiplayer/ui/copy.ts`); the components are rendered to HTML over a scripted share backend.
 */
import { describe, expect, test } from "bun:test"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { MultiplayerContext } from "../src/multiplayer/hooks"
import {
  createMultiplayerModel,
  type RelayTestState,
  resetConfirmCopy,
} from "../src/multiplayer/model"
import {
  agentLabel,
  agentMeta,
  agentPersona,
  connectionMeta,
  initialsOf,
  linkCopiedText,
  linkMeta,
  linkRevokedText,
  personRole,
  relayReady,
  relayResultView,
  remaining,
  resetDescription,
  sharePopoverStage,
  stackDimmed,
  stackOf,
  syncStatusView,
} from "../src/multiplayer/ui/copy"
import { PeoplePopover } from "../src/multiplayer/ui/PeoplePopover"
import { SharePopover } from "../src/multiplayer/ui/SharePopover"
import { TopbarShare, TopbarSyncStatus } from "../src/multiplayer/ui/TopbarShare"
import {
  BOARD41_NODES,
  board41Snapshot,
  createFakeShareBackend,
  fakeProbe,
  issuedLink,
} from "../src/multiplayer/ui/testing"

const DAY = 86_400_000
const HOUR = 3_600_000

describe("§2 sync status (rules row topbar-sync)", () => {
  test("each relay status maps to the board's SaveStatus look, icon and label", () => {
    expect(syncStatusView("synced")).toMatchObject({
      kind: "saved",
      icon: "circle-check",
      label: "Synced",
    })
    expect(syncStatusView("syncing")).toMatchObject({
      kind: "saving",
      icon: "loader-circle",
      label: "Syncing…",
    })
    expect(syncStatusView("reconnecting")).toMatchObject({
      kind: "paused",
      icon: "refresh-cw",
      label: "Reconnecting…",
    })
    expect(syncStatusView("offline")).toMatchObject({
      kind: "read-only",
      icon: "wifi-off",
      label: "Offline · edits kept",
    })
    expect(syncStatusView("view-only")).toMatchObject({
      kind: "read-only",
      icon: "eye",
      label: "View only",
    })
    expect(syncStatusView("saving", 2).label).toBe("Sharing 2 images")
    expect(syncStatusView("saving", 1).label).toBe("Sharing 1 image")
    // "Hover explains it" on Offline.
    expect(syncStatusView("offline").tooltip).toContain("more than 30 s")
  })

  test("the stack dims only while the relay is gone", () => {
    expect(stackDimmed("reconnecting")).toBe(true)
    expect(stackDimmed("offline")).toBe(true)
    expect(stackDimmed("synced")).toBe(false)
    expect(stackDimmed(null)).toBe(false)
  })

  test("avatar stack: at most three, then +N; initials", () => {
    expect(stackOf([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 })
    expect(stackOf([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: 2 })
    expect(initialsOf("Maya Rossi")).toBe("MR")
    expect(initialsOf("Guest 3")).toBe("G3")
    expect(initialsOf("ana")).toBe("A")
  })
})

describe("§3 Share popover copy", () => {
  test("stage: first run without a relay, ready with one, live for the owner", () => {
    expect(sharePopoverStage({ status: "not-shared", owner: false }, null)).toBe("first-run")
    expect(sharePopoverStage({ status: "not-shared", owner: false }, "wss://r")).toBe("ready")
    expect(sharePopoverStage({ status: "error", owner: false }, "wss://r")).toBe("ready")
    expect(sharePopoverStage({ status: "live", owner: true }, null)).toBe("live")
  })

  test("connection meta counts the others here", () => {
    expect(connectionMeta("relay.maya.studio", 5)).toBe("relay.maya.studio · 5 people here")
    expect(connectionMeta("relay.maya.studio", 1)).toBe("relay.maya.studio · 1 person here")
    expect(connectionMeta("relay.maya.studio", 0)).toBe("relay.maya.studio · nobody else here")
  })

  test("link rows and toasts", () => {
    const now = 1_800_000_000_000
    expect(remaining(now + 6 * DAY + 10 * 60_000, now)).toBe("6 days")
    expect(remaining(now + 7 * DAY - 5_000, now)).toBe("7 days")
    expect(remaining(now + 23 * HOUR + 10 * 60_000, now)).toBe("23 h")
    expect(remaining(now + 40 * 60_000, now)).toBe("40 min")
    expect(linkMeta({ expiresAt: now + 6 * DAY, lastUsedAt: now - 2 * HOUR }, now)).toBe(
      "Expires in 6 days · used 2 h ago",
    )
    expect(linkMeta({ expiresAt: null, lastUsedAt: now - 30 * HOUR }, now)).toBe(
      "Never expires · used yesterday",
    )
    // The relay does not report use yet: no "never used" claim.
    expect(linkMeta({ expiresAt: now + 23 * HOUR, lastUsedAt: null }, now)).toBe("Expires in 23 h")
    expect(linkCopiedText({ role: "edit", expiresAt: now + 7 * DAY }, now)).toBe(
      "Edit link copied · expires in 7 days",
    )
    expect(linkCopiedText({ role: "view", expiresAt: null }, now)).toBe(
      "View link copied · never expires",
    )
    expect(linkRevokedText("view")).toBe("View link revoked")
  })

  test("Reset all links names who is disconnected now (3 D)", () => {
    const copy = resetConfirmCopy({ people: ["Maya", "Jonas", "Ana"], more: 0, agents: 1 })
    expect(resetDescription(3, copy)).toBe(
      "Every link stops working, including the 3 active ones. Disconnects 3 people now (Maya, Jonas, Ana) and 1 agent using these links. The file and its history stay as they are.",
    )
    expect(resetDescription(1, resetConfirmCopy({ people: [], more: 0, agents: 0 }))).toBe(
      "Every link stops working, including the active one. Nobody is connected through these links now. The file and its history stay as they are.",
    )
  })
})

describe("§4 relay test results", () => {
  const view = (s: RelayTestState) => relayResultView(s)
  test("one result per state, with the board's copy", () => {
    expect(view({ kind: "idle" })).toBeNull()
    expect(view({ kind: "testing", url: "wss://relay.maya.studio" })).toEqual({
      kind: "testing",
      text: "Testing wss://relay.maya.studio…",
    })
    expect(
      view({
        kind: "ok",
        url: "wss://relay.maya.studio",
        name: "kimo-relay",
        version: "1.2",
        protocol: "kimo-mp/1",
        ms: 84,
      }),
    ).toEqual({
      kind: "ok",
      pill: "Kimo relay 1.2",
      time: "answered in 84 ms",
      protocol: "protocol 1",
    })
    expect(view({ kind: "not-a-relay", url: "https://x.test", message: "" })).toMatchObject({
      kind: "warning",
      icon: "triangle-alert",
      text: "This server answered, but not as a Kimo relay. Check the path, it usually ends in /kimo.",
    })
    expect(
      view({ kind: "unreachable", url: "wss://relay.maya.studio/kimo", message: "" }),
    ).toMatchObject({
      kind: "danger",
      icon: "circle-x",
      text: "Couldn't reach relay.maya.studio. Check the URL and that the relay is running.",
    })
    expect(view({ kind: "too-old", url: "wss://r", protocol: "0", message: "" })).toMatchObject({
      kind: "warning",
      text: "This relay speaks protocol 0. Update kimo-relay to 1.2 or later.",
    })
  })

  test("Start sharing needs a passing test of that very URL", () => {
    const ok: RelayTestState = {
      kind: "ok",
      url: "wss://a",
      name: "",
      version: "1.2",
      protocol: "kimo-mp/1",
      ms: 1,
    }
    expect(relayReady(ok, "wss://a")).toBe(true)
    expect(relayReady(ok, "wss://b")).toBe(false)
    expect(relayReady({ kind: "testing", url: "wss://a" }, "wss://a")).toBe(false)
  })
})

describe("§6 B people list copy", () => {
  test("roles, agent labels, persona and what it edits", () => {
    expect(personRole({ owner: true, role: "edit" })).toBe("Owner")
    expect(personRole({ owner: false, role: "view" })).toBe("View")
    expect(agentLabel({ label: "Kimo", ownerLabel: "Gui" })).toBe("Kimo · Gui's agent")
    expect(agentLabel({ label: "Claude Code", ownerLabel: null })).toBe("Claude Code")
    expect(agentPersona({ holder: "agent:kimo", isYours: true }, 0)).toBe("teal")
    const sol = agentPersona({ holder: "agent:sol", isYours: false }, 1)
    expect(sol).not.toBe("teal")
    expect(agentPersona({ holder: "agent:sol", isYours: false }, 3)).toBe(sol)
    const name = (id: string) => BOARD41_NODES[id] ?? null
    expect(agentMeta({ editing: ["hero"] }, name)).toBe("editing Hero Image")
    expect(agentMeta({ editing: ["hero", "pricing"] }, name)).toBe("editing Hero Image and 1 more")
    expect(agentMeta({ editing: [] }, name)).toBeNull()
  })
})

// --- Rendered states ----------------------------------------------------------------------------

function setup() {
  const fake = createFakeShareBackend()
  const model = createMultiplayerModel({
    backend: fake.backend,
    probe: fakeProbe({ relay: { version: "1.2" } }),
    storage: { get: () => null, set: () => {} },
  })
  const render = (node: ReturnType<typeof h>) =>
    renderToString(h(MultiplayerContext.Provider, { value: model }, node))
  return { fake, model, render }
}

describe("rendered states", () => {
  test("§2 A: not shared shows the fallback and Button/Secondary Share (users)", () => {
    const { render } = setup()
    const html = render(
      h("div", null, [
        h(TopbarSyncStatus, {
          key: "s",
          docKey: "/a.kimo",
          fallback: h("i", null, "Saved locally"),
        }),
        h(TopbarShare, { key: "t", docKey: "/a.kimo" }),
      ]),
    )
    expect(html).toContain("Saved locally")
    expect(html).toContain("kimo-button--secondary")
    expect(html).toContain(">Share<")
    expect(html).not.toContain("mp-stack")
  })

  test("§2 C: sharing with five others: Synced, three avatars + +2, Button/Soft Sharing", () => {
    const { fake, render } = setup()
    fake.set("/c.kimo", board41Snapshot())
    const html = render(
      h("div", null, [
        h(TopbarSyncStatus, { key: "s", docKey: "/c.kimo", fallback: "x" }),
        h(TopbarShare, { key: "t", docKey: "/c.kimo" }),
      ]),
    )
    expect(html).toContain('data-relay="synced"')
    expect(html).toContain(">Synced<")
    expect(html.match(/class="kimo-avatar mp-avatar"/g)?.length).toBe(3)
    expect(html).toContain(">MR<")
    expect(html).toContain("+<!-- -->2")
    expect(html).toContain("kimo-button--soft")
    expect(html).toContain(">Sharing<")
  })

  test("§2 B: sharing alone has no stack; viewers and guests get no Share", () => {
    const { fake, render } = setup()
    fake.set("/b.kimo", { ...board41Snapshot(), peers: [] })
    expect(render(h(TopbarShare, { docKey: "/b.kimo" }))).not.toContain("mp-stack")
    fake.set("/g.kimo", { ...board41Snapshot(), owner: false, role: "view", status: "read-only" })
    const guest = render(
      h("div", null, [
        h(TopbarSyncStatus, { key: "s", docKey: "/g.kimo", fallback: "x" }),
        h(TopbarShare, { key: "t", docKey: "/g.kimo" }),
      ]),
    )
    expect(guest).toContain(">View only<")
    expect(guest).not.toContain("mp-share-button")
  })

  test("§3 A / B / C: the popover stage follows the relay setting and the share state", async () => {
    const { fake, model, render } = setup()
    const popover = (key: string) =>
      render(h(SharePopover, { model, docKey: key, anchor: null, onClose() {}, onResetAll() {} }))
    const a = popover("/s.kimo")
    expect(a).toContain('data-stage="first-run"')
    expect(a).toContain("Share through your own relay")
    expect(a).toContain("How to host a relay, about 5 minutes")
    expect(a).toContain("Set once, kept in Settings")
    expect(a).toMatch(/<button[^>]*disabled=""[^>]*class="[^"]*mp-start/)

    fake.set("/l.kimo", board41Snapshot())
    fake.setLinks("/l.kimo", [issuedLink("l1", "edit", 6 * 86_400), issuedLink("l2", "view", null)])
    await model.document("/l.kimo").refreshLinks()
    const c = popover("/l.kimo")
    expect(c).toContain('data-stage="live"')
    expect(c).toContain(">Live<")
    expect(c).toContain("End-to-end encrypted")
    expect(c).toContain("relay.maya.studio · 5 people here")
    expect(c).toContain("Active links · <!-- -->2")
    expect(c).toContain("Reset all links")
    expect(c).toContain("Stop sharing")
    expect(c).toContain(">7 days<")
  })

  test("§6 B: people list, you badge, roles, idle, following, agents under a divider", () => {
    const { fake, model, render } = setup()
    fake.set("/p.kimo", board41Snapshot())
    const doc = model.document("/p.kimo")
    const off = doc.subscribe(() => {})
    doc.follow(2)
    const html = render(
      h(PeoplePopover, {
        model,
        docKey: "/p.kimo",
        anchor: null,
        onClose() {},
        nodeName: (id: string) => BOARD41_NODES[id] ?? null,
      }),
    )
    off()
    expect(html).toContain("In this file · 6")
    expect(html).toContain(">you<")
    expect(html).toContain(">Owner<")
    expect(html).toContain('data-following="true"')
    expect(html).toContain("mp-person--idle")
    expect(html).toContain(">Guest 1<")
    expect(html).toContain("Agents · <!-- -->2")
    expect(html).toContain("Kimo · Gui Rodrigues&#x27;s agent")
    expect(html).toContain("editing Hero Image")
    expect(html).toContain("Sol · Maya Rossi&#x27;s agent")
  })
})

describe("actions over the model", () => {
  test("create, revoke and reset go to the backend; the expiry is remembered", async () => {
    const { fake, model } = setup()
    fake.set("/x.kimo", board41Snapshot())
    const doc = model.document("/x.kimo")
    const link = await doc.createLink("edit", "30d")
    expect(fake.calls).toContain(`mint:/x.kimo:edit:${30 * 86_400}`)
    expect(doc.getState().expiry).toBe("30d")
    await doc.revokeLink(link.jti)
    expect(fake.calls).toContain(`revoke:/x.kimo:${link.jti}`)
    await doc.resetAllLinks()
    expect(fake.calls).toContain("reset:/x.kimo")
    await doc.stopSharing()
    expect(doc.getState().share.room).toBeNull()
  })
})
