import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * Vite config for the Kimo editor. The desktop shell (apps/desktop) loads
 * `dist/` in production and the dev server on :5173 in development, so the
 * port is strict and the base is relative.
 */
export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
})
