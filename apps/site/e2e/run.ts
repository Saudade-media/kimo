/**
 * Site e2e: builds the site into a temp dir (offline; contributors pinned to a fixture so the
 * section's geometry is measured), serves it, and runs in headless Chromium:
 *
 *   smoke    every page renders at 1440 and 390 with no console errors, page errors or failed
 *            same-origin requests; every internal link (and #anchor) resolves
 *   measure  one measured pass per page type and breakpoint: getBoundingClientRect +
 *            getComputedStyle of every design-named node against the design's own boxes
 *            (e2e/fixtures, from Pencil exports of board 26 — see gen-fixtures.ts)
 *
 *   bun run e2e              # both
 *   bun run e2e smoke        # scenarios whose name contains the filter
 *
 * Runs under Node via tsx (Playwright's pipe transport is unreliable under Bun 1.3, see
 * apps/web/e2e/run.ts).
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { type Browser, chromium, type Page } from "playwright"
import { diffBoxes, diffStyles, type Field, perSection } from "./measure-diff"
import { type Box, collectBoxes } from "./measure-lib"

const here = import.meta.dirname
const site = join(here, "..")

function sh(cmd: string[], env: Record<string, string>) {
  const r = spawnSync(cmd[0] as string, cmd.slice(1), {
    cwd: site,
    env: { ...process.env, ...env },
    stdio: "inherit",
  })
  if (r.status !== 0) throw new Error(`${cmd.join(" ")} failed`)
}

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".md": "text/markdown",
  ".txt": "text/plain",
}

function serve(dir: string): Promise<{ url: string; close(): void }> {
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x")
    let p = normalize(join(dir, decodeURIComponent(u.pathname)))
    if (!p.startsWith(dir)) {
      res.writeHead(403).end()
      return
    }
    if (u.pathname.endsWith("/")) p = join(p, "index.html")
    if (!existsSync(p)) {
      res.writeHead(404, { "content-type": "text/html" }).end(readFileSync(join(dir, "404.html")))
      return
    }
    res
      .writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" })
      .end(readFileSync(p))
  })
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const a = server.address() as { port: number }
      resolve({ url: `http://127.0.0.1:${a.port}`, close: () => server.close() })
    }),
  )
}

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function open(browser: Browser, width: number) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.addInitScript({ content: "globalThis.__name ??= (fn) => fn" })
  return ctx.newPage()
}

/* ---------------- smoke ---------------- */

async function smoke(browser: Browser, base: string, pages: string[]) {
  const linkTargets = new Map<string, string>()
  const anchorsByPage = new Map<string, Set<string>>()
  for (const width of [1440, 390]) {
    const page = await open(browser, width)
    const problems: string[] = []
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`))
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`))
    page.on("response", (r) => {
      if (r.url().startsWith(base) && r.status() >= 400) problems.push(`${r.status()} ${r.url()}`)
    })
    for (const path of pages) {
      const res = await page.goto(base + path, { waitUntil: "load" })
      expect(res?.status() === 200, `${path}: HTTP ${res?.status()}`)
      await page.evaluate(() => document.fonts.ready)
      const info = await page.evaluate(() => ({
        h1: document.querySelectorAll("h1").length,
        title: document.title,
        visibleH1: Array.from(document.querySelectorAll("h1")).filter(
          (h) => h.getBoundingClientRect().height > 0,
        ).length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        links: Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map(
          (a) => a.getAttribute("href") ?? "",
        ),
        ids: Array.from(document.querySelectorAll("[id]")).map((e) => e.id),
        brokenImages: Array.from(document.images)
          .filter((i) => i.loading !== "lazy" && i.complete && i.naturalWidth === 0)
          .map((i) => i.src),
      }))
      expect(info.title.length > 0, `${path}: empty <title>`)
      expect(info.visibleH1 >= 1, `${path} @${width}: no visible h1`)
      expect(info.overflow <= 0, `${path} @${width}: horizontal overflow ${info.overflow}px`)
      expect(
        info.brokenImages.length === 0,
        `${path}: broken images ${info.brokenImages.join(", ")}`,
      )
      anchorsByPage.set(path, new Set(info.ids))
      for (const l of info.links)
        if (l.startsWith("/") || l.startsWith("#"))
          linkTargets.set(l.startsWith("#") ? path + l : l, path)
    }
    expect(problems.length === 0, `@${width}:\n  ${problems.join("\n  ")}`)
    await page.close()
  }
  // Every internal link resolves; anchors exist on their page.
  const broken: string[] = []
  for (const [href, from] of linkTargets) {
    const [p, anchor] = href.split("#") as [string, string | undefined]
    const res = await fetch(base + p)
    if (res.status !== 200) broken.push(`${from} → ${href} (${res.status})`)
    else if (anchor) {
      const ids = anchorsByPage.get(p)
      if (ids && !ids.has(anchor)) broken.push(`${from} → ${href} (no #${anchor})`)
    }
  }
  expect(broken.length === 0, `broken links:\n  ${broken.join("\n  ")}`)
  return `${pages.length} pages × 2 widths, ${linkTargets.size} internal links`
}

