/**
 * A static AgentMark (idle face): the same geometry as packages/ui's AgentMark (faces.ts, board
 * 24 ZkIvw) with the body drawn as its CSS read of the shader mesh ($agent[-p] → $agent[-p]-2),
 * which is what the editor shows before the canvas paints. The site never animates it.
 */
import { raw } from "./html"

export type Persona = "teal" | "iris" | "violet" | "rose" | "ember" | "moss"

/** Design component id → persona (AgentMark QofdJ teal, /<Hue> UZACw sMeNF w7NlNK IfQZQ CK5YJ). */
export const MARK_REFS: Record<string, Persona> = {
  QofdJ: "teal",
  gmdHy: "teal",
  ull8K: "teal",
  UZACw: "iris",
  sMeNF: "violet",
  w7NlNK: "rose",
  IfQZQ: "ember",
  CK5YJ: "moss",
}

const tokens = (p: Persona) =>
  p === "teal" ? ["--kimo-agent", "--kimo-agent-2"] : [`--kimo-agent-${p}`, `--kimo-agent-${p}-2`]

/** Idle eyes: 32 px set rect(9.92, 11.2, 3.84 × 7.68, r 1.92); ≤ 12 px set dot(2.75, 4.25, ⌀2.5). */
function eyes(size: number): string {
  if (size <= 12) {
    const k = size / 12
    return [2.75, 6.75]
      .map(
        (x) =>
          `<circle cx="${(x + 1.25) * k}" cy="${(4.25 + 1.25) * k}" r="${1.25 * k}" fill="#FFFFFF"/>`,
      )
      .join("")
  }
  const k = size / 32
  return [9.92, 18.24]
    .map(
      (x) =>
        `<rect x="${x * k}" y="${11.2 * k}" width="${3.84 * k}" height="${7.68 * k}" rx="${1.92 * k}" fill="#FFFFFF"/>`,
    )
    .join("")
}

export function agentMark(size: number, persona: Persona = "teal") {
  const [base, second] = tokens(persona)
  return raw(
    `<span class="agent-mark" style="width:${size}px;height:${size}px;--mark-base:var(${base});--mark-second:var(${second})" aria-hidden="true"><span class="agent-mark__body"></span><svg class="agent-mark__eyes" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${eyes(size)}</svg></span>`,
  )
}
