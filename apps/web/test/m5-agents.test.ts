/** Board 21 "Agents & MCP": view models, the window controller over a real DocStore, the panes. */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import type { McpActivityEntry, McpApprovalRequest, McpConnectionInfo } from "@kimo/platform"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  AgentsMcpPane,
  activityGroups,
  activityRowView,
  approvalDescription,
  approvalFootnote,
  approvalTargets,
  approvalTitle,
  canLabel,
  changesLabel,
  clientOf,
  configSnippet,
  createAgentsController,
  DEFAULT_POLICY,
  diffLines,
  dryRunFromApproval,
  filesForScope,
  filesScopeOf,
  formatRevision,
  hostRowView,
  maskToken,
  matchesKind,
  nowCopy,
  presenceLabel,
  scopeLabel,
  serverPill,
  sessionOps,
  shortValue,
  storeNames,
} from "../src/agents"
import { createScriptedMcpHost, sampleConnection, sampleHosts } from "../src/agents/testing"
import {
  activeFeatures,
  FEATURE_ITEMS,
  featureChipLabel,
  featureOn,
  parseCustomTag,
  resetStyleOps,
  STYLISTIC_SETS,
  toggledFeature,
} from "../src/editor/sections/TextSection"
import { approvalChoices } from "../src/platform/contract"

const ORIGIN = "mcp:claude-code.k3x9qa"
const FILE = "f1"

function pricingDoc(): KimoDocument {
  const d = createEmptyDocument("Pricing") as KimoDocument & { nodes: Record<string, unknown> }
  const frame = (id: string, name: string, parent: string | null, order: string, extra = {}) => {
    d.nodes[id] = { type: "frame", parent, order, name, x: 0, y: 0, w: 136, h: 220, ...extra }
  }
  frame("Pricing0001", "Pricing — Desktop", null, "a0", { w: 520, h: 420, fill: "#FFFFFF" })
  frame("Cards00001", "Cards", "Pricing0001", "a0", { w: 440 })
  frame("Card000001", "Card 1", "Cards00001", "a0", { fill: "#F4F1EC" })
  frame("Card000002", "Card 2", "Cards00001", "a1", { fill: "#F4F1EC", radius: 12 })
  frame("Card000003", "Card 3", "Cards00001", "a2", { fill: "#F4F1EC" })
  d.nodes.Divider001 = {
    type: "rect",
    parent: "Pricing0001",
    order: "a1",
    name: "Divider",
    x: 0,
    y: 0,
    w: 440,
    h: 1,
  }
  return d
}

function approval(over: Partial<McpApprovalRequest> = {}): McpApprovalRequest {
  return {
    id: "ap1",
    client: {
      client: "codex",
      label: "Codex",
      version: "0.48.0",
      session: "q7w2er",
      transport: "http",
    },
    tool: "kimo_apply_ops",
    path: "/Users/me/repo/design/home.kimo",
    reason: { kind: "destructive", ops: ["delete"], nodeIds: ["Card000001", "Card000003"] },
    summary: "Replace hero",
    preview: {
      inserted: 1,
      updated: 1,
      deleted: 2,
      nodeIds: ["Card000001", "Card000003", "Card000002", "NewHero001"],
    },
    requestedAt: 1_000,
    expiresAt: 121_000,
    ...over,
  }
}

const entry = (over: Partial<McpActivityEntry> & { seq: number }): McpActivityEntry => ({
  time: new Date(2026, 9, 4, 10, 47).getTime(),
  origin: ORIGIN,
  actor: "Claude Code",
  kind: "edit",
  tool: "kimo_apply_ops",
  summary: "Restyle pricing cards",
  revision: { epoch: "k9abc", seq: 43 },
  nodeIds: ["Card000002", "Card000003"],
  undoToken: "u1",
  ...over,
})

