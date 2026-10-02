/**
 * The app's icon set, keyed by the exact lucide name used in desing.pen. Only the icons the
 * shell needs are imported (tree-shaken). `github` was removed from lucide 1.x (brand icons),
 * so it is defined here from lucide's original path data.
 */
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Circle,
  CloudAlert,
  CloudCheck,
  CloudUpload,
  CodeXml,
  Component,
  Copy,
  createLucideIcon,
  Diamond,
  Download,
  Eye,
  EyeOff,
  Files,
  Folder,
  FolderGit2,
  FolderOpen,
  Frame,
  Globe,
  Group,
  Hexagon,
  History,
  House,
  Image,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  List,
  Lock,
  LockOpen,
  type LucideIcon,
  Maximize,
  Minus,
  Monitor,
  Moon,
  MousePointer2,
  PanelTop,
  PencilLine,
  PenTool,
  Play,
  Plus,
  Presentation,
  RectangleHorizontal,
  Redo2,
  Search,
  Settings,
  Settings2,
  Smartphone,
  Smile,
  Sparkles,
  Spline,
  Square,
  StickyNote,
  Sun,
  SwatchBook,
  Trash2,
  Type,
  Undo2,
  Upload,
  Variable,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"

const Github = createLucideIcon("github", [
  [
    "path",
    {
      d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 3.5c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 10c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",
      key: "tonef",
    },
  ],
  ["path", { d: "M9 18c-4.51 2-5-2-7-2", key: "9comsn" }],
])

const ICONS: Record<string, LucideIcon> = {
  "align-horizontal-justify-center": AlignHorizontalJustifyCenter,
  "align-horizontal-justify-end": AlignHorizontalJustifyEnd,
  "align-horizontal-justify-start": AlignHorizontalJustifyStart,
  "arrow-up": ArrowUp,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  circle: Circle,
  "cloud-alert": CloudAlert,
  "cloud-check": CloudCheck,
  "cloud-upload": CloudUpload,
  "code-xml": CodeXml,
  component: Component,
  copy: Copy,
  diamond: Diamond,
  download: Download,
  eye: Eye,
  "eye-off": EyeOff,
  files: Files,
  folder: Folder,
  "folder-git-2": FolderGit2,
  "folder-open": FolderOpen,
  frame: Frame,
  github: Github,
  globe: Globe,
  group: Group,
  hexagon: Hexagon,
  history: History,
  house: House,
  image: Image,
  layers: Layers,
  "layout-dashboard": LayoutDashboard,
  "layout-grid": LayoutGrid,
  "layout-template": LayoutTemplate,
  list: List,
  lock: Lock,
  "lock-open": LockOpen,
  maximize: Maximize,
  minus: Minus,
  monitor: Monitor,
  moon: Moon,
  "mouse-pointer-2": MousePointer2,
  "panel-top": PanelTop,
  "pencil-line": PencilLine,
  "pen-tool": PenTool,
  play: Play,
  plus: Plus,
  presentation: Presentation,
  "rectangle-horizontal": RectangleHorizontal,
  "redo-2": Redo2,
  search: Search,
  settings: Settings,
  "settings-2": Settings2,
  smartphone: Smartphone,
  smile: Smile,
  sparkles: Sparkles,
  spline: Spline,
  square: Square,
  "sticky-note": StickyNote,
  sun: Sun,
  "swatch-book": SwatchBook,
  "trash-2": Trash2,
  type: Type,
  "undo-2": Undo2,
  upload: Upload,
  variable: Variable,
  x: X,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
}

export interface IconProps {
  /** Exact lucide name (kebab-case). */
  name: string
  /** px; the design node's width/height. Default 16. */
  size?: number
  className?: string
}

/** An icon by lucide name. Stroke 2 (lucide default), colored with `currentColor`. */
export function Icon({ name, size = 16, className }: IconProps) {
  const C = ICONS[name]
  if (!C) {
    if (import.meta.env?.DEV) console.warn(`Icon "${name}" is not registered in lib/icons.tsx`)
    return (
      <span style={{ width: size, height: size, display: "inline-block" }} aria-hidden="true" />
    )
  }
  return <C size={size} className={className} aria-hidden="true" />
}

/** True when `name` is registered. */
export const hasIcon = (name: string) => Object.hasOwn(ICONS, name)
