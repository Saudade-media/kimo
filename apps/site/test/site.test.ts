import { describe, expect, test } from "bun:test"
import { FORMAT_VERSION, SCHEMA_URL } from "@kimo/core-schema"
import { searchIndex } from "../src/client/site"
import { loadConfig } from "../src/config"
import { highlight, langOf, tokenizeLine } from "../src/docs/highlight"
import { renderMarkdown, resolveHref } from "../src/docs/markdown"
import { allPages, githubSlug, loadGroups, sourceIndex, splitH2 } from "../src/docs/sources"
import { landingKimoLines } from "../src/landing/shared"
import { lineHeight } from "../src/node"

const cfg = { ...loadConfig(), offline: true }
const groups = loadGroups()
const pages = allPages(groups)
const ctx = { cfg, bySource: sourceIndex(groups), anchors: new Map<string, string>() }
const page = pages.find((p) => p.source === "CONTRIBUTING.md") as (typeof pages)[number]

describe("config", () => {
  test("repo slug comes from the desktop updater endpoint", () => {
    expect(cfg.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
    expect(cfg.releasesUrl).toBe(`https://github.com/${cfg.repo}/releases/latest`)
  })
  test("format version and $schema come from @kimo/core-schema", () => {
    expect(cfg.formatVersion).toBe(FORMAT_VERSION)
    const lines = landingKimoLines(cfg).map((l) => l.toks.map((t) => t[0]).join(""))
    expect(lines).toContain(`  "format": "${FORMAT_VERSION}",`)
    expect(lines).toContain(`  "$schema": "${SCHEMA_URL}",`)
  })
})

describe("information architecture", () => {
  test("every page has a title, a unique url and a body", () => {
    const urls = new Set<string>()
    for (const p of pages) {
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.url).toMatch(/^\/docs\/.*\/$/)
      expect(urls.has(p.url)).toBe(false)
      urls.add(p.url)
    }
  })
  test("the spec is split into its numbered sections, the CLI into commands", () => {
    const spec = pages.filter((p) => p.group === "spec")
    expect(spec[0]?.sectionNo).toBe("§1")
    expect(spec.some((p) => p.url === "/docs/spec/sizing-and-layout/")).toBe(true)
    const cli = pages.filter((p) => p.group === "cli").map((p) => p.title)
    expect(cli).toContain("kimo merge")
    expect(cli).toContain("kimo validate")
  })
  test("agent guides follow docs/agents/index.md and know their kimo_read_docs path", () => {
    const agents = pages.filter((p) => p.group === "agents")
    expect(agents[0]?.navLabel).toBe("Overview")
    expect(agents.find((p) => p.url === "/docs/agents/guide/web/")?.readDocsPath).toBe("guide/web")
    expect(agents.find((p) => p.url === "/docs/agents/ops/")?.editPath).toBe(
      "packages/mcp-server/guides/ops.md",
    )
  })
  test("docs/release.md is not published", () => {
    expect(pages.some((p) => p.source === "docs/release.md")).toBe(false)
  })
  test("splitH2 ignores headings inside code fences", () => {
    const { sections } = splitH2("intro\n## A\n```md\n## not a heading\n```\n## B\n")
    expect(sections.map((s) => s.heading)).toEqual(["A", "B"])
  })
  test("anchors follow GitHub's slugs", () => {
    expect(githubSlug("6.1 Size")).toBe("61-size")
    expect(githubSlug("`kimo merge`: the git merge driver")).toBe("kimo-merge-the-git-merge-driver")
  })
})