describe("formatting and policies", () => {
  test("revision, origin, short values", () => {
    expect(formatRevision({ epoch: "k9xyz", seq: 43 })).toBe("k9·43")
    expect(clientOf("mcp:claude-code.k3x9qa")).toBe("claude-code")
    expect(shortValue("#E9DFCF")).toBe("#E9DFCF")
    expect(shortValue(undefined)).toBe("none")
    expect(shortValue([{ color: "#fff" }])).toBe("#fff")
  })
  test("files scope ↔ allow-list round trip; scope / can labels", () => {
    const cwd = "/Users/me/repo/design"
    for (const s of ["current", "folder", "any"] as const)
      expect(filesScopeOf({ ...DEFAULT_POLICY, files: filesForScope(s, cwd) }, cwd)).toBe(s)
    expect(scopeLabel({ ...DEFAULT_POLICY, files: [`${cwd}/**`] }, cwd)).toBe("Edit · this folder")
    expect(scopeLabel({ ...DEFAULT_POLICY, level: "read" }, cwd)).toBe("Read only · current file")
    expect(canLabel({ ...DEFAULT_POLICY, files: [`${cwd}/**`] }, cwd)).toBe(
      "Can edit · ~/repo/design/",
    )
  })
  test("server pill (rule Server status)", () => {
    const s = {
      socket: { path: "x", listening: true },
      http: { enabled: false },
      documentHost: "ready",
      shimPath: "",
      protocol: "p",
      connections: 2,
    } as const
    expect(serverPill(s, 2)).toEqual({ tone: "success", label: "Running · 2 clients" })
    expect(serverPill(s, 0).label).toBe("Running · no clients")
    expect(serverPill({ ...s, socket: { path: "x", listening: false } }, 0)).toEqual({
      tone: "neutral",
      label: "Stopped",
    })
    expect(serverPill(s, 0, { code: "EADDRINUSE", message: "" })).toEqual({
      tone: "danger",
      label: "Error · HTTP down",
    })
  })
  test("host rows (rule Host rows): installed / outdated / not installed / not found", () => {
    const rows = sampleHosts().map((h) =>
      hostRowView(h, { home: "/Users/me", machine: "this Mac", entryVersion: "0.4" }),
    )
    expect(rows.map((r) => [r.state, r.status.label, r.status.tone])).toEqual([
      ["installed", "Installed", "success"],
      ["outdated", "Outdated · kimo-mcp 0.4", "warning"],
      ["not-installed", "Not installed", "neutral"],
      ["installed", "Installed", "success"],
      ["not-found", "Not found", "neutral"],
    ])
    expect(rows[0]?.path).toBe("~/.claude.json · mcpServers.kimo")
    expect(rows[1]?.path).toBe("~/.codex/config.toml · [mcp_servers.kimo]")
    expect(rows[2]?.path).toBe("~/.gemini/settings.json · not configured")
    expect(rows[4]?.path).toBe("No VS Code install found on this Mac")
    expect(rows.map((r) => r.icon)).toEqual([
      "square-terminal",
      "terminal",
      "sparkle",
      "mouse-pointer-2",
      "code-xml",
    ])
  })
  test("copy config per host (ADR 0013 §9 entries); token mask; diff", () => {
    expect(configSnippet("claude-code", "/k")).toContain('"mcpServers"')
    expect(configSnippet("vscode", "/k")).toContain('"servers"')
    expect(configSnippet("gemini-cli", "/k")).toContain('"trust": false')
    expect(configSnippet("codex", "/k")).toMatch(/^\[mcp_servers\.kimo\]/)
    expect(configSnippet("codex", "/k")).toContain('default_tools_approval_mode = "approve"')
    expect(maskToken("kimo_pat_abcdef123f9a")).toBe("kimo_pat_••••••••••••3f9a")
    expect(diffLines("{}\n", '{\n  "kimo": 1\n}\n')).toContain('+   "kimo": 1')
  })
})

