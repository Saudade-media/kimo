/**
 * Persona hues (board 24 § 2 "Persona hue tokens" k2aTF and the assignment rule PqjaS).
 *
 * Shader uniforms per persona: `u_c3 = $agent-<p>`, `u_c2 = $agent-<p>-2` (theme-aware tokens),
 * `u_c1` deep ink and `u_c4` highlight are per-persona literals (shader-only, no tokens). Teal
 * keeps `$agent` / `$agent-2` / `$agent-soft`.
 *
 * Hues are identity only (mark body, split-mode cursor + label, session dot, scope badge, op
 * chips); never success / warning / danger, diff highlights or selection.
 */

export const PERSONAS = ["teal", "iris", "violet", "rose", "ember", "moss"] as const
export type Persona = (typeof PERSONAS)[number]

/** Rotation order for spawned / additional agents (rule 2). */
export const PERSONA_ROTATION: readonly Exclude<Persona, "teal">[] = [
  "iris",
  "violet",
  "rose",
  "ember",
  "moss",
]

export interface PersonaColors {
  /** u_c1 deep ink (literal). */
  ink: string
  /** u_c4 highlight (literal). */
  highlight: string
  /** CSS custom properties of u_c3 / u_c2 / the soft fill. */
  tokens: { base: string; second: string; soft: string }
}

const tok = (p: Persona) =>
  p === "teal"
    ? { base: "--kimo-agent", second: "--kimo-agent-2", soft: "--kimo-agent-soft" }
    : {
        base: `--kimo-agent-${p}`,
        second: `--kimo-agent-${p}-2`,
        soft: `--kimo-agent-${p}-soft`,
      }

/** Literals from AgentMark QofdJ (teal) and AgentMark/<Hue> UZACw, sMeNF, w7NlNK, IfQZQ, CK5YJ. */
export const PERSONA_COLORS: Readonly<Record<Persona, PersonaColors>> = {
  teal: { ink: "#0B1E3A", highlight: "#7FE7EF", tokens: tok("teal") },
  iris: { ink: "#14163F", highlight: "#B9C2FF", tokens: tok("iris") },
  violet: { ink: "#1E0F3A", highlight: "#E2C8FF", tokens: tok("violet") },
  rose: { ink: "#2E0B1E", highlight: "#FFC6DC", tokens: tok("rose") },
  ember: { ink: "#2E1008", highlight: "#FFD2B8", tokens: tok("ember") },
  moss: { ink: "#141F0A", highlight: "#D6EBB0", tokens: tok("moss") },
}

/** `var(--kimo-agent-iris)` etc. for CSS (cursor pills, scope badges, op chips). */
export function personaVar(p: Persona, which: "base" | "second" | "soft" = "base"): string {
  return `var(${PERSONA_COLORS[p].tokens[which]})`
}

/** Display name ("Iris", "Iris 2" for the 7th+ concurrent agent). */
export function personaLabel(p: Persona, round = 1): string {
  const name = p.charAt(0).toUpperCase() + p.slice(1)
  return round > 1 ? `${name} ${round}` : name
}

export interface PersonaSlot {
  persona: Persona
  /** 1 for the first lap, 2 after wrapping past Moss (rule 4: "Iris 2"). */
  round: number
}

/** Reconnects within this window get their old hue back (rule 2). */
export const PERSONA_HOLD_MS = 10 * 60_000

export interface PersonaAgent {
  /** Stable key: the agent origin (`agent:kimo.<s>.<n>`, `mcp:<client>.<session>`). */
  id: string
  /** The lead: the built-in agent, or the first agent attached to the session (rule 1). */
  lead?: boolean
  /** External CLI over MCP (Claude Code, Codex, Gemini): Teal unless Split mode is on (rule 3). */
  external?: boolean
}

/**
 * Persona assignment (rule PqjaS):
 * 1. The lead is Teal.
 * 2. Each spawned / additional agent takes the next free hue Iris → Violet → Rose → Ember → Moss,
 *    held for the session, released on disconnect; reconnects within 10 min get their hue back.
 * 3. External CLIs keep Teal unless Split mode is on; then they join the rotation.
 * 4. 7th+ concurrent agent: wrap to Iris with a numeric suffix (Iris 2).
 * 5. Hue never encodes status.
 */
export class PersonaAllocator {
  private held = new Map<string, PersonaSlot>()
  private released = new Map<string, { slot: PersonaSlot; at: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  /** The slot of `agent`, assigning one if needed. */
  assign(agent: PersonaAgent, opts: { split?: boolean } = {}): PersonaSlot {
    if (agent.lead) return { persona: "teal", round: 1 }
    if (agent.external && !opts.split) return { persona: "teal", round: 1 }
    const have = this.held.get(agent.id)
    if (have) return have
    const back = this.released.get(agent.id)
    this.released.delete(agent.id)
    if (back && this.now() - back.at <= PERSONA_HOLD_MS && this.isFree(back.slot)) {
      this.held.set(agent.id, back.slot)
      return back.slot
    }
    const slot = this.nextFree()
    this.held.set(agent.id, slot)
    return slot
  }

  /** Disconnect: frees the hue (kept for a reconnect within {@link PERSONA_HOLD_MS}). */
  release(id: string): void {
    const slot = this.held.get(id)
    if (!slot) return
    this.held.delete(id)
    this.released.set(id, { slot, at: this.now() })
  }

  /** Current assignments (tests, debugging). */
  snapshot(): Record<string, PersonaSlot> {
    return Object.fromEntries(this.held)
  }

  private isFree(slot: PersonaSlot): boolean {
    for (const s of this.held.values())
      if (s.persona === slot.persona && s.round === slot.round) return false
    return true
  }

  private nextFree(): PersonaSlot {
    for (let round = 1; ; round++)
      for (const persona of PERSONA_ROTATION) {
        const slot = { persona, round }
        if (this.isFree(slot)) return slot
      }
  }
}

/** Pure helper: personas for an ordered agent list (lead first) without hold/reconnect state. */
export function assignPersonas(
  agents: readonly PersonaAgent[],
  opts: { split?: boolean } = {},
): PersonaSlot[] {
  const a = new PersonaAllocator(() => 0)
  return agents.map((x) => a.assign(x, opts))
}
