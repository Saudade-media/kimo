/**
 * Builds the static site into apps/site/dist:
 *
 *   /                      landing (desktop + mobile frames)
 *   /docs/…/               one page per doc (see docs/sources.ts)
 *   /search-index.json     client-side search index
 *   /site.js, /*.css       the one script and the stylesheets (tokens copied from
 *                          @kimo/design-tokens, never edited)
 *   /fonts, /shots         bundled fonts, product shots exported from desing.pen
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import type { IndexEntry } from "./client/site"
import { loadConfig, REPO_ROOT, type SiteConfig } from "./config"
import { docPage, drawer } from "./docs/layout"
import { headingIds, type LinkContext, renderMarkdown } from "./docs/markdown"
import {
  allPages,
  type Group,
  loadGroups,
  SPEC_SOURCE,
  sourceIndex,
  specHeader,
} from "./docs/sources"
import { esc, html, iconSprite, type Raw, raw } from "./html"
import { landingDesktop } from "./landing/desktop"
import { landingMobile } from "./landing/mobile"
import { type Contributor, fetchContributors, ic, links } from "./landing/shared"
import { LOGO_PATH, LOGO_SYMBOLS } from "./logo"
import { frame, leaf, root, text } from "./node"

const SITE = join(import.meta.dir, "..")

export interface BuildResult {
  outDir: string
  pages: string[]
  contributors: number | null
}

function shell(
  cfg: SiteConfig,
  opts: { title: string; description: string; path: string; css: string[]; body: Raw },
): string {
  const canonical = `${cfg.siteUrl}${opts.path}`
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
<meta name="color-scheme" content="light">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/Inter-Regular.ttf" as="font" type="font/ttf" crossorigin>
<link rel="preload" href="/fonts/Inter-Medium.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/base.css">
${opts.css.map((c) => `<link rel="stylesheet" href="/${c}">`).join("\n")}
<script type="module" src="/site.js"></script>
</head>
<body>
${opts.body.value}
</body>
</html>
`
}

function write(outDir: string, urlPath: string, contents: string) {
  const file = urlPath.endsWith("/") ? join(outDir, urlPath, "index.html") : join(outDir, urlPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents)
}

/** The mobile landing menu: the drawer (F0F2T) with the landing nav's links as group rows. */
function landingDrawer(cfg: SiteConfig) {
  const l = links(cfg)
  const rows: [string, string, string][] = [
    ["Docs", "book-open", l.docs],
    ["Format spec", "braces", l.spec],
    ["Agents", "plug", l.agents],
    ["CLI", "terminal", l.cli],
    ["Changelog", "history", l.changelog],
    ["Download", "download", l.download],
  ]
  return drawer(
    cfg,
    rows.map(([label, iconName, href]) =>
      frame(
        {
          node: `Group · ${label}`,
          tag: "a",
          cls: "nav-group",
          attrs: href.startsWith("http") ? { href, rel: "noopener" } : { href },
          w: "fill",
          h: 42,
          gap: 10,
          p: [0, 8],
          ai: "center",
        },
        ic(iconName, 16, "text-secondary", "Icon"),
        text({ node: "Label", fs: 15, fw: 500, color: "text-secondary" }, label),
        leaf({ node: "Spacer", w: "fill", h: 1 }),
        ic("chevron-right", 14, "text-tertiary", "Chevron"),
      ),
    ),
    { search: false, title: "Kimo" },
  )
}

function favicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>path{fill:#0A0A0A}@media (prefers-color-scheme:dark){path{fill:#F5F5F4}}</style><path fill-rule="evenodd" d="${LOGO_PATH}"/></svg>\n`
}

async function bundleClient(outDir: string) {
  const res = await Bun.build({
    entrypoints: [join(SITE, "src/client/site.ts")],
    minify: true,
    target: "browser",
    format: "esm",
  })
  if (!res.success) throw new AggregateError(res.logs, "client bundle failed")
  const out = res.outputs[0]
  if (!out) throw new Error("client bundle produced no output")
  writeFileSync(join(outDir, "site.js"), await out.text())
}

