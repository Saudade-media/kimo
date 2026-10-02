/** Browser entry for the measurement page (scripts/measure-gallery.ts). */
import "@kimo/design-tokens/editor.css"
import "../src/styles.css"
import { createRoot } from "react-dom/client"
import { Gallery } from "../src/index"

const container = document.getElementById("root")
if (!container) throw new Error("#root missing")
const theme = new URLSearchParams(location.search).get("theme")
document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light"
createRoot(container).render(<Gallery />)
