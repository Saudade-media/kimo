/**
 * AgentMark faces and motion, read from board 24 "Agent Mark & Gaps" (iLW1l) › AgentMark
 * component sheet (ZkIvw) and the mapping table (eqlcN / cfYTc).
 *
 * Eye geometry is a ratio of the mark size S ("one state machine drives all sizes"): marks
 * larger than 12 px scale the 32 px components (AgentMark QofdJ, /32/Listening e3N4E, /32/Thinking
 * FMKZE, /32/Working dmepg, /32/Done ZrFsG, /32/Error Y8jtUr; the 24 px set KMF8p… is exactly
 * 0.75×), marks of 12 px and below scale the 12 px set (ull8K, N0LALv, z8DyZ, ethZq, g6oBbh,
 * wYZIy: flat mesh body, dot eyes).
 */

/** Agent states as the code names them (mapping table "AGENT STATE (code)"). */
export type AgentMarkState =
  /** connected, no turn. Blink every ~6 s. */
  | "idle"
  /** composer focused / user typing. */
  | "listening"
  /** waiting-approval: listening face + a count badge outside the mark. */
  | "waiting"
  /** streaming plan / no ops yet. Glance up-right. */
  | "thinking"
  /** editing / running a tool / ops applied. Narrowed eyes. */
  | "working"
  /** turn committed: arc eyes for 1.6 s, then back to idle. */
  | "done"
  /** user paused: idle face, frozen body. */
  | "paused"
  /** error / denied: slanted eyes, frozen body. */
  | "error"
  /** disconnected: the error mark at 50 % opacity. */
  | "disconnected"

export const AGENT_MARK_STATES: readonly AgentMarkState[] = [
  "idle",
  "listening",
  "waiting",
  "thinking",
  "working",
  "done",
  "paused",
  "error",
  "disconnected",
]

/** The face actually drawn (waiting/paused/disconnected reuse another face). */
export type FaceId = "idle" | "listening" | "thinking" | "working" | "done" | "error"

export function faceOf(state: AgentMarkState): FaceId {
  switch (state) {
    case "waiting":
      return "listening"
    case "paused":
      return "idle"
    case "disconnected":
      return "error"
    default:
      return state
  }
}

/** Shader motion per state (mapping table column "SHADER speed / turb"). */
export interface Motion {
  speed: number
  turbulence: number
}

export function motionOf(state: AgentMarkState): Motion {
  switch (state) {
    case "thinking":
      return { speed: 0.3, turbulence: 0.3 }
    case "working":
      return { speed: 0.55, turbulence: 0.45 }
    case "paused":
      return { speed: 0, turbulence: 0.15 }
    case "error":
    case "disconnected":
      return { speed: 0, turbulence: 0.1 }
    default:
      // idle, listening, waiting; done eases to this over DONE_EASE_MS.
      return { speed: 0.12, turbulence: 0.15 }
  }
}

/** "Arc eyes for 1.6s, then back to Idle." */
export const DONE_FACE_MS = 1600
/** "ease → 0.12 (600ms)". */
export const DONE_EASE_MS = 600
/** "blink every ~6s (eye scaleY 1→0.1→1, 120ms)". */
export const BLINK_EVERY_MS = 6000
export const BLINK_MS = 120
/** `u_soft` 0.6 px (crisp, anti-aliased). */
export const EDGE_SOFT_PX = 0.6

/** One eye in the mark's own coordinates (S × S). */
export type Eye =
  | { kind: "rect"; x: number; y: number; w: number; h: number; r: number }
  /** Upper half ring (ellipse innerRadius 0.5, sweepAngle 180): the "∩" of Done. */
  | { kind: "arc"; x: number; y: number; size: number }
  /** Slanted stroke `M0 10l20-10` in a w × h box, round caps. */
  | { kind: "slash"; x: number; y: number; w: number; h: number; stroke: number }
  | { kind: "dot"; x: number; y: number; d: number }

type Pair = readonly [Eye, Eye]

const rect = (x: number, y: number, w: number, h: number, r: number): Eye => ({
  kind: "rect",
  x,
  y,
  w,
  h,
  r,
})
const dot = (x: number, y: number, d: number): Eye => ({ kind: "dot", x, y, d })

