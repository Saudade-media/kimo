/**
 * README screenshots: builds the web app (production bundle), serves it with `vite preview` on a
 * free port and captures three shots of the real editor in headless Chromium at 1440 × 900, 2x:
 *
 * - `hero.png`: `examples/dashboard/dashboard.kimo` with the layers panel, the canvas and the
 *   properties panel, a stat card selected;
 * - `agent.png`: the built-in agent mid-task on `examples/landing-page/landing.kimo`. The
 *   Anthropic Messages endpoint is routed to a scripted reply (as in `e2e/agent-pointer.e2e.ts`),
 *   so no API key or network is used; the last model call is held so the turn stays live;
 * - `dark.png`: `examples/mobile-app/streak.kimo` in the dark theme.
 *
 *   bun run screenshots:readme    # writes docs/assets/readme/{hero,agent,dark}.png
 *
 * The PNGs go through `pngquant` when it is on PATH. The driver runs under Node (tsx), like the
 * e2e runner (see e2e/run.ts for why not Bun).
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Browser, chromium, type Page, type Route } from "playwright"
import { build, preview } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const repo = join(root, "..", "..")
const outDir = join(repo, "docs", "assets", "readme")
const VIEWPORT = { width: 1440, height: 900 }

type Box = { x: number; y: number; w: number; h: number }
type W = {
  __kimo: {
    session: {
      store: { nodeIds(): string[]; getNode(id: string): Record<string, unknown> | undefined }
      ui: { getState(): { select(ids: string[]): void; setViewport(v: object): void } }
    }
    canvas(): {
      layout(): { nodes: Map<string, { world: Box }> } | null
    } | null
    agent?: { send(text: string): Promise<void>; state: { busy: boolean } }
  }
}

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  )

/** Opens a `.kimo` from disk the way a web user does: Home › Open… › pick the file. */
async function openExample(page: Page, url: string, file: string) {
  await page.goto(`${url}?kimo-debug#/`)
  await page.locator(".home-sidebar").waitFor({ timeout: 30_000 })
  const chooser = page.waitForEvent("filechooser", { timeout: 15_000 })
  await page.getByRole("button", { name: "Open…" }).first().click()
  await (await chooser).setFiles({
    name: basename(file),
    mimeType: "application/json",
    buffer: readFileSync(join(repo, file)),
  })
  await page.waitForFunction(() => location.hash.startsWith("#/file/"), undefined, {
    timeout: 30_000,
  })
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await page.waitForFunction(() => !!(window as unknown as W).__kimo?.canvas())
}

/** The first layer named `name` (under `parent` when given). */
const idByName = (page: Page, name: string, parent?: string) =>
  page.evaluate(
    ([n, p]) => {
      const s = (window as unknown as W).__kimo.session.store
      const id = s
        .nodeIds()
        .find((i) => s.getNode(i)?.name === n && (!p || s.getNode(i)?.parent === p))
      if (!id) throw new Error(`no layer named ${n}`)
      return id
    },
    [name, parent] as const,
  )

/**
 * Fits `ids` (none: every top-level layer) in the canvas above the floating toolbar, then
 * selects `select` (none: clears the selection).
 */
async function frame(page: Page, ids: string[], select: string[], padding = 48) {
  await page.evaluate(
    ([f, s, p]) => {
      const k = (window as unknown as W).__kimo
      const nodes = k.canvas()?.layout()?.nodes
      if (!nodes) throw new Error("no layout")
      const store = k.session.store
      const targets = f.length ? f : store.nodeIds().filter((i) => store.getNode(i)?.parent == null)
      const boxes = targets.map((i) => nodes.get(i)?.world).filter((b): b is Box => !!b)
      const x0 = Math.min(...boxes.map((b) => b.x))
      const y0 = Math.min(...boxes.map((b) => b.y))
      const x1 = Math.max(...boxes.map((b) => b.x + b.w))
      const y1 = Math.max(...boxes.map((b) => b.y + b.h))
      const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
      const bar = document.querySelector(".floating-toolbar")?.getBoundingClientRect()
      const h = (bar ? bar.top - host.top : host.height) - p
      const w = host.width
      const zoom = Math.min((w - 2 * p) / (x1 - x0), (h - p) / (y1 - y0), 1)
      k.session.ui.getState().setViewport({
        x: (x0 + x1) / 2 - w / 2 / zoom,
        y: (y0 + y1) / 2 - (h + p) / 2 / zoom,
        zoom,
      })
      k.session.ui.getState().select(s)
    },
    [ids, select, padding] as const,
  )
}

