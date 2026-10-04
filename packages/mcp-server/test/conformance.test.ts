/** Host conformance for the headless in-memory host (memory platform). */
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createMemoryDocumentHost } from "../src/index"
import { describeHostConformance } from "./conformance"

describeHostConformance("headless memory host", async () => {
  const platform = createMemoryPlatform({ pid: 2000 })
  const host = createMemoryDocumentHost({ platform, autosaveMs: 0 })
  return {
    host,
    handlers: host.runtime.handlers,
    headless: true,
    root: "/work",
    writeFile: async (path, text) => platform.control.writeExternal(path, text),
    readFile: async (path) => platform.control.readFile(path),
    setForeignLease: (path, holder) => platform.control.setForeignLease(path, holder),
    dispose: () => host.dispose(),
  }
})
