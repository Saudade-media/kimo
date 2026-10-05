/**
 * Agent pointer (board 31 "Agent cursor"): a scripted built-in agent turn in the real editor
 * (real agent panel controller and loop, the Anthropic adapter over a routed Messages endpoint,
 * the in-window tools, the real canvas) edits a card at world (800, 400) that sits inside a page
 * frame at 0:0. The persona cursor must point at the last layer the edit added (the badge, at
 * its top-left + 4, inside the card's screen rect, never the page frame's 0:0 corner), stay
 * locked to it while the canvas pans and zooms, Follow must target that same layer, and the
 * cursor goes away once the turn ends.
 */
import type { Page, Route } from "playwright"
import { openEditor, settle, setViewport } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Box = { x: number; y: number; w: number; h: number }
type W = {
  __kimo: {
    session: { apply(ops: unknown[], label?: string): boolean }
    canvas(): {
      layout(): { nodes: Map<string, { world: Box }> } | null
      renderer: { render(): void; viewport: { x: number; y: number; zoom: number } }
    }
    agent?: {
      send(text: string): Promise<void>
      state: {
        busy: boolean
        canvas: { cursors: { nodeId: string; nodeIds?: string[]; pointerId?: string }[] }
        messages: { kind: string; progress?: { follow: string[] } }[]
      }
    }
  }
}

const PAGE = "PageFrame01"
const CARD = "CardFrame01"

const sse = (events: Record<string, unknown>[]) =>
  events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("")

const start = (model: string) => ({
  type: "message_start",
  message: {
    id: "msg_e2e",
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 1 },
  },
})

function textStream(model: string, text: string): string {
  return sse([
    start(model),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } },
    { type: "message_stop" },
  ])
}

function toolStream(model: string, input: unknown): string {
  return sse([
    start(model),
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_e2e_1", name: "kimo_apply_ops", input: {} },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 40 } },
    { type: "message_stop" },
  ])
}

/**
 * Routed Anthropic Messages endpoint: the turn's first call edits (grows the page frame and adds
 * a badge inside the card), the call after the tool result answers once `release()` is called so
 * the turn stays live while the test pans; anything else (the title namer) gets plain text.
 */
async function routeAnthropic(page: Page) {
  let release: () => void = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    const req = route.request()
    // A cross-origin call from the page: answer the preflight and allow the origin.
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    }
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
    if (!new URL(req.url()).pathname.endsWith("/v1/messages"))
      return route.fulfill({ headers: cors, json: { data: [] } })
    const body = JSON.parse(req.postData() ?? "{}") as {
      model: string
      tools?: unknown[]
      messages: { role: string; content: unknown }[]
    }
    const raw = JSON.stringify(body)
    const docId = /docId ([A-Za-z0-9_-]+) \(open/.exec(raw)?.[1]
    const last = body.messages[body.messages.length - 1]
    const afterTool =
      Array.isArray(last?.content) &&
      (last.content as { type?: string }[]).some((p) => p.type === "tool_result")
    const headers = { ...cors, "content-type": "text/event-stream" }
    if (!body.tools?.length || !docId)
      return route.fulfill({ headers, body: textStream(body.model, '{"title":"Badge"}') })
    if (afterTool) {
      await held
      return route.fulfill({ headers, body: textStream(body.model, "Added a badge to Card.") })
    }
    return route.fulfill({
      headers,
      body: toolStream(body.model, {
        docId,
        label: "Badge",
        ops: [
          { op: "update", id: PAGE, set: { h: 1300 } },
          {
            op: "insert",
            key: "badge",
            parent: CARD,
            node: { type: "frame", name: "Badge", x: 16, y: 16, w: 96, h: 28, fill: "#111111" },
          },
        ],
      }),
    })
  })
  return () => release()
}