describe("session ops from the op log (AgentOpRow, rule Session popover)", () => {
  test("update rows show before → after, insert folds children, delete counts, keep / undo", () => {
    const store = importDocument(pricingDoc())
    const o = { origin: ORIGIN } as const
    expect(
      store.apply({ op: "update", id: "Card000002", set: { fill: "#E9DFCF", radius: 20 } }, o).ok,
    ).toBe(true)
    expect(
      store.apply(
        [
          {
            op: "insert",
            id: "Popular001",
            node: {
              type: "frame",
              parent: "Card000002",
              name: "Popular",
              x: 0,
              y: 0,
              w: 57,
              h: 19,
            },
          },
          {
            op: "insert",
            id: "PopLabel01",
            node: {
              type: "text",
              parent: "Popular001",
              name: "Label",
              x: 0,
              y: 0,
              content: "Popular",
            },
          },
        ],
        o,
      ).ok,
    ).toBe(true)
    expect(store.apply({ op: "delete", id: "Divider001" }, o).ok).toBe(true)
    expect(
      store.apply({ op: "update", id: "Card000001", set: { name: "Free" } }, { origin: "user" }).ok,
    ).toBe(true)

    const s = sessionOps(store.log(), ORIGIN, -1, store)
    expect(s.groups.length).toBe(3)
    expect(s.rows.map((r) => `${r.op} ${r.target} | ${r.detail}`)).toEqual([
      "update Card 2 | fill #F4F1EC → #E9DFCF",
      "update Card 2 | radius 12 → 20",
      "insert Popular | frame + text in Card 2",
      "delete Divider | rect",
    ])
    expect(s.rows[3]?.tone).toBe("danger")
    expect([...s.touched].sort()).toEqual(["Card000002", "PopLabel01", "Popular001"])
    expect(changesLabel(s)).toBe("4 changes · 3 nodes")
    expect(s.after?.seq).toBe((s.before?.seq ?? 0) + 3)
    expect(s.rows.map((r) => r.group)).toEqual([0, 0, 1, 2])

    // Undo pops the top group; Keep commits the rest.
    store.undo(ORIGIN)
    expect(sessionOps(store.log(), ORIGIN, -1, store).groups.length).toBe(2)
    const keep = sessionOps(store.log(), ORIGIN, -1, store).after?.seq ?? 0
    expect(sessionOps(store.log(), ORIGIN, keep, store).rows).toEqual([])
  })
})

describe("approval prompt (rule Approval)", () => {
  test("title, description, targets, choices without session for files, footnote countdown", () => {
    const store = importDocument(pricingDoc())
    const r = approval()
    expect(approvalTitle(r, store)).toBe("Codex wants to delete 2 frames")
    expect(approvalDescription(r, "edit")).toBe(
      "Its permission is Edit, so deletes need your OK. Nothing is applied while you decide — the canvas shows a dry run.",
    )
    expect(approvalTargets(r, store).map((t) => `${t.op} ${t.target} ${t.detail}`)).toEqual([
      "delete Card 1 frame",
      "delete Card 3 frame",
      "update Card 2 ",
      "insert NewHero001 new",
    ])
    expect(approvalChoices(r)).toEqual(["deny", "session", "once"])
    const file = approval({ reason: { kind: "file", path: "/tmp/x.kimo", action: "open" } })
    expect(approvalChoices(file)).toEqual(["deny", "once"])
    expect(approvalTitle(file)).toBe("Codex wants to open x.kimo")
    expect(approvalFootnote(r, 120_000, 1)).toBe(
      "Codex is waiting. No answer in 2 min → PERMISSION_DENIED. Esc = Deny.",
    )
    expect(approvalFootnote(file, 61_000, 3)).toBe(
      "Codex is waiting. No answer in 1:01 → OUT_OF_SCOPE. Esc = Deny. 2 more waiting.",
    )
    const dry = dryRunFromApproval(r, store)
    expect(dry.counts).toEqual({ delete: 2, insert: 1, update: 1 })
    expect(dry.ghosts.map((g) => g.kind)).toEqual(["delete", "delete", "update", "insert"])
  })
})

