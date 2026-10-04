/**
 * Docs page chrome, translated from board 26 › 2 · Docs site:
 *   desktop  Docs · Article · Desktop 1440 (BRyqo), Format spec (suf5N), CLI reference (uvFUy)
 *   mobile   Docs · Article · Mobile 390 (YgbwO), Nav drawer open (F0F2T)
 * The spec and CLI pages use their own frames' values where they differ from the article
 * (nav items 30 px / 13.5, prev/next padding 24, title rows, rail cards).
 */
import { agentMark } from "../agent-mark"
import type { SiteConfig } from "../config"
import { esc, html, type Raw, raw } from "../html"
import { ic } from "../landing/shared"
import { logo } from "../logo"
import { type Child, frame, leaf, root, text } from "../node"
import { callout, type Rendered } from "./markdown"
import type { DocPage, Group } from "./sources"

export interface DocView {
  page: DocPage
  group: Group
  groups: Group[]
  prev: DocPage | null
  next: DocPage | null
  r: Rendered
  /** Spec pages: the spec preamble (Status, Schema, …) as rendered inline html. */
  specHeader?: [string, string][]
  /** Spec pages: the machine-readable files that exist in this build. */
  downloads?: { label: string; href: string }[]
  /** CLI pages: every command page. */
  commands?: DocPage[]
}

const a = (href: string) => (href.startsWith("http") ? { href, rel: "noopener" } : { href })

function versionPill(cfg: SiteConfig, size: "desktop" | "mobile") {
  const d = size === "desktop"
  return html`<details class="version" data-node="Version"><summary style="display:flex;align-items:center;gap:${d ? 6 : 4}px;height:${d ? 32 : 28}px;padding:${d ? "0 10px 0 12px" : "0 8px 0 10px"};border-radius:var(--kimo-radius-pill);outline:1px solid var(--kimo-border-strong);outline-offset:-0.5px"><span data-node="Label" style="font-family:var(--kimo-font-mono);font-size:${d ? 13 : 12}px;line-height:${d ? 17 : 16}px;font-weight:500;color:var(--kimo-text-primary)">${cfg.versionLabel}</span>${ic("chevron-down", d ? 14 : 12, "text-secondary", "Chevron")}</summary><div class="version__menu" role="menu"><a role="menuitem" href="/docs/" aria-current="true">${cfg.versionLabel} · current</a><a role="menuitem" href="${cfg.repoUrl}/releases" rel="noopener">All releases</a></div></details>`
}

function topBar(cfg: SiteConfig) {
  return frame(
    {
      node: "Top bar",
      tag: "header",
      cls: "doc-topbar",
      w: "fill",
      h: 64,
      st: "border",
      sw: { bottom: 1 },
      gap: 16,
      p: [0, 24],
      ai: "center",
    },
    frame(
      { node: "Brand", w: 256, gap: 10, ai: "center" },
      html`<a href="/" aria-label="Kimo home" style="display:flex;align-items:center;gap:10px"><span data-node="KimoLogo" style="display:flex;width:28px;height:28px;color:var(--kimo-text-primary)">${logo(28)}</span>${root(text({ node: "Wordmark", fs: 17, fw: 600, ls: -0.3, color: "text-primary" }, "Kimo"), "row")}</a>`,
      leaf({ node: "Divider", w: 1, h: 16, bg: "border-strong" }),
      text(
        {
          node: "Section",
          tag: "a",
          attrs: { href: "/docs/" },
          fs: 15,
          fw: 500,
          color: "text-secondary",
        },
        "Docs",
      ),
    ),
    frame(
      {
        node: "Search",
        tag: "button",
        cls: "search-trigger",
        attrs: { type: "button", "data-search-open": "", "aria-label": "Search docs" },
        w: 420,
        h: 38,
        bg: "bg-muted",
        r: "radius-pill",
        st: "border",
        gap: 8,
        p: [0, 8, 0, 14],
        ai: "center",
      },
      ic("search", 16, "text-tertiary", "Icon"),
      text({ node: "Placeholder", fs: 14, color: "text-tertiary" }, "Search docs, ops, CLI flags…"),
      leaf({ node: "Spacer", w: "fill", h: 1 }),
      frame(
        {
          node: "Kbd",
          tag: "kbd",
          h: 22,
          bg: "bg-app",
          r: 6,
          st: "border-strong",
          p: [0, 7],
          ai: "center",
        },
        text({ node: "Label", font: "mono", fs: 11, color: "text-secondary" }, "⌘K"),
      ),
    ),
    leaf({ node: "Spacer", w: "fill", h: 1 }),
    versionPill(cfg, "desktop"),
    text(
      {
        node: "Link · Changelog",
        tag: "a",
        cls: "link",
        attrs: a(cfg.blob("CHANGELOG.md")),
        fs: 14,
        fw: 500,
        color: "text-secondary",
      },
      "Changelog",
    ),
    text(
      {
        node: "Link · kimo.design",
        tag: "a",
        cls: "link",
        attrs: { href: "/" },
        fs: 14,
        fw: 500,
        color: "text-secondary",
      },
      "kimo.design",
    ),
    frame(
      {
        node: "GitHub",
        tag: "a",
        cls: "icon-btn",
        attrs: { ...a(cfg.repoUrl), "aria-label": "GitHub" },
        w: 36,
        h: 36,
        r: 18,
        st: "border-strong",
        jc: "center",
        ai: "center",
      },
      ic("github-logo", 18, "text-primary", "Icon"),
    ),
  )
}

