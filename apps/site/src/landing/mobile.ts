/**
 * Landing · Mobile 390 (desing.pen t4GJ6Z). Its own node tree (the mobile frame is not the
 * desktop one reflowed), translated node for node like the desktop.
 */
import { agentMark } from "../agent-mark"
import type { SiteConfig } from "../config"
import { html, type Raw } from "../html"
import { logo } from "../logo"
import { type Box, type Child, frame, leaf, type Paint, text } from "../node"
import { copyButton } from "./desktop"
import { type Contributor, ic, type Links, PERSONAS, TOKEN_COLOR, type Tok } from "./shared"

const a = (href: string): Box["attrs"] =>
  href.startsWith("http") ? { href, rel: "noopener" } : { href }

const eyebrow = (s: string) =>
  text({ node: "Eyebrow", font: "mono", fs: 11, ls: 0.5, color: "text-tertiary" }, s)
const title32 = (s: string) =>
  text(
    {
      node: "Title",
      tag: "h2",
      fs: 32,
      fw: 500,
      lh: 1.1,
      ls: -0.9,
      color: "text-primary",
      w: "fill",
    },
    s,
  )
const body16 = (s: string) =>
  text({ node: "Body", tag: "p", fs: 16, lh: 1.55, color: "text-secondary", w: "fill" }, s)

function button(
  node: string,
  kind: "accent" | "outline" | "ghost",
  href: string,
  label: string,
  h: number,
  fs: number,
  lead?: [string, number],
  trail?: [string, number],
  w: Box["w"] | "fit" = "fill",
) {
  const fg: Paint = kind === "accent" ? "on-accent" : "text-primary"
  return frame(
    {
      node,
      tag: "a",
      cls: `btn btn--${kind}`,
      attrs: a(href),
      w: w === "fit" ? undefined : w,
      h,
      bg: kind === "accent" ? "accent" : kind === "outline" ? "bg-app" : undefined,
      st: kind === "outline" ? "border-strong" : undefined,
      r: "radius-pill",
      gap: 8,
      p: [0, 20],
      jc: w === "fill" ? "center" : undefined,
      ai: "center",
    },
    lead ? ic(lead[0], lead[1], fg, "Icon") : null,
    text({ node: "Label", fs, fw: 500, color: fg }, label),
    trail ? ic(trail[0], trail[1], "text-secondary", "Trailing icon") : null,
  )
}

function nav() {
  return frame(
    {
      node: "Nav",
      tag: "header",
      w: "fill",
      h: 60,
      st: "border",
      sw: { bottom: 1 },
      p: [0, 20],
      jc: "space_between",
      ai: "center",
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
      {
        node: "Menu button",
        tag: "button",
        cls: "icon-btn",
        attrs: {
          type: "button",
          "data-drawer-open": "",
          "aria-label": "Open menu",
          "aria-controls": "drawer",
          "aria-expanded": "false",
        },
        w: 40,
        h: 40,
        r: 20,
        st: "border-strong",
        jc: "center",
        ai: "center",
      },
      ic("menu", 18, "text-primary", "Icon"),
    ),
  )
}

