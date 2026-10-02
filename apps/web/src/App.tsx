/**
 * App root: hash routing between Home (`#/`), the editor (`#/file/:id`) and the @kimo/ui
 * component gallery (`#/gallery`).
 */
import { Gallery } from "@kimo/ui"
import { Editor } from "./editor/Editor"
import { Home } from "./home/Home"
import { useHash } from "./lib/hooks"
import { useTheme } from "./lib/theme"
import { parseRoute } from "./router"

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
          <Gallery theme={theme} />
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
