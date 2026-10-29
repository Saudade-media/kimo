/**
 * @kimo/mcp-server — Kimo's agent tool surface (teardown 9.1, 11; ADR 0013): the tool registry
 * (single source for MCP, the built-in agent and the CLI), the result envelope, the typed wire
 * ops, permissions/approvals/activity, the local socket protocol, attach-vs-headless topology,
 * and the host installer.
 *
 * The main entry has no MCP SDK or Node imports. `./server` (MCP SDK) and `./installer`
 * (node:fs) are separate entries.
 */
export {
  CLAIM_TTL_MS,
  type ClaimConflict,
  type ClaimRecord,
  type ClaimRegistry,
  type ClaimView,
  claimsFor,
  type HumanEdit,
  releaseClaims,
} from "@kimo/editor-state"
export * from "./claims"
export * from "./envelope"
export * from "./guides"
export * from "./handlers/index"
export * from "./ops"
export * from "./partial-json"
export * from "./policy"
export * from "./protocol"
export * from "./registry"
export * from "./resources"
export * from "./retry"
export * from "./runtime"
export * from "./schema"
export * from "./stream"
export * from "./target"
export * from "./tools/define"
export * from "./tools/output"
export * from "./tools/read"
export * from "./tools/session"
export * from "./tools/write"
export * from "./topology"
