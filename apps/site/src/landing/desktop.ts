/**
 * Landing · Desktop 1440 (desing.pen yutK2). One call per design node, in the design's order and
 * nesting; values are the nodes' own. Product shots are the design frames exported to PNG
 * (public/shots/<node id>.png) and keep the frame box of the node they replace.
 */
import { agentMark, type Persona } from "../agent-mark"
import type { SiteConfig } from "../config"
import { html, type Raw } from "../html"
import { logo } from "../logo"
import { type Box, type Child, frame, leaf, type Paint, text } from "../node"
import {
  type Contributor,
  ic,
  type Links,
  landingKimoLines,
  PERSONAS,
  TOKEN_COLOR,
  type Tok,
} from "./shared"

const a = (href: string): Box["attrs"] =>
  href.startsWith("http") ? { href, rel: "noopener" } : { href }

/* ---------- shared desktop pieces ---------- */

function eyebrow(node: string, s: string) {
  return text({ node, font: "mono", fs: 12, ls: 0.5, color: "text-tertiary" }, s)
}
function title48(node: string, s: string, w: Box["w"] = "fill") {
  return text({ node, tag: "h2", fs: 48, fw: 500, lh: 1.08, ls: -1.4, color: "text-primary", w }, s)
}
function body18(node: string, s: string, w: Box["w"] = "fill") {
  return text({ node, tag: "p", fs: 18, lh: 1.55, color: "text-secondary", w }, s)
}

/** Pill buttons: Download for macOS (accent), Windows / Linux (outlined), Open in browser. */
function bigButton(
  node: string,
  kind: "accent" | "outline" | "ghost",
  href: string,
  label: string,
  lead?: [string, number],
  trail?: [string, number],
  padX = kind === "accent" ? 24 : 20,
) {
  const fg: Paint = kind === "accent" ? "on-accent" : "text-primary"
  return frame(
    {
      node,
      tag: "a",
      cls: `btn btn--${kind}`,
      attrs: a(href),
      gap: 8,
      p: [0, padX],
      ai: "center",
      h: 52,
      bg: kind === "accent" ? "accent" : kind === "outline" ? "bg-app" : undefined,
      st: kind === "outline" ? "border-strong" : undefined,
      sw: kind === "outline" ? 1 : undefined,
      r: "radius-pill",
    },
    lead ? ic(lead[0], lead[1], fg, "Icon") : null,
    text({ node: "Label", fs: 16, fw: 500, color: fg }, label),
    trail ? ic(trail[0], trail[1], "text-secondary", "Trailing icon") : null,
  )
}

function codeLine(
  node: string,
  toks: Tok[],
  opts: { no?: number; hl?: boolean; pad?: [number, number, number, number] | [number, number] },
) {
  return frame(
    {
      node,
      cls: "code__line",
      w: "fill",
      p: opts.pad ?? [2, 16, 2, 12],
      bg: opts.hl ? "selection-soft" : undefined,
      st: opts.hl ? "selection" : undefined,
      sw: opts.hl ? { left: 2 } : undefined,
    },
    opts.no !== undefined
      ? [
          text(
            {
              node: "No",
              font: "mono",
              fs: 13,
              color: opts.hl ? "selection" : "text-tertiary",
              ta: "right",
              w: 28,
              css: "user-select:none",
            },
            String(opts.no),
          ),
          leaf({ node: "Gutter", w: 14, h: 1 }),
        ]
      : null,
    toks.map(([s, k]) =>
      text({ node: "Token", font: "mono", fs: 13, lh: 1.6, color: TOKEN_COLOR[k] }, s),
    ),
  )
}

function codeHeader(node: string, lead: Child, file: string, tag: string) {
  return frame(
    {
      node,
      w: "fill",
      h: 40,
      st: "border",
      sw: { bottom: 1 },
      gap: 8,
      p: [0, 16],
      ai: "center",
    },
    lead,
    text({ node: "File name", font: "mono", fs: 12, color: "text-secondary" }, file),
    leaf({ node: "Spacer", w: "fill", h: 1 }),
    frame(
      { node: "Tag", h: 20, bg: "bg-muted", r: "radius-pill", p: [0, 8], ai: "center" },
      text({ node: "Label", font: "mono", fs: 11, color: "text-secondary" }, tag),
    ),
    copyButton(14),
  )
}

/** The design's copy glyph, wired to the copy-to-clipboard script. */
export function copyButton(size: number) {
  return html`<button type="button" class="copy" data-copy aria-label="Copy" data-node="Copy">${ic("copy", size, "text-tertiary")}</button>`
}

/* ---------- sections ---------- */

