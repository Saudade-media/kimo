/** Entry point: `bun apps/server/src/main.ts` (reads `PORT`, default 8787). */
import { createServer } from "./index"

const raw = process.env.PORT ?? "8787"
const port = Number.parseInt(raw, 10)
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT: ${raw}`)
  process.exit(1)
}

const server = createServer({ port, hostname: process.env.HOST ?? "127.0.0.1" })
console.log(`@kimo/server (stub) listening on ${server.url.href}`)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.stop().then(() => process.exit(0))
  })
}
