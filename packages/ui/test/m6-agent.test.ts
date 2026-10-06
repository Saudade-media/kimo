/** Board 22 components (zJmdL) and board 24 AgentMark (ZkIvw): geometry, personas, render. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  AGENT_LIQUID_GLSL,
  AgentErrorCard,
  AgentMark,
  AgentStatus,
  AgentStep,
  AttachmentChip,
  AttachmentThumb,
  assignPersonas,
  CompactButton,
  ComposerAgent,
  eyePath,
  eyesFor,
  faceOf,
  Message,
  MessageMeta,
  ModeChip,
  ModeOption,
  meshPixels,
  motionOf,
  PERSONA_COLORS,
  PERSONA_HOLD_MS,
  PersonaAllocator,
  parseMarkColor,
  ScopeTag,
  SessionRow,
  SkillRow,
  StepsToggle,
} from "../src/index"

const root = join(import.meta.dir, "../../..")

describe("AgentMark (board 24 ZkIvw)", () => {
  test("the embedded shader is shaders/agent-liquid.glsl verbatim (v2 flat)", () => {
    expect(AGENT_LIQUID_GLSL).toBe(readFileSync(join(root, "shaders/agent-liquid.glsl"), "utf8"))
    expect(AGENT_LIQUID_GLSL).toContain("uniform float u_turbulence")
  })

  test("32 px faces are the node values (QofdJ, e3N4E, FMKZE, dmepg, ZrFsG, Y8jtUr)", () => {
    expect(eyesFor("idle", 32)).toEqual([
      { kind: "rect", x: 9.92, y: 11.2, w: 3.84, h: 7.68, r: 1.92 },
      { kind: "rect", x: 18.24, y: 11.2, w: 3.84, h: 7.68, r: 1.92 },
    ])
    expect(eyesFor("listening", 32)[0]).toEqual({
      kind: "rect",
      x: 9.44,
      y: 10.24,
      w: 4.8,
      h: 9.6,
      r: 2.4,
    })
    expect(eyesFor("thinking", 32)[1]).toMatchObject({ x: 20.16, y: 9.28, h: 6.4 })
    expect(eyesFor("working", 32)[0]).toMatchObject({ x: 9.12, y: 14, w: 5.44, h: 2.08 })
    expect(eyesFor("done", 32)[0]).toEqual({ kind: "arc", x: 8.64, y: 13.12, size: 6.4 })
    expect(eyesFor("error", 32)[1]).toEqual({
      kind: "slash",
      x: 17.44,
      y: 13.92,
      w: 5.44,
      h: 2.24,
      stroke: 1.92,
    })
  })

  test("24 px = 0.75 × 32 (KMF8p tpVnG 7.44, 8.4, 2.88 × 5.76) and 12 px dot eyes (ull8K)", () => {
    const [l] = eyesFor("idle", 24)
    expect(l).toMatchObject({ kind: "rect" })
    if (l?.kind !== "rect") throw new Error("rect")
    expect(l.x).toBeCloseTo(7.44, 6)
    expect(l.y).toBeCloseTo(8.4, 6)
    expect(l.w).toBeCloseTo(2.88, 6)
    expect(l.h).toBeCloseTo(5.76, 6)
    expect(eyesFor("idle", 12)).toEqual([
      { kind: "dot", x: 2.75, y: 4.25, d: 2.5 },
      { kind: "dot", x: 6.75, y: 4.25, d: 2.5 },
    ])
    expect(eyesFor("working", 12)[1]).toEqual({ kind: "rect", x: 6.5, y: 5, w: 3, h: 1.5, r: 0.75 })
    expect(eyesFor("thinking", 12)[0]).toEqual({ kind: "dot", x: 3.6, y: 3.1, d: 2.25 })
  })

  test("mapping table: faces and shader speed / turbulence per state (eqlcN)", () => {
    expect(faceOf("waiting")).toBe("listening")
    expect(faceOf("paused")).toBe("idle")
    expect(faceOf("disconnected")).toBe("error")
    expect(motionOf("idle")).toEqual({ speed: 0.12, turbulence: 0.15 })
    expect(motionOf("listening")).toEqual({ speed: 0.12, turbulence: 0.15 })
    expect(motionOf("thinking")).toEqual({ speed: 0.3, turbulence: 0.3 })
    expect(motionOf("working")).toEqual({ speed: 0.55, turbulence: 0.45 })
    expect(motionOf("paused")).toEqual({ speed: 0, turbulence: 0.15 })
    expect(motionOf("error")).toEqual({ speed: 0, turbulence: 0.1 })
  })

  test("eye paths: done is an upper half ring, error a slash M0 10l20-10", () => {
    const arc = eyePath({ kind: "arc", x: 0, y: 0, size: 4 })
    expect(arc).toBe("M0 2A2 2 0 0 1 4 2H3A1 1 0 0 0 1 2Z")
    expect(eyePath({ kind: "slash", x: 1, y: 2, w: 5, h: 2, stroke: 1 })).toBe("M1 4L6 2")
  })

  test("renders body canvas + two white eyes, state / persona / static data", () => {
    const html = renderToString(h(AgentMark, { size: 24, state: "working", persona: "iris" }))
    expect(html).toContain("kimo-agent-mark")
    expect(html).toContain('data-state="working"')
    expect(html).toContain('data-face="working"')
    expect(html).toContain('data-persona="iris"')
    expect(html).toContain("--kimo-mark-base:var(--kimo-agent-iris)")
    expect(html).toContain("<canvas")
    expect(html.match(/fill="#FFFFFF"/g)?.length).toBe(2)
    expect(renderToString(h(AgentMark, { size: 12 }))).toContain("data-static")
    expect(renderToString(h(AgentMark, { size: 32, state: "error" }))).toContain('stroke="#FFFFFF"')
  })

  test("static 3 × 3 mesh: corners u_c4 / $agent-2 / u_c1, transparent outside the circle", () => {
    const c = {
      c1: parseMarkColor("#0B1E3A") as [number, number, number],
      c2: parseMarkColor("#3860BE") as [number, number, number],
      c3: parseMarkColor("#0093A3") as [number, number, number],
      c4: parseMarkColor("#7FE7EF") as [number, number, number],
    }
    const px = 64
    const d = meshPixels(px, c)
    const at = (x: number, y: number) => Array.from(d.slice((y * px + x) * 4, (y * px + x) * 4 + 4))
    expect(at(0, 0)[3]).toBe(0)
    for (const [i, want] of [0, 147, 163].entries())
      expect(Math.abs((at(32, 32)[i] ?? 0) - want)).toBeLessThanOrEqual(3)
    expect(at(32, 32)[3]).toBe(255)
    // Toward the top-left the highlight dominates, toward the bottom-right the ink.
    const tl = at(14, 14)
    const br = at(50, 50)
    expect((tl[0] ?? 0) + (tl[1] ?? 0)).toBeGreaterThan((br[0] ?? 0) + (br[1] ?? 0))
  })

  test("parseColor reads hex and rgb()", () => {
    expect(parseMarkColor("#FFFFFF")).toEqual([1, 1, 1])
    expect(parseMarkColor(" rgb(0, 0, 255) ")).toEqual([0, 0, 1])
    expect(parseMarkColor("var(--x)")).toBeNull()
  })
})

describe("Persona assignment (board 24 PqjaS)", () => {
  test("lead teal, then Iris → Violet → Rose → Ember → Moss, 7th wraps to Iris 2", () => {
    const slots = assignPersonas([
      { id: "lead", lead: true },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}` })),
    ])
    expect(slots.map((s) => `${s.persona}${s.round > 1 ? s.round : ""}`)).toEqual([
      "teal",
      "iris",
      "violet",
      "rose",
      "ember",
      "moss",
      "iris2",
    ])
  })
  test("external CLIs keep teal unless split; released hue comes back within 10 min", () => {
    let t = 0
    const a = new PersonaAllocator(() => t)
    expect(a.assign({ id: "cc", external: true }).persona).toBe("teal")
    expect(a.assign({ id: "cc", external: true }, { split: true }).persona).toBe("iris")
    expect(a.assign({ id: "x" }).persona).toBe("violet")
    a.release("cc")
    t = PERSONA_HOLD_MS - 1
    expect(a.assign({ id: "cc", external: true }, { split: true }).persona).toBe("iris")
    a.release("x")
    t += PERSONA_HOLD_MS + 1
    expect(a.assign({ id: "y" }).persona).toBe("violet")
    expect(a.assign({ id: "x" }).persona).toBe("rose")
  })
  test("persona literals (UZACw, sMeNF, w7NlNK, IfQZQ, CK5YJ)", () => {
    expect(PERSONA_COLORS.iris).toMatchObject({ ink: "#14163F", highlight: "#B9C2FF" })
    expect(PERSONA_COLORS.moss.tokens).toEqual({
      base: "--kimo-agent-moss",
      second: "--kimo-agent-moss-2",
      soft: "--kimo-agent-moss-soft",
    })
  })
})

describe("Board 22 components (zJmdL)", () => {
  test("messages, steps, meta", () => {
    expect(renderToString(h(Message, { from: "user" }, "Make it warmer"))).toContain(
      "kimo-message--user",
    )
    const agent = renderToString(
      h(Message, { from: "agent", streaming: true, markState: "working" }, "Hi"),
    )
    expect(agent).toContain("kimo-agent-mark")
    expect(agent).toContain('data-state="working"')
    expect(agent).toContain("kimo-message__caret")
    expect(renderToString(h(AgentStep, { status: "failed" }, "Reading"))).toContain(
      "kimo-agent-step--failed",
    )
    const meta = renderToString(
      h(MessageMeta, {
        tokens: "3.1k in · 1.4k out",
        cost: "$0.034",
        duration: "11.2s",
        onRegenerate: () => {},
      }),
    )
    expect(meta).toContain(">$0.034<")
    expect(meta).toContain('aria-label="Regenerate"')
    expect(renderToString(h(MessageMeta, { tokens: "2.8k", streaming: true }))).toContain(
      ">Streaming<",
    )
    expect(renderToString(h(MessageMeta, { tokens: "1k", reveal: "hover" }))).toContain(
      "kimo-msg-meta--reveal-hover",
    )
  })
  test("board 31: AgentStatus and StepsToggle", () => {
    const st = renderToString(
      h(AgentStatus, {
        status: "Building the pricing section",
        elapsed: "0:42",
        steps: "5 steps",
        onFollow: () => {},
      }),
    )
    expect(st).toContain(">Building the pricing section<")
    expect(st).toContain(">0:42<")
    expect(st).toContain("kimo-agent-status__sep")
    expect(st).toContain(">Follow<")
    expect(st).toContain('data-state="working"')
    const bare = renderToString(h(AgentStatus, { status: "Thinking…", elapsed: "0:01" }))
    expect(bare).not.toContain("kimo-agent-status__sep")
    expect(bare).not.toContain("Follow")
    const closed = renderToString(h(StepsToggle, { count: 6, open: false }))
    expect(closed).toContain(">6<!-- --> step<!-- -->s<")
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).not.toContain("failed")
    const failed = renderToString(h(StepsToggle, { count: 1, failed: 1, open: true }))
    expect(failed).toContain("kimo-steps-toggle--open")
    expect(failed).toContain("1<!-- --> failed")
  })
  test("chips, thumbs, mode chip / option, scope tag, rows, error card, composer", () => {
    expect(renderToString(h(AttachmentChip, { label: "Hero", onRemove: () => {} }))).toContain(
      'aria-label="Remove Hero"',
    )
    expect(renderToString(h(AttachmentThumb, { name: "a.png", size: 24 }))).toContain(
      "kimo-attach-thumb--24",
    )
    expect(renderToString(h(ModeChip, { mode: "single", label: "Single" }))).toContain(
      "kimo-mode-chip--single",
    )
    expect(
      renderToString(
        h(ModeOption, { mode: "split", name: "Split", description: "d", checked: true }),
      ),
    ).toContain('aria-checked="true"')
    expect(
      renderToString(h(ScopeTag, { label: "Agent 1 · only inside Hero", persona: "iris" })),
    ).toContain("--kimo-scope-fill:var(--kimo-agent-iris)")
    expect(
      renderToString(h(SessionRow, { title: "T", time: "now", meta: "m", current: true })),
    ).toContain("kimo-session-row--current")
    expect(
      renderToString(h(SkillRow, { name: "kimo-design", source: "s", enabled: true })),
    ).toContain('aria-checked="true"')
    const card = renderToString(
      h(AgentErrorCard, {
        kind: "rate_limit",
        title: "Rate limited",
        description: "d",
        actions: [
          { id: "switch_model", label: "Switch to Haiku 4.5" },
          { id: "stop", label: "Stop" },
        ],
      }),
    )
    expect(card).toContain("kimo-error-card--warning")
    expect(card).toContain("kimo-button--secondary")
    expect(card).toContain("kimo-button--ghost")
    expect(renderToString(h(CompactButton, { height: 26, padX: 10 }, "x"))).toContain(
      "--kimo-compact-h:26px",
    )
    const composer = renderToString(
      h(ComposerAgent, {
        value: "",
        model: { label: "Opus 5.5" },
        action: "stop",
        more: { dot: "warning" },
      }),
    )
    expect(composer).toContain('aria-label="Stop"')
    expect(composer).toContain(">Opus 5.5<")
    // Board 40: Skills left the bar for the "…" menu; the dot marks auto-approve on.
    expect(composer).toContain('data-testid="agent-more"')
    expect(composer).toContain('data-dot="warning"')
  })
  test("styles.css imports every M6 stylesheet", () => {
    const styles = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8")
    for (const f of [
      "AgentMark",
      "MessageMeta",
      "AttachmentChip",
      "AttachmentThumb",
      "CompactButton",
      "ModeChip",
      "ModeOption",
      "ScopeTag",
      "SkillRow",
      "SessionRow",
      "AgentErrorCard",
      "ComposerAgent",
    ])
      expect(styles).toContain(`/${f}.css"`)
  })
})
