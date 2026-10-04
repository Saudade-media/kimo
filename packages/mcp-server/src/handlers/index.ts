/**
 * Real tool handlers (ADR 0013 §12 item 2): `createToolHandlers(host)` implements all 20 tools
 * over any {@link DocumentHost}; `createMemoryDocumentHost` is the runtime-neutral headless host;
 * `createDocumentHost` is the core the desktop document host builds on; `createMcpHostRuntime`
 * adds connections (origin per client session), approvals, activity and presence.
 */
export * from "./activity"
export { type CompileResult, compileWireOps, touchedIds, wirePath } from "./compile"
export * from "./core-host"
export { createToolHandlers } from "./create"
export * from "./host-runtime"
export * from "./importers"
export { ChangeJournal, journalFor } from "./journal"
export * from "./memory-host"
export { computeProblems, type QueryInput, type QueryOutput, runQuery, textOf } from "./query"
export * from "./scene"
export {
  type AgentSummary,
  BUILTIN_STYLES,
  type StylePreset,
  type SvgImporter,
  subtreeDocument,
  type ToolHandlerOptions,
} from "./tools"
export { fileIdOf, normalizePath, pathHash, sha256Hex } from "./util"
