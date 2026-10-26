/** Entry point: `bun apps/server/src/main.ts`. Configuration comes from the environment (README). */
import { join } from "node:path"
import { createServer, loadConfig, loadOwnerPolicy, type OwnerPolicyModule } from "./index"
import { resolveWebDir } from "./web"

let config: ReturnType<typeof loadConfig>
let ownerPolicy: OwnerPolicyModule | undefined
try {
  config = {
    ...loadConfig(process.env),
    // Board 45: the bundled relay carries the build in `web/`; from source, apps/web/dist.
    webDir: resolveWebDir(process.env.KIMO_WEB_DIR, [
      join(import.meta.dir, "web"),
      join(import.meta.dir, "..", "..", "web", "dist"),
    ]),
  }
  if (config.ownerPolicyModule) ownerPolicy = await loadOwnerPolicy(config.ownerPolicyModule)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const server = createServer({
  port: config.port,
  hostname: config.hostname,
  config,
  log: (line) => console.log(line),
  ...(ownerPolicy ? { ownerPolicy } : {}),
})
console.log(
  `@kimo/server listening on ${server.url.href} (data: ${config.dataDir}, web: ${config.webDir ?? "hand-off page only"})`,
)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.stop(true).then(() => process.exit(0))
  })
}
