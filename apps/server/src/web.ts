/**
 * The Kimo web app on the relay (board 45): share links are `https://<relay>/join#...`, so the
 * relay serves the app's static build from `KIMO_WEB_DIR` (the relay image and the desktop
 * bundle ship it). `/`, `/join` and `/pair` get `index.html`; other paths get the build's files.
 * Without a build, `/join` and `/pair` get a small page that hands the link to the Kimo app.
 *
 * The fragment carries the token and the room key and never reaches the relay: browsers do not
 * send it, and nothing here reads or logs it.
 */
import { existsSync, statSync } from "node:fs"
import { join, normalize, sep } from "node:path"

/** Paths that open the app itself. */
const APP_PAGES = new Set(["/", "/join", "/join/", "/pair", "/pair/"])

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const

/** A directory with the web build's `index.html`, or null. */
export function webDirOk(dir: string | null | undefined): string | null {
  if (!dir) return null
  try {
    return statSync(join(dir, "index.html")).isFile() ? dir : null
  } catch {
    return null
  }
}

/**
 * The web build to serve: `KIMO_WEB_DIR` when set (`off` serves none), else the first of
 * `candidates` holding an `index.html`.
 */
export function resolveWebDir(
  env: string | undefined,
  candidates: readonly string[],
): string | null {
  const value = env?.trim()
  if (value === "off") return null
  if (value) return webDirOk(value)
  for (const dir of candidates) if (webDirOk(dir)) return dir
  return null
}

/** The file under `dir` for a URL path, or null when it would leave `dir` or does not exist. */
function fileFor(dir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes("\0")) return null
  const root = normalize(dir + sep)
  const path = normalize(join(root, decoded))
  if (!path.startsWith(root)) return null
  if (!existsSync(path) || !statSync(path).isFile()) return null
  return path
}

/**
 * Answers GET and HEAD for the web app; undefined when the path is not the app's (the caller
 * then reports 404). `dir` null: only the hand-off page for `/join` and `/pair`.
 */
export function webResponse(req: Request, url: URL, dir: string | null): Response | undefined {
  if (req.method !== "GET" && req.method !== "HEAD") return undefined
  if (dir) {
    const path = APP_PAGES.has(url.pathname) ? join(dir, "index.html") : fileFor(dir, url.pathname)
    if (!path) return undefined
    const isHtml = path.endsWith(".html")
    return new Response(req.method === "HEAD" ? null : Bun.file(path), {
      headers: isHtml
        ? HTML_HEADERS
        : {
            "x-content-type-options": "nosniff",
            // Vite names built assets by content hash.
            ...(url.pathname.startsWith("/assets/")
              ? { "cache-control": "public, max-age=31536000, immutable" }
              : {}),
          },
    })
  }
  const route = /^\/(join|pair)\/?$/.exec(url.pathname)?.[1]
  if (!route) return undefined
  return new Response(req.method === "HEAD" ? null : handoffPage(route), {
    headers: HTML_HEADERS,
  })
}

/** The fallback page: board 45 B without "Continue in browser" (there is no app to continue in). */
function handoffPage(route: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${route === "pair" ? "Add this device" : "Open in Kimo"}</title>
<style>
:root{color-scheme:light dark;--bg:#f4f3f1;--card:#fff;--line:#e7e5e1;--ink:#0a0a0a;--ink2:#57534e;--ink3:#8a857f;--accent:#0a0a0a;--on:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--card:#161616;--line:#262626;--ink:#f5f5f4;--ink2:#a8a29e;--ink3:#78716c;--accent:#f5f5f4;--on:#0a0a0a}}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font:14px/1.45 Inter,system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{width:360px;max-width:100%;box-sizing:border-box;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 4px 16px rgba(0,0,0,.08);padding:24px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}
h1{margin:0;font-size:15px;font-weight:600;color:var(--ink)}p{margin:0;color:var(--ink2)}
a.btn{display:inline-flex;align-items:center;height:32px;padding:0 14px;border-radius:999px;background:var(--accent);color:var(--on);font-weight:500;text-decoration:none}
small{color:var(--ink3);font-size:12px}small a{color:inherit}
</style>
</head>
<body>
<main>
<h1>${route === "pair" ? "Add this device" : "Open this shared file"}</h1>
<p>This link opens in the Kimo app.</p>
<a class="btn" id="open" href="kimo://${route}">Open in Kimo</a>
<small>No Kimo yet? <a href="https://getkimo.design/" target="_blank" rel="noreferrer">Get Kimo</a></small>
</main>
<script>
var a=document.getElementById("open");a.href="kimo://${route}"+location.hash;location.href=a.href;
</script>
</body>
</html>`
}