function nav(l: Links) {
  const link = (node: string, label: string, href: string) =>
    text(
      { node, tag: "a", cls: "link", attrs: a(href), fs: 14, fw: 500, color: "text-secondary" },
      label,
    )
  return frame(
    {
      node: "Nav",
      tag: "header",
      w: "fill",
      h: 72,
      st: "border",
      sw: { bottom: 1 },
      p: [0, 64],
      jc: "space_between",
      ai: "center",
      cls: "gutter",
    },
    frame(
      {
        node: "Brand",
        tag: "a",
        attrs: { href: "/", "aria-label": "Kimo home" },
        gap: 10,
        ai: "center",
      },
      html`<span data-node="KimoLogo" style="display:flex;width:28px;height:28px;color:var(--kimo-text-primary)">${logo(28)}</span>`,
      text({ node: "Wordmark", fs: 18, fw: 600, ls: -0.3, color: "text-primary" }, "Kimo"),
    ),
    frame(
      { node: "Links", tag: "nav", gap: 32, ai: "center" },
      link("Link · Docs", "Docs", l.docs),
      link("Link · Format spec", "Format spec", l.spec),
      link("Link · Agents", "Agents", l.agents),
      link("Link · Changelog", "Changelog", l.changelog),
      link("Link · GitHub", "GitHub", l.repo),
    ),
    frame(
      { node: "Actions", gap: 8, ai: "center" },
      frame(
        {
          node: "Button · Star on GitHub",
          tag: "a",
          cls: "btn btn--outline",
          attrs: a(l.repo),
          gap: 8,
          p: [0, 14],
          ai: "center",
          h: 36,
          bg: "bg-app",
          st: "border-strong",
          r: "radius-pill",
        },
        ic("github-logo", 16, "text-primary", "Icon"),
        text({ node: "Label", fs: 14, fw: 500, color: "text-primary" }, "Star on GitHub"),
      ),
      frame(
        {
          node: "Button · Download",
          tag: "a",
          cls: "btn btn--accent",
          attrs: a(l.download),
          gap: 8,
          p: [0, 16],
          ai: "center",
          h: 36,
          bg: "accent",
          r: "radius-pill",
        },
        ic("download", 16, "on-accent", "Icon"),
        text({ node: "Label", fs: 14, fw: 500, color: "on-accent" }, "Download"),
      ),
    ),
  )
}

function hero(cfg: SiteConfig, l: Links) {
  return frame(
    {
      node: "Hero",
      tag: "section",
      layout: "column",
      gap: 28,
      p: [96, 64, 64, 64],
      ai: "center",
      w: "fill",
      cls: "gutter",
    },
    frame(
      {
        node: "Release pill",
        gap: 10,
        p: [0, 6],
        ai: "center",
        h: 30,
        bg: "bg-muted",
        st: "border",
        r: "radius-pill",
      },
      frame(
        { node: "Tag", p: [0, 8], ai: "center", h: 20, bg: "accent", r: "radius-pill" },
        text(
          { node: "Version", font: "mono", fs: 12, fw: 600, color: "on-accent" },
          cfg.versionLabel,
        ),
      ),
      text(
        { node: "Pill text", fs: 13, color: "text-secondary" },
        "MIT · local-first · agent-native",
      ),
      frame(
        {
          node: "Notes link",
          tag: "a",
          cls: "link",
          attrs: a(l.releaseNotes),
          gap: 4,
          p: [0, 8, 0, 0],
          ai: "center",
        },
        text({ node: "Label", fs: 13, fw: 500, color: "text-primary" }, "Release notes"),
        ic("arrow-right", 14, "text-primary", "Arrow"),
      ),
    ),
    text(
      {
        node: "Headline",
        tag: "h1",
        fs: 76,
        fw: 500,
        lh: 1.04,
        ls: -2.6,
        ta: "center",
        color: "text-primary",
        w: 1000,
      },
      "An open design canvas\nfor you and your agents.",
    ),
    text(
      { node: "Subhead", tag: "p", fs: 20, lh: 1.5, ta: "center", color: "text-secondary", w: 720 },
      "Kimo is a free, MIT-licensed design tool. Your designs are plain JSON files in your repo, Claude Code, Codex, Gemini CLI or any MCP client can read and edit them, and the built-in agent runs on the CLI subscription you already have.",
    ),
    frame(
      { node: "Download row", gap: 10, p: [8, 0, 0, 0], ai: "center" },
      bigButton("Button · Download for macOS", "accent", l.download, "Download for macOS", [
        "apple-logo",
        20,
      ]),
      bigButton("Button · Windows", "outline", l.download, "Windows", ["windows-logo", 18]),
      bigButton("Button · Linux", "outline", l.download, "Linux", ["linux-logo", 18]),
    ),
    frame(
      { node: "Secondary row", gap: 20, ai: "center" },
      frame(
        {
          node: "Button · Open in browser",
          tag: "a",
          cls: "btn btn--ghost",
          attrs: a(l.app),
          gap: 8,
          p: [0, 4],
          ai: "center",
          h: 36,
          r: "radius-pill",
        },
        text({ node: "Label", fs: 15, fw: 500, color: "text-primary" }, "Open in browser"),
        ic("arrow-up-right", 16, "text-secondary", "Trailing icon"),
      ),
      leaf({ node: "Divider", w: 1, h: 16, bg: "border-strong" }),
      frame(
        {
          node: "Button · Star on GitHub",
          tag: "a",
          cls: "btn btn--ghost",
          attrs: a(l.repo),
          gap: 8,
          p: [0, 4],
          ai: "center",
          h: 36,
          r: "radius-pill",
        },
        ic("star", 16, "text-primary", "Icon"),
        text({ node: "Label", fs: 15, fw: 500, color: "text-primary" }, "Star on GitHub"),
      ),
    ),
    text(
      { node: "Fine print", font: "mono", fs: 12, color: "text-tertiary" },
      "No account · no backend · works offline · macOS, Windows, Linux and the web open the same .kimo files",
    ),
  )
}