describe("activity (rules Grouping, Entry, States)", () => {
  test("rows: tool line, tone, target with revision, stale, denial", () => {
    const store = importDocument(pricingDoc())
    const names = storeNames(store)
    const ok = activityRowView(entry({ seq: 1 }), names)
    expect(ok.time).toBe("10:47")
    expect(ok.tool).toBe("kimo_apply_ops · 2 nodes")
    expect(ok.target).toBe("Card 2 +1 · k9·43")
    expect(ok.undoable).toBe(true)
    const denied = activityRowView(
      entry({
        seq: 2,
        kind: "denied",
        code: "PERMISSION_DENIED",
        outcome: "deny",
        undoToken: undefined,
        nodeIds: ["Card000001"],
      }),
      names,
    )
    expect([denied.tool, denied.tone, denied.target, denied.undoable]).toEqual([
      "PERMISSION_DENIED · denied by you",
      "danger",
      "Card 1 · no change",
      false,
    ])
    expect(
      activityRowView(entry({ seq: 3, kind: "error", code: "REVISION_CONFLICT" }), names).tone,
    ).toBe("warning")
    expect(
      activityRowView(
        entry({ seq: 4, kind: "export", nodeIds: [], revision: undefined, undoToken: undefined }),
        names,
      ).target,
    ).toBe("no doc change")
    expect(activityRowView(entry({ seq: 5 }), names, { stale: true }).target).toBe(
      "stale · nothing left to undo",
    )
  })
  test("filters and grouping: reads hidden by default, pending first, newest group first", () => {
    expect(matchesKind("read", "writes-errors")).toBe(false)
    expect(matchesKind("denied", "writes-errors")).toBe(true)
    expect(matchesKind("render", "all")).toBe(true)
    const entries = [
      entry({ seq: 1, time: 1 }),
      entry({ seq: 2, time: 2, kind: "read", tool: "kimo_query" }),
      entry({
        seq: 3,
        time: 5,
        origin: "mcp:codex.q7w2er",
        actor: "Codex",
        kind: "denied",
        code: "PERMISSION_DENIED",
      }),
    ]
    const groups = activityGroups({
      entries,
      pending: [approval({ requestedAt: 6 })],
      nameOf: (id) => id,
      client: "all",
      kind: "writes-errors",
      stale: new Set(),
      undone: new Set(),
      transport: (o) => (o.startsWith("mcp:codex") ? "http" : "stdio"),
    })
    expect(groups.map((g) => g.name)).toEqual(["Codex", "Claude Code"])
    expect(groups[0]?.rows.map((r) => r.pending)).toEqual([true, false])
    expect(groups[0]?.rows[0]?.tool).toBe("kimo_apply_ops · waiting for approval")
    expect(groups[1]?.rows.length).toBe(1) // the read is filtered out
    expect(groups[1]?.meta.endsWith("· stdio")).toBe(true)
    const codexOnly = activityGroups({
      entries,
      pending: [],
      nameOf: (id) => id,
      client: "codex",
      kind: "all",
      stale: new Set(),
      undone: new Set(),
    })
    expect(codexOnly.map((g) => g.client)).toEqual(["codex"])
  })
})

