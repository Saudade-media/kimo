/**
 * Board 21 "Agents & MCP" (M5) editor + settings surfaces. Mount points only; the shared
 * integration files (Editor, Topbar, RightPanel, LeftPanel, SettingsView) wire them — see
 * INTEGRATION.md.
 */
import "./agents.css"

export { AgentActivityPanel } from "./ActivityPanel"
export { AgentsMcpPane, type AgentsServerControls } from "./AgentsMcpPane"
export { AgentCanvasLayer } from "./CanvasLayer"
export {
  type AgentsControllerExt,
  type AgentsNotice,
  createAgentsController,
} from "./controller"
export * from "./model"
export { AgentPausedBanner } from "./PausedBanner"
export { AgentPresence } from "./Presence"
