/**
 * M6 built-in agent components (board 22 "Built-in Agent (M6)" D0zDSY › Components zJmdL, and
 * board 24 "Agent Mark & Gaps" iLW1l › AgentMark ZkIvw), owned by one builder; re-exported from
 * index.ts.
 */

export {
  AgentErrorCard,
  type AgentErrorCardAction,
  type AgentErrorCardKind,
  type AgentErrorCardProps,
  ERROR_ACTION_ICONS,
  ERROR_CARD_STYLE,
} from "./agent-error-card/AgentErrorCard"
export { AgentMark, type AgentMarkProps, resolveColors } from "./agent-mark/AgentMark"
export {
  AGENT_MARK_STATES,
  type AgentMarkState,
  BLINK_EVERY_MS,
  DONE_EASE_MS,
  DONE_FACE_MS,
  type Eye,
  eyePath,
  eyesFor,
  type FaceId,
  faceOf,
  type Motion,
  motionOf,
  SMALL_MARK_MAX,
} from "./agent-mark/faces"
export {
  assignPersonas,
  PERSONA_COLORS,
  PERSONA_HOLD_MS,
  PERSONA_ROTATION,
  PERSONAS,
  type Persona,
  type PersonaAgent,
  PersonaAllocator,
  type PersonaColors,
  type PersonaSlot,
  personaLabel,
  personaVar,
} from "./agent-mark/persona"
export {
  agentMarkRendererStats,
  invalidateAll as invalidateAgentMarks,
  type MarkColors,
  meshPixels,
  parseColor as parseMarkColor,
} from "./agent-mark/renderer"
export { AGENT_LIQUID_GLSL } from "./agent-mark/shader"
export { AgentStatus, type AgentStatusProps } from "./agent-status/AgentStatus"
export { AttachmentChip, type AttachmentChipProps } from "./attachment-chip/AttachmentChip"
export { AttachmentThumb, type AttachmentThumbProps } from "./attachment-thumb/AttachmentThumb"
export { CompactButton, type CompactButtonProps } from "./compact-button/CompactButton"
export {
  ComposerAgent,
  type ComposerAgentProps,
  type ComposerMoreDot,
  composerMoreDot,
} from "./composer-agent/ComposerAgent"
export { MessageMeta, type MessageMetaProps } from "./message-meta/MessageMeta"
export { type AgentModeId, MODE_ICONS, ModeChip, type ModeChipProps } from "./mode-chip/ModeChip"
export { ModeOption, type ModeOptionProps } from "./mode-option/ModeOption"
export { ScopeTag, type ScopeTagProps } from "./scope-tag/ScopeTag"
export { SessionRow, type SessionRowProps } from "./session-row/SessionRow"
export { SkillRow, type SkillRowProps } from "./skill-row/SkillRow"
export { StepsToggle, type StepsToggleProps } from "./steps-toggle/StepsToggle"