function mobileTopBar(cfg: SiteConfig) {
  const btn = (node: string, iconName: string, attrs: Record<string, string>) =>
    frame(
      {
        node,
        tag: "button",
        cls: "icon-btn",
        attrs: { type: "button", ...attrs },
        w: 36,
        h: 36,
        r: 18,
        st: "border-strong",
        jc: "center",
        ai: "center",
      },
      ic(iconName, 17, "text-primary", "Icon"),
    )
  return frame(
    {
      node: "Top bar",
      tag: "header",
      cls: "doc-topbar-m",
      w: "fill",
      h: 56,
      st: "border",
      sw: { bottom: 1 },
      gap: 10,
      p: [0, 16],
      ai: "center",
    },
    btn("Icon button · menu", "menu", {
      "data-drawer-open": "",
      "aria-label": "Open navigation",
      "aria-controls": "drawer",
      "aria-expanded": "false",
    }),
    frame(
      {
        node: "Brand",
        tag: "a",
        attrs: { href: "/docs/", "aria-label": "Kimo docs" },
        gap: 8,
        ai: "center",
      },
      html`<span data-node="KimoLogo" style="display:flex;width:24px;height:24px;color:var(--kimo-text-primary)">${logo(24, "small")}</span>`,
      text({ node: "Label", fs: 16, fw: 600, color: "text-primary" }, "Docs"),
    ),
    leaf({ node: "Spacer", w: "fill", h: 1 }),
    versionPill(cfg, "mobile"),
    btn("Icon button · search", "search", { "data-search-open": "", "aria-label": "Search docs" }),
  )
}