function copyAssets(outDir: string) {
  const tokens = join(REPO_ROOT, "packages/design-tokens/src/generated/editor.css")
  copyFileSync(tokens, join(outDir, "tokens.css"))
  for (const f of ["base.css", "landing.css", "docs.css"])
    copyFileSync(join(SITE, "src/styles", f), join(outDir, f))
  const fonts = join(REPO_ROOT, "packages/renderer/assets/fonts")
  mkdirSync(join(outDir, "fonts"), { recursive: true })
  for (const f of [
    "Inter-Regular.ttf",
    "Inter-Medium.ttf",
    "Inter-SemiBold.ttf",
    "Inter-Bold.ttf",
    "Inter-Italic.ttf",
    "JetBrainsMono-Regular.ttf",
    "JetBrainsMono-Medium.ttf",
    "OFL-Inter.txt",
    "OFL-JetBrainsMono.txt",
  ])
    copyFileSync(join(fonts, f), join(outDir, "fonts", f))
  cpSync(join(SITE, "public"), outDir, { recursive: true })
  writeFileSync(join(outDir, "favicon.svg"), favicon())
}

/** Spec "Machine-readable" files that exist in the repository (copied into the build). */
function specDownloads(outDir: string): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = []
  const schemaDir = join(REPO_ROOT, "packages/core-schema/schema")
  const schemaFile = `kimo-${loadConfig().formatVersion.split(".").slice(0, 2).join(".")}.schema.json`
  if (existsSync(join(schemaDir, schemaFile))) {
    mkdirSync(join(outDir, "schema"), { recursive: true })
    copyFileSync(join(schemaDir, schemaFile), join(outDir, "schema", schemaFile))
    out.push({ label: schemaFile, href: `/schema/${schemaFile}` })
  }
  if (existsSync(join(REPO_ROOT, "CHANGELOG.md"))) {
    copyFileSync(join(REPO_ROOT, "CHANGELOG.md"), join(outDir, "CHANGELOG.md"))
    out.push({ label: "CHANGELOG.md", href: "/CHANGELOG.md" })
  }
  return out
}