function productShot() {
  return frame(
    {
      node: "Product shot",
      tag: "section",
      layout: "column",
      p: [24, 0, 0, 0],
      w: "fill",
      bgImage: "linear-gradient(180deg, #FFFFFF 0%, #F5F4F2 35%)",
      attrs: { "aria-label": "The Kimo editor with the agent panel" },
    },
    frame(
      {
        node: "Editor window",
        layout: "none",
        w: "fill",
        h: 900,
        st: "border-strong",
        sw: { top: 1, bottom: 1 },
        clip: true,
      },
      html`<img data-node="Editor · agent panel (copied from board 04)" src="/shots/I3RaS.png" width="1440" height="900" alt="The Kimo editor: canvas, layers and the agent panel editing a landing page" style="position:absolute;top:0;left:max(0px,calc(50% - 720px));width:1440px;height:900px;display:block;background:var(--kimo-bg-canvas)" fetchpriority="high">`,
    ),
  )
}

function point(node: string, iconName: string, title: string, detail: string) {
  return frame(
    { node, w: "fill", gap: 14 },
    frame(
      {
        node: "Icon box",
        w: 32,
        h: 32,
        bg: "bg-muted",
        r: "radius-md",
        jc: "center",
        ai: "center",
      },
      ic(iconName, 16, "text-primary", "Icon"),
    ),
    frame(
      { node: "Text", w: "fill", layout: "column", gap: 4 },
      text({ node: "Title", tag: "h3", fs: 16, fw: 600, color: "text-primary" }, title),
      text(
        { node: "Detail", tag: "p", fs: 15, lh: 1.5, color: "text-secondary", w: "fill" },
        detail,
      ),
    ),
  )
}

function openFormat(cfg: SiteConfig) {
  const lines = landingKimoLines(cfg)
  const zsh: Tok[][] = [
    [
      ["$ ", "p"],
      ["git merge design/pricing", "v"],
    ],
    [["Auto-merging landing.kimo", "k"]],
    [
      ["kimo merge: landing.kimo: ", "k"],
      ["3 changes merged", "ok"],
    ],
    [["Merge made by the 'ort' strategy.", "k"]],
    [
      ["$ ", "p"],
      ["kimo validate landing.kimo", "v"],
    ],
    [["landing.kimo: valid", "ok"]],
  ]
  return frame(
    {
      node: "Open format",
      tag: "section",
      attrs: { id: "format" },
      w: "fill",
      gap: 72,
      p: [128, 64, 120, 64],
      ai: "center",
      cls: "gutter",
    },
    frame(
      { node: "Copy", w: 480, layout: "column", gap: 20 },
      eyebrow("Eyebrow", "01 · OPEN FORMAT"),
      title48("Title", "The file is the product."),
      body18(
        "Body",
        "A .kimo file is plain, pretty-printed JSON that lives next to your code. Nothing is encrypted, nothing needs an account to open, and the spec, JSON Schema and TypeScript types are published under MIT.",
      ),
      frame(
        { node: "Points", w: "fill", layout: "column", gap: 18, p: [12, 0, 0, 0] },
        point(
          "Point · A flat node table",
          "table-2",
          "A flat node table",
          "Every node is one keyed entry, so two people adding layers touch different lines — git merges cleanly most of the time.",
        ),
        point(
          "Point · kimo merge for the rest",
          "git-merge",
          "kimo merge for the rest",
          "A semantic three-way merge driver: per node, per property, per variable. Real disagreements are stored in the file and resolved in the Conflicts tab.",
        ),
        point(
          "Point · Versioned and validated",
          "file-check",
          "Versioned and validated",
          "Semver, migrations and a changelog. kimo validate checks schema, references and lints in CI.",
        ),
      ),
    ),
    frame(
      { node: "Proof", w: "fill", layout: "column", gap: 16 },
      frame(
        {
          node: "Code · landing.kimo",
          cls: "code",
          clip: true,
          w: "fill",
          bg: "bg-subtle",
          r: 14,
          st: "border",
          layout: "column",
        },
        codeHeader("Header", null, "landing.kimo", "plain JSON"),
        frame(
          { node: "Lines", tag: "pre", w: "fill", layout: "column", p: [12, 0] },
          lines.map((ln, i) => codeLine(`Line ${i + 1}`, ln.toks, { no: i + 1, hl: ln.hl })),
        ),
      ),
      frame(
        {
          node: "Code · zsh — feature/hero",
          cls: "code",
          clip: true,
          w: "fill",
          bg: "bg-subtle",
          r: 14,
          st: "border",
          layout: "column",
        },
        codeHeader(
          "Header",
          ic("terminal", 14, "text-tertiary", "Icon"),
          "zsh — feature/hero",
          "git driver",
        ),
        frame(
          { node: "Lines", tag: "pre", w: "fill", layout: "column", p: [12, 0] },
          zsh.map((t, i) => codeLine(`Line ${i + 1}`, t, { pad: [2, 16] })),
        ),
      ),
    ),
  )
}

