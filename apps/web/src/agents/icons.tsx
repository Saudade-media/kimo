/**
 * Lucide icons of board 21 by their exact design names. Imported here (not in lib/icons, which is
 * shared) so the agents surfaces stay self-contained.
 */
import {
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  CircleCheck,
  CirclePause,
  CircleX,
  CodeXml,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  GitCompare,
  History,
  LoaderCircle,
  type LucideIcon,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  Settings2,
  Sparkle,
  Square,
  SquareTerminal,
  Terminal,
  Undo2,
  Unplug,
  X,
} from "lucide-react"

const ICONS: Record<string, LucideIcon> = {
  "arrow-up": ArrowUp,
  "arrow-up-right": ArrowUpRight,
  bot: Bot,
  check: Check,
  "circle-check": CircleCheck,
  "circle-pause": CirclePause,
  "circle-x": CircleX,
  "code-xml": CodeXml,
  copy: Copy,
  download: Download,
  eye: Eye,
  "eye-off": EyeOff,
  "folder-open": FolderOpen,
  "git-compare": GitCompare,
  history: History,
  "loader-circle": LoaderCircle,
  "mouse-pointer-2": MousePointer2,
  pause: Pause,
  play: Play,
  plus: Plus,
  "refresh-cw": RefreshCw,
  "rotate-cw": RotateCw,
  server: Server,
  "settings-2": Settings2,
  sparkle: Sparkle,
  square: Square,
  "square-terminal": SquareTerminal,
  terminal: Terminal,
  "undo-2": Undo2,
  unplug: Unplug,
  x: X,
}

/** A board 21 icon by lucide name; `size` px, colored with currentColor. */
export function AgentIcon({
  name,
  size = 16,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  const C = ICONS[name]
  if (!C) throw new Error(`agents: unknown icon ${name}`)
  return <C width={size} height={size} className={className} aria-hidden="true" data-icon={name} />
}