function hero(cfg: SiteConfig, l: Links) {
  return frame(
    { node: "Hero", tag: "section", w: "fill", layout: "column", gap: 20, p: [48, 20, 40, 20] },
    frame(
      {
        node: "Release pill",
        tag: "a",
        attrs: a(l.releaseNotes),
        h: 28,
        bg: "bg-muted",
        r: "radius-pill",
        st: "border",
        gap: 8,
        p: [0, 10, 0, 4],
        ai: "center",
      },
      frame(
        { node: "Tag", h: 20, bg: "accent", r: "radius-pill", p: [0, 8], ai: "center" },
        text(
          { node: "Version", font: "mono", fs: 12, fw: 600, color: "on-accent" },
          cfg.versionLabel,
        ),
      ),
      text({ node: "Pill text", fs: 13, color: "text-secondary" }, "MIT · local-first"),
      ic("arrow-right", 14, "text-primary", "Arrow"),
    ),
    text(
      {
        node: "Headline",
        tag: "h1",
        fs: 42,
        fw: 500,
        lh: 1.06,
        ls: -1.4,
        color: "text-primary",
        w: "fill",
      },
      "An open design canvas for you and your agents.",
    ),
    text(
      { node: "Subhead", tag: "p", fs: 17, lh: 1.5, color: "text-secondary", w: "fill" },
      "Free and MIT-licensed. Designs are plain JSON in your repo, your coding agents edit them over MCP, and the built-in agent runs on the CLI subscription you already have.",
    ),
    frame(
      { node: "Downloads", w: "fill", layout: "column", gap: 10, p: [8, 0, 0, 0] },
      button("Button · Download for macOS", "accent", l.download, "Download for macOS", 52, 16, [
        "apple-logo",
        20,
      ]),
      frame(
        { node: "Other platforms", w: "fill", gap: 10 },
        button("Button · Windows", "outline", l.download, "Windows", 48, 15, ["windows-logo", 18]),
        button("Button · Linux", "outline", l.download, "Linux", 48, 15, ["linux-logo", 18]),
      ),
    ),
    frame(
      { node: "Secondary row", w: "fill", jc: "space_between", ai: "center" },
      button(
        "Button · Open in browser",
        "ghost",
        l.app,
        "Open in browser",
        36,
        15,
        undefined,
        ["arrow-up-right", 16],
        "fit",
      ),
      button(
        "Button · Star on GitHub",
        "ghost",
        l.repo,
        "Star on GitHub",
        36,
        15,
        ["star", 16],
        undefined,
        "fit",
      ),
    ),
    text(
      { node: "Fine print", font: "mono", fs: 12, color: "text-tertiary" },
      "No account · no backend · works offline",
    ),
  )
}

function productShot() {
  return frame(
    {
      node: "Product shot",
      tag: "section",
      w: "fill",
      bg: "bg-canvas",
      st: "border",
      sw: { top: 1, bottom: 1 },
      p: [0, 0, 0, 20],
      attrs: { "aria-label": "The agent panel" },
    },
    frame(
      {
        node: "Agent panel crop",
        w: "fill",
        h: 600,
        st: "border-strong",
        sw: { left: 1 },
        layout: "none",
        clip: true,
      },
      html`<img src="/shots/F83s90.png" alt="The agent panel: a request, the agent's plan and the changes it made" width="370" height="600" loading="lazy" style="display:block;position:absolute;left:0;top:0;width:370px;height:600px">`,
    ),
  )
}

function codeBlock(node: string, file: string, lines: Tok[][]) {
  return frame(
    {
      node,
      cls: "code",
      clip: true,
      w: "fill",
      bg: "bg-subtle",
      r: 12,
      st: "border",
      layout: "column",
    },
    frame(
      {
        node: "Header",
        w: "fill",
        h: 36,
        st: "border",
        sw: { bottom: 1 },
        gap: 8,
        p: [0, 14],
        ai: "center",
      },
      text({ node: "File name", font: "mono", fs: 11, color: "text-secondary" }, file),
      leaf({ node: "Spacer", w: "fill", h: 1 }),
      copyButton(14),
    ),
    frame(
      { node: "Lines", tag: "pre", w: "fill", layout: "column", p: [10, 0] },
      lines.map((toks, i) =>
        frame(
          { node: `Line ${i + 1}`, cls: "code__line", w: "fill", p: [1, 14] },
          toks.map(([s, k]) =>
            text({ node: "Token", font: "mono", fs: 11.5, lh: 1.6, color: TOKEN_COLOR[k] }, s),
          ),
        ),
      ),
    ),
  )
}

function openFormat() {
  return frame(
    { node: "Open format", tag: "section", w: "fill", layout: "column", gap: 16, p: [64, 20] },
    eyebrow("01 · OPEN FORMAT"),
    title32("The file is the product."),
    body16(
      "A .kimo file is plain JSON next to your code. A flat node table, so git merges cleanly, and kimo merge settles the rest.",
    ),
    codeBlock("Code · landing.kimo", "landing.kimo", [
      [
        ['"nodes"', "k"],
        [": {", "p"],
      ],
      [
        ['  "h3Ro9xQk2a"', "k"],
        [": { ", "p"],
        ['"type"', "k"],
        [": ", "p"],
        ['"frame"', "v"],
        [",", "p"],
      ],
      [
        ['    "name"', "k"],
        [": ", "p"],
        ['"Hero"', "v"],
        [", ", "p"],
        ['"parent"', "k"],
        [": ", "p"],
        ["null", "v"],
        [" },", "p"],
      ],
      [
        ['  "t7Kp2mVw8c"', "k"],
        [": { ", "p"],
        ['"type"', "k"],
        [": ", "p"],
        ['"text"', "v"],
        [", … }", "p"],
      ],
      [["}", "p"]],
    ]),
    codeBlock("Code · zsh", "zsh", [
      [
        ["$ ", "p"],
        ["git merge design/pricing", "v"],
      ],
      [
        ["kimo merge: landing.kimo: ", "k"],
        ["3 changes merged", "ok"],
      ],
    ]),
  )
}

