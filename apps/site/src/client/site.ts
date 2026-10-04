/**
 * The site's only script (bundled to /site.js): the mobile drawer, docs search (a client-side
 * index fetched on first use), copy buttons on code blocks, the "On this page" scroll spy and
 * the version menu. Everything works without it except those interactions.
 */

export interface IndexEntry {
  /** title */
  t: string
  /** group label */
  g: string
  /** url */
  u: string
  /** headings: [anchor, text] */
  h: [string, string][]
  /** body text */
  b: string
}

export interface Hit {
  entry: IndexEntry
  url: string
  heading: string | null
  score: number
  snippet: string
}

const norm = (s: string) => s.toLowerCase()

/** Ranks pages for a query: every term must match; title > heading > body. */
export function searchIndex(index: IndexEntry[], query: string, limit = 12): Hit[] {
  const terms = norm(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const hits: Hit[] = []
  for (const e of index) {
    const title = norm(e.t)
    const body = norm(e.b)
    let score = 0
    let heading: [string, string] | null = null
    let ok = true
    for (const term of terms) {
      let s = 0
      if (title.includes(term)) s += title.startsWith(term) ? 12 : 8
      const h = e.h.find(([, text]) => norm(text).includes(term))
      if (h) {
        s += 5
        heading ??= h
      }
      if (body.includes(term)) s += 1 + Math.min(3, body.split(term).length - 1) * 0.5
      if (s === 0) {
        ok = false
        break
      }
      score += s
    }
    if (!ok) continue
    const first = terms[0] as string
    const at = body.indexOf(first)
    let snippet = ""
    if (at >= 0) {
      const start = Math.max(0, at - 50)
      snippet = `${start > 0 ? "…" : ""}${e.b.slice(start, at + 110).replace(/\s+/g, " ")}…`
    }
    hits.push({
      entry: e,
      url: heading ? `${e.u}#${heading[0]}` : e.u,
      heading: heading?.[1] ?? null,
      score,
      snippet,
    })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  )
}

function markTerms(text: string, query: string) {
  let out = escapeHtml(text)
  for (const term of query.split(/\s+/).filter((t) => t.length > 1)) {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
    out = out.replace(re, "<mark>$1</mark>")
  }
  return out
}

function overlay(el: HTMLElement | null, open: boolean) {
  if (!el) return
  el.hidden = !open
  document.body.classList.toggle("has-overlay", open)
}

function setupDrawer() {
  const drawer = document.getElementById("drawer")
  if (!drawer) return
  const openers = document.querySelectorAll<HTMLElement>("[data-drawer-open]")
  const set = (open: boolean) => {
    overlay(drawer, open)
    for (const o of openers) o.setAttribute("aria-expanded", String(open))
    if (open) drawer.querySelector<HTMLElement>("[data-drawer-close].icon-btn")?.focus()
  }
  for (const o of openers) o.addEventListener("click", () => set(true))
  for (const c of drawer.querySelectorAll("[data-drawer-close]"))
    c.addEventListener("click", () => set(false))
  drawer.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a[href]")) set(false)
  })
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer.hidden) set(false)
  })
  matchMedia("(min-width: 1024px)").addEventListener("change", (m) => m.matches && set(false))
}

function setupSearch() {
  const root = document.getElementById("search")
  const input = document.getElementById("search-input") as HTMLInputElement | null
  const list = document.getElementById("search-results")
  const empty = document.getElementById("search-empty")
  if (!root || !input || !list || !empty) return
  let index: IndexEntry[] | null = null
  let selected = 0
  let hits: Hit[] = []
  const load = async () => {
    if (index) return index
    const res = await fetch("/search-index.json")
    index = (await res.json()) as IndexEntry[]
    return index
  }
  const render = () => {
    const q = input.value.trim()
    list.innerHTML = hits
      .map(
        (h, i) =>
          `<li role="option" aria-selected="${i === selected}"><a href="${h.url}"><span class="search__hit-title">${markTerms(h.heading ?? h.entry.t, q)}</span><span class="search__hit-path">${escapeHtml(h.entry.g)} › ${escapeHtml(h.entry.t)}</span>${h.snippet ? `<span class="search__hit-snippet">${markTerms(h.snippet, q)}</span>` : ""}</a></li>`,
      )
      .join("")
    empty.hidden = !(q && hits.length === 0)
  }
  const run = async () => {
    const idx = await load()
    hits = searchIndex(idx, input.value)
    selected = 0
    render()
  }
  const open = () => {
    document.getElementById("drawer")?.setAttribute("hidden", "")
    overlay(root, true)
    input.focus()
    input.select()
    void load()
  }
  const close = () => overlay(root, false)
  for (const o of document.querySelectorAll("[data-search-open]")) o.addEventListener("click", open)
  for (const c of root.querySelectorAll("[data-search-close]")) c.addEventListener("click", close)
  input.addEventListener("input", () => void run())
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (hits.length === 0) return
      selected = (selected + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length
      render()
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
    } else if (e.key === "Enter") {
      const h = hits[selected]
      if (h) location.href = h.url
    }
  })
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
      e.preventDefault()
      open()
    } else if (e.key === "Escape" && !root.hidden) close()
  })
  list.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) close()
  })
}

function setupCopy() {
  document.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-copy]")
    if (!btn) return
    const block = btn.closest(".code")
    if (!block) return
    const lines = [...block.querySelectorAll<HTMLElement>(".code__line")].map((l) =>
      [...l.children]
        .filter((c) => !["No", "Gutter"].includes((c as HTMLElement).dataset.node ?? ""))
        .map((c) => c.textContent ?? "")
        .join(""),
    )
    try {
      await navigator.clipboard.writeText(lines.join("\n"))
      const label = btn.querySelector("span")
      btn.setAttribute("data-copied", "")
      btn.setAttribute("aria-label", "Copied")
      if (label) label.textContent = "Copied"
      setTimeout(() => {
        btn.removeAttribute("data-copied")
        btn.setAttribute("aria-label", "Copy")
        if (label) label.textContent = "Copy"
      }, 1500)
    } catch {
      // Clipboard denied (insecure context): leave the button as it is.
    }
  })
}

function setupToc() {
  const items = [...document.querySelectorAll<HTMLElement>("[data-toc]")]
  if (items.length === 0 || !("IntersectionObserver" in window)) return
  const targets = items
    .map((i) => document.getElementById(i.dataset.toc ?? ""))
    .filter((t): t is HTMLElement => t !== null)
  const activate = (id: string) => {
    for (const i of items) {
      if (i.dataset.toc === id) i.setAttribute("aria-current", "true")
      else i.removeAttribute("aria-current")
    }
  }
  const visible = new Set<string>()
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) visible.add(en.target.id)
        else visible.delete(en.target.id)
      }
      const first = targets.find((t) => visible.has(t.id))
      if (first) activate(first.id)
    },
    { rootMargin: "-72px 0px -60% 0px" },
  )
  for (const t of targets) io.observe(t)
}

function setupVersionMenus() {
  document.addEventListener("click", (e) => {
    for (const d of document.querySelectorAll<HTMLDetailsElement>("details.version[open]")) {
      if (!d.contains(e.target as Node)) d.open = false
    }
  })
}

if (typeof document !== "undefined") {
  setupDrawer()
  setupSearch()
  setupCopy()
  setupToc()
  setupVersionMenus()
}
