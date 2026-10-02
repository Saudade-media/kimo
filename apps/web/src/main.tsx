import "@kimo/design-tokens/editor.css"
import "./app.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"

const container = document.getElementById("root")
if (!container) throw new Error("Kimo: #root element missing from index.html")

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