/** Fonts loaded, no toasts or tooltips, pointer parked off the canvas, two frames drawn. */
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: `.kimo-toast, .m3-toasts, .kimo-files-toasts, .updater-toasts, .kimo-tooltip,
      .kimo-tooltip--floating { display: none !important; }
      *, *::before, *::after { caret-color: transparent !important; }`,
  })
  await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2)
  await page.waitForTimeout(800)
  await settle(page)
  const path = join(outDir, `${name}.png`)
  await page.screenshot({ path })
  return path
}

async function hero(browser: Browser, url: string) {
  const page = await newPage(browser, "light")
  await openExample(page, url, "examples/dashboard/dashboard.kimo")
  const board = await idByName(page, "Dashboard — themes")
  const card = await page.evaluate(() => {
    // The first stat card in the authored dashboard's Stats row.
    const s = (window as unknown as W).__kimo.session.store
    const stats = s.nodeIds().find((i) => s.getNode(i)?.name === "Stats")
    return s.nodeIds().find((i) => s.getNode(i)?.parent === stats) ?? null
  })
  await frame(page, [board], card ? [card] : [], 40)
  return capture(page, "hero")
}

async function dark(browser: Browser, url: string) {
  const page = await newPage(browser, "dark")
  await openExample(page, url, "examples/mobile-app/streak.kimo")
  await frame(page, [], [], 56)
  return capture(page, "dark")
}

// --- Agent: a scripted turn over a routed Anthropic Messages endpoint --------------------------

const sse = (events: Record<string, unknown>[]) =>
  events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("")

function reply(model: string, text: string, tool?: { name: string; input: unknown }): string {
  const blocks: Record<string, unknown>[] = [
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
  ]
  if (tool)
    blocks.push(
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: `toolu_${tool.name}`, name: tool.name, input: {} },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) },
      },
      { type: "content_block_stop", index: 1 },
    )
  return sse([
    {
      type: "message_start",
      message: {
        id: "msg_readme",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 4200, output_tokens: 1 },
      },
    },
    ...blocks,
    {
      type: "message_delta",
      delta: { stop_reason: tool ? "tool_use" : "end_turn" },
      usage: { output_tokens: 380 },
    },
    { type: "message_stop" },
  ])
}

const PROMPT = "Add a pricing section with three plans between Features and the footer"

/** The pricing section the agent inserts into the landing page (before the footer). */
function pricingOps(page: string) {
  const ink = { $ref: "color/ink" }
  const muted = { $ref: "color/muted" }
  const plan = (key: string, name: string, price: string, copy: string, featured = false) => [
    {
      op: "insert",
      key,
      parent: "@grid",
      node: {
        type: "frame",
        name: `Plan/${name}`,
        w: { mode: "fill" },
        radius: { $ref: "radius/card" },
        fill: featured ? { $ref: "color/ink" } : { $ref: "color/surface" },
        stroke: { paint: { $ref: "color/border" } },
        layout: { dir: "column", gap: 12, pad: 28 },
      },
    },
    {
      op: "insert",
      parent: `@${key}`,
      node: {
        type: "text",
        name: "Name",
        content: name,
        style: { font: "Inter", size: 18, weight: 600 },
        fill: featured ? "#FFFFFF" : ink,
      },
    },
    {
      op: "insert",
      parent: `@${key}`,
      node: {
        type: "text",
        name: "Price",
        content: price,
        style: { font: "Inter", size: 40, weight: 700, letterSpacing: -1 },
        fill: featured ? "#FFFFFF" : ink,
      },
    },
    {
      op: "insert",
      parent: `@${key}`,
      node: {
        type: "text",
        name: "Copy",
        w: 300,
        grow: "fixed-width",
        content: copy,
        style: { font: "Inter", size: 15, lineHeight: 1.55 },
        fill: featured ? "#D6D9E0" : muted,
      },
    },
  ]
  return [
    {
      op: "insert",
      key: "pricing",
      parent: page,
      index: 3,
      node: {
        type: "frame",
        name: "Pricing",
        w: { mode: "fill" },
        layout: { dir: "column", gap: 48, pad: [0, 120, 96, 120], align: "center" },
      },
    },
    {
      op: "insert",
      parent: "@pricing",
      node: {
        type: "text",
        name: "Section title",
        content: "Simple pricing",
        style: { font: "Inter", size: 40, weight: 700, letterSpacing: -1 },
        fill: ink,
      },
    },
    {
      op: "insert",
      key: "grid",
      parent: "@pricing",
      node: { type: "frame", name: "Plans", w: { mode: "fill" }, layout: { dir: "row", gap: 24 } },
    },
    ...plan("starter", "Starter", "$0", "One project, the core charts and a week of history."),
    ...plan("team", "Team", "$24", "Unlimited projects, alerts and a year of history.", true),
    ...plan("business", "Business", "$79", "SSO, audit logs and a dedicated success manager."),
  ]
}

