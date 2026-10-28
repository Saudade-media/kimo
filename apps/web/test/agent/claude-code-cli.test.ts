/**
 * The Claude Code CLI engine behind the Agent tab (ADR 0014 §11): a fake CLI process emits
 * stream-json, the controller turns it into agent events, bills it as a subscription (never
 * dollars) and resumes the CLI session on the next turn.
 */
import { describe, expect, test } from "bun:test"
import type { CliDetection } from "@kimo/ai-agent"
import { createFakeCliHost } from "../../src/agent-panel/testing"
import { setupPanel } from "./helpers"

describe("Claude Code turn", () => {
  test("tool calls become steps, cost stays a subscription, the CLI session is resumed", async () => {
    const envelope = {
      ok: true,
      summary: "Inserted Waitlist Form",
      changed: ["F1"],
      undoToken: "u1",
      ops: [{}],
      doc: { id: "d" },
    }
    const host = createFakeCliHost(() =>
      [
        {
          type: "system",
          subtype: "init",
          session_id: "s-cli",
          mcp_servers: [{ name: "kimo", status: "connected" }],
        },
        {
          type: "stream_event",
          session_id: "s-cli",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Adding the form." },
          },
        },
        {
          type: "assistant",
          session_id: "s-cli",
          message: {
            content: [
              { type: "text", text: "Adding the form." },
              {
                type: "tool_use",
                id: "t1",
                name: "mcp__kimo__kimo_apply_ops",
                input: { label: "Insert Waitlist Form", ops: [] },
              },
            ],
          },
        },
        {
          type: "user",
          session_id: "s-cli",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                content: [{ type: "text", text: JSON.stringify(envelope) }],
              },
            ],
          },
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: "s-cli",
          num_turns: 2,
          total_cost_usd: 0.04,
          usage: { input_tokens: 3100, output_tokens: 1400 },
        },
      ].map((l) => JSON.stringify(l)),
    )
    const clis: CliDetection[] = [
      {
        id: "claude-code",
        label: "Claude Code",
        installed: true,
        path: "/usr/local/bin/claude",
        signedIn: true,
        billing: "subscription",
      },
    ]
    const { c } = setupPanel(() => ({ text: "unused" }), {
      platform: "desktop",
      clis,
      cliHost: host,
      defaultSelection: { provider: "cli:claude-code", model: "default" },
    })
    await c.refresh()
    await c.send("Add a waitlist form")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error("no agent message")
    expect(a.text).toContain("Adding the form.")
    expect(a.steps[0]?.state).toBe("done")
    expect(a.meta?.billing).toBe("subscription")
    expect(a.meta?.costUsd).toBeNull()
    // The CLI may only use Kimo's MCP server.
    expect(host.spawned[0]?.args).toContain("--strict-mcp-config")
    await c.send("More")
    expect(host.spawned[1]?.args.join(" ")).toContain("--resume s-cli")
  })
})
