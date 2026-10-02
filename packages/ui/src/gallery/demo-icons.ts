/**
 * Gallery-only icon index for the IconPicker demo: the board 09 icons (`b1gaD`) taken from
 * `lucide-react` (already a dependency), normalised to path data like the renderer's
 * `IconProvider` does. The editor passes the renderer's lazy provider instead.
 */
import {
  ArrowRight,
  Bell,
  Bookmark,
  Calendar,
  Camera,
  Check,
  Cloud,
  Compass,
  File,
  Folder,
  Heart,
  House,
  Image,
  Link,
  Lock,
  type LucideIcon,
  Mail,
  MapPin,
  MessageCircle,
  Moon,
  Music,
  Package,
  Phone,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  Sun,
  Tag,
  Trash2,
  Upload,
  User,
  Video,
  Wifi,
  X,
  Zap,
} from "lucide-react"
import type { IconIndexProvider, IconPickerGlyph } from "../icon-picker/IconPicker"

const ICONS: Record<string, LucideIcon> = {
  star: Star,
  heart: Heart,
  sparkles: Sparkles,
  "arrow-right": ArrowRight,
  check: Check,
  x: X,
  plus: Plus,
  search: Search,
  house: House,
  user: User,
  settings: Settings,
  bell: Bell,
  mail: Mail,
  calendar: Calendar,
  camera: Camera,
  cloud: Cloud,
  folder: Folder,
  file: File,
  image: Image,
  link: Link,
  lock: Lock,
  "map-pin": MapPin,
  "message-circle": MessageCircle,
  moon: Moon,
  music: Music,
  package: Package,
  phone: Phone,
  play: Play,
  send: Send,
  shield: Shield,
  "shopping-bag": ShoppingBag,
  sun: Sun,
  tag: Tag,
  "trash-2": Trash2,
  upload: Upload,
  video: Video,
  wifi: Wifi,
  zap: Zap,
  bookmark: Bookmark,
  compass: Compass,
}

/** "All icons" order of board 09 (the Recent row's icons come first in the catalog). */
const ORDER = Object.keys(ICONS).slice(8)

type Attrs = Record<string, string | number | undefined>
const n = (v: string | number | undefined) => Number(v ?? 0)

/** One SVG element of a lucide icon node as path data. */
export function elementToPath(tag: string, a: Attrs): string | null {
  switch (tag) {
    case "path":
      return String(a.d ?? "")
    case "circle": {
      const [cx, cy, r] = [n(a.cx), n(a.cy), n(a.r)]
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`
    }
    case "ellipse": {
      const [cx, cy, rx, ry] = [n(a.cx), n(a.cy), n(a.rx), n(a.ry)]
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`
    }
    case "rect": {
      const [x, y, w, h] = [n(a.x), n(a.y), n(a.width), n(a.height)]
      const rx = Math.min(n(a.rx ?? a.ry), w / 2)
      const ry = Math.min(n(a.ry ?? a.rx), h / 2)
      if (!rx && !ry) return `M${x} ${y}h${w}v${h}h${-w}z`
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}z`
    }
    case "line":
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`
    case "polyline":
    case "polygon": {
      const pts = String(a.points ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      let d = ""
      for (let i = 0; i + 1 < pts.length; i += 2)
        d += `${i === 0 ? "M" : "L"}${pts[i]} ${pts[i + 1]}`
      return tag === "polygon" ? `${d}z` : d
    }
    default:
      return null
  }
}

/** Reads a lucide-react component's icon node (`createLucideIcon` passes it as `icon`). */
function nodeOf(icon: LucideIcon): [string, Attrs][] {
  const render = (
    icon as unknown as {
      render?: (
        p: object,
        r: null,
      ) => { props: { icon?: { node?: [string, Attrs][] }; iconNode?: [string, Attrs][] } }
    }
  ).render
  const el = render?.({}, null)
  return el?.props.icon?.node ?? el?.props.iconNode ?? []
}

const cache = new Map<string, IconPickerGlyph | null>()
function glyph(name: string): IconPickerGlyph | null {
  if (cache.has(name)) return cache.get(name) ?? null
  const icon = ICONS[name]
  const g: IconPickerGlyph | null = icon
    ? {
        viewBox: [0, 0, 24, 24],
        strokeWidth: 2,
        paths: nodeOf(icon)
          .map(([tag, attrs]) => elementToPath(tag, attrs))
          .filter((d): d is string => !!d)
          .map((d) => ({ d, paint: "stroke" as const })),
      }
    : null
  cache.set(name, g)
  return g
}

/** Demo provider: every library serves the same lucide glyphs (gallery only). */
export const demoIconProvider: IconIndexProvider = {
  catalog: async () => ORDER.map((name) => ({ name })),
  load: async (_set, name) => glyph(name),
  get: (_set, name) => glyph(name),
}

/** Recent row of board 09 (`b1gaD`): star · heart · sparkles · arrow-right · check · x · plus · search. */
export const DEMO_RECENT = Object.keys(ICONS)
  .slice(0, 8)
  .map((name) => ({ set: "lucide", name }))