/** Left nav (desktop) and the drawer's nav (mobile) share the IA, with each frame's own values. */
function navGroups(v: DocView, variant: "desktop" | "drawer") {
  const d = variant === "desktop"
  const spec = v.page.kind !== "article"
  return v.groups.map((g) => {
    const active = g.id === v.group.id
    const row = frame(
      {
        node: `Group · ${g.label}`,
        tag: "a",
        cls: "nav-group",
        attrs: { href: g.pages[0]?.url ?? "/docs/", ...(active ? { "aria-current": "true" } : {}) },
        w: "fill",
        h: d ? 36 : 42,
        r: d ? "radius-md" : undefined,
        gap: 10,
        p: [0, d ? 10 : 8],
        ai: "center",
      },
      ic(g.icon, 16, active ? "text-primary" : "text-secondary", "Icon"),
      text(
        {
          node: "Label",
          fs: d ? 14 : 15,
          fw: active ? 600 : 500,
          color: active ? "text-primary" : "text-secondary",
        },
        g.label,
      ),
      leaf({ node: "Spacer", w: "fill", h: 1 }),
      ic(active ? "chevron-down" : "chevron-right", 14, "text-tertiary", "Chevron"),
    )
    if (!active || g.pages.length < 2) return row
    const items = g.pages.map((p) => {
      const cur = p.url === v.page.url
      if (!d)
        return frame(
          {
            node: `Item · ${p.navLabel}`,
            tag: "a",
            cls: "nav-item",
            attrs: { href: p.url, ...(cur ? { "aria-current": "page" } : {}) },
            w: "fill",
            h: 38,
            bg: cur ? "bg-muted" : undefined,
            r: "radius-md",
            p: [0, 12],
            ai: "center",
          },
          text(
            {
              node: "Label",
              font: p.navMono ? "mono" : "sans",
              fs: 14,
              fw: cur ? 500 : 400,
              color: cur ? "text-primary" : "text-secondary",
              css: "flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis",
            },
            p.navLabel,
          ),
        )
      return frame(
        {
          node: `Item · ${p.navLabel}`,
          tag: "a",
          cls: "nav-item",
          attrs: { href: p.url, ...(cur ? { "aria-current": "page" } : {}) },
          w: "fill",
          h: spec ? 30 : 32,
          bg: cur ? "bg-app" : undefined,
          r: "radius-md",
          st: "border",
          sw: cur ? 1 : { left: 1 },
          p: [0, 12],
          ai: "center",
        },
        text(
          {
            node: "Label",
            font: p.navMono ? "mono" : "sans",
            fs: spec ? 13.5 : 14,
            fw: cur ? 500 : 400,
            color: cur ? "text-primary" : "text-secondary",
            css: "flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis",
          },
          p.navLabel,
        ),
      )
    })
    return [
      row,
      d
        ? frame(
            { node: `Items · ${g.label}`, w: "fill", layout: "column", gap: 2, p: [2, 0, 8, 22] },
            items,
          )
        : frame({ node: "Items", w: "fill", layout: "column", p: [0, 0, 6, 20] }, items),
    ]
  })
}

function leftNav(v: DocView) {
  return frame(
    {
      node: "Left nav",
      tag: "nav",
      cls: "doc-leftnav",
      attrs: { "aria-label": "Docs" },
      w: 280,
      h: "fill",
      bg: "bg-subtle",
      st: "border",
      sw: { right: 1 },
      layout: "column",
      gap: 2,
      p: [24, 16, 40, 16],
    },
    navGroups(v, "desktop"),
  )
}

function breadcrumb(v: DocView) {
  const mono = v.page.navMono
  return frame(
    {
      node: "Breadcrumb",
      tag: "nav",
      cls: "doc-crumb",
      attrs: { "aria-label": "Breadcrumb" },
      gap: 8,
      ai: "center",
    },
    text(
      {
        node: "Crumb",
        tag: "a",
        attrs: { href: v.group.pages[0]?.url ?? "/docs/" },
        fs: 13,
        color: "text-tertiary",
      },
      v.group.label,
    ),
    ic("chevron-right", 12, "text-tertiary", "Sep"),
    text(
      {
        node: "Crumb",
        font: mono ? "mono" : "sans",
        fs: 13,
        color: "text-secondary",
        attrs: { "aria-current": "page" },
      },
      v.page.sectionNo ? `${v.page.sectionNo} ${v.page.title}` : v.page.title,
    ),
  )
}

function titleBlock(v: DocView) {
  const p = v.page
  if (p.kind === "spec")
    return frame(
      { node: "Title row", cls: "doc-title-row", w: "fill", gap: 12, ai: "center" },
      p.sectionNo
        ? text(
            {
              node: "Section no",
              font: "mono",
              fs: 40,
              ls: -1,
              color: "text-tertiary",
              cls: "doc-sectionno",
            },
            p.sectionNo,
          )
        : null,
      text(
        {
          node: "H1",
          tag: "h1",
          cls: "doc-h1",
          fs: 40,
          fw: 600,
          ls: -1,
          color: "text-primary",
          css: "white-space:normal;flex-shrink:1;min-width:0",
        },
        p.title,
      ),
    )
  if (p.kind === "cli")
    return frame(
      { node: "Title row", cls: "doc-title-row", gap: 12, ai: "center", css: "flex-wrap:wrap" },
      text(
        {
          node: "H1",
          tag: "h1",
          cls: "doc-h1 doc-h1--mono",
          font: "mono",
          fs: 38,
          fw: 600,
          ls: -1,
          color: "text-primary",
        },
        p.title,
      ),
      p.badge
        ? frame(
            { node: "Badge", h: 24, bg: "bg-muted", r: "radius-pill", p: [0, 10], ai: "center" },
            text({ node: "Label", font: "mono", fs: 12, color: "text-secondary" }, p.badge),
          )
        : null,
    )
  return text(
    {
      node: "H1",
      tag: "h1",
      cls: "doc-h1",
      fs: 40,
      fw: 600,
      ls: -1,
      color: "text-primary",
      css: "white-space:normal",
    },
    p.title,
  )
}

