/**
 * M5 document host round trip (ADR 0002 Option A, ADR 0013 §12 item 2): the real editor as a
 * client of an in-page document host (`e2e/m5-host-harness`). An MCP client's edit appears in
 * the editor (layers panel + replica store), the user's ⌘Z undoes only the user's edit, and the
 * agent's own undo removes its edit from the editor.
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { type E2EContext, expect, type Scenario } from "./run"

const here = fileURLToPath(new URL(".", import.meta.url))
const harnessDir = join(here, "m5-host-harness")
let built: Promise<string> | null = null

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m5-host-harness/index.html`
  built ??= build({
    root: harnessDir,
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "m5-host"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "m5-host/index.html")
  return `${ctx.url}${await built}`
}

type HostHook = {
  FILE: string
  call(
    tool: string,
    input: unknown,
  ): Promise<{
    ok: boolean
    summary: string
    data?: Record<string, unknown>
    created?: { key: string; id: string }[]
    undoToken?: string
  }>
}

type AgentHook = {
  agentCall(
    tool: string,
    input: Record<string, unknown>,
    o?: { n?: number; scope?: string[] },
  ): Promise<{
    ok: boolean
    summary: string
    data?: Record<string, unknown>
    created?: { key: string; id: string }[]
    undoToken?: string
    errors?: { code: string }[]
  }>
}

/** An in-app agent's call through the host RPC `agentCall` (ADR 0014 §5). */
const agentCall = (
  page: Page,
  tool: string,
  input: Record<string, unknown>,
  o: { n?: number; scope?: string[] } = {},
) =>
  page.evaluate(
    ([t, i, opts]) =>
      (window as unknown as { __kimoHost: AgentHook }).__kimoHost.agentCall(
        t as string,
        i as Record<string, unknown>,
        opts as { n?: number; scope?: string[] },
      ),
    [tool, input, o] as const,
  )

const call = (page: Page, tool: string, input: unknown) =>
  page.evaluate(
    ([t, i]) => (window as unknown as { __kimoHost: HostHook }).__kimoHost.call(t as string, i),
    [tool, input] as const,
  )

const replicaName = (page: Page, id: string) =>
  page.evaluate(
    (nid) =>
      (
        window as unknown as {
          __kimo?: { session: { store: { getNode(id: string): { name?: string } | undefined } } }
        }
      ).__kimo?.session.store.getNode(nid)?.name ?? null,
    id,
  )

const layerRow = (page: Page, name: string) =>
  page.locator(".kimo-layer-row__name", { hasText: new RegExp(`^${name}$`) })

const replicaHas = (page: Page, id: string) =>
  page.evaluate(
    (n) =>
      !!(
        window as unknown as { __kimo?: { session: { store: { hasNode(id: string): boolean } } } }
      ).__kimo?.session.store.hasNode(n),
    id,
  )