function agents() {
  const chip = (label: string, color: Paint = "text-primary") =>
    frame(
      {
        node: `Chip · ${label}`,
        h: 28,
        bg: "bg-muted",
        r: "radius-pill",
        st: "border-strong",
        p: [0, 10],
        ai: "center",
      },
      text({ node: "Label", fs: 12, fw: 500, color }, label),
    )
  const card = (node: string, ...children: Child[]) =>
    frame(
      { node, w: "fill", bg: "bg-subtle", r: 20, st: "border", layout: "column", gap: 14, p: 24 },
      ...children,
    )
  const kicker = (s: string) =>
    text({ node: "Kicker", font: "mono", fs: 11, ls: 0.5, color: "text-secondary" }, s)
  const ctitle = (s: string) =>
    text(
      { node: "Title", tag: "h3", fs: 22, fw: 500, ls: -0.4, color: "text-primary", w: "fill" },
      s,
    )
  const line = (s: string, c: Paint) =>
    text({ node: "Line", font: "mono", fs: 12, lh: 1.5, color: c }, s)
  return frame(
    {
      node: "Agents",
      tag: "section",
      theme: "dark",
      w: "fill",
      bg: "bg-app",
      layout: "column",
      gap: 16,
      p: [64, 20],
    },
    eyebrow("02 · AGENTS"),
    title32("Your agents edit the canvas. You stay in control."),
    body16("Typed, atomic, attributed edits. Scopes are enforced and undo is per agent."),
    card(
      "Card · MCP",
      kicker("MCP SERVER"),
      ctitle("Bring the coding agent you already use."),
      frame({ node: "Hosts", gap: 6 }, chip("Claude Code"), chip("Codex"), chip("Gemini CLI")),
      frame(
        { node: "Hosts", gap: 6 },
        chip("Cursor"),
        chip("VS Code"),
        chip("any MCP client", "text-secondary"),
      ),
      frame(
        {
          node: "Terminal",
          tag: "pre",
          w: "fill",
          bg: "bg-app",
          r: 12,
          st: "border",
          layout: "column",
          gap: 4,
          p: [12, 14],
        },
        line("$ kimo mcp install", "text-primary"),
        line("Claude Code  installed", "success"),
        line("Codex        installed", "success"),
      ),
    ),
    card(
      "Card · Built-in",
      kicker("BUILT-IN AGENT"),
      ctitle("An agent in the editor, on the subscription you already pay for."),
      text(
        { node: "Body", tag: "p", fs: 15, lh: 1.5, color: "text-secondary", w: "fill" },
        "Claude Code, Codex or Gemini CLI, or your own API key. No Kimo account, no metering.",
      ),
    ),
    frame(
      { node: "Personas", w: "fill", layout: "column", gap: 12, p: [12, 0, 0, 0] },
      text(
        { node: "Caption", tag: "p", fs: 14, lh: 1.5, color: "text-secondary", w: "fill" },
        "Several agents on one canvas, each with its own mark and scope.",
      ),
      frame(
        { node: "Marks", gap: 10 },
        PERSONAS.map(
          (p) =>
            html`<span data-node="AgentMark" title="${p.name}" style="display:flex">${agentMark(32, p.persona)}</span>`,
        ),
      ),
    ),
  )
}

