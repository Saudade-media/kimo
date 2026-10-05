/**
 * Writing style for everything a model says to the user (status lines and replies), shared by the
 * built-in agent's system prompt, the kimo-design skill and the MCP server instructions. Kept
 * short: it is re-sent with every model call.
 *
 * `aiTellPhrases` is the matching lint: tests run it on canned replies, and it is meant for UI copy
 * checks too. It flags phrasing that reads as machine-written; it does not judge content.
 */

/** The system prompt / skill paragraph. */
export const REPLY_STYLE = `How to write status lines and replies: plain and specific, like a colleague's chat message. Say what changed and where; put layer names in double quotes, exactly as named ("Landing — Desktop"). No openers or closers ("Great question", "I hope this helps", "Let me know if…", "Feel free to…"). Don't narrate your process; mention a check only when it found a problem. No hype words (seamless, robust, leverage, elevate, streamline, comprehensive, vibrant, sleek, effortless), no "not just X but Y", no em-dash asides, no emoji, no filler lists of three. Use plain sentences; a bullet list only for 3 or more parallel items; bold only for names the reader scans for; no headings.`

export type AiTellKind =
  | "opener"
  | "closer"
  | "narration"
  | "hype"
  | "em-dash"
  | "emoji"
  | "not-just"

export interface AiTell {
  kind: AiTellKind
  /** The matched text. */
  match: string
  /** Offset in the input. */
  index: number
}

const HYPE = [
  "seamless(?:ly)?",
  "robust",
  "leverag(?:e|es|ed|ing)",
  "delv(?:e|es|ing)",
  "elevat(?:e|es|ed|ing)",
  "streamlin(?:e|es|ed|ing)",
  "cutting-edge",
  "comprehensive",
  "crucial",
  "vibrant",
  "sleek",
  "effortless(?:ly)?",
  "unlock(?:s|ed|ing)?",
  "empower(?:s|ed|ing)?",
  "game-?changer",
  "stunning",
  "testament",
  "tapestry",
  "in today's",
]

const RULES: readonly (readonly [AiTellKind, RegExp])[] = [
  [
    "opener",
    /(?:^|\n)\s*(?:great question|good question|certainly[!,]|absolutely[!,]|of course[!,]|sure[!,]|i'd be happy to|i'm happy to|happy to help)/gi,
  ],
  [
    "closer",
    /\b(?:i hope (?:this|that) helps|let me know if|feel free to|don't hesitate to|happy to help|hope you like it)\b/gi,
  ],
  [
    "narration",
    /\b(?:i (?:checked|verified|double-checked|confirmed|made sure)\b[^.\n]*|(?:it|the (?:layout|result|design)) looks (?:right|good|great|correct|clean)\b)/gi,
  ],
  ["hype", new RegExp(`\\b(?:${HYPE.join("|")})\\b`, "gi")],
  ["not-just", /\bnot (?:just|only)\b[^.\n]{1,80}?\bbut\b/gi],
  ["emoji", /\p{Extended_Pictographic}/gu],
]

/** Quoted names and code may contain dashes on purpose ("Landing — Desktop"). */
function maskQuoted(text: string): string {
  return text.replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g, (m) => " ".repeat(m.length))
}

/** Phrases that read as AI-written, in order of appearance. Empty when the text is clean. */
export function aiTellPhrases(text: string): AiTell[] {
  const out: AiTell[] = []
  for (const [kind, re] of RULES) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) out.push({ kind, match: m[0].trim(), index: m.index ?? 0 })
  }
  const masked = maskQuoted(text)
  for (const m of masked.matchAll(/—/g))
    out.push({ kind: "em-dash", match: "—", index: m.index ?? 0 })
  return out.sort((a, b) => a.index - b.index)
}