/** 32 px components, exact node values. */
const FACES_32: Record<FaceId, Pair> = {
  // AgentMark QofdJ: Eye L F6TCU / Eye R Zw3Oq
  idle: [rect(9.92, 11.2, 3.84, 7.68, 1.92), rect(18.24, 11.2, 3.84, 7.68, 1.92)],
  // e3N4E: h3MZG / J8r84
  listening: [rect(9.44, 10.24, 4.8, 9.6, 2.4), rect(17.76, 10.24, 4.8, 9.6, 2.4)],
  // FMKZE: AfQbf / CDB3s (glance up-right)
  thinking: [rect(11.84, 9.28, 3.84, 6.4, 1.92), rect(20.16, 9.28, 3.84, 6.4, 1.92)],
  // dmepg: B8prz / xqtb7 (narrowed)
  working: [rect(9.12, 14, 5.44, 2.08, 1.04), rect(17.44, 14, 5.44, 2.08, 1.04)],
  // ZrFsG: mVK34 / WjjDk ellipses 6.4, innerRadius 0.5, sweep 180
  done: [
    { kind: "arc", x: 8.64, y: 13.12, size: 6.4 },
    { kind: "arc", x: 16.96, y: 13.12, size: 6.4 },
  ],
  // Y8jtUr: wI9SW / y7sp4 path M0 10l20-10, 5.44 × 2.24, stroke 1.92 round
  error: [
    { kind: "slash", x: 9.12, y: 13.92, w: 5.44, h: 2.24, stroke: 1.92 },
    { kind: "slash", x: 17.44, y: 13.92, w: 5.44, h: 2.24, stroke: 1.92 },
  ],
}

/** 12 px components (flat mesh body, dot eyes), exact node values. */
const FACES_12: Record<FaceId, Pair> = {
  idle: [dot(2.75, 4.25, 2.5), dot(6.75, 4.25, 2.5)], // ull8K tr6Rv / rGIFz
  listening: [dot(2.5, 3.75, 3), dot(6.5, 3.75, 3)], // N0LALv PMUnZ / lxXNa
  thinking: [dot(3.6, 3.1, 2.25), dot(7.4, 3.1, 2.25)], // z8DyZ m3miO4 / XYyaw
  working: [rect(2.5, 5, 3, 1.5, 0.75), rect(6.5, 5, 3, 1.5, 0.75)], // ethZq AuC7y / f5rkOE
  done: [dot(2.75, 5, 2.5), dot(6.75, 5, 2.5)], // g6oBbh ttCPn / BPG5w
  error: [dot(2.75, 4.75, 2.5), dot(6.75, 4.75, 2.5)], // wYZIy r9Se7 / M6Aba
}

/** ≤ 12 px uses the 12 px set (static mesh body, dot eyes). */
export const SMALL_MARK_MAX = 12

function scaleEye(e: Eye, k: number): Eye {
  switch (e.kind) {
    case "rect":
      return rect(e.x * k, e.y * k, e.w * k, e.h * k, e.r * k)
    case "arc":
      return { kind: "arc", x: e.x * k, y: e.y * k, size: e.size * k }
    case "slash":
      return { kind: "slash", x: e.x * k, y: e.y * k, w: e.w * k, h: e.h * k, stroke: e.stroke * k }
    case "dot":
      return dot(e.x * k, e.y * k, e.d * k)
  }
}

/** Both eyes of `face` for a mark of `size` px. */
export function eyesFor(face: FaceId, size: number): [Eye, Eye] {
  const small = size <= SMALL_MARK_MAX
  const base = small ? FACES_12[face] : FACES_32[face]
  const k = size / (small ? 12 : 32)
  return [scaleEye(base[0], k), scaleEye(base[1], k)]
}

/** SVG path of one eye (all faces are filled shapes except the slash, which is stroked). */
export function eyePath(e: Eye): string {
  const n = (v: number) => Math.round(v * 1000) / 1000
  switch (e.kind) {
    case "rect": {
      const r = Math.min(e.r, e.w / 2, e.h / 2)
      const x2 = e.x + e.w
      const y2 = e.y + e.h
      return [
        `M${n(e.x + r)} ${n(e.y)}H${n(x2 - r)}`,
        `A${n(r)} ${n(r)} 0 0 1 ${n(x2)} ${n(e.y + r)}V${n(y2 - r)}`,
        `A${n(r)} ${n(r)} 0 0 1 ${n(x2 - r)} ${n(y2)}H${n(e.x + r)}`,
        `A${n(r)} ${n(r)} 0 0 1 ${n(e.x)} ${n(y2 - r)}V${n(e.y + r)}`,
        `A${n(r)} ${n(r)} 0 0 1 ${n(e.x + r)} ${n(e.y)}Z`,
      ].join("")
    }
    case "dot": {
      const r = e.d / 2
      const cx = e.x + r
      const cy = e.y + r
      return `M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)}Z`
    }
    case "arc": {
      const R = e.size / 2
      const r = R * 0.5
      const cx = e.x + R
      const cy = e.y + R
      return `M${n(cx - R)} ${n(cy)}A${n(R)} ${n(R)} 0 0 1 ${n(cx + R)} ${n(cy)}H${n(cx + r)}A${n(r)} ${n(r)} 0 0 0 ${n(cx - r)} ${n(cy)}Z`
    }
    case "slash":
      return `M${n(e.x)} ${n(e.y + e.h)}L${n(e.x + e.w)} ${n(e.y)}`
  }
}
