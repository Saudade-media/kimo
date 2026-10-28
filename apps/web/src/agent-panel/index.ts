/**
 * M6 Agent tab (board 22 "Built-in Agent (M6)" D0zDSY, board 24 iLW1l). Mount points only; the
 * shared files (Editor, RightPanel) wire them — see INTEGRATION.md. Importing the module loads
 * `agent-panel.css`.
 */
import "./agent-panel.css"

export { AgentPanel } from "./AgentPanel"
export { agentCanvasProps } from "./canvas"
export {
  type AgentPanelControllerExt,
  type AgentPanelViewState,
  createAgentPanelController,
} from "./controller"
export * from "./format"
export { hasHomeHandoff, peekHomeHandoff, useHomeHandoff } from "./handoff"
export { createHostTools, rpcToolStream, STREAMED_TOOLS } from "./host-tools"
export { ModeSummaryOverlay } from "./Modes"
export { storeOutline } from "./outline"
export { createPlatformAgentRuntime } from "./runtime"
export { skillsFolderAction } from "./skills-folder"
export { createInWindowTools } from "./tools"