function meta(cfg: SiteConfig, v: DocView) {
  const minutes = Math.max(1, Math.round(v.r.plain.split(/\s+/).filter(Boolean).length / 220))
  const [fmaj, fmin] = cfg.formatVersion.split(".")
  return frame(
    { node: "Meta", cls: "doc-meta", gap: 16, p: [0, 0, 8, 0], ai: "center" },
    text({ node: "Read time", fs: 13, color: "text-tertiary" }, `${minutes} min read`),
    text({ node: "Dot", fs: 13, color: "text-tertiary" }, "·"),
    text(
      { node: "Version", font: "mono", fs: 13, color: "text-tertiary" },
      `Kimo ${cfg.versionLabel.slice(1)} · format ${fmaj}.${fmin}`,
    ),
  )
}

function specHeader(rows: [string, string][]) {
  return frame(
    { node: "Spec header", cls: "spec-header", w: "fill", r: 12, st: "border", layout: "column" },
    rows.map(([k, val], i) =>
      frame(
        {
          node: `Row · ${k}`,
          w: "fill",
          st: i < rows.length - 1 ? "border" : undefined,
          sw: i < rows.length - 1 ? { bottom: 1 } : undefined,
          gap: 16,
          p: [10, 16],
        },
        text({ node: "Key", fs: 13, fw: 600, color: "text-primary", w: 110 }, k),
        html`<div data-node="Value" class="spec-header__value" style="flex:1 1 0;min-width:0">${raw(val)}</div>`,
      ),
    ),
  )
}

function rfcLegend() {
  const kw = (k: string) =>
    frame(
      { node: `Keyword · ${k}`, h: 22, bg: "bg-muted", r: 6, p: [0, 8], ai: "center" },
      text({ node: "Label", font: "mono", fs: 11, fw: 600, color: "text-primary" }, k),
    )
  return frame(
    { node: "RFC 2119 keywords", cls: "rfc-legend", gap: 8, ai: "center", css: "flex-wrap:wrap" },
    text({ node: "Label", fs: 12, color: "text-tertiary" }, "Keywords:"),
    kw("MUST"),
    kw("MUST NOT"),
    kw("SHOULD"),
    kw("MAY"),
    text(
      { node: "Note", fs: 12, color: "text-tertiary" },
      "set in small mono caps wherever they are normative",
    ),
  )
}

function prevNext(v: DocView) {
  const spec = v.page.kind !== "article"
  const label = (p: DocPage) => (p.sectionNo ? `${p.sectionNo} ${p.title}` : p.title)
  const card = (dir: "Previous" | "Next", p: DocPage | null) =>
    p
      ? frame(
          {
            node: dir,
            tag: "a",
            cls: "pn-card",
            attrs: { href: p.url, rel: dir === "Next" ? "next" : "prev" },
            w: "fill",
            r: 14,
            st: "border",
            layout: "column",
            gap: 4,
            p: [16, 20],
            ai: dir === "Next" ? "end" : undefined,
          },
          text({ node: "Dir", fs: 12, color: "text-tertiary" }, dir),
          spec
            ? text(
                {
                  node: "Title",
                  fs: 16,
                  fw: 600,
                  color: "text-primary",
                  font: p.navMono ? "mono" : "sans",
                },
                label(p),
              )
            : frame(
                { node: "Title row", gap: 6, ai: "center" },
                dir === "Previous" ? ic("arrow-left", 16, "text-primary", "Arrow") : null,
                text(
                  {
                    node: "Title",
                    fs: 16,
                    fw: 600,
                    color: "text-primary",
                    font: p.navMono ? "mono" : "sans",
                  },
                  label(p),
                ),
                dir === "Next" ? ic("arrow-right", 16, "text-primary", "Arrow") : null,
              ),
        )
      : leaf({ node: `${dir} (none)`, w: "fill", h: 1 })
  const cardM = (dir: "Previous" | "Next", p: DocPage | null) =>
    p
      ? frame(
          {
            node: dir,
            tag: "a",
            cls: "pn-card",
            attrs: { href: p.url },
            w: "fill",
            r: 14,
            st: "border",
            gap: 8,
            p: [14, 16],
            ai: "center",
          },
          frame(
            { node: "Text", w: "fill", layout: "column", gap: 2 },
            text({ node: "Dir", fs: 12, color: "text-tertiary" }, dir),
            text(
              {
                node: "Title",
                fs: 16,
                fw: 600,
                color: "text-primary",
                font: p.navMono ? "mono" : "sans",
                w: "fill",
              },
              label(p),
            ),
          ),
          ic(dir === "Next" ? "arrow-right" : "arrow-left", 18, "text-primary", "Arrow"),
        )
      : null
  return [
    frame(
      {
        node: "Prev / next",
        tag: "nav",
        cls: "doc-pn doc-pn--desktop",
        attrs: { "aria-label": "Previous and next page" },
        w: "fill",
        gap: 16,
        p: [spec ? 24 : 32, 0, 0, 0],
      },
      card("Previous", v.prev),
      card("Next", v.next),
    ),
    frame(
      {
        node: "Prev / next",
        tag: "nav",
        cls: "doc-pn doc-pn--mobile",
        attrs: { "aria-label": "Previous and next page" },
        w: "fill",
        layout: "column",
        gap: 10,
        p: [16, 0, 0, 0],
      },
      cardM("Next", v.next),
      cardM("Previous", v.prev),
    ),
  ]
}

