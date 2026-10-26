/**
 * Board 40 (desing.pen d5ZDH) "Composer bar and “…” menu": the bar holds Attach, Mode, "…",
 * the model chip and Send; Skills, Auto-approve and Web access live in the "…" menu, and a dot
 * on "…" shows a switch away from its default.
 */
import { describe, expect, test } from "bun:test"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import { ComposerAgent, composerMoreDot, MenuItemDense } from "@kimo/ui"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { createAgentPanelController, createInWindowTools } from "../src/agent-panel"
import type { AgentPanelViewState } from "../src/agent-panel/controller"
import { MoreMenu } from "../src/agent-panel/Menus"
import { createTestRuntime } from "../src/agent-panel/testing"

const noop = () => {}

function menu(o: {
  auto?: boolean
  web?: boolean
  blocked?: "privacy" | "model" | null
  skills?: string[]
}): string {
  const state = {
    autoApprove: o.auto ?? true,
    webAccess: { on: o.web ?? true, disabled: o.blocked ?? null },
    skills: { enabled: o.skills ?? ["kimo-design", "kimo-layout", "kimo-tokens"] },
  } as unknown as AgentPanelViewState
  return renderToString(
    h(MoreMenu, {
      state,
      onSkills: noop,
      onAutoApprove: noop,
      onWebAccess: noop,
      onClose: noop,
      onEscape: noop,
    }),
  )
}

