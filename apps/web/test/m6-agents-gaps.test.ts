/**
 * Board 24 › 5 agent gap vignettes on the M5 surfaces: (c) config diff, (d) 2+ agents
 * popover order + personas, (e) queue badge, (h) undone entries.
 */
import { describe, expect, test } from "bun:test"
import type { McpActivityEntry } from "@kimo/platform"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  type AgentChipView,
  activityRowView,
  backupPath,
  ConfigDiffDialog,
  chipMarkState,
  chipPersonas,
  diffRows,
  sortChips,
  unifiedDiffText,
} from "../src/agents"

describe("(c) config diff preview (K5Dnf)", () => {
  test("unified diff around the change, with context and gap markers", () => {
    const before = [
      "{",
      '  "mcpServers": {',
      '    "kimo": {',
      '      "command": "kimo-mcp@0.4.1",',
      '      "env": {}',
      "    }",
      "  }",
      "}",
    ].join("\n")
    const after = before.replace(
      '"command": "kimo-mcp@0.4.1",',
      '"command": "kimo-mcp@0.5.0",\n      "args": ["--attach"],',
    )
    const rows = diffRows(before, after)
    expect(rows.filter((r) => r.sign === "-").map((r) => r.text.trim())).toEqual([
      '"command": "kimo-mcp@0.4.1",',
    ])
    expect(rows.filter((r) => r.sign === "+").map((r) => r.text.trim())).toEqual([
      '"command": "kimo-mcp@0.5.0",',
      '"args": ["--attach"],',
    ])
    expect(rows[0]?.sign).toBe(" ")
    expect(unifiedDiffText(rows)).toContain('-       "command": "kimo-mcp@0.4.1",')
    expect(diffRows(null, "a\nb")).toEqual([
      { sign: "+", text: "a" },
      { sign: "+", text: "b" },
    ])
    expect(backupPath("~/.claude.json", new Date("2026-10-04T10:00:00Z"))).toBe(
      "~/.claude.json.kimo-2026-10-04.bak",
    )
  })
  test("dialog: title, path · versions, Copy diff / Cancel / Write config, backup footnote", () => {
    const html = renderToString(
      h(ConfigDiffDialog, {
        label: "Claude Code",
        action: "update",
        path: "~/.claude.json",
        versions: "kimo 0.4.1 → 0.5.0",
        before: "a",
        after: "b",
        onCopy: () => {},
        onCancel: () => {},
        onConfirm: () => {},
        now: new Date("2026-10-04T10:00:00Z"),
      }),
    )
    expect(html).toContain("Update Claude Code config?")
    expect(html).toContain("~/.claude.json · kimo 0.4.1 → 0.5.0")
    expect(html).toContain(">Copy diff<")
    expect(html).toContain(">Write config<")
    expect(html).toContain("Backup → ~/.claude.json.kimo-2026-10-04.bak")
    expect(html).toContain("agents-config-diff__line--del")
    expect(html).toContain("agents-config-diff__line--add")
  })
})

const chip = (o: Partial<AgentChipView> & { origin: string }): AgentChipView =>
  ({
    connectionId: o.origin,
    label: o.origin,
    icon: "terminal",
    state: "idle",
    focus: [],
    lastActivityAt: 0,
    client: o.origin,
    presence: "editing",
    text: "",
    connection: {} as never,
    session: { rows: [], groups: [], touched: new Set() } as never,
    policy: {} as never,
    pending: 0,
    paused: null,
    ...o,
  }) as AgentChipView

describe("(d) 2+ agents popover, (e) queue badge", () => {
  test("rows sort waiting → working → idle; marks follow state; spawned agents get personas", () => {
    const chips = [
      chip({ origin: "mcp:claude-code.a", state: "editing" }),
      chip({ origin: "agent:kimo.s1.2", state: "idle" }),
      chip({ origin: "mcp:codex.b", presence: "waiting", state: "waiting-approval" }),
    ]
    const sorted = sortChips(chips)
    expect(sorted.map((c) => c.origin)).toEqual([
      "mcp:codex.b",
      "mcp:claude-code.a",
      "agent:kimo.s1.2",
    ])
    expect(sorted.map(chipMarkState)).toEqual(["listening", "working", "idle"])
    const p = chipPersonas(chips)
    expect(p.get("mcp:claude-code.a")).toBe("teal")
    expect(p.get("mcp:codex.b")).toBe("teal")
    expect(p.get("agent:kimo.s1.2")).toBe("iris")
  })
})

describe("(h) undone activity entry (uKH9b)", () => {
  test("stays in the log; tool line 'Undone by you · time'; not undoable", () => {
    const e: McpActivityEntry = {
      seq: 7,
      time: new Date(2026, 9, 4, 10, 47).getTime(),
      origin: "mcp:claude-code.a",
      actor: "Claude Code",
      kind: "edit",
      tool: "kimo_apply_ops",
      summary: "Swap hero image",
      undoToken: "u7",
      nodeIds: [],
    } as McpActivityEntry
    const r = activityRowView(e, (id) => id, {
      undone: true,
      undoneAt: new Date(2026, 9, 4, 10, 52).getTime(),
    })
    expect(r.undone).toBe(true)
    expect(r.undoable).toBe(false)
    expect(r.tool).toBe("Undone by you · 10:52")
  })
})
