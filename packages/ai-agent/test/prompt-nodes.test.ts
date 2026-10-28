import { describe, expect, test } from "bun:test"
import { ProviderError } from "../src/errors"
import { contextNotes, convertNoteToPromptOp, planPromptRun } from "../src/prompt-node"

const providers = [
  {
    id: "anthropic",
    kind: "anthropic" as const,
    label: "Anthropic",
    models: { agent: "claude-opus-5-5", fast: "claude-haiku-4-5-20251001" },
  },
  {
    id: "openai",
    kind: "openai" as const,
    label: "OpenAI",
    models: { agent: "gpt-4.1", fast: "gpt-4.1-mini" },
  },
]

const frames: Record<string, { id: string; box: { x: number; y: number; w: number; h: number } }> =
  { Pricing001: { id: "Pricing001", box: { x: 0, y: 0, w: 1200, h: 800 } } }
const doc = {
  frame: (id: string) => frames[id] ?? null,
  notes: [
    {
      id: "N1",
      content: "Use $brand",
      author: "Gui",
      parent: null,
      box: { x: 100, y: 100, w: 200, h: 100 },
    },
    { id: "N2", content: "elsewhere", parent: null, box: { x: 5000, y: 0, w: 10, h: 10 } },
  ],
  origin: "agent:kimo.s.0",
  now: new Date(0),
}
const def = { provider: "anthropic", model: "claude-opus-5-5" }

describe("prompt nodes", () => {
  test("with a target: scope = target, overlapping notes as context", () => {
    const plan = planPromptRun(
      {
        id: "P1",
        content: "Draft 3 cards",
        model: { provider: "openai", model: "gpt-4.1" },
        target: "Pricing001",
        box: { x: 1300, y: 0, w: 280, h: 100 },
      },
      doc,
      providers,
      def,
    )
    expect(plan.scopeRoots).toEqual(["Pricing001"])
    expect(plan.setup).toEqual([])
    expect(plan.model.provider.id).toBe("openai")
    expect(plan.notes).toEqual([{ author: "Gui", content: "Use $brand" }])
    expect(contextNotes(doc.notes, null)).toEqual([])
  })

  test("without a valid target: a placeholder frame owned by the run", () => {
    const plan = planPromptRun(
      {
        id: "P2",
        name: "Footer prompt",
        content: "Add a footer",
        target: "Gone000001",
        box: { x: 1300, y: 400, w: 280, h: 100 },
      },
      doc,
      providers,
      def,
    )
    expect(plan.scopeRoots).toEqual(["@prompt_target"])
    const ins = plan.setup[0] as unknown as { node: { placeholder: { by: string } } }
    expect(ins.node.placeholder.by).toBe("agent:kimo.s.0")
  })

  test("no key for the prompt's provider fails loudly", () => {
    expect(() =>
      planPromptRun(
        {
          id: "P3",
          content: "x",
          model: { provider: "gemini", model: "gemini-2.5-pro" },
          box: { x: 0, y: 0, w: 1, h: 1 },
        },
        doc,
        providers,
        def,
      ),
    ).toThrow(ProviderError)
  })

  test("converting a note to a prompt keeps its body", () => {
    expect(
      convertNoteToPromptOp({ id: "N1", body: { type: "note", content: "c", author: "Gui" } }, def),
    ).toEqual({
      op: "replace",
      id: "N1",
      node: { type: "prompt", content: "c", author: "Gui", model: def },
    } as never)
  })
})