function exportSection() {
  return frame(
    { node: "Export", tag: "section", w: "fill", layout: "column", gap: 16, p: [64, 20] },
    eyebrow("03 · DESIGN → CODE"),
    title32("Export is code, not a prompt."),
    body16(
      "React + Tailwind, HTML + CSS, DTCG tokens, SVG · PNG · PDF. Deterministic generators, the same ones behind the live Code tab.",
    ),
    frame(
      { node: "Proof stage", w: "fill", bg: "bg-canvas", r: 20, p: [16, 0], jc: "center" },
      frame(
        {
          node: "Right Panel · Code (copied from board 25)",
          w: "fill",
          h: 520,
          bg: "bg-app",
          r: "radius-md",
          clip: true,
          css: "max-width:350px",
        },
        html`<img src="/shots/o0aP8n.png" alt="The Code tab: Hero.tsx generated as React + Tailwind" width="351" height="521" loading="lazy" style="display:block;width:100%;height:auto;margin:-0.5px">`,
      ),
    ),
  )
}

function components() {
  return frame(
    {
      node: "Components & variables",
      tag: "section",
      w: "fill",
      bg: "bg-canvas",
      layout: "column",
      gap: 16,
      p: [64, 20],
    },
    eyebrow("04 · COMPONENTS & VARIABLES"),
    title32("A design system with components, variables and themes."),
    body16(
      "Components with props and slots, instances with overrides, and themed variables across light/dark, density and brand.",
    ),
    frame(
      {
        node: "Panel crop",
        w: "fill",
        h: 440,
        bg: "bg-app",
        r: 16,
        clip: true,
        css: "max-width:350px",
      },
      html`<img src="/shots/rwcJh.png" alt="The Design panel of an instance: props, variables and themes" width="351" height="441" loading="lazy" style="display:block;width:100%;height:auto;margin:-0.5px">`,
    ),
  )
}

function localFirst() {
  const fact = (node: string, iconName: string, title: string, detail: string) =>
    frame(
      { node, w: "fill", st: "border", sw: { top: 1 }, gap: 14, p: [16, 0] },
      ic(iconName, 20, "text-primary", "Icon"),
      frame(
        { node: "Text", w: "fill", layout: "column", gap: 4 },
        text({ node: "Title", tag: "h3", fs: 16, fw: 600, color: "text-primary" }, title),
        text(
          { node: "Detail", tag: "p", fs: 14, lh: 1.5, color: "text-secondary", w: "fill" },
          detail,
        ),
      ),
    )
  return frame(
    {
      node: "Local-first & privacy",
      tag: "section",
      w: "fill",
      layout: "column",
      gap: 16,
      p: [64, 20],
    },
    eyebrow("05 · LOCAL-FIRST & PRIVACY"),
    title32("Your files and keys stay on your machine."),
    body16("No account and no backend. Nothing to sign in to, nothing to shut down."),
    frame(
      { node: "Facts", w: "fill", layout: "column" },
      fact(
        "Fact · No account",
        "user-x",
        "No account",
        "Editor, CLI, MCP and export all work signed out.",
      ),
      fact(
        "Fact · Works offline",
        "wifi-off",
        "Works offline",
        "Only your model provider and first-use Google Fonts touch the network.",
      ),
      fact(
        "Fact · Never lose work",
        "shield-check",
        "Never lose work",
        "Atomic writes, autosave, crash recovery.",
      ),
      fact(
        "Fact · Keys stay with you",
        "key-round",
        "Keys stay with you",
        "Requests go straight to your provider.",
      ),
    ),
  )
}