describe("markdown", () => {
  test("blockquote markers become callouts", () => {
    const r = renderMarkdown(
      "Lead.\n\n> [!WARNING]\n> **Locked.** The file has a lease.\n\n> [!NOTE]\n> Plain note.\n",
      page,
      ctx,
    )
    expect(r.html).toContain('class="callout callout--warning"')
    expect(r.html).toContain('<div class="callout__title" data-node="Title">Locked</div>')
    expect(r.html).toContain('class="callout callout--note"')
    expect(r.html).toContain("Plain note.")
  })
  test("first paragraph is the lead; sub-headings feed the TOC", () => {
    const r = renderMarkdown("The lead.\n\n## Setup\n\nText.\n\n### Deeper\n", page, ctx)
    expect(r.lead).toBe("The lead.")
    expect(r.toc).toEqual([{ id: "setup", text: "Setup" }])
    expect(r.html).toContain('<h3 id="deeper"')
  })
  test("tables render desktop and stacked forms", () => {
    const r = renderMarkdown("x\n\n| Host | Path |\n|---|---|\n| Codex | `~/.codex` |\n", page, ctx)
    expect(r.html).toContain('class="doc-table"')
    expect(r.html).toContain('class="doc-table-stacked"')
    expect(r.html).toContain('<span class="stack-row__label">Path</span>')
  })
  test("links: docs sources become site urls, other repo files GitHub links", () => {
    expect(resolveHref("docs/agents/ops.md", "CONTRIBUTING.md", ctx)).toBe("/docs/agents/ops/")
    expect(resolveHref("SECURITY.md", "CONTRIBUTING.md", ctx)).toBe(cfg.blob("SECURITY.md"))
    expect(resolveHref("docs/adr", "CONTRIBUTING.md", ctx)).toBe(cfg.tree("docs/adr"))
    expect(resolveHref("https://bun.sh", "CONTRIBUTING.md", ctx)).toBe("https://bun.sh")
  })
})

describe("Ink highlighter", () => {
  test("JSON: keys attr, values plain, punctuation punct", () => {
    expect(tokenizeLine('  "type": "frame",', "json")).toEqual([
      { kind: "plain", text: "  " },
      { kind: "attr", text: '"type"' },
      { kind: "punct", text: ":" },
      { kind: "plain", text: ' "frame"' },
      { kind: "punct", text: "," },
    ])
  })
  test("shell: prompt punct, strings attr, comments italic, ✓ lines ok", () => {
    const t = tokenizeLine('$ git config merge.kimo.name "Kimo" # set', "sh")
    expect(t[0]).toEqual({ kind: "punct", text: "$ " })
    expect(t.find((x) => x.kind === "attr")?.text).toBe('"Kimo"')
    expect(t.at(-1)?.kind).toBe("comment")
    expect(tokenizeLine("✓ valid", "sh")).toEqual([{ kind: "ok", text: "✓ valid" }])
  })
  test("TS keywords strong; block comments carry across lines", () => {
    expect(tokenizeLine("export const a = 1", "js")[0]).toEqual({ kind: "strong", text: "export" })
    const lines = highlight("/* a\nb */ const x", "js")
    expect(lines[1]?.[0]).toEqual({ kind: "comment", text: "b */" })
  })
  test("languages", () => {
    expect(langOf("sh")).toBe("sh")
    expect(langOf("jsonc")).toBe("json")
    expect(langOf(undefined)).toBe("text")
  })
})

describe("search", () => {
  const index = [
    {
      t: "kimo_apply_ops cookbook",
      g: "Agents & MCP",
      u: "/docs/agents/ops/",
      h: [["insert", "Insert"]] as [string, string][],
      b: "apply ops atomically",
    },
    { t: "Examples", g: "Getting started", u: "/docs/examples/", h: [], b: "ops mentioned once" },
  ]
  test("title matches outrank body matches; every term must match", () => {
    const hits = searchIndex(index, "ops")
    expect(hits[0]?.entry.u).toBe("/docs/agents/ops/")
    expect(searchIndex(index, "ops zebra")).toEqual([])
  })
  test("a heading match links to its anchor", () => {
    expect(searchIndex(index, "insert")[0]?.url).toBe("/docs/agents/ops/#insert")
  })
})

test("text line heights are whole pixels, like Pencil", () => {
  expect(lineHeight(16, undefined, "sans")).toBe(19)
  expect(lineHeight(13, undefined, "mono")).toBe(17)
  expect(lineHeight(15, 1.5, "sans")).toBe(23)
})
