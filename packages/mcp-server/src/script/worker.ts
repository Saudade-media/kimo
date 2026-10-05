/**
 * The kimo_script worker (browser / desktop document host): QuickJS sessions by id. Only the
 * runner talks to it; nothing here touches the document.
 */
/// <reference lib="webworker" />
import variant from "@jitl/quickjs-singlefile-browser-release-sync"
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core"
import type { WorkerReply, WorkerRequest } from "./runner"
import { ScriptSession } from "./session"

let mod: Promise<QuickJSWASMModule> | null = null
const sessions = new Map<number, ScriptSession>()
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  postMessage(m: WorkerReply): void
}

scope.onmessage = async (e) => {
  const m = e.data
  if (m.t === "close") {
    sessions.get(m.sid)?.dispose()
    sessions.delete(m.sid)
    return
  }
  try {
    if (m.t === "open") {
      mod ??= newQuickJSWASMModuleFromVariant(variant)
      sessions.set(m.sid, new ScriptSession(await mod, m.world, m.carry, m.limits, m.page))
      scope.postMessage({ id: m.id, ok: true, value: null })
      return
    }
    const s = sessions.get(m.sid)
    if (!s) throw new Error("The script session is closed.")
    const value = m.t === "run" ? s.run(m.code, m.firstLine) : s.carry(m.names, m.refs)
    scope.postMessage({ id: m.id, ok: true, value })
  } catch (err) {
    scope.postMessage({
      id: m.id,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
