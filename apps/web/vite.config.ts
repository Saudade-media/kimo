import { execFileSync } from "node:child_process"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * The build number in the version string (board 25 §7 "Version string": `Kimo 1.0.0 (412) ·
 * …`): `VITE_KIMO_BUILD` when CI sets it, else the commit count of HEAD, else "dev".
 */
function buildNumber(): string {
  if (process.env.VITE_KIMO_BUILD) return process.env.VITE_KIMO_BUILD
  try {
    return execFileSync("git", ["rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return "dev"
  }
}

/**
 * Vite config for the Kimo editor. The desktop shell (apps/desktop) loads
 * `dist/` in production and the dev server on :5173 in development, so the
 * port is strict and the base is relative.
 */
export default defineConfig({
  plugins: [react()],
  define: { "import.meta.env.VITE_KIMO_BUILD": JSON.stringify(buildNumber()) },
  base: "./",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  // kimo_script's sandbox worker loads QuickJS lazily (code-split): ES module workers.
  worker: { format: "es" },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
})
