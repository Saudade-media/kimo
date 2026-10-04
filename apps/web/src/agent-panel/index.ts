/**
 * M6 Agent tab (board 22 "Built-in Agent (M6)" D0zDSY, board 24 iLW1l). Mount points only; the
 * shared files (Editor, RightPanel) wire them — see INTEGRATION.md. Importing the module loads
 * `agent-panel.css`.
 */
import "./agent-panel.css"

export { AgentPanel, type AgentPanelProps, readImage } from "./AgentPanel"
export { agentCanvasProps } from "./canvas"
export {
  type AgentPanelControllerExt,
  type AgentPanelOptions,
  type AgentPanelViewState,
  type CanvasAgentState,
  createAgentPanelController,
  type ModeAgentRow,
  type ModeRunView,
  markOf,
  messagesFromTurns,
  modeChipLabel,
  type PanelMenu,
  type PlanLogRow,
  pickerGroups,
  type SelectionItem,
  turnMeta,
} from "./controller"
export * from "./format"
export { hasHomeHandoff, peekHomeHandoff, useHomeHandoff } from "./handoff"
export { useAgentPanelState } from "./hooks"
export { createHostTools, type HostTools, type HostToolsOptions } from "./host-tools"
export { ModelMenu, ModeMenu, SkillsMenu } from "./Menus"
export {
  AgentCursorPill,
  ModeSummaryPill,
  OpLogRow,
  PassChip,
  PlanCard,
  RejectedOpPill,
  ReviewCard,
  VariantActions,
} from "./Modes"
export {
  type AgentPanelRuntime,
  createAppAgentRuntime,
  createIndexedDbSessionStore,
  createPlatformAgentRuntime,
  providerFor,
  type UnavailableProvider,
} from "./runtime"
export { SessionList } from "./Sessions"
export {
  createInWindowTools,
  createWindowDocumentHost,
  type InWindowToolsOptions,
  scopedTargets,
  scopeViolations,
  storeScopeTree,
  type ToolHostFactory,
  type ToolHostSpec,
} from "./tools"