/** The `<button>` of one row, by its test id. */
function row(html: string, id: string): string {
  const m = html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>.*?</button>`))
  if (!m) throw new Error(`no row ${id}`)
  return m[0]
}

describe("dot on “…”", () => {
  test("warning while auto-approve is on, whatever web access does", () => {
    expect(composerMoreDot({ autoApprove: true, webAccessOn: true, webAccessBlocked: false })).toBe(
      "warning",
    )
    expect(
      composerMoreDot({ autoApprove: true, webAccessOn: false, webAccessBlocked: false }),
    ).toBe("warning")
    expect(composerMoreDot({ autoApprove: true, webAccessOn: false, webAccessBlocked: true })).toBe(
      "warning",
    )
  })

  test("secondary while web access is off and could be on", () => {
    expect(
      composerMoreDot({ autoApprove: false, webAccessOn: false, webAccessBlocked: false }),
    ).toBe("secondary")
  })

  test("none at the defaults or when web access is blocked", () => {
    expect(
      composerMoreDot({ autoApprove: false, webAccessOn: true, webAccessBlocked: false }),
    ).toBeNull()
    expect(
      composerMoreDot({ autoApprove: false, webAccessOn: false, webAccessBlocked: true }),
    ).toBeNull()
  })
})

describe("“…” menu items reflect the session", () => {
  test("defaults: Skills with its count, Ask before changes off, web access on", () => {
    const html = menu({})
    expect(html).toContain('role="menu"')
    expect(html).toContain('aria-label="More options"')
    const skills = row(html, "agent-more-skills")
    expect(skills).toContain('role="menuitem"')
    expect(skills).toContain(">Skills<")
    expect(skills).toContain(">3<")
    const auto = row(html, "agent-more-auto")
    expect(auto).toContain('role="menuitemcheckbox"')
    expect(auto).toContain(">Ask before changes<")
    expect(auto).toContain('aria-checked="false"')
    expect(auto).toContain("kimo-toggle--off")
    expect(auto).toContain('lucide lucide-shield"')
    const web = row(html, "agent-more-web")
    expect(web).toContain('aria-checked="true"')
    expect(web).toContain('data-state="on"')
    expect(web).toContain("kimo-toggle--on")
    expect(web).toContain('lucide lucide-globe"')
    expect(html).not.toContain("agent-more-reason")
  })

  test("Ask before changes on: checked, shield-check", () => {
    const auto = row(menu({ auto: false }), "agent-more-auto")
    expect(auto).toContain('aria-checked="true"')
    expect(auto).toContain("lucide-shield-check")
    expect(auto).toContain("kimo-toggle--on")
  })

  test("web access off: unchecked, globe-x", () => {
    const web = row(menu({ web: false }), "agent-more-web")
    expect(web).toContain('aria-checked="false"')
    expect(web).toContain('data-state="off"')
    expect(web).toContain("lucide-globe-x")
    expect(web).not.toContain("aria-disabled")
  })

  test("No third-party fetch: disabled row, globe-lock, the reason under it", () => {
    const html = menu({ web: false, blocked: "privacy" })
    const web = row(html, "agent-more-web")
    expect(web).toContain('aria-disabled="true"')
    expect(web).toContain('aria-describedby="agent-more-web-reason"')
    expect(web).toContain("lucide-globe-lock")
    expect(web).toContain("kimo-toggle--off")
    expect(html).toContain(">No third-party fetch is on</p>")
  })

  test("model without web tools: disabled row, globe-x, the reason under it", () => {
    const html = menu({ web: false, blocked: "model" })
    expect(row(html, "agent-more-web")).toContain("lucide-globe-x")
    expect(html).toContain(">This model can&#x27;t use the web</p>")
  })

  test("a switch row is a menuitemcheckbox ending in a Toggle, in place of Meta", () => {
    const html = renderToString(
      h(MenuItemDense, { label: "Web access", switchOn: true, meta: "x" }),
    )
    expect(html).toContain('role="menuitemcheckbox"')
    expect(html).toContain("kimo-menu-item-dense--switch")
    expect(html).toContain("kimo-toggle kimo-toggle--on kimo-menu-item-dense__switch")
    expect(html).not.toContain("kimo-menu-item-dense__meta")
  })
})

describe("composer bar", () => {
  const bar = (more: Parameters<typeof ComposerAgent>[0]["more"]) =>
    renderToString(
      h(ComposerAgent, { value: "", model: { label: "Sonnet 5.5" }, modeChip: "Mode", more }),
    )

  test("Attach, Mode, “…”, Model, Send; no Skills, shield or globe in the bar", () => {
    const html = bar({})
    expect(html).toContain('aria-label="Attach image"')
    expect(html).toContain('data-testid="agent-more"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-label="More options"')
    expect(html).toContain("lucide-ellipsis")
    expect(html).toContain('title="Sonnet 5.5"')
    expect(html).not.toContain("kimo-composer-agent__skills")
    expect(html).not.toContain("agent-auto-approve")
    expect(html).not.toContain("agent-web-access")
    expect(html).not.toContain("agent-more-dot")
    const order = ["Attach image", ">Mode<", "agent-more", "kimo-composer-agent__spacer", "Model: "]
    const at = order.map((s) => html.indexOf(s))
    expect(at.every((v, i) => v >= 0 && (i === 0 || v > (at[i - 1] ?? 0)))).toBe(true)
  })

  test("the dot and the open state show on “…”, and its name says why", () => {
    const warn = bar({ dot: "warning", open: true })
    expect(warn).toContain('data-dot="warning"')
    expect(warn).toContain("kimo-composer-agent__more-dot--warning")
    expect(warn).toContain('aria-expanded="true"')
    expect(warn).toContain("kimo-composer-agent__more-button--open")
    expect(warn).toContain('aria-label="More options (auto-approve is on)"')
    const off = bar({ dot: "secondary" })
    expect(off).toContain('data-dot="secondary"')
    expect(off).toContain('aria-label="More options (web access is off)"')
  })
})

describe("controller", () => {
  test("the “…” menu opens and closes like the other composer menus", async () => {
    const store = importDocument(createEmptyDocument("Bar"))
    const tools = createInWindowTools({ store, path: "/u/me/Bar.kimo" })
    const c = createAgentPanelController({
      runtime: createTestRuntime({
        tools: (spec) => tools.factory(spec),
        script: () => ({ text: "ok" }),
      }),
      fileId: "f-bar",
      fileName: "Bar.kimo",
      docId: () => tools.docId(),
    })
    await c.refresh()
    c.openMenu("more")
    expect(c.state.menu).toBe("more")
    c.openMenu("skills")
    expect(c.state.menu).toBe("skills")
    c.openMenu("more")
    c.openMenu("more")
    expect(c.state.menu).toBeNull()
  })
})
