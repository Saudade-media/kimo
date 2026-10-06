/**
 * Board 37 / no-op audit, editor scope (E1–E13, A5): the pieces behind each fix that run
 * without a browser. The clicks themselves are covered by e2e/editor-gaps.e2e.ts.
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { createDocStore, createUiStore } from "@kimo/editor-state"
import { formatDeepLink, parseDeepLink } from "@kimo/platform"
import { causeOf, failureText } from "../src/editor/errors"
import { addSlotProp, componentOfSelection } from "../src/editor/m3/actions"
import { M3Controller } from "../src/editor/m3/controller"
import { pageLink } from "../src/editor/pages/PagesStrip"
import { actionFailure } from "../src/files/BannerHost"
import { type Banner, bannerCopy } from "../src/platform/contract"
import { bannerFormatters } from "../src/platform/format"
import { diskPath, parseRoute } from "../src/router"

const SCHEMA = "https://kimo.design/schema/kimo-1.0.json"

function doc(): KimoDocument {
  return {
    $schema: SCHEMA,
    format: "1.0.0",
    nodes: {
      Card000001: {
        type: "frame",
        parent: null,
        order: "a0",
        name: "Card",
        x: 0,
        y: 0,
        w: 200,
        h: 120,
        component: {},
      },
      Body000001: { type: "frame", parent: "Card000001", order: "a0", name: "Body", w: 100, h: 40 },
      Title00001: { type: "text", parent: "Card000001", order: "a1", content: "Title" },
      Inst000001: { type: "instance", parent: null, order: "a1", of: "Card000001", x: 300, y: 0 },
      Plain00001: { type: "rect", parent: null, order: "a2", x: 0, y: 300, w: 10, h: 10 },
    },
  } as unknown as KimoDocument
}

function controller(d: KimoDocument) {
  const store = createDocStore(d)
  const session = {
    id: "t",
    store,
    ui: createUiStore(),
    route: undefined,
    onReject: new Set(),
  } as never
  return { store, m3: new M3Controller(session, () => null) }
}

describe("A5: failures say what failed", () => {
  test("Couldn't <what>. <cause>.", () => {
    expect(failureText("add the image", new Error("Image is too large"))).toBe(
      "Couldn't add the image. Image is too large.",
    )
    expect(failureText("reveal a.kimo")).toBe("Couldn't reveal a.kimo.")
    expect(causeOf({ message: "permission denied" })).toBe("Permission denied.")
    expect(causeOf("Error: Disk full!")).toBe("Disk full!")
    expect(causeOf(42)).toBe("")
  })

  test("banner actions name the file (E13 Mark resolved & save, E8 reveal)", () => {
    expect(actionFailure("mark-resolved-save", "home.kimo")).toBe("save home.kimo")
    expect(actionFailure("reveal-recovery", "home.kimo")).toBe("reveal the recovery copy")
    expect(actionFailure("open-as-text", "home.kimo")).toBe("open home.kimo as text")
  })
})

describe("E8: Show diff becomes Reveal recovery copy, gated on reveal", () => {
  const mismatch: Banner = {
    kind: "save-failed",
    severity: "danger",
    fileName: "a.kimo",
    failure: { code: "READ_BACK_MISMATCH", path: "/a.kimo", message: "x", at: 0 },
  } as Banner
  const failed = {
    kind: "failed-load",
    severity: "danger",
    fileName: "a.kimo",
    detail: { headline: "", explanation: "", error: null, excerpt: [] },
  } as unknown as Banner

  test("desktop: Reveal recovery copy, then Save as…", () => {
    const c = bannerCopy(mismatch, bannerFormatters("macos"))
    expect(c.actions.map((a) => a.label)).toEqual(["Reveal recovery copy", "Save as…"])
    expect(c.actions[0]?.id).toBe("reveal-recovery")
  })

  test("web (no reveal): no reveal or open-as-text actions", () => {
    const fmt = { ...bannerFormatters("web"), reveal: false }
    expect(bannerCopy(mismatch, fmt).actions.map((a) => a.id)).toEqual(["save-as"])
    expect(bannerCopy(failed, fmt).actions).toEqual([])
    expect(bannerCopy(failed, bannerFormatters("macos")).actions.map((a) => a.id)).toEqual([
      "reveal",
      "open-as-text",
    ])
  })
})

describe("E9: Copy link to page", () => {
  const session = (ref: string, deepLinks: boolean) =>
    ({ document: { ref, manager: { platform: { capabilities: { deepLinks } } } } }) as never

  test("desktop: a kimo:// deep link with the page", () => {
    const link = pageLink(session("/Users/me/loom/home.kimo", true), "Page000002")
    expect(link).toBe(
      formatDeepLink({ action: "open", path: "/Users/me/loom/home.kimo", page: "Page000002" }),
    )
    expect(parseDeepLink(link as string)).toEqual({
      action: "open",
      path: "/Users/me/loom/home.kimo",
      page: "Page000002",
    })
  })

  test("a never-saved file has no link", () => {
    expect(pageLink(session("untitled:abc", true), "Page000002")).toBeNull()
  })

  test("the deep link's page reaches the editor route", () => {
    const path = diskPath("/a/home.kimo", null, "Page000002")
    expect(path).toBe("/disk/%2Fa%2Fhome.kimo?page=Page000002")
    expect(parseRoute(`#${path}`)).toEqual({ name: "disk", ref: "/a/home.kimo", node: null })
    const both = diskPath("/a/home.kimo", "Node000001", "Page000002")
    expect(parseRoute(`#${both}`)).toEqual({
      name: "disk",
      ref: "/a/home.kimo",
      node: "Node000001",
    })
  })
})

describe("E7: Replace with selection", () => {
  test("the selection's component: a main, or an instance's main", () => {
    const { m3 } = controller(doc())
    expect(componentOfSelection(m3, ["Card000001"], "Inst000001/Body000001")).toBe("Card000001")
    expect(componentOfSelection(m3, ["Inst000001"], "X/Y")).toBe("Card000001")
    expect(componentOfSelection(m3, ["Plain00001"], "X/Y")).toBeNull()
    expect(componentOfSelection(m3, ["Card000001", "Inst000001"], "X/Y")).toBeNull()
    expect(componentOfSelection(m3, [], "X/Y")).toBeNull()
    // The layer being replaced never counts.
    expect(componentOfSelection(m3, ["Card000001"], "Card000001")).toBeNull()
  })
})

describe("E7: Add prop › Slot (mark a frame)", () => {
  test("marks the frame a slot and declares the prop in one undo step", () => {
    const { store, m3 } = controller(doc())
    expect(addSlotProp(m3, "Card000001", "Body000001", "body")).toBe(true)
    expect(store.getNode("Body000001")?.slot).toEqual({})
    const props = (store.getNode("Card000001")?.component as { props?: Record<string, unknown> })
      ?.props
    expect(props?.body).toMatchObject({ type: "slot", target: "Body000001" })
    store.undo("user")
    expect(store.getNode("Body000001")?.slot).toBeUndefined()
    expect(
      (store.getNode("Card000001")?.component as { props?: Record<string, unknown> })?.props?.body,
    ).toBeUndefined()
  })

  test("a frame that is already a slot only gets the prop", () => {
    const d = doc()
    ;(d.nodes as Record<string, Record<string, unknown>>).Body000001 = {
      ...(d.nodes as Record<string, Record<string, unknown>>).Body000001,
      slot: { suggested: [] },
    }
    const { store, m3 } = controller(d)
    expect(addSlotProp(m3, "Card000001", "Body000001", "body")).toBe(true)
    expect(store.getNode("Body000001")?.slot).toEqual({ suggested: [] })
  })

  test("a taken prop name is refused (toast), nothing changes", () => {
    const { store, m3 } = controller(doc())
    expect(addSlotProp(m3, "Card000001", "Body000001", "body")).toBe(true)
    const before = store.toDocument()
    expect(addSlotProp(m3, "Card000001", "Body000001", "body")).toBe(false)
    expect(store.toDocument()).toEqual(before)
    expect(m3.toasts.get().some((t) => t.tone !== "success")).toBe(true)
  })
})