function chip(label: string) {
  return frame(
    {
      node: `Chip · ${label}`,
      h: 32,
      bg: "bg-muted",
      r: "radius-pill",
      st: "border-strong",
      gap: 8,
      p: [0, 14],
      ai: "center",
    },
    text({ node: "Label", fs: 14, fw: 500, color: "text-primary" }, label),
  )
}

function provider(
  node: string,
  persona: Persona,
  name: string,
  detail: string,
  last: boolean,
  tag?: string,
) {
  return frame(
    {
      node,
      w: "fill",
      st: last ? undefined : "border",
      sw: last ? undefined : { bottom: 1 },
      gap: 12,
      p: [14, 16],
      ai: "center",
    },
    html`<span data-node="AgentMark" style="display:flex">${agentMark(24, persona)}</span>`,
    frame(
      { node: "Text", w: "fill", layout: "column", gap: 2 },
      text({ node: "Name", fs: 14, fw: 500, color: "text-primary" }, name),
      text({ node: "Detail", fs: 13, color: "text-tertiary" }, detail),
    ),
    tag
      ? frame(
          { node: "Tag", h: 20, bg: "bg-muted", r: "radius-pill", p: [0, 8], ai: "center" },
          text({ node: "Label", font: "mono", fs: 11, color: "text-secondary" }, tag),
        )
      : null,
  )
}

function agents() {
  const card = (node: string, ...children: Child[]) =>
    frame(
      {
        node,
        w: "fill",
        h: 551,
        bg: "bg-subtle",
        r: 24,
        st: "border",
        layout: "column",
        gap: 20,
        p: 40,
      },
      ...children,
    )
  const termLine = (s: string, c: Paint) =>
    text({ node: "Line", font: "mono", fs: 13, lh: 1.5, color: c }, s)
  return frame(
    {
      node: "Agents",
      tag: "section",
      attrs: { id: "agents" },
      theme: "dark",
      w: "fill",
      bg: "bg-app",
      layout: "column",
      gap: 56,
      p: [128, 64],
      cls: "gutter",
    },
    frame(
      { node: "Heading", w: "fill", jc: "space_between", ai: "end" },
      frame(
        { node: "Left", w: 720, layout: "column", gap: 20 },
        eyebrow("Eyebrow", "02 · AGENTS"),
        title48("Title", "Your agents edit the canvas.\nYou stay in control."),
      ),
      text(
        { node: "Body", tag: "p", fs: 18, lh: 1.55, color: "text-secondary", w: 440 },
        "Every agent edit is a typed, atomic op with an origin. Scopes are enforced, undo is per agent, and anything an agent is still working on is flagged on the canvas.",
      ),
    ),
    frame(
      { node: "Cards", w: "fill", gap: 20 },
      card(
        "Card · MCP",
        frame(
          { node: "Label row", gap: 8, ai: "center" },
          ic("plug", 16, "text-secondary", "Icon"),
          text(
            { node: "Kicker", font: "mono", fs: 12, ls: 0.5, color: "text-secondary" },
            "MCP SERVER",
          ),
        ),
        text(
          { node: "Title", tag: "h3", fs: 28, fw: 500, ls: -0.6, color: "text-primary", w: "fill" },
          "Bring the coding agent you already use.",
        ),
        text(
          { node: "Body", tag: "p", fs: 16, lh: 1.55, color: "text-secondary", w: "fill" },
          "kimo mcp exposes an open, typed tool set: read nodes and tokens, apply ops with revisions, render a PNG to check the work. Works with the desktop app open, or headless in CI.",
        ),
        frame(
          { node: "Hosts", gap: 8 },
          ["Claude Code", "Codex", "Gemini CLI", "Cursor", "VS Code"].map(chip),
        ),
        text(
          { node: "Hosts note", fs: 13, color: "text-tertiary" },
          "…or any client that speaks MCP over stdio.",
        ),
        leaf({ node: "Spacer", w: "fill", h: "fill" }),
        frame(
          {
            node: "Terminal",
            tag: "pre",
            w: "fill",
            bg: "bg-app",
            r: 14,
            st: "border",
            layout: "column",
            gap: 6,
            p: [16, 20],
          },
          termLine("$ kimo mcp install", "text-primary"),
          termLine("Claude Code  installed        ~/.claude.json", "success"),
          termLine("Codex        installed        ~/.codex/config.toml", "success"),
          termLine("Gemini CLI   unchanged        ~/.gemini/settings.json", "text-tertiary"),
        ),
      ),
      card(
        "Card · Built-in",
        frame(
          { node: "Label row", gap: 8, ai: "center" },
          html`<span data-node="AgentMark 12" style="display:flex">${agentMark(12)}</span>`,
          text(
            { node: "Kicker", font: "mono", fs: 12, ls: 0.5, color: "text-secondary" },
            "BUILT-IN AGENT",
          ),
        ),
        text(
          { node: "Title", tag: "h3", fs: 28, fw: 500, ls: -0.6, color: "text-primary", w: "fill" },
          "An agent in the editor, on the subscription you already pay for.",
        ),
        text(
          { node: "Body", tag: "p", fs: 16, lh: 1.55, color: "text-secondary", w: "fill" },
          "The agent panel runs on your signed-in Claude Code, Codex or Gemini CLI — or on your own API key for Anthropic, OpenAI, Gemini, OpenRouter or any compatible endpoint. No Kimo account. No metering.",
        ),
        frame(
          { node: "Providers", w: "fill", bg: "bg-app", r: 14, st: "border", layout: "column" },
          provider(
            "Provider · Claude Code",
            "teal",
            "Claude Code",
            "Your Claude subscription · signed in",
            false,
            "Default",
          ),
          provider("Provider · Codex", "iris", "Codex", "Your ChatGPT plan · signed in", false),
          provider(
            "Provider · Gemini CLI",
            "moss",
            "Gemini CLI",
            "Your Google account · signed in",
            false,
          ),
          provider(
            "Provider · API key",
            "teal",
            "API key",
            "Anthropic, OpenAI, Gemini, OpenRouter, compatible",
            true,
          ),
        ),
        leaf({ node: "Spacer", w: "fill", h: "fill" }),
      ),
    ),
    frame(
      {
        node: "Personas",
        w: "fill",
        st: "border",
        sw: { top: 1 },
        gap: 48,
        p: [40, 0, 0, 0],
        ai: "center",
      },
      frame(
        { node: "Text", w: 400, layout: "column", gap: 8 },
        text(
          { node: "Title", tag: "h3", fs: 22, fw: 500, ls: -0.4, color: "text-primary" },
          "Several agents, one canvas.",
        ),
        text(
          { node: "Body", tag: "p", fs: 15, lh: 1.5, color: "text-secondary", w: "fill" },
          "Each session gets its own AgentMark persona and a scope it cannot leave. Edits are attributed in layers and the activity log.",
        ),
      ),
      frame(
        { node: "Marks", w: "fill", gap: 12, jc: "end" },
        PERSONAS.map((p) =>
          frame(
            {
              node: `Persona · ${p.name}`,
              bg: "bg-subtle",
              r: "radius-pill",
              st: "border",
              gap: 10,
              p: [8, 14, 8, 8],
              ai: "center",
            },
            html`<span data-node="AgentMark" style="display:flex">${agentMark(32, p.persona)}</span>`,
            frame(
              { node: "Text", layout: "column", gap: 1 },
              text({ node: "Name", fs: 13, fw: 500, color: "text-primary" }, p.name),
              text({ node: "Scope", font: "mono", fs: 11, color: "text-tertiary" }, p.scope),
            ),
          ),
        ),
      ),
    ),
  )
}

