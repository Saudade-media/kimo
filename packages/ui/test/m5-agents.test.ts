/** Board 21 components (T7Fuw): AgentOrb, AgentPresenceChip, SegmentedText, rows, layer mark. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  ActivityRow,
  AGENT_LAYER_ROW_CLASS,
  AgentClientRow,
  AgentHostRow,
  AgentLayerMark,
  AgentOpRow,
  AgentOrb,
  AgentPresenceChip,
  AgentTonePill,
  SegmentedText,
} from "../src/index"

describe("AgentOrb (dT6Po)", () => {
  test("size and the on-accent ring of solid-fill instances", () => {
    const html = renderToString(h(AgentOrb, { size: 28 }))
    expect(html).toContain("kimo-agent-orb")
    expect(html).toContain("width:28px")
    expect(html).not.toContain("data-ring")
    const ring = renderToString(h(AgentOrb, { size: 12, ring: 1 }))
    expect(ring).toContain('data-ring="1"')
    expect(ring).toContain("--kimo-orb-ring:1px")
  })
})

describe("AgentPresenceChip (I3Q0Q, /Paused fFrQA, /Waiting MFqUw)", () => {
  test("states, label, meta with separator, chevron", () => {
    const html = renderToString(
      h(AgentPresenceChip, { label: "Claude Code is editing", meta: "3 ops" }),
    )
    expect(html).toContain("kimo-agent-chip--editing")
    expect(html).toContain(">Claude Code is editing<")
    expect(html).toContain("kimo-agent-chip__sep")
    expect(html).toContain(">3 ops<")
    expect(html).toContain('aria-haspopup="dialog"')
    for (const state of ["paused", "waiting"] as const)
      expect(renderToString(h(AgentPresenceChip, { label: "x", state }))).toContain(
        `kimo-agent-chip--${state}`,
      )
  })
  test("no meta → no separator; waiting orb ring 1.5; 2+ clients stack (≤ 3 orbs)", () => {
    expect(renderToString(h(AgentPresenceChip, { label: "x" }))).not.toContain("__sep")
    expect(renderToString(h(AgentPresenceChip, { label: "x", state: "waiting" }))).toContain(
      'data-ring="1.5"',
    )
    const many = renderToString(h(AgentPresenceChip, { label: "5 agents editing", orbs: 5 }))
    expect(many.match(/kimo-agent-orb/g)?.length).toBe(3)
  })
})

describe("SegmentedText (FC6O7)", () => {
  test("radio group with the selected segment", () => {
    const html = renderToString(
      h(SegmentedText, {
        label: "Can",
        value: "edit",
        options: [
          { value: "read", label: "Read only" },
          { value: "edit", label: "Edit" },
          { value: "edit+delete", label: "Edit + delete" },
        ],
      }),
    )
    expect(html).toContain('role="radiogroup"')
    expect(html.match(/role="radio"/g)?.length).toBe(3)
    expect(html).toContain("kimo-seg-text__segment--on")
    expect(html).toMatch(/aria-checked="true"[^>]*data-value="edit"/)
  })
})

describe("AgentTonePill (StatusPill instances)", () => {
  test("four tones, free label", () => {
    for (const tone of ["success", "warning", "neutral", "danger"] as const) {
      const html = renderToString(h(AgentTonePill, { tone, label: "Installed" }))
      expect(html).toContain(`kimo-agent-pill--${tone}`)
      expect(html).toContain(">Installed<")
    }
  })
})

describe("AgentHostRow (fRQJO) / AgentClientRow (hp5kw)", () => {
  test("host row: icon tile, name, pill, path, actions, muted", () => {
    const html = renderToString(
      h(AgentHostRow, {
        icon: h("svg"),
        name: "VS Code",
        status: { tone: "neutral", label: "Not found" },
        path: "No VS Code install found on this Mac",
        muted: true,
        actions: h("button", { type: "button" }, "Copy config"),
      }),
    )
    expect(html).toContain("kimo-agent-host-row--muted")
    expect(html).toContain("kimo-agent-host-row__tile")
    expect(html).toContain(">Not found<")
    expect(html).toContain(">Copy config<")
  })
  test("client row: writable badge teal, expanded chevron + aria", () => {
    const html = renderToString(
      h(AgentClientRow, {
        name: "Claude Code",
        version: "2.1.4",
        meta: "Since 10:42 · 2 files open · stdio",
        scope: "Edit · this folder",
        writable: true,
        expanded: true,
      }),
    )
    expect(html).toContain("kimo-agent-client-row__scope--writable")
    expect(html).toContain("kimo-agent-client-row--expanded")
    expect(html).toContain('aria-expanded="true"')
    expect(
      renderToString(
        h(AgentClientRow, {
          name: "Codex",
          meta: "",
          scope: "Read only · current file",
          writable: false,
        }),
      ),
    ).not.toContain("__scope--writable")
  })
})

describe("AgentOpRow (m9RhF) / ActivityRow (R7zb80)", () => {
  test("op row: chip tone, revert only with a handler", () => {
    const del = renderToString(
      h(AgentOpRow, { op: "delete", target: "Divider", detail: "rectangle", tone: "danger" }),
    )
    expect(del).toContain("kimo-agent-op-row--danger")
    expect(del).not.toContain("__revert")
    expect(
      renderToString(
        h(AgentOpRow, { op: "update", target: "Card 2", detail: "fill", onRevert: () => {} }),
      ),
    ).toContain("kimo-agent-op-row__revert")
  })
  test("activity row: tones, pending, stale undo", () => {
    const html = renderToString(
      h(ActivityRow, {
        time: "11:06",
        label: "Replace hero",
        tool: "kimo_apply_ops · waiting for approval",
        target: "5 ops",
        tone: "agent",
        pending: true,
      }),
    )
    expect(html).toContain("kimo-activity-row--pending")
    expect(html).toContain("kimo-activity-row--agent")
    expect(html).not.toContain("__undo")
    const stale = renderToString(
      h(ActivityRow, { time: "", label: "", tool: "", target: "", stale: true, onUndo: () => {} }),
    )
    expect(stale).toContain("data-stale")
    expect(stale).toContain("kimo-activity-row__undo")
  })
})

describe("LayerRow/Agent (PwDCI)", () => {
  test("class and standalone mark; CSS turns every LayerRow spacer into the 6 px dot", () => {
    expect(AGENT_LAYER_ROW_CLASS).toBe("kimo-layer-row--agent")
    expect(renderToString(h(AgentLayerMark))).toContain("kimo-agent-layer-mark__dot")
    const css = readFileSync(
      join(import.meta.dir, "../src/agent-layer-mark/AgentLayerMark.css"),
      "utf8",
    )
    expect(css).toContain(".kimo-layer-row--agent .kimo-layer-row__spacer")
    expect(css).toContain(".kimo-layer-row--agent .kimo-layer-row-m3__spacer")
    const styles = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8")
    for (const f of [
      "AgentOrb",
      "AgentPresenceChip",
      "SegmentedText",
      "AgentTonePill",
      "AgentHostRow",
      "AgentClientRow",
      "AgentOpRow",
      "ActivityRow",
      "AgentLayerMark",
    ])
      expect(styles).toContain(`/${f}.css"`)
  })
})
