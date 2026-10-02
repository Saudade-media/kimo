/**
 * App root: hash routing between Home (`#/`), the editor (`#/file/:id`) and the @kimo/ui
 * component gallery (`#/gallery`). The gallery (and its demo boards/icons) is a lazy chunk so
 * it never ships in the editor's main bundle.
 */
import { lazy, Suspense } from "react"
import { Editor } from "./editor/Editor"
import { Home } from "./home/Home"
import { useHash } from "./lib/hooks"
import { useTheme } from "./lib/theme"
import { parseRoute } from "./router"

const Gallery = lazy(() => import("@kimo/ui/gallery").then((m) => ({ default: m.Gallery })))

export function App() {
  const route = parseRoute(useHash())
  const theme = useTheme()
  switch (route.name) {
    case "home":
      return <Home />
    case "file":
      return <Editor key={route.id} fileId={route.id} />
    case "gallery":
      return (
        <div className="gallery-route">
          <Suspense fallback={null}>
            <Gallery theme={theme} />
          </Suspense>
        </div>
      )
    default:
      return (
        <main className="not-found">
          <p className="not-found__label">Nothing at {route.path}</p>
          <a className="not-found__link" href="#/">
            Back to files
          </a>
        </main>
      )
  }
}