function exportSection() {
  const target = (name: string, detail: string) =>
    frame(
      { node: `Target · ${name}`, w: "fill", st: "border", sw: { top: 1 }, gap: 16, p: [16, 0] },
      text({ node: "Name", tag: "h3", fs: 15, fw: 600, color: "text-primary", w: 150 }, name),
      text(
        { node: "Detail", tag: "p", fs: 15, lh: 1.5, color: "text-secondary", w: "fill" },
        detail,
      ),
    )
  return frame(
    {
      node: "Export",
      tag: "section",
      attrs: { id: "export" },
      w: "fill",
      gap: 72,
      p: [128, 64],
      ai: "center",
      cls: "gutter",
    },
    frame(
      { node: "Copy", w: 480, layout: "column", gap: 20 },
      eyebrow("Eyebrow", "03 · DESIGN → CODE"),
      title48("Title", "Export is code, not a prompt."),
      body18(
        "Body",
        "The same deterministic generators power the live Code tab and the Export dialog. Same input, same output — reviewable in a diff, runnable in CI.",
      ),
      frame(
        { node: "Targets", w: "fill", layout: "column", p: [12, 0, 0, 0] },
        target(
          "React + Tailwind",
          "Components become components, instances become imports, variables become CSS custom properties.",
        ),
        target("HTML + CSS", "Static, dependency-free markup with a stylesheet per page."),
        target("Design tokens", "W3C DTCG JSON from your variables and themes."),
        target("SVG · PNG · PDF", "Kimo's own emitters; PNG matches the canvas pixel for pixel."),
      ),
    ),
    frame(
      {
        node: "Proof stage",
        w: "fill",
        h: 700,
        bg: "bg-canvas",
        r: 24,
        gap: 24,
        jc: "center",
        ai: "center",
      },
      frame(
        {
          node: "Right Panel · Code (copied from board 25)",
          w: "fill",
          h: 620,
          bg: "bg-app",
          r: "radius-md",
          css: "position:relative",
        },
        html`<img src="/shots/eOcxK.png" alt="The Code tab: Hero.tsx generated as React + Tailwind" width="509" height="693" loading="lazy" style="display:block;position:absolute;left:-36.5px;top:-28.5px;width:calc(100% + 73px);height:auto">`,
      ),
      frame(
        { node: "Rendered", layout: "column", gap: 10, ai: "center" },
        text(
          { node: "Caption", font: "mono", fs: 11, ls: 0.5, color: "text-tertiary" },
          "HERO.TSX → BROWSER",
        ),
        frame(
          {
            node: "Rendered hero",
            w: 300,
            bg: "#FBF3EA",
            r: 14,
            st: "border",
            layout: "column",
            gap: 12,
            p: [28, 24],
          },
          text(
            { node: "H1", fs: 26, fw: 600, lh: 1.05, ls: -0.6, color: "#2B1C14" },
            "Plan less.\nShip more together.",
          ),
          text(
            { node: "P", fs: 13, lh: 1.45, color: "#6B5A4E", w: "fill" },
            "Loom turns messy roadmaps into plans your whole team can follow.",
          ),
          frame(
            { node: "Button", h: 34, bg: "#D9612C", r: "radius-pill", p: [0, 16], ai: "center" },
            text({ node: "Label", fs: 13, fw: 600, color: "#FFFFFF" }, "Start free"),
          ),
        ),
      ),
    ),
  )
}