export const scenarios: Scenario[] = [
  {
    name: "m5-host: an in-app agent through agentCall — presence, activity, MCP attribution, undo isolation, scope",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      const base = await harnessUrl(ctx)
      await page.goto(`${base}?kimo-debug`)
      await page.waitForFunction(() => !!(window as unknown as { __kimoHost?: unknown }).__kimoHost)
      const file = await page.evaluate(
        () => (window as unknown as { __kimoHost: HostHook }).__kimoHost.FILE,
      )
      await page.evaluate((f) => {
        location.hash = `#/disk/${encodeURIComponent(f)}`
      }, file)
      await page.locator(".canvas-host canvas").first().waitFor({ timeout: 20_000 })
      await layerRow(page, "Home").first().waitFor({ timeout: 15_000 })
      const opened = await call(page, "kimo_open", { path: file })
      expect(opened.ok, `kimo_open: ${opened.summary}`)
      const docId = (opened.data as { doc: { id: string } }).doc.id

      // A user edit first (the window's own undo stack).
      await page.evaluate(() => {
        const k = (window as unknown as { __kimo: { session: { apply(o: unknown): boolean } } })
          .__kimo
        k.session.apply({ op: "update", id: "Frame00001", set: { name: "User rename" } })
      })
      await layerRow(page, "User rename").first().waitFor({ timeout: 10_000 })

      // The in-app agent (lead, agent:kimo.e2e.0) inserts a card through the document host.
      const applied = await agentCall(page, "kimo_apply_ops", {
        label: "Insert Kimo card",
        ops: [
          {
            op: "insert",
            key: "card",
            parent: "Frame00001",
            node: { type: "rect", name: "Kimo card", x: 40, y: 40, w: 120, h: 80 },
          },
        ],
      })
      expect(applied.ok, `agent kimo_apply_ops: ${applied.summary}`)
      const cardId = applied.created?.[0]?.id as string
      await page.waitForFunction(
        (id) =>
          !!(
            window as unknown as {
              __kimo?: { session: { store: { hasNode(id: string): boolean } } }
            }
          ).__kimo?.session.store.hasNode(id),
        cardId,
        { timeout: 10_000 },
      )
      const tree = page.locator(".layer-tree")
      const disclosure = tree.locator('[data-node-id="Frame00001"] [aria-label="Expand"]')
      if ((await disclosure.count()) > 0) await disclosure.first().click()
      await layerRow(page, "Kimo card").first().waitFor({ timeout: 10_000 })

      // Presence: the window's McpHostApi lists the agent next to the MCP client.
      await page.waitForFunction(
        async () => {
          const mcp = (
            window as unknown as {
              __kimoHost: {
                platform: {
                  mcp: { connections(): Promise<{ origin: string; identity: { label: string } }[]> }
                }
              }
            }
          ).__kimoHost.platform.mcp
          const list = await mcp.connections()
          return (
            list.some((c) => c.origin === "agent:kimo.e2e.0" && c.identity.label === "Kimo") &&
            list.some((c) => c.origin.startsWith("mcp:claude-code."))
          )
        },
        undefined,
        { timeout: 10_000 },
      )

      // Activity tab: the agent's labelled edit, attributed to Kimo.
      await page.getByRole("tab", { name: "Activity" }).click()
      const activity = page.locator("[data-testid=agent-activity]")
      await activity.waitFor({ timeout: 10_000 })
      await activity.getByText("Insert Kimo card").first().waitFor({ timeout: 10_000 })

      // The MCP client sees the agent on the document and cannot undo its edit.
      const state = await call(page, "kimo_get_state", { docId })
      const agents =
        (state.data as { documents: { agents: { origin: string; label: string }[] }[] })
          .documents[0]?.agents ?? []
      expect(
        agents.some((a) => a.origin === "agent:kimo.e2e.0" && a.label === "Kimo"),
        `kimo_get_state agents: ${JSON.stringify(agents)}`,
      )
      const mcpUndo = await call(page, "kimo_history", { docId, action: "undo" })
      expect(!mcpUndo.ok, "the MCP client has nothing of its own to undo")
      expect(await replicaHas(page, cardId), "the agent's card survives the MCP client's undo")

      // ⌘Z in the editor: undoes the user's rename only.
      await page.locator(".canvas-host").click({ position: { x: 5, y: 5 } })
      await page.keyboard.press("Meta+z")
      await layerRow(page, "Home").first().waitFor({ timeout: 10_000 })
      expect(await replicaHas(page, cardId), "the agent's card survives the user's undo")

      // A scoped child (agent:kimo.e2e.1, scope = the card) cannot touch the frame.
      const out = await agentCall(
        page,
        "kimo_apply_ops",
        { ops: [{ op: "update", id: "Frame00001", set: { name: "Out of scope" } }] },
        { n: 1, scope: [cardId] },
      )
      expect(
        !out.ok && out.errors?.[0]?.code === "OUT_OF_SCOPE",
        `scoped child: ${out.summary} ${JSON.stringify(out.errors)}`,
      )
      expect((await replicaName(page, "Frame00001")) === "Home", "nothing applied")

      // The agent's own undo (Undo turn) removes its card from the editor.
      const undo = await agentCall(page, "kimo_history", {
        action: "undo",
        token: applied.undoToken,
      })
      expect(undo.ok, `agent kimo_history undo: ${undo.summary}`)
      await layerRow(page, "Kimo card").waitFor({ state: "detached", timeout: 10_000 })
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m5-host-agent-call.png") })
    },
  },
  {
    name: "m5-host: an MCP edit appears in the editor; the user's undo never undoes agent ops",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      const base = await harnessUrl(ctx)
      await page.goto(`${base}?kimo-debug`)
      await page.waitForFunction(() => !!(window as unknown as { __kimoHost?: unknown }).__kimoHost)
      const file = await page.evaluate(
        () => (window as unknown as { __kimoHost: HostHook }).__kimoHost.FILE,
      )
      await page.evaluate((f) => {
        location.hash = `#/disk/${encodeURIComponent(f)}`
      }, file)
      await page.locator(".canvas-host canvas").first().waitFor({ timeout: 20_000 })
      await layerRow(page, "Home").first().waitFor({ timeout: 15_000 })

      // The agent opens the file the window shows: the same host document.
      const opened = await call(page, "kimo_open", { path: file })
      expect(opened.ok, `kimo_open: ${opened.summary}`)
      expect((opened.data as { alreadyOpen: boolean }).alreadyOpen, "already open in the host")
      const docId = (opened.data as { doc: { id: string } }).doc.id

      // A user edit through the editor session (origin user, the window's undo stack).
      await page.evaluate(() => {
        const k = (window as unknown as { __kimo: { session: { apply(o: unknown): boolean } } })
          .__kimo
        k.session.apply({ op: "update", id: "Frame00001", set: { name: "User rename" } })
      })
      await layerRow(page, "User rename").first().waitFor({ timeout: 10_000 })

      // The agent inserts a card: it appears in the editor's layers panel.
      const applied = await call(page, "kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            key: "card",
            parent: "Frame00001",
            node: {
              type: "rect",
              name: "Agent card",
              x: 40,
              y: 40,
              w: 120,
              h: 80,
              fill: "#0EA5A4",
            },
          },
        ],
      })
      expect(applied.ok, `kimo_apply_ops: ${applied.summary}`)
      const cardId = applied.created?.[0]?.id as string
      await page.waitForFunction(
        (id) =>
          !!(
            window as unknown as {
              __kimo?: { session: { store: { hasNode(id: string): boolean } } }
            }
          ).__kimo?.session.store.hasNode(id),
        cardId,
        { timeout: 10_000 },
      )
      const tree = page.locator(".layer-tree")
      const disclosure = tree.locator('[data-node-id="Frame00001"] [aria-label="Expand"]')
      if ((await disclosure.count()) > 0) await disclosure.first().click()
      await layerRow(page, "Agent card").first().waitFor({ timeout: 10_000 })

      // ⌘Z in the editor: undoes the user's rename only.
      await page.locator(".canvas-host").click({ position: { x: 5, y: 5 } })
      await page.keyboard.press("Meta+z")
      await layerRow(page, "Home").first().waitFor({ timeout: 10_000 })
      expect(await replicaHas(page, cardId), "the agent's card survives the user's undo")
      const state = await call(page, "kimo_query", {
        docId,
        select: { ids: [cardId, "Frame00001"] },
        depth: 0,
      })
      const names = ((state.data as { nodes: { name?: string }[] }).nodes ?? []).map((n) => n.name)
      expect(
        JSON.stringify(names) === JSON.stringify(["Agent card", "Home"]),
        `host document after the user's undo: ${JSON.stringify(names)}`,
      )

      // The agent's own undo removes its card from the editor.
      const undo = await call(page, "kimo_history", {
        docId,
        action: "undo",
        token: applied.undoToken,
      })
      expect(undo.ok, `kimo_history undo: ${undo.summary}`)
      await page.waitForFunction(
        (id) =>
          !(
            window as unknown as {
              __kimo?: { session: { store: { hasNode(id: string): boolean } } }
            }
          ).__kimo?.session.store.hasNode(id),
        cardId,
        { timeout: 10_000 },
      )
      await layerRow(page, "Agent card").waitFor({ state: "detached", timeout: 10_000 })
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m5-host.png") })
    },
  },
  {
    name: "m5-host: agents UI in the real editor — presence chip, layer dot, Activity tab, kimo_focus, pause",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      const base = await harnessUrl(ctx)
      await page.goto(`${base}?kimo-debug`)
      await page.waitForFunction(() => !!(window as unknown as { __kimoHost?: unknown }).__kimoHost)
      const file = await page.evaluate(
        () => (window as unknown as { __kimoHost: HostHook }).__kimoHost.FILE,
      )
      await page.evaluate((f) => {
        location.hash = `#/disk/${encodeURIComponent(f)}`
      }, file)
      await page.locator(".canvas-host canvas").first().waitFor({ timeout: 20_000 })
      await layerRow(page, "Home").first().waitFor({ timeout: 15_000 })
      const opened = await call(page, "kimo_open", { path: file })
      expect(opened.ok, `kimo_open: ${opened.summary}`)
      const docId = (opened.data as { doc: { id: string } }).doc.id
      const applied = await call(page, "kimo_apply_ops", {
        docId,
        label: "Insert Agent card",
        ops: [
          {
            op: "insert",
            key: "card",
            parent: "Frame00001",
            node: { type: "rect", name: "Agent card", x: 40, y: 40, w: 120, h: 80 },
          },
        ],
      })
      expect(applied.ok, `kimo_apply_ops: ${applied.summary}`)
      const cardId = applied.created?.[0]?.id as string

      // Board 44: the presence chip leads the right card header's People group.
      const chip = page.locator(".card-header__people [data-testid=agent-presence]")
      await chip.waitFor({ timeout: 10_000 })
      expect(
        ((await chip.textContent()) ?? "").includes("Claude Code"),
        `chip names the client: ${await chip.textContent()}`,
      )
      // Layer dot on the row the agent touched.
      const tree = page.locator(".layer-tree")
      const disclosure = tree.locator('[data-node-id="Frame00001"] [aria-label="Expand"]')
      if ((await disclosure.count()) > 0) await disclosure.first().click()
      await page
        .locator(`.layer-tree [data-node-id="${cardId}"].kimo-layer-row--agent`)
        .waitFor({ timeout: 10_000 })

      // kimo_focus selects the card in this window.
      const focus = await call(page, "kimo_focus", { docId, ids: [cardId], zoom: "keep" })
      expect(focus.ok, `kimo_focus: ${focus.summary}`)
      await page.waitForFunction(
        (id) =>
          (
            window as unknown as {
              __kimo?: { session: { ui: { getState(): { selection: readonly string[] } } } }
            }
          ).__kimo?.session.ui
            .getState()
            .selection.includes(id),
        cardId,
        { timeout: 10_000 },
      )

      // Activity tab (4th, after Agent) lists the labelled edit.
      await page.getByRole("tab", { name: "Activity" }).click()
      const activity = page.locator("[data-testid=agent-activity]")
      await activity.waitFor({ timeout: 10_000 })
      await activity.getByText("Insert Agent card").first().waitFor({ timeout: 10_000 })

      // Pause holds the agent's next call until resume (a real pause in the host runtime).
      await page.evaluate(() =>
        (
          window as unknown as {
            __kimoHost: { platform: { mcp: { clients: { pause(c: string): Promise<void> } } } }
          }
        ).__kimoHost.platform.mcp.clients.pause("claude-code"),
      )
      const pending = page.evaluate(
        async ([d, id]) => {
          const h = (window as unknown as { __kimoHost: HostHook }).__kimoHost
          const t0 = Date.now()
          const r = await h.call("kimo_apply_ops", {
            docId: d,
            ops: [{ op: "update", id, set: { name: "Paused rename" } }],
          })
          return { ok: (r as { ok: boolean }).ok, waited: Date.now() - t0 }
        },
        [docId, cardId] as const,
      )
      await page.waitForTimeout(400)
      expect(!(await replicaName(page, cardId))?.startsWith("Paused"), "held while paused")
      await page.evaluate(() =>
        (
          window as unknown as {
            __kimoHost: { platform: { mcp: { clients: { resume(c: string): Promise<void> } } } }
          }
        ).__kimoHost.platform.mcp.clients.resume("claude-code"),
      )
      const r = await pending
      expect(r.ok && r.waited >= 300, `resumed after the pause (${r.waited} ms)`)
      await layerRow(page, "Paused rename").first().waitFor({ timeout: 10_000 })
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m5-host-agents.png") })
    },
  },
]