describe("controller (AgentsController over McpHostApi + DocStore)", () => {
  async function setup(now = { t: 100_000 }) {
    const store = importDocument(pricingDoc())
    const conn = sampleConnection({ docs: ["doc-1"], state: "idle", lastActivityAt: 0 })
    const host = createScriptedMcpHost({ connections: [conn], hosts: sampleHosts() })
    const focus: string[][] = []
    const c = createAgentsController({
      host,
      fileId: FILE,
      filePath: "/Users/me/repo/design/home.kimo",
      docId: "doc-1",
      store,
      // The test store owns the agent's undo stack (in-process host).
      hostHistory: false,
      now: () => now.t,
      onFocus: (ids) => focus.push(ids),
    })
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    return { store, host, c, conn, now, focus }
  }

  test("presence: hidden until a write; editing chip with op count; hidden 60 s after", async () => {
    const { store, host, c, now } = await setup()
    expect(c.state.chips).toEqual([])
    store.apply({ op: "update", id: "Card000002", set: { fill: "#E9DFCF" } }, { origin: ORIGIN })
    host.control.append(FILE, entry({ seq: 10, time: now.t, nodeIds: ["Card000002"] }))
    const chip = c.state.chips[0]
    expect(chip?.presence).toBe("editing")
    expect(chip?.text).toBe("Claude Code is editing")
    expect(chip?.meta).toBe("1 op")
    expect(chip?.focus).toEqual(["Card000002"])
    expect([...c.state.touched]).toEqual(["Card000002"])
    // Keep: committed → no dots; after 60 s without writes the chip hides.
    c.keep(ORIGIN)
    expect(c.state.touched.size).toBe(0)
    now.t += 61_000
    c.refresh()
    expect(c.state.chips).toEqual([])
    c.dispose()
  })

  test("approvals: waiting chip, prompt queue oldest first, answer → respond, dry run for this file", async () => {
    const { host, c } = await setup()
    host.control.request(
      approval({
        id: "b",
        requestedAt: 5,
        client: {
          client: "claude-code",
          label: "Claude Code",
          session: "k3x9qa",
          transport: "socket",
        },
      }),
    )
    host.control.request(
      approval({
        id: "a",
        requestedAt: 2,
        client: {
          client: "claude-code",
          label: "Claude Code",
          session: "k3x9qa",
          transport: "socket",
        },
      }),
    )
    expect(c.state.prompt?.request.id).toBe("a")
    expect(c.state.prompt?.queued).toBe(2)
    expect(c.state.chips[0]?.presence).toBe("waiting")
    expect(c.state.chips[0]?.text).toBe("Claude Code needs approval")
    expect(c.state.chips[0]?.meta).toBe("2")
    expect(c.state.dryRun?.source).toBe("approval")
    await c.answer("a", "once")
    expect(host.calls).toContain("respond a once")
    expect(c.state.prompt?.request.id).toBe("b")
    host.control.resolve("b", "timeout")
    expect(c.state.prompt).toBeNull()
    expect(c.state.dryRun).toBeNull()
    c.dispose()
  })

  test("paused on READ_ONLY / DOCUMENT_LOCKED; a later edit clears it; user pause = host pause", async () => {
    const { host, c, now } = await setup()
    host.control.append(
      FILE,
      entry({ seq: 20, time: now.t, kind: "error", code: "READ_ONLY", undoToken: undefined }),
    )
    expect(c.state.chips[0]?.presence).toBe("paused")
    expect(c.state.chips[0]?.text).toBe("Claude Code · edits paused")
    expect(c.state.chips[0]?.meta).toBe("read-only")
    host.control.append(FILE, entry({ seq: 21, time: now.t }))
    expect(c.state.chips[0]?.presence).toBe("editing")
    await c.pause("claude-code")
    // A real pause in the host runtime, not a policy change.
    expect(host.calls).toContain("pause claude-code")
    expect(host.control.policies["claude-code"]).toBeUndefined()
    expect(await host.clients.paused()).toEqual(["claude-code"])
    expect(c.state.connections[0]?.paused).toBe(true)
    expect(c.state.chips[0]?.presence).toBe("paused")
    await c.resume("claude-code")
    expect(await host.clients.paused()).toEqual([])
    expect(c.state.chips[0]?.presence).toBe("editing")
    c.dispose()
  })

  test("M5 addendum: host undo per call, Now row call label, focus nodes, preview kinds, op count", async () => {
    const { host, c, now } = await setup()
    const c2 = createAgentsController({
      host,
      fileId: FILE,
      filePath: "/Users/me/repo/design/home.kimo",
      docId: "doc-1",
      now: () => now.t,
    })
    host.control.setUndo((_p, _o, token) => ({ ok: token === "tok-1", stale: token !== "tok-1" }))
    const r = await c2.undoEntry(entry({ seq: 40, time: now.t, undoToken: "tok-1" }))
    expect(r).toEqual({ ok: true, stale: false })
    expect(host.calls).toContain(`undo ${ORIGIN} tok-1`)
    host.control.append(FILE, entry({ seq: 39, time: now.t }))
    const id = c.state.connections[0]?.connectionId as string
    host.control.updateConnection(id, {
      call: { tool: "kimo_render", label: "Rendering Card", startedAt: now.t },
      focus: ["Card000003"],
    })
    expect(nowCopy(c.state.connections[0] as McpConnectionInfo)).toEqual({
      label: "Rendering Card",
      tool: "kimo_render",
    })
    expect(c.state.chips[0]?.focus).toEqual(["Card000003"])
    const req = {
      id: "ap-k",
      client: (c.state.connections[0] as McpConnectionInfo).identity,
      tool: "kimo_apply_ops",
      reason: { kind: "level" as const, need: "delete" as const, have: "edit" as const },
      summary: "x",
      preview: {
        inserted: 1,
        updated: 0,
        deleted: 1,
        nodeIds: ["Card000002", "NewNode1"],
        kinds: { Card000002: "delete" as const, NewNode1: "insert" as const },
      },
      requestedAt: now.t,
      expiresAt: now.t + 120_000,
    }
    const rows = approvalTargets(req, c.store)
    expect(rows.map((x) => x.op)).toEqual(["delete", "insert"])
    const row = activityRowView(
      entry({
        seq: 41,
        time: now.t,
        opCount: 3,
        label: "Restyle cards",
        revisionBefore: { epoch: "e1", seq: 4 },
        revision: { epoch: "e1", seq: 5 },
      }),
      (x) => x,
    )
    expect(row.tool).toContain("3 ops")
    expect(row.label).toBe("Restyle cards")
    expect(row.target).toContain("→")
    c2.dispose()
    c.dispose()
  })

  test("undo all / revert top / undo entry (guarded) / undo session; stale marks", async () => {
    const { store, host, c, now, focus } = await setup()
    store.apply({ op: "update", id: "Card000002", set: { fill: "#E9DFCF" } }, { origin: ORIGIN })
    store.apply({ op: "update", id: "Card000003", set: { fill: "#E9DFCF" } }, { origin: ORIGIN })
    host.control.append(FILE, entry({ seq: 30, time: now.t }))
    expect(c.state.chips[0]?.session.groups.length).toBe(2)
    await c.undoTop(ORIGIN)
    expect(c.state.chips[0]?.session.groups.length).toBe(1)
    const r = await c.undoAll(ORIGIN)
    expect(r.undone).toBe(1)
    expect((store.getNode("Card000002") as { fill?: unknown }).fill).toBe("#F4F1EC")
    // Nothing left on the stack: the entry's undo is stale.
    const e = c.state.activity.at(-1) as McpActivityEntry
    const res = await c.undoEntry(e)
    expect(res.ok).toBe(false)
    expect(c.state.stale.has(30)).toBe(true)
    c.focusEntry(e)
    expect(focus).toEqual([["Card000002", "Card000003"]])
    c.dispose()
  })

  test("policies, disconnect, hosts install/remove through the host API", async () => {
    const { host, c, conn } = await setup()
    await c.setPolicy("claude-code", { ...DEFAULT_POLICY, level: "edit+delete" })
    expect(c.state.policies["claude-code"]?.level).toBe("edit+delete")
    await c.loadHosts()
    expect(c.state.hosts.length).toBe(5)
    const row = await c.installHost("gemini-cli", "user")
    expect(row.installed).toBe(true)
    await c.removeHost("cursor", "user")
    expect(c.state.hosts.find((x) => x.host === "cursor")?.installed).toBe(false)
    await c.disconnect(conn.connectionId)
    expect(host.calls).toContain(`disconnect ${conn.connectionId}`)
    expect(c.state.connections).toEqual([])
    c.dispose()
  })

  test("presence label verbs", () => {
    expect(presenceLabel("Codex", "editing", { state: "reading" })).toBe("Codex is reading")
    expect(presenceLabel("Codex", "waiting")).toBe("Codex needs approval")
  })
})