function components() {
  const pt = (s: string) =>
    frame(
      { node: "Point", w: "fill", gap: 10, ai: "center" },
      ic("check", 16, "text-primary", "Check"),
      text({ node: "Text", fs: 15, lh: 1.45, color: "text-primary", w: "fill" }, s),
    )
  return frame(
    {
      node: "Components & variables",
      tag: "section",
      w: "fill",
      bg: "bg-canvas",
      gap: 72,
      p: [128, 64],
      ai: "center",
      cls: "gutter",
    },
    frame(
      { node: "Proof", w: "fill", gap: 20 },
      frame(
        { node: "Themes", w: 400, h: 796, css: "position:relative;flex-shrink:0" },
        html`<img src="/shots/QDVWd.png" alt="One pricing component resolved in the light and the dark theme" width="409" height="801.5" loading="lazy" style="display:block;position:absolute;left:-4.5px;top:0;width:409px;height:801.5px">`,
      ),
      frame(
        { node: "Panel crop", w: 280, h: 640, css: "position:relative;flex-shrink:0" },
        html`<img src="/shots/Rlv8c.png" alt="The Design panel of an instance: props, variables and themes" width="353" height="713" loading="lazy" style="display:block;position:absolute;left:-36.5px;top:-28.5px;width:353px;height:713px">`,
      ),
    ),
    frame(
      { node: "Copy", w: 460, layout: "column", gap: 20 },
      eyebrow("Eyebrow", "04 · COMPONENTS & VARIABLES"),
      title48("Title", "A real design system, not a pile of frames."),
      body18(
        "Body",
        "Components with typed props and slots, instances with flat overrides, and multi-axis themed variables — light/dark, density, brand — resolved the same way on canvas, in export and for agents.",
      ),
      frame(
        { node: "Points", w: "fill", layout: "column", gap: 10, p: [8, 0, 0, 0] },
        pt("Libraries: import components and tokens from another .kimo file"),
        pt("Variables in hex, OKLCH or Display-P3, with aliases"),
        pt("Token sync in both directions via DTCG"),
      ),
    ),
  )
}

function localFirst() {
  const fact = (node: string, iconName: string, title: string, detail: string, i: number) =>
    frame(
      {
        node,
        w: "fill",
        st: i > 0 ? "border" : undefined,
        sw: i > 0 ? { left: 1 } : undefined,
        layout: "column",
        gap: 12,
        p: i === 0 ? [32, 32, 0, 0] : i === 3 ? [32, 0, 0, 32] : [32, 32, 0, 32],
      },
      ic(iconName, 22, "text-primary", "Icon"),
      text({ node: "Title", tag: "h3", fs: 18, fw: 600, ls: -0.2, color: "text-primary" }, title),
      text(
        { node: "Detail", tag: "p", fs: 15, lh: 1.5, color: "text-secondary", w: "fill" },
        detail,
      ),
    )
  return frame(
    {
      node: "Local-first & privacy",
      tag: "section",
      w: "fill",
      layout: "column",
      gap: 56,
      p: [128, 64],
      cls: "gutter",
    },
    frame(
      { node: "Heading", w: 900, layout: "column", gap: 20 },
      eyebrow("Eyebrow", "05 · LOCAL-FIRST & PRIVACY"),
      title48("Title", "Your files, your machine, your keys."),
      body18(
        "Body",
        "Kimo has no account and no backend. There is nothing to sign in to, and nothing to shut down.",
      ),
    ),
    frame(
      { node: "Facts", w: "fill", st: "border", sw: { top: 1 } },
      fact(
        "Fact · No account",
        "user-x",
        "No account",
        "Every feature — editor, CLI, MCP, export — works without signing in.",
        0,
      ),
      fact(
        "Fact · Works offline",
        "wifi-off",
        "Works offline",
        "The only network calls are to the model you pick and to Google Fonts on first use. Turn fonts off, or install the offline pack.",
        1,
      ),
      fact(
        "Fact · Never lose work",
        "shield-check",
        "Never lose work",
        "Atomic writes, autosave, crash recovery, and Kimo refuses to save over a file it failed to load.",
        2,
      ),
      fact(
        "Fact · Keys stay with you",
        "key-round",
        "Keys stay with you",
        "CLI logins and API keys stay on your machine; requests go straight to your provider.",
        3,
      ),
    ),
  )
}

