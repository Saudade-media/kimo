import { type ComponentPropsWithRef, useEffect, useLayoutEffect, useRef, useState } from "react"
import { cx, mergeRefs } from "../internal/util"
import {
  type AgentMarkState,
  BLINK_EVERY_MS,
  BLINK_MS,
  DONE_FACE_MS,
  eyePath,
  eyesFor,
  type FaceId,
  faceOf,
  motionOf,
  SMALL_MARK_MAX,
} from "./faces"
import { PERSONA_COLORS, type Persona } from "./persona"
import { type MarkColors, parseColor, type Rgb, registerMark } from "./renderer"

/** Props for {@link AgentMark}. Remaining `<span>` props go to the frame. */
export interface AgentMarkProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /**
   * S in px. Components: 32 (QofdJ…), 24 (KMF8p…), 12 (ull8K…). Instances on the boards: 12
   * (cursor pill, placeholder tag, model chip, dry-run bar), 24 (message row, presence chip),
   * 28 (client row, session rows), 32 (approval prompt, Home heading).
   */
  size?: number
  /** Agent state (board 24 mapping table eqlcN). Default `idle`. */
  state?: AgentMarkState
  /** Persona hue (rule PqjaS). Default `teal`. */
  persona?: Persona
  /**
   * Force the static flat mesh body (AgentMark/32/Static gmdHy): export, snapshot tests. Marks
   * ≤ 12 px and `prefers-reduced-motion` are always static.
   */
  static?: boolean
  /** Inside stroke where the mark sits on a solid fill or overlaps another mark (Mode Summary). */
  ring?: { width: number; color: string }
  /** Accessible name. Omitted: decorative (`aria-hidden`). */
  label?: string
}

/**
 * The agent's identity mark (board 24 "AgentMark", replaces AgentOrb dT6Po). Frame S × S, layout
 * none › Body ellipse (the flat liquid shader, `shaders/agent-liquid.glsl`; flat 3 × 3 mesh at
 * ≤ 12 px / Static / reduced motion) › Eye L, Eye R (flat #FFFFFF; rect / arc / stroke by state).
 * Every mark on screen shares one WebGL context (see `renderer.ts`).
 */
export function AgentMark({
  size = 24,
  state = "idle",
  persona = "teal",
  static: forceStatic = false,
  ring,
  label,
  className,
  style,
  ref,
  ...rest
}: AgentMarkProps) {
  const root = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const small = size <= SMALL_MARK_MAX
  const isStatic = forceStatic || small
  // Done shows arc eyes for 1.6 s, then the idle face.
  const [doneExpired, setDoneExpired] = useState(false)
  useEffect(() => {
    setDoneExpired(false)
    if (state !== "done") return
    const t = setTimeout(() => setDoneExpired(true), DONE_FACE_MS)
    return () => clearTimeout(t)
  }, [state])
  const face: FaceId = state === "done" && doneExpired ? "idle" : faceOf(state)
  // Blink (idle face only, never under reduced motion).
  const [blink, setBlink] = useState(false)
  useEffect(() => {
    if (face !== "idle" || state === "paused") return
    if (typeof window === "undefined") return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    let off: ReturnType<typeof setTimeout> | undefined
    const every = setInterval(() => {
      setBlink(true)
      off = setTimeout(() => setBlink(false), BLINK_MS)
    }, BLINK_EVERY_MS)
    return () => {
      clearInterval(every)
      clearTimeout(off)
    }
  }, [face, state])

  // Live motion for the renderer (read every frame).
  const motionRef = useRef(motionOf(state))
  motionRef.current = motionOf(state)
  const personaRef = useRef(persona)
  personaRef.current = persona
  const reg = useRef<ReturnType<typeof registerMark> | null>(null)
  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    reg.current = registerMark({
      canvas: el,
      size,
      forceStatic: isStatic,
      motion: () => motionRef.current,
      resolveColors: () => resolveColors(root.current, personaRef.current),
    })
    return () => {
      reg.current?.dispose()
      reg.current = null
    }
  }, [size, isStatic])
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-resolve colors when the persona changes.
  useEffect(() => {
    reg.current?.update()
  }, [persona])

  const eyes = eyesFor(face, size)
  const p = PERSONA_COLORS[persona]
  return (
    <span
      {...rest}
      ref={mergeRefs(root, ref)}
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-state={state}
      data-face={face}
      data-persona={persona}
      data-static={isStatic || undefined}
      className={cx("kimo-agent-mark", className)}
      style={{
        width: size,
        height: size,
        ["--kimo-mark-base" as string]: `var(${p.tokens.base})`,
        ["--kimo-mark-second" as string]: `var(${p.tokens.second})`,
        ...(ring
          ? {
              ["--kimo-mark-ring" as string]: `${ring.width}px`,
              ["--kimo-mark-ring-color" as string]: ring.color,
            }
          : null),
        ...style,
      }}
      data-ring={ring ? "" : undefined}
    >
      <canvas ref={canvas} className="kimo-agent-mark__body" />
      <svg
        className="kimo-agent-mark__eyes"
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
        data-blink={blink || undefined}
      >
        {eyes.map((e, i) =>
          e.kind === "slash" ? (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: Eye L / Eye R.
              key={i}
              className="kimo-agent-mark__eye"
              d={eyePath(e)}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={e.stroke}
              strokeLinecap="round"
            />
          ) : (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: Eye L / Eye R.
              key={i}
              className="kimo-agent-mark__eye"
              d={eyePath(e)}
              fill="#FFFFFF"
            />
          ),
        )}
      </svg>
    </span>
  )
}

/** Resolves u_c1..u_c4 for a persona from the element's theme (falls back to light values). */
export function resolveColors(el: Element | null, persona: Persona): MarkColors {
  const p = PERSONA_COLORS[persona]
  const read = (prop: string, fallback: string): Rgb => {
    if (el && typeof getComputedStyle !== "undefined") {
      const v = getComputedStyle(el).getPropertyValue(prop)
      const c = parseColor(v)
      if (c) return c
    }
    return parseColor(fallback) as Rgb
  }
  return {
    c1: parseColor(p.ink) as Rgb,
    c2: read(p.tokens.second, FALLBACK[persona].second),
    c3: read(p.tokens.base, FALLBACK[persona].base),
    c4: parseColor(p.highlight) as Rgb,
  }
}

/** Light values (only used when the token stylesheet is missing). */
const FALLBACK: Record<Persona, { base: string; second: string }> = {
  teal: { base: "#0093A3", second: "#3860BE" },
  iris: { base: "#4F5FE8", second: "#3236B8" },
  violet: { base: "#8B47DE", second: "#5A2BAE" },
  rose: { base: "#D6457F", second: "#A12C68" },
  ember: { base: "#E8652A", second: "#A8331E" },
  moss: { base: "#5E8A2E", second: "#3B5E1C" },
}