describe("Settings › Agents & MCP pane (SSR first paint)", () => {
  test("renders the empty layout before data arrives (hgZHV)", () => {
    const host = createScriptedMcpHost()
    const html = renderToString(h(AgentsMcpPane, { host }))
    expect(html).toContain('data-state="empty"')
    expect(html).toContain("No agents connected")
    expect(html).toContain("How to connect")
  })
  test("failed state (bxqQH) with banner and port fix", () => {
    const host = createScriptedMcpHost()
    const html = renderToString(
      h(AgentsMcpPane, {
        host,
        server: {
          error: {
            code: "EADDRINUSE 127.0.0.1:7341",
            message: "Port 7341 is in use.",
            port: 7341,
            suggestedPort: 7342,
          },
        },
      }),
    )
    expect(html).toContain('data-state="error"')
    expect(html).toContain("MCP server failed to start")
    expect(html).toContain("Use 7342 and restart")
    expect(html).toContain("7342 is free")
  })
})

describe("Text “…” menu (board 21 N6MWL)", () => {
  test("liga / calt default on; toggles write false / remove; chips for non-defaults", () => {
    expect(FEATURE_ITEMS.map((f) => f.tag)).toEqual([
      "liga",
      "calt",
      "tnum",
      "zero",
      "smcp",
      "frac",
    ])
    expect(STYLISTIC_SETS[0]).toBe("ss01")
    expect(STYLISTIC_SETS.at(-1)).toBe("ss20")
    expect(featureOn({}, "liga")).toBe(true)
    expect(featureOn({}, "tnum")).toBe(false)
    expect(toggledFeature({}, "liga")).toBe(false)
    expect(toggledFeature({ liga: false }, "liga")).toBeUndefined()
    expect(toggledFeature({}, "tnum")).toBe(true)
    expect(toggledFeature({ tnum: true }, "tnum")).toBeUndefined()
    expect(
      activeFeatures({ liga: true, tnum: true, ss01: true, calt: false }).map(([t]) => t),
    ).toEqual(["tnum", "ss01", "calt"])
    expect(featureChipLabel("salt", 2)).toBe("salt = 2")
    expect(featureChipLabel("calt", false)).toBe("calt off")
    expect(parseCustomTag("salt = 2")).toEqual(["salt", 2])
    expect(parseCustomTag("ss03")).toEqual(["ss03", true])
    expect(parseCustomTag("toolong")).toBeNull()
  })
  test("Reset text style keeps font / size / weight / spacing / align", () => {
    const node = {
      type: "text",
      style: {
        font: "Inter",
        size: 32,
        weight: 600,
        align: "center",
        italic: true,
        href: "https://x",
        features: { tnum: true },
        decoration: ["underline"],
        case: "upper",
      },
    }
    const [op] = resetStyleOps([{ id: "T1", node } as never])
    expect(op).toEqual({
      op: "update",
      id: "T1",
      set: { style: { font: "Inter", size: 32, weight: 600, align: "center" } },
    })
    expect(
      resetStyleOps([{ id: "T2", node: { type: "text", style: { italic: true } } } as never])[0],
    ).toEqual({
      op: "update",
      id: "T2",
      unset: ["style"],
    })
  })
})