/* ---------------- measure ---------------- */

interface MeasureSpec {
  name: string
  fixture: string
  path: string
  /** data-node name of the frame root, or a CSS selector with `rootSel`. */
  root: string
  rootSel?: string
  /** Design paths to compare (regex). */
  only?: RegExp
  /** Design paths to skip (regex): product shots' internals, content that is the repo's own. */
  skip?: RegExp
  fields?: Field[]
  before?: (page: Page) => Promise<void>
  /** Root selector in the fixture's own space when the frame is a sub-tree (drawer). */
  fixtureRoot?: string
  /** Rewrites the site's paths onto the fixture's tree (one responsive DOM, two frames). */
  rewrite?: [RegExp, string]
  /** Compare each top-level section in its own coordinates (see perSection). */
  sections?: boolean
  /** Known, explained differences: path → reason. Anything else fails. */
  allow?: [RegExp, string][]
}

const SHOT_INTERNALS =
  /^(Product shot\/Editor window\/Editor · agent panel \(copied from board 04\)\/|Product shot\/Agent panel crop\/|Export\/Proof stage\/Right Panel · Code \(copied from board 25\)\/|Components & variables\/Proof\/(Themes|Panel crop)\/|Components & variables\/Panel crop\/)/
const MARK_INTERNALS = /AgentMark( 12)?(#\d+)?\//

const SPECS: MeasureSpec[] = [
  {
    name: "landing desktop 1440",
    fixture: "landing-desktop",
    path: "/",
    root: "Landing · Desktop 1440",
    sections: true,
    skip: new RegExp(`${SHOT_INTERNALS.source}|${MARK_INTERNALS.source}`),
    allow: [
      [/\/Token(#\d+)?$/, "code tokens carry the real $schema/format values and real CLI output"],
      [
        /^Agents\/Cards\/Card · MCP\/Terminal\/Line/,
        "kimo mcp install output is the real CLI's format",
      ],
      [
        /^Components & variables(\/Proof(\/Themes)?)?$|^Components & variables\/Copy/,
        "Themes keeps Pencil's 796 px (the export's re-render of its copied cards measures 792), so the section is 4 px taller and the centered copy 2 px lower",
      ],
    ],
  },
  {
    name: "landing mobile 390",
    fixture: "landing-mobile",
    path: "/",
    root: "Landing · Mobile 390",
    sections: true,
    skip: new RegExp(
      `${SHOT_INTERNALS.source}|${MARK_INTERNALS.source}|^Agents/Personas/Marks/AgentMark`,
    ),
    allow: [
      [/\/Token(#\d+)?$/, "code tokens carry real values"],
      [/^Agents\/Card · MCP\/Terminal\/Line/, "kimo mcp install output is the real CLI's format"],
    ],
  },
  {
    name: "docs article desktop 1440 (chrome)",
    fixture: "docs-article-desktop",
    path: "/docs/agents/",
    root: "Docs · Desktop",
    only: /^(Top bar(\/.*)?|Body\/Left nav\/Group · (Getting started|Agents & MCP)(\/(Icon|Label|Chevron))?|Body\/Content\/Breadcrumb(\/(Crumb|Sep))?|Body\/Content\/Meta(\/.*)?|Body\/Right rail\/Title|Body\/Right rail\/Agent card(\/Head(\/.*)?)?)$/,
    fields: ["w", "h"],
    skip: MARK_INTERNALS,
    allow: [
      [/^Body\/Content\/Breadcrumb(\/Crumb#1)?$/, "breadcrumb names this page"],
      [/^Body\/Content\/Meta/, "read time is computed"],
    ],
  },
  {
    name: "docs spec desktop 1440 (chrome)",
    fixture: "docs-spec-desktop",
    path: "/docs/spec/sizing-and-layout/",
    root: "Docs · Desktop",
    only: /^(Body\/Left nav\/Items · File format spec\/Item · (5\. Nodes|6\. Sizing and layout)(\/Label)?|Body\/Content\/Title row(\/.*)?|Body\/Content\/Spec header\/Row · (Schema|License)\/Key|Body\/Content\/RFC 2119 keywords(\/.*)?|Body\/Right rail\/Title|Body\/Right rail\/TOC\/TOC · 6\.1 Size(\/Label)?)$/,
    fields: ["w", "h"],
    skip: MARK_INTERNALS,
    allow: [
      [/^Body\/Content\/Title row$/, "title row spans the column"],
      [
        /^Body\/Right rail\/TOC\/TOC · /,
        "the active TOC entry follows the scroll position (the design shows 6.2 active)",
      ],
    ],
  },
  {
    name: "docs cli desktop 1440 (chrome)",
    fixture: "docs-cli-desktop",
    path: "/docs/cli/merge/",
    root: "Docs · Desktop",
    only: /^(Body\/Left nav\/Items · CLI\/Item · (Overview|kimo merge)(\/Label)?|Body\/Content\/Breadcrumb(\/.*)?|Body\/Content\/Title row(\/.*)?|Body\/Right rail\/Title)$/,
    fields: ["w", "h"],
    allow: [
      [
        /^Body\/Right rail\/Title$/,
        "the README's kimo merge section has no subsections, so no TOC",
      ],
    ],
  },
  {
    name: "docs nav drawer mobile 390",
    fixture: "docs-drawer-mobile",
    path: "/docs/spec/sizing-and-layout/",
    root: "drawer",
    rootSel: "#drawer",
    before: async (page) => {
      await page.locator("[data-drawer-open]").filter({ visible: true }).first().click()
    },
    only: /^(Scrim|Drawer(\/Head(\/.*)?|\/Search(\/.*)?|\/Version row(\/.*)?|\/Nav\/Group · [^/]+(\/(Icon|Label|Chevron))?|\/Nav\/Items\/Item · (5\. Nodes|6\. Sizing and layout)(\/Label)?)?)$/,
    fields: ["w", "h"],
    allow: [
      [/^Scrim$/, "the scrim covers the viewport (900 tall here, 844 in the frame)"],
      [/^Drawer$/, "the drawer is the viewport's height"],
      [/^Drawer\/Head\/Spacer$/, "follows the label width"],
      [
        /^Drawer\/Nav\/Group · (Editor|Components & variables|Built-in agent|Export)(\/|$)/,
        "group omitted: the repository has no docs for it yet (no placeholder pages)",
      ],
    ],
  },
  {
    name: "docs article mobile 390 (content chrome)",
    fixture: "docs-article-mobile",
    path: "/docs/cli/mcp/",
    root: "Docs · Desktop",
    rewrite: [/^Body\//, ""],
    only: /^(Content|Content\/On this page \(collapsed\)|Content\/Code · Terminal|Content\/Code · Terminal\/Header(\/(File name|Copy))?|Content\/Prev \/ next|Content\/Prev \/ next\/(Next|Previous))$/,
    fields: ["x", "w", "h"],
    allow: [
      [
        /^Content$|^Content\/Code · Terminal$|^Content\/Prev \/ next(\/(Next|Previous))?$/,
        "height follows this page's content",
      ],
    ],
  },
  {
    name: "docs article mobile 390 (chrome)",
    fixture: "docs-article-mobile",
    path: "/docs/agents/",
    root: "Docs · Desktop",
    only: /^Top bar(\/.*)?$/,
  },
]

async function measure(browser: Browser, base: string) {
  const report: string[] = []
  const failures: string[] = []
  for (const spec of SPECS) {
    const fx = JSON.parse(readFileSync(join(here, "fixtures", `${spec.fixture}.json`), "utf8")) as {
      width: number
      boxes: Box[]
    }
    const page = await open(browser, fx.width)
    await page.goto(base + spec.path, { waitUntil: "load" })
    await page.evaluate(() => document.fonts.ready)
    if (spec.before) await spec.before(page)
    const rawBoxes = await page.evaluate(collectBoxes, {
      rootSel: spec.rootSel ?? `[data-node="${spec.root}"]`,
      attr: "data-node",
    })
    const rw = spec.rewrite
    const siteBoxes = rw
      ? rawBoxes.map((b) => ({ ...b, path: b.path.replace(rw[0], rw[1]) }))
      : rawBoxes
    // The mobile docs fixture is the article frame; its top bar is the site's mobile top bar.
    const filter = (p: string) =>
      (!spec.only || spec.only.test(p)) && !(spec.skip?.test(p) ?? false)
    const d = spec.sections
      ? diffBoxes(perSection(fx.boxes), perSection(siteBoxes), 1, filter, spec.fields)
      : diffBoxes(fx.boxes, siteBoxes, 1, filter, spec.fields)
    const s = diffStyles(fx.boxes, siteBoxes, filter)
    const allowed = (p: string) => spec.allow?.find(([re]) => re.test(p))
    const offOk = d.off.filter((o) => allowed(o.path))
    const offBad = d.off.filter((o) => !allowed(o.path))
    const styleBad = s.filter((x) => !allowed(x.path))
    const missingBad = spec.only
      ? d.missing.filter((m) => !allowed(m))
      : d.missing.filter((m) => !allowed(m))
    report.push(
      `${spec.name}: ${d.matched} nodes matched · ${d.matched - d.off.length} exact (±1px) · ${offBad.length} off · ${styleBad.length} style off · ${missingBad.length} missing`,
    )
    const reasons = new Map<string, number>()
    for (const p of [
      ...offOk.map((o) => o.path),
      ...s.filter((x) => allowed(x.path)).map((x) => x.path),
    ]) {
      const why = allowed(p)?.[1] as string
      reasons.set(why, (reasons.get(why) ?? 0) + 1)
    }
    for (const [why, n] of reasons) report.push(`    explained ×${n}: ${why}`)
    for (const o of offBad) failures.push(`${spec.name}: ${o.path} Δ${JSON.stringify(o.delta)}`)
    for (const x of styleBad)
      failures.push(`${spec.name}: ${x.path} ${x.kind} design «${x.design}» site «${x.site}»`)
    for (const m of missingBad) failures.push(`${spec.name}: missing ${m}`)
    await page.close()
  }
  // Overlays render (scrim box > 0, not display:none) once opened.
  const page = await open(browser, 390)
  await page.goto(`${base}/docs/agents/`, { waitUntil: "load" })
  await page.locator("[data-drawer-open]").filter({ visible: true }).first().click()
  const scrim = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>(".drawer__scrim")
    const p = document.querySelector<HTMLElement>(".drawer__panel")
    if (!s || !p) return null
    return {
      display: getComputedStyle(s).display,
      sh: s.getBoundingClientRect().height,
      bg: getComputedStyle(s).backgroundColor,
      pw: p.getBoundingClientRect().width,
      shadow: getComputedStyle(p).boxShadow,
    }
  })
  expect(
    scrim && scrim.display !== "none" && scrim.sh > 0,
    `drawer scrim not rendered: ${JSON.stringify(scrim)}`,
  )
  expect(scrim.bg === "rgba(10, 10, 10, 0.4)", `scrim fill ${scrim.bg} ≠ #0A0A0A66`)
  expect(scrim.pw === 320, `drawer width ${scrim.pw} ≠ 320`)
  report.push(
    `drawer @390: scrim ${scrim.sh}px ${scrim.bg}; panel ${scrim.pw}px; shadow ${scrim.shadow}`,
  )
  await page.close()
  if (failures.length) throw new Error(`${report.join("\n")}\n${failures.join("\n")}`)
  return report.join("\n")
}

/* ---------------- interactions ---------------- */

async function interactions(browser: Browser, base: string) {
  const notes: string[] = []
  // Landing menu (mobile): the drawer opens, lists the nav, closes on Escape.
  const m = await open(browser, 390)
  await m.goto(`${base}/`, { waitUntil: "load" })
  await m.locator("[data-drawer-open]").filter({ visible: true }).first().click()
  await m.locator("#drawer .drawer__panel").waitFor({ state: "visible" })
  expect(await m.locator("#drawer a.nav-group[href='/docs/']").isVisible(), "landing drawer lists Docs")
  await m.keyboard.press("Escape")
  await m.locator("#drawer").waitFor({ state: "hidden" })
  notes.push("landing menu drawer opens and closes")
  await m.close()
  // Search: ⌘K opens it, a query finds the ops guide, Enter navigates.
  const d = await open(browser, 1440)
  await d.goto(`${base}/docs/`, { waitUntil: "load" })
  await d.keyboard.press("ControlOrMeta+k")
  await d.locator("#search-input").waitFor({ state: "visible" })
  await d.keyboard.type("apply ops")
  await d.locator("#search-results li").first().waitFor()
  const first = await d.locator("#search-results li a").first().getAttribute("href")
  expect(first?.startsWith("/docs/agents/ops/"), `first search hit ${first}`)
  await d.keyboard.press("Enter")
  await d.waitForURL(/\/docs\/agents\/ops\//)
  notes.push(`search "apply ops" → ${first}`)
  // Copy button copies the block's text (line numbers excluded).
  await d.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await d.locator(".doc-code [data-copy]").first().click()
  const copied = await d.evaluate(() => navigator.clipboard.readText())
  const expected = await d.evaluate(() =>
    Array.from(document.querySelector(".doc-code")?.querySelectorAll(".code__line") ?? [])
      .map((l) => l.textContent)
      .join("\n"),
  )
  expect(copied === expected && copied.length > 0, "copy button copies the code block")
  notes.push(`copy: ${copied.split("\n").length} lines`)
  await d.close()
  return notes.join("\n")
}

/* ---------------- runner ---------------- */

const filter = process.argv[2] ?? ""
const out = mkdtempSync(join(tmpdir(), "kimo-site-e2e-"))
sh(
  [
    "bun",
    "-e",
    `const { build } = await import("./src/build.ts"); const r = await build(${JSON.stringify(out)}); await Bun.write(${JSON.stringify(join(out, "pages.json"))}, JSON.stringify(r.pages))`,
  ],
  {
    KIMO_SITE_OFFLINE: "1",
    KIMO_SITE_CONTRIBUTORS_FILE: join(here, "fixtures/contributors.json"),
  },
)
const pages = JSON.parse(readFileSync(join(out, "pages.json"), "utf8")) as string[]
const server = await serve(out)
const browser = await chromium.launch()
let failed = 0
for (const [name, run] of [
  ["smoke", () => smoke(browser, server.url, pages)],
  ["measure", () => measure(browser, server.url)],
  ["interactions", () => interactions(browser, server.url)],
] as const) {
  if (!name.includes(filter)) continue
  const t0 = Date.now()
  try {
    const summary = await run()
    console.log(`✓ ${name} (${Date.now() - t0} ms)\n${summary.replace(/^/gm, "    ")}`)
  } catch (e) {
    failed++
    console.log(`✗ ${name}\n${String((e as Error).message).replace(/^/gm, "    ")}`)
  }
}
await browser.close()
server.close()
rmSync(out, { recursive: true, force: true })
console.log(failed ? `${failed} scenario(s) failed` : "all scenarios passed")
process.exit(failed ? 1 : 0)