function pageFooter(cfg: SiteConfig, v: DocView) {
  return frame(
    {
      node: "Page footer",
      cls: "doc-footer",
      w: "fill",
      st: "border",
      sw: { top: 1 },
      p: [20, 0, 0, 0],
      jc: "space_between",
      css: "flex-wrap:wrap;gap:8px 16px",
    },
    frame(
      {
        node: "Edit link",
        tag: "a",
        cls: "link",
        attrs: a(cfg.blob(v.page.editPath)),
        gap: 6,
        ai: "center",
      },
      ic("pencil", 14, "text-secondary", "Icon"),
      text({ node: "Label", fs: 13, color: "text-secondary" }, "Edit this page on GitHub"),
    ),
    text(
      { node: "Source", font: "mono", fs: 12, color: "text-tertiary" },
      `${v.page.source} · MIT`,
    ),
  )
}

/** "On this page (collapsed)" (mobile): a disclosure with the same TOC. */
function mobileToc(v: DocView) {
  if (v.r.toc.length === 0) return null
  return html`<details class="toc-m" data-node="On this page (collapsed)"><summary>${ic("list", 16, "text-secondary", "Icon")}<span data-node="Label" class="toc-m__label">On this page</span><span class="toc-m__spacer"></span><span data-node="Count" class="toc-m__count">${v.r.toc.length} ${v.r.toc.length === 1 ? "section" : "sections"}</span>${ic("chevron-down", 16, "text-secondary", "Chevron")}</summary><ol>${v.r.toc.map((t) => html`<li><a href="#${t.id}">${t.text}</a></li>`)}</ol></details>`
}

function content(cfg: SiteConfig, v: DocView) {
  const p = v.page
  const agentsNote =
    p.group === "agents"
      ? html`<div class="only-desktop">${raw(callout("note", "Agents read these docs too", `Every page in Agents &amp; MCP is served to agents by <code>kimo_read_docs</code>, word for word. If a page here is wrong, so is your agent — <a href="${esc(`${cfg.repoUrl}/issues`)}" rel="noopener">file an issue</a>.`))}</div><div class="only-mobile">${raw(callout("note", "", "Agents read these docs too, via <code>kimo_read_docs</code>."))}</div>`
      : null
  // The RFC 2119 legend sits after the first block of normative text (before the 2nd heading).
  let body = v.r.html
  if (p.kind === "spec") {
    const legend = root(rfcLegend()).value
    const marks = [...body.matchAll(/<div class="doc-h2-frame"/g)]
    const at = marks[1]?.index
    body = at === undefined ? body + legend : body.slice(0, at) + legend + body.slice(at)
  }
  return frame(
    {
      node: "Content",
      tag: "main",
      cls: "doc-content",
      attrs: { id: "content", "data-pagefind-body": "" },
      w: "fill",
      layout: "column",
      gap: 20,
      p: [40, 64, 64, 64],
    },
    breadcrumb(v),
    text({ node: "Crumb", cls: "doc-crumb-m", fs: 13, color: "text-tertiary" }, v.group.label),
    titleBlock(v),
    v.r.lead ? html`<p class="doc-lead" data-node="Lead">${raw(v.r.lead)}</p>` : null,
    p.kind !== "spec" ? meta(cfg, v) : null,
    mobileToc(v),
    v.specHeader ? specHeader(v.specHeader) : null,
    agentsNote,
    raw(body),
    prevNext(v),
    pageFooter(cfg, v),
  )
}

