/**
 * Board 21 "Agents & MCP" (M5) editor + settings surfaces. Mount points only; the shared
 * integration files (Editor, Topbar, RightPanel, LeftPanel, SettingsView) wire them — see
 * INTEGRATION.md.
 */
import "./agents.css"

export { AgentActivityPanel, type AgentActivityPanelProps } from "./ActivityPanel"
export {
  AgentsMcpPane,
  type AgentsMcpPaneProps,
  type AgentsServerControls,
  diffLines,
} from "./AgentsMcpPane"
export { ApprovalPrompt, type ApprovalPromptProps } from "./ApprovalPrompt"
export {
  AgentCanvasLayer,
  type AgentCanvasLayerProps,
  DryRunBar,
  type ProjectedBox,
} from "./CanvasLayer"
export {
  type AgentChipView,
  type AgentHistory,
  type AgentsControllerExt,
  type AgentsOptions,
  type AgentsViewState,
  createAgentsController,
  type PausedInfo,
} from "./controller"
export { useAgentsState } from "./hooks"
export * from "./model"
export { AgentPausedBanner, type AgentPausedBannerProps } from "./PausedBanner"
export {
  AgentPresence,
  type AgentPresenceProps,
  SessionPopover,
  type SessionPopoverProps,
} from "./Presence"