const REPO_ROWS: [string, string, string][] = [
  ["Row · app/", "apps/ · packages/", "Editor, desktop shell, CLI"],
  ["Row · spec/kimo-format.md", "docs/spec/", "The .kimo format, versioned"],
  ["Row · schema/kimo-1.0.json", "core-schema/schema/", "JSON Schema + TS types"],
  ["Row · mcp/tools.json", "packages/mcp-server/", "Typed MCP tool schemas"],
  ["Row · docs/agents/", "docs/agents/", "Guides your agent reads"],
  ["Row · docs/adr/", "docs/adr/", "Every decision, with reasons"],
]

/** Repo-relative path of each row, for its link. */
const REPO_PATHS = [
  "apps",
  "docs/spec",
  "packages/core-schema/schema",
  "packages/mcp-server",
  "docs/agents",
  "docs/adr",
]

function openSource(cfg: SiteConfig, l: Links, people: Contributor[] | null, size: 36 | 32) {
  return frame(
    { node: "Open source", tag: "section", w: "fill", p: [0, 64, 128, 64], cls: "gutter" },
    frame(
      { node: "Card", w: "fill", bg: "bg-subtle", r: 32, st: "border", gap: 64, p: 56 },
      frame(
        { node: "Copy", w: "fill", layout: "column", gap: 20 },
        eyebrow("Eyebrow", "06 · OPEN SOURCE"),
        title48("Title", "MIT, all the way down."),
        body18(
          "Body",
          "Not just the app. The format spec, JSON Schema, MCP tool schemas, socket protocol and agent guides are all MIT — no clause against reading, forking or training on any of it.",
        ),
        frame(
          { node: "Actions", gap: 10, p: [8, 0, 0, 0] },
          frame(
            {
              node: "Button · View source on GitHub",
              tag: "a",
              cls: "btn btn--accent",
              attrs: a(l.repo),
              h: 44,
              bg: "accent",
              r: "radius-pill",
              gap: 8,
              p: [0, 20],
              ai: "center",
            },
            ic("github-logo", 18, "on-accent", "Icon"),
            text({ node: "Label", fs: 15, fw: 500, color: "on-accent" }, "View source on GitHub"),
          ),
          frame(
            {
              node: "Button · Read CONTRIBUTING.md",
              tag: "a",
              cls: "btn btn--outline",
              attrs: a(l.contributing),
              h: 44,
              bg: "bg-app",
              r: "radius-pill",
              st: "border-strong",
              gap: 8,
              p: [0, 20],
              ai: "center",
            },
            ic("book-open", 16, "text-primary", "Icon"),
            text({ node: "Label", fs: 15, fw: 500, color: "text-primary" }, "Read CONTRIBUTING.md"),
          ),
        ),
        people ? contributors(people, l, size) : null,
      ),
      frame(
        { node: "Repo", w: 520, bg: "bg-app", r: 20, st: "border", layout: "column" },
        REPO_ROWS.map(([node, path, detail], i) =>
          frame(
            {
              node,
              tag: "a",
              cls: "row-link",
              attrs: a(cfg.tree(REPO_PATHS[i] as string)),
              w: "fill",
              st: i < REPO_ROWS.length - 1 ? "border" : undefined,
              sw: i < REPO_ROWS.length - 1 ? { bottom: 1 } : undefined,
              gap: 12,
              p: [16, 20],
              ai: "center",
            },
            ic("folder", 16, "text-tertiary", "Icon"),
            text({ node: "Path", font: "mono", fs: 13, color: "text-primary", w: 200 }, path),
            text({ node: "Detail", fs: 14, color: "text-secondary", w: "fill" }, detail),
            frame(
              { node: "License", h: 20, bg: "bg-muted", r: "radius-pill", p: [0, 8], ai: "center" },
              text({ node: "Label", font: "mono", fs: 11, color: "text-secondary" }, "MIT"),
            ),
          ),
        ),
      ),
    ),
  )
}

export function contributors(people: Contributor[], l: Links, size: 36 | 32) {
  return frame(
    { node: "Contributors", w: "fill", layout: "column", gap: 10, p: [24, 0, 0, 0] },
    text(
      { node: "Caption", font: "mono", fs: 11, ls: 0.5, color: "text-tertiary" },
      "CONTRIBUTORS · LIVE FROM THE GITHUB API AT BUILD TIME",
    ),
    frame(
      { node: "Avatars", gap: -8, cls: "avatars" },
      people.map(
        (p) =>
          html`<a href="${p.url}" rel="noopener" data-node="Avatar slot" title="${p.login}" style="display:block;flex-shrink:0;width:${size}px;height:${size}px;border-radius:50%;background:var(--kimo-bg-muted);outline:2px solid var(--kimo-bg-subtle);outline-offset:-1px;overflow:hidden"><img src="${p.avatar}" alt="${p.login}" width="${size}" height="${size}" loading="lazy" style="display:block;width:100%;height:100%"></a>`,
      ),
      frame(
        {
          node: "You",
          tag: "a",
          attrs: { ...a(l.contributing), "aria-label": "Contribute" },
          w: size,
          h: size,
          bg: "bg-app",
          r: size / 2,
          st: "border-strong",
          jc: "center",
          ai: "center",
        },
        ic("plus", 16, "text-secondary", "Plus"),
      ),
    ),
  )
}