function rightRail(v: DocView) {
  const p = v.page
  const tocItem = (t: { id: string; text: string }, i: number) =>
    frame(
      {
        node: `TOC · ${t.text}`,
        tag: "a",
        cls: "toc-item",
        attrs: {
          href: `#${t.id}`,
          "data-toc": t.id,
          ...(i === 0 ? { "aria-current": "true" } : {}),
        },
        w: "fill",
        p: [6, 0, 6, 14],
      },
      p.kind === "article"
        ? text({ node: "Label", fs: 13, lh: 1.4, color: "text-secondary", w: "fill" }, t.text)
        : text(
            {
              node: "Label",
              fs: 13,
              color: "text-secondary",
              css: "white-space:normal;flex-shrink:1;min-width:0",
            },
            t.text,
          ),
    )
  let card: Child = null
  if (p.readDocsPath)
    card = frame(
      {
        node: "Agent card",
        w: "fill",
        bg: "bg-subtle",
        r: 12,
        st: "border",
        layout: "column",
        gap: 8,
        p: 14,
      },
      frame(
        { node: "Head", gap: 8, ai: "center" },
        html`<span data-node="AgentMark 12" style="display:flex">${agentMark(12)}</span>`,
        text({ node: "Title", fs: 13, fw: 600, color: "text-primary" }, "For agents"),
      ),
      text(
        {
          node: "Call",
          font: "mono",
          fs: 12,
          color: "text-secondary",
          w: "fill",
          css: "overflow-wrap:anywhere",
        },
        `kimo_read_docs {path: "${p.readDocsPath}"}`,
      ),
    )
  else if (p.kind === "spec" && v.downloads?.length)
    card = frame(
      {
        node: "Downloads",
        w: "fill",
        bg: "bg-subtle",
        r: 12,
        st: "border",
        layout: "column",
        gap: 8,
        p: 14,
      },
      text({ node: "Title", fs: 13, fw: 600, color: "text-primary" }, "Machine-readable"),
      v.downloads.map((d) =>
        frame(
          {
            node: `File · ${d.label}`,
            tag: "a",
            cls: "link",
            attrs: { href: d.href, download: "" },
            gap: 6,
            ai: "center",
          },
          ic("download", 13, "text-secondary", "Icon"),
          text({ node: "Label", font: "mono", fs: 12, color: "text-secondary" }, d.label),
        ),
      ),
    )
  else if (p.group === "cli" && v.commands)
    card = frame(
      {
        node: "Commands",
        w: "fill",
        bg: "bg-subtle",
        r: 12,
        st: "border",
        layout: "column",
        gap: 6,
        p: 14,
      },
      text({ node: "Title", fs: 13, fw: 600, color: "text-primary" }, "All commands"),
      v.commands.map((c) =>
        text(
          {
            node: "Cmd",
            tag: "a",
            cls: "link",
            attrs: { href: c.url, ...(c.url === p.url ? { "aria-current": "page" } : {}) },
            font: "mono",
            fs: 12,
            color: c.url === p.url ? "text-primary" : "text-secondary",
          },
          c.title,
        ),
      ),
      text({ node: "Cmd", font: "mono", fs: 12, color: "text-secondary" }, "kimo --help"),
    )
  return frame(
    {
      node: "Right rail",
      tag: "aside",
      cls: "doc-rail",
      w: 248,
      layout: "column",
      gap: 12,
      p: [40, 24, 40, 0],
    },
    v.r.toc.length
      ? [
          text({ node: "Title", fs: 13, fw: 600, color: "text-primary" }, "On this page"),
          frame(
            {
              node: "TOC",
              tag: "nav",
              cls: "toc",
              attrs: { "aria-label": "On this page" },
              w: "fill",
              st: "border",
              sw: { left: 1 },
              layout: "column",
            },
            v.r.toc.map(tocItem),
          ),
        ]
      : null,
    card,
  )
}

