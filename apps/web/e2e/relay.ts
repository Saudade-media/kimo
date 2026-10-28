/**
 * A real relay for the share scenarios: `apps/server` on a free local port with a throwaway data
 * directory, as a `bun` child process (the relay is a Bun service; the e2e driver runs under Node).
 * Not a scenario file.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const main = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "server", "src", "main.ts")

export interface Relay {
  /** `http://127.0.0.1:<port>`: what goes in the Share popover's Relay URL field. */
  url: string
  stop(): Promise<void>
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      const port = typeof address === "object" && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

export async function startRelay(): Promise<Relay> {
  const port = await freePort()
  const dataDir = mkdtempSync(join(tmpdir(), "kimo-e2e-relay-"))
  const child: ChildProcess = spawn(process.env.BUN ?? "bun", [main], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      KIMO_DATA_DIR: dataDir,
      KIMO_OWNER_KEY: "",
      KIMO_RESET_OWNER: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((r) => child.once("exit", () => r()))
      child.kill("SIGTERM")
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000)
      await exited
      clearTimeout(timer)
    }
    rmSync(dataDir, { recursive: true, force: true })
  }
  let output = ""
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`relay did not start in 15 s:\n${output}`)),
        15_000,
      )
      const onData = (chunk: Buffer) => {
        output += chunk.toString()
        if (output.includes("listening on")) {
          clearTimeout(timer)
          resolve()
        }
      }
      child.stdout?.on("data", onData)
      child.stderr?.on("data", onData)
      child.once("error", (e) => {
        clearTimeout(timer)
        reject(new Error(`could not run bun for the relay: ${e.message}`))
      })
      child.once("exit", (code) => {
        clearTimeout(timer)
        reject(new Error(`relay exited with code ${code}:\n${output}`))
      })
    })
  } catch (e) {
    await stop()
    throw e
  }
  return { url: `http://127.0.0.1:${port}`, stop }
}