function finalCta(l: Links) {
  return frame(
    {
      node: "Final CTA",
      tag: "section",
      w: "fill",
      bg: "bg-canvas",
      st: "border",
      sw: { top: 1 },
      layout: "column",
      gap: 24,
      p: [120, 64],
      ai: "center",
    },
    html`<span data-node="KimoLogo" style="display:flex;width:72px;height:72px;color:var(--kimo-text-primary)">${logo(72)}</span>`,
    text(
      { node: "Title", tag: "h2", fs: 56, fw: 500, ls: -1.8, ta: "center", color: "text-primary" },
      "Start with one file.",
    ),
    text(
      { node: "Body", tag: "p", fs: 18, ta: "center", color: "text-secondary" },
      "Download Kimo, open a .kimo in your repo, and point your agent at it.",
    ),
    frame(
      { node: "Download row", gap: 10, p: [12, 0, 0, 0] },
      bigButton("Button · Download for macOS", "accent", l.download, "Download for macOS", [
        "apple-logo",
        20,
      ]),
      bigButton("Button · Windows", "outline", l.download, "Windows", ["windows-logo", 18]),
      bigButton("Button · Linux", "outline", l.download, "Linux", ["linux-logo", 18]),
      bigButton("Button · Open in browser", "ghost", l.app, "Open in browser", undefined, [
        "arrow-up-right",
        16,
      ]),
    ),
  )
}

function footer(l: Links) {
  const col = (node: string, heading: string, items: [string, string][]) =>
    frame(
      { node, w: 180, layout: "column", gap: 12 },
      text({ node: "Heading", fs: 13, fw: 600, color: "text-primary" }, heading),
      items.map(([label, href]) =>
        text(
          {
            node: `Link · ${label}`,
            tag: "a",
            cls: "link",
            attrs: a(href),
            fs: 14,
            color: "text-secondary",
          },
          label,
        ),
      ),
    )
  return frame(
    {
      node: "Footer",
      tag: "footer",
      w: "fill",
      st: "border",
      sw: { top: 1 },
      layout: "column",
      gap: 56,
      p: [64, 64, 40, 64],
      cls: "gutter",
    },
    frame(
      { node: "Top", w: "fill", gap: 48 },
      frame(
        { node: "Brand", w: "fill", layout: "column", gap: 14 },
        frame(
          { node: "Logo", gap: 10, ai: "center" },
          html`<span data-node="KimoLogo" style="display:flex;width:28px;height:28px;color:var(--kimo-text-primary)">${logo(28)}</span>`,
          text({ node: "Wordmark", fs: 18, fw: 600, ls: -0.3, color: "text-primary" }, "Kimo"),
        ),
        text(
          { node: "Tagline", tag: "p", fs: 14, lh: 1.5, color: "text-secondary", w: 300 },
          "The open, local-first design canvas for people and their agents.",
        ),
      ),
      col("Column · Product", "Product", [
        ["Download", l.download],
        ["Open in browser", l.app],
        ["Changelog", l.changelog],
        ["Roadmap", l.roadmap],
      ]),
      col("Column · Docs", "Docs", [
        ["Getting started", l.docs],
        ["Agents & MCP", l.agents],
        ["File format spec", l.spec],
        ["CLI reference", l.cli],
      ]),
      col("Column · Community", "Community", [
        ["GitHub", l.repo],
        ["Discussions", l.discussions],
        ["Contributing", l.contributing],
        ["Code of Conduct", l.conduct],
        ["Security", l.security],
      ]),
    ),
    frame(
      {
        node: "Bottom",
        w: "fill",
        st: "border",
        sw: { top: 1 },
        p: [20, 0, 0, 0],
        jc: "space_between",
        ai: "center",
      },
      text(
        { node: "Legal", font: "mono", fs: 12, color: "text-tertiary" },
        `MIT License · © ${new Date().getFullYear()} Kimo contributors`,
      ),
      text(
        { node: "Disclaimer", fs: 12, color: "text-tertiary" },
        "Not affiliated with pen.dev or Pencil. Names of agent tools belong to their owners.",
      ),
    ),
  )
}

export function landingDesktop(cfg: SiteConfig, l: Links, people: Contributor[] | null): Raw {
  return frame(
    {
      node: "Landing · Desktop 1440",
      cls: "landing landing--desktop",
      layout: "column",
      w: "fill",
      bg: "bg-app",
      clip: true,
    },
    nav(l),
    html`<main style="display:contents">`,
    hero(cfg, l),
    productShot(),
    openFormat(cfg),
    agents(),
    exportSection(),
    components(),
    localFirst(),
    openSource(cfg, l, people, 36),
    finalCta(l),
    html`</main>`,
    footer(l),
  )
}