const FOLLOW_UP = "Mark Team as the most popular plan"

/** A "Most popular" pill at the top of the Team plan card. */
const badgeOps = (team: string) => [
  {
    op: "insert",
    key: "badge",
    parent: team,
    index: 0,
    node: {
      type: "frame",
      name: "Badge",
      radius: { $ref: "radius/pill" },
      fill: { $ref: "color/accent" },
      layout: { dir: "row", pad: [4, 10] },
    },
  },
  {
    op: "insert",
    parent: "@badge",
    node: {
      type: "text",
      name: "Label",
      content: "Most popular",
      style: { font: "Inter", size: 12, weight: 600 },
      fill: { $ref: "color/on-accent" },
    },
  },
]

/** The user text of a request's latest prompt and how many tool results follow it. */
function turnOf(messages: { role: string; content: unknown }[]) {
  const isResult = (m: { content: unknown }) =>
    Array.isArray(m.content) &&
    (m.content as { type?: string }[]).some((p) => p.type === "tool_result")
  const at = messages.findLastIndex((m) => m.role === "user" && !isResult(m))
  return {
    prompt: JSON.stringify(messages[at]?.content ?? ""),
    results: messages.slice(at + 1).filter(isResult).length,
  }
}

/**
 * Two turns. The first finishes: a query of the page's sections, one `kimo_apply_ops` that
 * inserts the section, then the reply. The second (the follow-up) adds a badge and its next
 * model call is held until the shot is taken, so it is still running on screen with its cursor
 * on the canvas. Other calls (the session title namer) get a plain answer.
 */
async function routeAnthropic(page: Page, ids: { page: string; team: () => string }) {
  let release: () => void = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  }
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    const req = route.request()
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
    if (!new URL(req.url()).pathname.endsWith("/v1/messages"))
      return route.fulfill({ headers: cors, json: { data: [] } })
    const body = JSON.parse(req.postData() ?? "{}") as {
      model: string
      tools?: unknown[]
      messages: { role: string; content: unknown }[]
    }
    const docId = /docId ([A-Za-z0-9_-]+) \(open/.exec(JSON.stringify(body))?.[1]
    const headers = { ...cors, "content-type": "text/event-stream" }
    const send = (text: string, tool?: { name: string; input: unknown }) =>
      route.fulfill({ headers, body: reply(body.model, text, tool) })
    if (!body.tools?.length || !docId) return send('{"title":"Pricing section"}')
    const turn = turnOf(body.messages)
    if (turn.prompt.includes(FOLLOW_UP)) {
      if (turn.results === 0)
        return send("Adding a pill above the plan name, in the accent color.", {
          name: "kimo_apply_ops",
          input: { docId, label: "Most popular badge", ops: badgeOps(ids.team()) },
        })
      await held
      return send("Team is marked as the most popular plan.")
    }
    if (turn.results === 0)
      return send(
        "I'll check how the page is laid out first, so the new section matches the others.",
        { name: "kimo_query", input: { docId, select: { under: ids.page }, depth: 1 } },
      )
    if (turn.results === 1)
      return send("Adding the section before the footer.", {
        name: "kimo_apply_ops",
        input: { docId, label: "Pricing section", ops: pricingOps(ids.page) },
      })
    return send(
      [
        "Added **Pricing** between Features and the footer, built like the other sections:",
        "",
        "- A full-width column with the same 120 px side padding and title style.",
        "- **Starter**, **Team** and **Business** cards on the `radius/card` and `color/surface` tokens.",
        "- Team is highlighted on `color/ink`.",
      ].join("\n"),
    )
  })
  return () => release()
}