/** Nav drawer (F0F2T › Drawer A4LLJ), shared by the docs and the mobile landing menu. */
export function drawer(cfg: SiteConfig, navHtml: Child, opts: { search: boolean; title: string }) {
  return html`<div class="drawer" id="drawer" hidden><div class="drawer__scrim" data-node="Scrim" data-drawer-close></div>${root(
    frame(
      {
        node: "Drawer",
        cls: "drawer__panel",
        attrs: { role: "dialog", "aria-modal": "true", "aria-label": opts.title },
        w: 320,
        bg: "bg-app",
        shadow: { x: 8, y: 0, blur: 32, color: "shadow-strong" },
        layout: "column",
        gap: 12,
        p: [14, 16, 24, 16],
      },
      frame(
        { node: "Head", w: "fill", h: 36, gap: 8, ai: "center" },
        html`<span data-node="KimoLogo" style="display:flex;width:24px;height:24px;color:var(--kimo-text-primary)">${logo(24, "small")}</span>`,
        text({ node: "Label", fs: 16, fw: 600, color: "text-primary" }, opts.title),
        leaf({ node: "Spacer", w: "fill", h: 1 }),
        frame(
          {
            node: "Close",
            tag: "button",
            cls: "icon-btn",
            attrs: { type: "button", "data-drawer-close": "", "aria-label": "Close" },
            w: 32,
            h: 32,
            bg: "bg-muted",
            r: 16,
            jc: "center",
            ai: "center",
          },
          ic("x", 16, "text-primary", "Icon"),
        ),
      ),
      opts.search
        ? frame(
            {
              node: "Search",
              tag: "button",
              cls: "search-trigger",
              attrs: { type: "button", "data-search-open": "" },
              w: "fill",
              h: 40,
              bg: "bg-muted",
              r: "radius-pill",
              st: "border",
              gap: 8,
              p: [0, 14],
              ai: "center",
            },
            ic("search", 16, "text-tertiary", "Icon"),
            text({ node: "Placeholder", fs: 14, color: "text-tertiary" }, "Search docs"),
          )
        : null,
      frame(
        { node: "Version row", w: "fill", gap: 8, ai: "center" },
        text({ node: "Label", fs: 13, color: "text-tertiary" }, "Version"),
        versionPill(cfg, "mobile"),
        leaf({ node: "Spacer", w: "fill", h: 1 }),
        frame(
          { node: "GitHub", tag: "a", attrs: a(cfg.repoUrl), gap: 6, ai: "center" },
          ic("github-logo", 16, "text-primary", "Icon"),
          text({ node: "Label", fs: 13, fw: 500, color: "text-primary" }, "GitHub"),
        ),
      ),
      frame(
        {
          node: "Nav",
          tag: "nav",
          w: "fill",
          st: "border",
          sw: { top: 1 },
          layout: "column",
          p: [8, 0, 0, 0],
          css: "overflow-y:auto;min-height:0;flex:1 1 auto",
        },
        navHtml,
      ),
    ),
  )}</div>`
}

export function searchDialog() {
  return html`<div class="search" id="search" hidden><div class="search__scrim" data-search-close></div><div class="search__panel" role="dialog" aria-modal="true" aria-label="Search docs"><div class="search__field">${ic("search", 16, "text-tertiary")}<input type="search" id="search-input" placeholder="Search docs, ops, CLI flags…" autocomplete="off" spellcheck="false" aria-controls="search-results"><kbd class="search__esc">esc</kbd></div><ul class="search__results" id="search-results" role="listbox"></ul><p class="search__empty" id="search-empty" hidden>No results.</p></div></div>`
}

export function docPage(cfg: SiteConfig, v: DocView): Raw {
  const desktop = frame(
    { node: "Docs · Desktop", cls: "doc doc--desktop", layout: "column", w: "fill", bg: "bg-app" },
    topBar(cfg),
    mobileTopBar(cfg),
    frame({ node: "Body", cls: "doc-body", w: "fill" }, leftNav(v), content(cfg, v), rightRail(v)),
  )
  return html`${root(desktop)}${drawer(cfg, navGroups(v, "drawer"), { search: true, title: "Docs" })}${searchDialog()}`
}
