/** Entry point: `bun apps/server/src/main.ts`. Configuration comes from the environment (README). */
import { createServer, loadConfig, loadOwnerPolicy, type OwnerPolicyModule } from "./index"

let config: ReturnType<typeof loadConfig>
let ownerPolicy: OwnerPolicyModule | undefined
try {
  config = loadConfig(process.env)
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
console.log(`@kimo/server listening on ${server.url.href} (data: ${config.dataDir})`)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.stop(true).then(() => process.exit(0))
  })
}