async function scriptedEdit({ page, url, log }: E2EContext) {
  // Anthropic configured for this origin (Settings › AI providers on the web: key in
  // localStorage, "Allow calls from the browser" on).
  await page.addInitScript(() => {
    localStorage.setItem(
      "kimo.ai",
      JSON.stringify({
        version: 1,
        providers: {
          anthropic: {
            id: "anthropic",
            kind: "anthropic",
            label: "Anthropic",
            models: { agent: "claude-sonnet-4-5", fast: "claude-haiku-4-5" },
            allowBrowser: true,
          },
        },
        configured: ["anthropic"],
        tests: {},
      }),
    )
    localStorage.setItem(
      "kimo.providers",
      JSON.stringify({ "provider.anthropic": "sk-ant-api03-test-3f9a" }),
    )
  })
  const release = await routeAnthropic(page)
  await openEditor(page, url)
  const ok = await page.evaluate(
    ([p, c]) =>
      (window as unknown as W).__kimo.session.apply([
        {
          op: "insert",
          id: p,
          parent: null,
          node: { type: "frame", name: "Landing", x: 0, y: 0, w: 1440, h: 1200, fill: "#FFFFFF" },
        },
        {
          op: "insert",
          id: c,
          parent: p,
          node: { type: "frame", name: "Card", x: 800, y: 400, w: 320, h: 200, fill: "#EEEEEE" },
        },
      ]),
    [PAGE, CARD],
  )
  expect(ok, "fixture applied")
  await setViewport(page, { x: 0, y: 0, zoom: 0.5 })
  await page.waitForFunction(() => !!(window as unknown as W).__kimo.agent, null, {
    timeout: 15_000,
  })
  await settle(page)
  void page.evaluate(() => (window as unknown as W).__kimo.agent?.send("Add a badge to the card"))

  // The cursor lands in the card (the badge it created), not on the page frame's corner.
  await page
    .waitForFunction(
      (pageId) => {
        const cur = (window as unknown as W).__kimo.agent?.state.canvas.cursors[0]
        return !!cur?.pointerId && !(cur.nodeIds ?? [cur.nodeId]).includes(pageId)
      },
      PAGE,
      { timeout: 20_000 },
    )
    .catch(async (e) => {
      log(
        await page.evaluate(() =>
          JSON.stringify({
            ...(window as unknown as W).__kimo.agent?.state,
            sessions: undefined,
            picker: undefined,
          }).slice(0, 3000),
        ),
      )
      throw e
    })
  await page.locator('[data-testid="persona-cursor"]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400) // the 280 ms glide
  await settle(page)
  const inCard = async () =>
    page.evaluate((id) => {
      const w = window as unknown as W
      const canvas = w.__kimo.canvas()
      const v = canvas.renderer.viewport
      const b = canvas.layout()?.nodes.get(id)?.world as Box
      const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
      const el = document.querySelector('[data-testid="persona-cursor"]') as HTMLElement
      const e = el.getBoundingClientRect()
      const r = {
        x: host.x + (b.x - v.x) * v.zoom,
        y: host.y + (b.y - v.y) * v.zoom,
        w: b.w * v.zoom,
        h: b.h * v.zoom,
      }
      return {
        cursor: { x: e.x, y: e.y },
        card: r,
        inside: e.x >= r.x && e.x <= r.x + r.w && e.y >= r.y && e.y <= r.y + r.h,
        display: getComputedStyle(el).display,
        height: e.height,
      }
    }, CARD)
  const before = await inCard()
  log(
    `  cursor ${before.cursor.x.toFixed(1)},${before.cursor.y.toFixed(1)} · card ${JSON.stringify(before.card)}`,
  )
  expect(before.inside, `cursor inside the card's screen rect: ${JSON.stringify(before)}`)
  expect(before.display !== "none" && before.height > 0, "cursor rendered")

  // The cursor points at the badge (the last added layer): its top-left + (4, 4).
  const badge = await page.evaluate((card) => {
    const w = window as unknown as W
    const canvas = w.__kimo.canvas()
    const v = canvas.renderer.viewport
    const id = w.__kimo.agent?.state.canvas.cursors[0]?.pointerId ?? ""
    const b = canvas.layout()?.nodes.get(id)?.world as Box
    const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
    const e = (
      document.querySelector('[data-testid="persona-cursor"]') as HTMLElement
    ).getBoundingClientRect()
    return {
      id,
      isCard: id === card,
      dx: e.x - (host.x + (b.x - v.x) * v.zoom + 4),
      dy: e.y - (host.y + (b.y - v.y) * v.zoom + 4),
    }
  }, CARD)
  log(`  pointer ${badge.id} offset ${badge.dx.toFixed(2)},${badge.dy.toFixed(2)}`)
  expect(!badge.isCard && !!badge.id, `pointer on the added badge: ${JSON.stringify(badge)}`)
  expect(
    Math.abs(badge.dx) <= 0.5 && Math.abs(badge.dy) <= 0.5,
    `cursor at the badge's top-left + 4: ${JSON.stringify(badge)}`,
  )

  // Follow targets the layer the cursor points at.
  const area = await page.evaluate(() => {
    const s = (window as unknown as W).__kimo.agent?.state
    const cur = s?.canvas.cursors[0]
    const a = s?.messages.findLast((m) => m.kind === "agent")
    return { pointer: cur?.pointerId, follow: a?.progress?.follow ?? [] }
  })
  expect(
    area.follow.length === 1 && area.follow[0] === area.pointer,
    `Follow = the pointed layer: ${JSON.stringify(area)}`,
  )

  // Position lock: sample every drawn canvas frame while panning / zooming. The cursor's screen
  // position must equal the pointed layer's top-left (+4, +4) as drawn in that frame (≤ 0.5 px).
  await page.evaluate(() => {
    const w = window as unknown as W & { __lock: { rx: number; ry: number; zoom: number }[] }
    const canvas = w.__kimo.canvas()
    const r = canvas.renderer
    const host = document.querySelector(".canvas-host") as HTMLElement
    w.__lock = []
    const draw = r.render.bind(r)
    r.render = () => {
      draw()
      const v = r.viewport
      const cur = w.__kimo.agent?.state.canvas.cursors[0]
      const el = document.querySelector('[data-testid="persona-cursor"]')
      if (!el || !cur) return
      const boxes = (cur.pointerId ? [cur.pointerId] : (cur.nodeIds ?? [cur.nodeId]))
        .map((id) => canvas.layout()?.nodes.get(id)?.world)
        .filter((x): x is Box => !!x)
      if (!boxes.length) return
      const ax = Math.min(...boxes.map((x) => x.x))
      const ay = Math.min(...boxes.map((x) => x.y))
      const h = host.getBoundingClientRect()
      const e = el.getBoundingClientRect()
      w.__lock.push({
        rx: e.x - h.x - ((ax - v.x) * v.zoom + 4),
        ry: e.y - h.y - ((ay - v.y) * v.zoom + 4),
        zoom: v.zoom,
      })
    }
  })
  const host = await page.locator(".canvas-host").boundingBox()
  const c = { x: (host?.x ?? 0) + 400, y: (host?.y ?? 0) + 300 }
  await page.mouse.move(c.x, c.y)
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(18, 12)
    await page.waitForTimeout(16)
  }
  await page.keyboard.down("Control")
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, i < 2 ? -20 : 10)
    await page.waitForTimeout(16)
  }
  await page.keyboard.up("Control")
  await settle(page)
  const rows = await page.evaluate(
    () => (window as unknown as { __lock: { rx: number; ry: number; zoom: number }[] }).__lock,
  )
  const worst = Math.max(...rows.map((r) => Math.max(Math.abs(r.rx), Math.abs(r.ry))))
  const zooms = new Set(rows.map((r) => r.zoom.toFixed(3)))
  log(
    `  position lock: ${rows.length} drawn frames, ${zooms.size} zoom levels, worst offset ${worst.toFixed(2)} px`,
  )
  expect(rows.length >= 8, `sampled ${rows.length} drawn frames`)
  expect(zooms.size >= 2, "the pan included zoom steps")
  expect(worst <= 0.5, `cursor drift ${worst.toFixed(2)} px while panning / zooming`)
  const after = await inCard()
  expect(after.inside, `cursor still inside the card after panning: ${JSON.stringify(after)}`)

  // Turn ends: the cursor goes away (idle).
  release()
  await page.waitForFunction(
    () => (window as unknown as W).__kimo.agent?.state.busy === false,
    null,
    {
      timeout: 15_000,
    },
  )
  await settle(page)
  expect(
    (await page.locator('[data-testid="persona-cursor"]').count()) === 0,
    "no cursor once the turn ended",
  )
}

export const scenarios: Scenario[] = [
  {
    name: "agent pointer: a scripted edit moves the cursor to the layer it added (not 0:0), locked while panning",
    run: scriptedEdit,
  },
]