async function agent(browser: Browser, url: string) {
  const page = await newPage(browser, "light")
  // Anthropic configured for this origin (Settings › AI providers on the web) with a placeholder
  // key: every call is answered by the route above.
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
    localStorage.setItem("kimo.providers", JSON.stringify({ "provider.anthropic": "sk-ant-demo" }))
  })
  await openExample(page, url, "examples/landing-page/landing.kimo")
  const landing = await idByName(page, "Landing — Desktop")
  let team = ""
  const release = await routeAnthropic(page, { page: landing, team: () => team })
  await page.waitForFunction(() => !!(window as unknown as W).__kimo.agent, null, {
    timeout: 15_000,
  })
  await page.getByRole("tab", { name: "Agent" }).click()
  const busy = () => page.evaluate(() => !!(window as unknown as W).__kimo.agent?.state.busy)
  // Turn 1 runs to the end; its steps list is opened.
  await page.evaluate((p) => (window as unknown as W).__kimo.agent?.send(p), PROMPT)
  for (let i = 0; i < 300 && (await busy()); i++) await page.waitForTimeout(100)
  await page.locator('[data-testid="agent-steps-toggle"]').first().click()
  team = await idByName(page, "Plan/Team")
  // Turn 2 stays live: the status row in the panel, the cursor on the Team card.
  void page.evaluate((p) => (window as unknown as W).__kimo.agent?.send(p), FOLLOW_UP)
  await page.locator('[data-testid="agent-cursor"]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1200) // the cursor's 600 ms glide and the build-in motion
  const sections = ["Features", "Pricing"].map((n) => idByName(page, n, landing))
  await frame(page, await Promise.all(sections), [], 32)
  await page.waitForTimeout(800)
  const path = await capture(page, "agent")
  release()
  return path
}

// ------------------------------------------------------------------------------------------

async function newPage(browser: Browser, scheme: "light" | "dark") {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: scheme,
  })
  // tsx's keepNames wraps functions in __name(); functions passed to evaluate run in the page.
  await context.addInitScript({ content: "globalThis.__name ??= (fn) => fn" })
  const page = await context.newPage()
  page.on("pageerror", (e) => console.error(`  page error: ${e.message}`))
  // File-chooser interception on before any trigger (see armFileChooser in e2e/qa-helpers.ts).
  page.on("filechooser", () => {})
  // The <input type=file> path of the web picker (see noPickers in e2e/qa-m2-helpers.ts).
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    delete w.showSaveFilePicker
    delete w.showOpenFilePicker
  })
  return page
}

function optimize(path: string) {
  try {
    execFileSync("pngquant", ["--force", "--skip-if-larger", "--quality=80-95", "--ext=.png", path])
  } catch (e) {
    // Not installed (ENOENT) or no smaller result (exit 98/99): keep the original.
    const code = (e as { code?: string; status?: number }).code ?? (e as { status?: number }).status
    if (code !== "ENOENT" && code !== 98 && code !== 99) throw e
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const dist = join(root, "node_modules", ".cache", "readme-screenshots")
  const configFile = join(root, "vite.config.ts")
  await build({ root, configFile, logLevel: "error", build: { outDir: dist, emptyOutDir: true } })
  const server = await preview({
    root,
    configFile,
    logLevel: "error",
    build: { outDir: dist },
    preview: { port: 41000 + Math.floor(Math.random() * 8000), host: "127.0.0.1" },
  })
  const address = server.httpServer?.address()
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`
  // SwiftShader gives headless Chromium a WebGL context (the canvas uses CanvasKit WebGL).
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })
  try {
    for (const shot of [hero, agent, dark]) {
      const path = await shot(browser, url)
      optimize(path)
      console.log(`${path} (${Math.round(statSync(path).size / 1024)} KB)`)
    }
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
