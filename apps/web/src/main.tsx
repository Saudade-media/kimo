import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "./fonts.css"
import "./app.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { initTheme } from "./lib/theme"

const container = document.getElementById("root")
if (!container) throw new Error("Kimo: #root element missing from index.html")

initTheme()
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
