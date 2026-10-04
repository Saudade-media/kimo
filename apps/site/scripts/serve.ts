/** A static file server for dist (dev server and e2e): directories serve index.html, 404.html otherwise. */
import { existsSync, statSync } from "node:fs"
import { join, normalize } from "node:path"

export function serveDir(dir: string, port = 0) {
  return Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url)
      let p = normalize(join(dir, decodeURIComponent(url.pathname)))
      if (!p.startsWith(dir)) return new Response("forbidden", { status: 403 })
      if (existsSync(p) && statSync(p).isDirectory()) {
        if (!url.pathname.endsWith("/"))
          return Response.redirect(`${url.pathname}/${url.search}`, 301)
        p = join(p, "index.html")
      }
      if (existsSync(p)) return new Response(Bun.file(p))
      return new Response(Bun.file(join(dir, "404.html")), {
        status: 404,
        headers: { "content-type": "text/html" },
      })
    },
  })
}