function openSource(l: Links, people: Contributor[] | null) {
  return frame(
    { node: "Open source", tag: "section", w: "fill", p: [0, 20, 64, 20] },
    frame(
      {
        node: "Card",
        w: "fill",
        bg: "bg-subtle",
        r: 24,
        st: "border",
        layout: "column",
        gap: 16,
        p: 24,
      },
      eyebrow("06 · OPEN SOURCE"),
      title32("MIT, all the way down."),
      body16("The app, format spec, JSON Schema, MCP tool schemas and agent guides are all MIT."),
      button("Button · View source on GitHub", "accent", l.repo, "View source on GitHub", 48, 15, [
        "github-logo",
        18,
      ]),
      button(
        "Button · Read CONTRIBUTING.md",
        "outline",
        l.contributing,
        "Read CONTRIBUTING.md",
        48,
        15,
        ["book-open", 18],
      ),
      people
        ? [
            text(
              { node: "Caption", font: "mono", fs: 10, ls: 0.4, color: "text-tertiary" },
              "CONTRIBUTORS · LIVE FROM GITHUB AT BUILD TIME",
            ),
            frame(
              { node: "Avatars", gap: -8 },
              people
                .slice(0, 7)
                .map(
                  (p) =>
                    html`<a href="${p.url}" rel="noopener" data-node="Avatar slot" title="${p.login}" style="display:block;flex-shrink:0;width:32px;height:32px;border-radius:50%;background:var(--kimo-bg-muted);outline:2px solid var(--kimo-bg-subtle);outline-offset:-1px;overflow:hidden"><img src="${p.avatar}" alt="${p.login}" width="32" height="32" loading="lazy" style="display:block;width:100%;height:100%"></a>`,
                ),
            ),
          ]
        : null,
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
      gap: 16,
      p: [64, 20],
      ai: "center",
    },
    html`<span data-node="KimoLogo" style="display:flex;width:56px;height:56px;color:var(--kimo-text-primary)">${logo(56)}</span>`,
    text(
      { node: "Title", tag: "h2", fs: 34, fw: 500, ls: -1, ta: "center", color: "text-primary" },
      "Start with one file.",
    ),
    text(
      { node: "Body", tag: "p", fs: 16, lh: 1.5, ta: "center", color: "text-secondary", w: "fill" },
      "Download Kimo, open a .kimo in your repo, and point your agent at it.",
    ),
    frame(
      { node: "Downloads", w: "fill", layout: "column", gap: 10, p: [8, 0, 0, 0] },
      button("Button · Download for macOS", "accent", l.download, "Download for macOS", 52, 15, [
        "apple-logo",
        18,
      ]),
      frame(
        { node: "Other platforms", w: "fill", gap: 10 },
        button("Button · Windows", "outline", l.download, "Windows", 48, 15, ["windows-logo", 18]),
        button("Button · Linux", "outline", l.download, "Linux", 48, 15, ["linux-logo", 18]),
      ),
      button("Button · Open in browser", "ghost", l.app, "Open in browser", 48, 15),
    ),
  )
}

function footer(l: Links) {
  const col = (node: string, heading: string, items: [string, string][]) =>
    frame(
      { node, w: "fill", layout: "column", gap: 10 },
      text({ node: "Heading", fs: 13, fw: 600, color: "text-primary" }, heading),
      items.map(([label, href]) =>
        text(
          {
            node: `Link · ${label}`,
            tag: "a",
            cls: "link",
            attrs: a(href),
            fs: 13,
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
      gap: 28,
      p: [40, 20, 32, 20],
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
      { node: "Columns", w: "fill", gap: 16 },
      col("Column · Product", "Product", [
        ["Download", l.download],
        ["Open in browser", l.app],
        ["Changelog", l.changelog],
      ]),
      col("Column · Docs", "Docs", [
        ["Getting started", l.docs],
        ["Agents & MCP", l.agents],
        ["Format spec", l.spec],
        ["CLI", l.cli],
      ]),
      col("Column · Community", "Community", [
        ["GitHub", l.repo],
        ["Contributing", l.contributing],
        ["Security", l.security],
      ]),
    ),
    frame(
      {
        node: "Bottom",
        w: "fill",
        st: "border",
        sw: { top: 1 },
        layout: "column",
        gap: 6,
        p: [16, 0, 0, 0],
      },
      text(
        { node: "Legal", font: "mono", fs: 11, color: "text-tertiary" },
        `MIT License · © ${new Date().getFullYear()} Kimo contributors`,
      ),
      text(
        { node: "Disclaimer", fs: 11, color: "text-tertiary" },
        "Not affiliated with pen.dev or Pencil.",
      ),
    ),
  )
}

export function landingMobile(cfg: SiteConfig, l: Links, people: Contributor[] | null): Raw {
  return frame(
    {
      node: "Landing · Mobile 390",
      cls: "landing landing--mobile",
      layout: "column",
      w: "fill",
      bg: "bg-app",
      clip: true,
    },
    nav(),
    html`<main style="display:contents">`,
    hero(cfg, l),
    productShot(),
    openFormat(),
    agents(),
    exportSection(),
    components(),
    localFirst(),
    openSource(l, people),
    finalCta(l),
    html`</main>`,
    footer(l),
  )
}