function buildDocs(
  cfg: SiteConfig,
  outDir: string,
  groups: Group[],
): { urls: string[]; index: IndexEntry[] } {
  const pages = allPages(groups)
  const bySource = sourceIndex(groups)
  const anchors = new Map<string, string>()
  for (const p of pages) {
    for (const id of headingIds(p.body)) {
      const k = `${p.source}#${id}`
      if (!anchors.has(k)) anchors.set(k, p.url)
    }
  }
  // A split section's own heading ("## 6. Sizing and layout") anchors to its page.
  for (const p of pages)
    if (p.depth === 2) {
      const heading = p.sectionNo?.startsWith("§") ? `${p.sectionNo.slice(1)}. ${p.title}` : p.title
      const id = heading
        .toLowerCase()
        .replace(/`/g, "")
        .replace(/[^\p{L}\p{N} _-]/gu, "")
        .replace(/ /g, "-")
      anchors.set(`${p.source}#${id}`, p.url)
    }
  const ctx: LinkContext = { cfg, bySource, anchors }
  const specPage = pages.find((p) => p.source === SPEC_SOURCE)
  const header = specHeader().map(([k, v]) => {
    const r = specPage ? renderMarkdown(v, { ...specPage, kind: "article" }, ctx) : null
    return [k === "Reference implementation" ? "Reference" : k, r?.lead ?? ""] as [string, string]
  })
  const downloads = specDownloads(outDir)
  const index: IndexEntry[] = []
  const urls: string[] = []
  pages.forEach((page, i) => {
    const group = groups.find((g) => g.id === page.group) as Group
    const r = renderMarkdown(page.body, page, ctx)
    const view = {
      page,
      group,
      groups,
      prev: pages[i - 1] ?? null,
      next: pages[i + 1] ?? null,
      r,
      specHeader: page.kind === "spec" ? header : undefined,
      downloads: page.kind === "spec" ? downloads : undefined,
      commands: page.group === "cli" ? group.pages.filter((p) => p.kind === "cli") : undefined,
    }
    const title = `${page.sectionNo ? `${page.sectionNo} ${page.title}` : page.title} · ${group.label} · Kimo docs`
    const description = (r.lead ? r.lead.replace(/<[^>]+>/g, "") : r.plain.slice(0, 200))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200)
    write(
      outDir,
      page.url,
      shell(cfg, {
        title,
        description,
        path: page.url,
        css: ["docs.css"],
        body: docPage(cfg, view),
      }),
    )
    urls.push(page.url)
    index.push({
      t: page.sectionNo ? `${page.sectionNo} ${page.title}` : page.title,
      g: group.label,
      u: page.url,
      h: r.headings.map((h) => [h.id, h.text]),
      b: r.plain.replace(/[`*]/g, "").replace(/\s+/g, " ").slice(0, 6000),
    })
  })
  // /docs/ → the first page of the first group, rendered in place (no redirect hop).
  const first = pages[0]
  if (first) {
    const html0 = readFileSync(join(outDir, first.url, "index.html"), "utf8").replace(
      /<link rel="canonical" href="[^"]*">/,
      `<link rel="canonical" href="${esc(`${cfg.siteUrl}${first.url}`)}">`,
    )
    write(outDir, "/docs/", html0)
    urls.push("/docs/")
  }
  return { urls, index }
}

function notFound(cfg: SiteConfig) {
  return root(
    frame(
      {
        node: "404",
        tag: "main",
        layout: "column",
        gap: 16,
        p: [96, 20],
        ai: "center",
        w: "fill",
        css: "min-height:100vh;justify-content:center",
      },
      text({ tag: "h1", fs: 40, fw: 600, ls: -1, color: "text-primary" }, "Page not found"),
      text(
        { tag: "p", fs: 16, lh: 1.65, color: "text-secondary", ta: "center" },
        "The page you asked for is not part of this site.",
      ),
      html`<p style="display:flex;gap:16px;font-size:15px;font-weight:500"><a class="link" href="/">Home</a><a class="link" href="/docs/">Docs</a><a class="link" href="${cfg.repoUrl}" rel="noopener">GitHub</a></p>`,
    ),
  )
}

export async function build(outDir = join(SITE, "dist")): Promise<BuildResult> {
  const cfg = loadConfig()
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  copyAssets(outDir)
  await bundleClient(outDir)

  const people: Contributor[] | null = await fetchContributors(cfg)
  const l = links(cfg)
  const landing = html`${landingDesktop(cfg, l, people)}${landingMobile(cfg, l, people)}${landingDrawer(cfg)}`
  write(
    outDir,
    "/",
    shell(cfg, {
      title: "Kimo — an open design canvas for you and your agents",
      description:
        "Kimo is a free, MIT-licensed, local-first design tool. Designs are plain JSON files in your repo that Claude Code, Codex, Gemini CLI or any MCP client can read and edit.",
      path: "/",
      css: ["landing.css"],
      body: raw(root(landing).value),
    }),
  )

  const groups = loadGroups()
  const { urls, index } = buildDocs(cfg, outDir, groups)
  writeFileSync(join(outDir, "search-index.json"), JSON.stringify(index))
  writeFileSync(join(outDir, "icons.svg"), iconSprite(LOGO_SYMBOLS))
  write(
    outDir,
    "/404.html",
    shell(cfg, {
      title: "Not found · Kimo",
      description: "Page not found.",
      path: "/404.html",
      css: [],
      body: notFound(cfg),
    }),
  )
  return { outDir, pages: ["/", ...urls], contributors: people?.length ?? null }
}
