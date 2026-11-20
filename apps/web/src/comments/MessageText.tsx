/**
 * Renders message text (docs/spec/comments.md §3) as React nodes from {@link parseMessage}: no
 * HTML is ever injected, and links are http or https only.
 */
import type { ReactNode } from "react"
import { type Block, type Inline, parseMessage } from "./text"

export interface MessageTextProps {
  text: string
  /** Author ids that render as mentions (others show their name as plain text). */
  known?: (id: string) => boolean
  onLink?: (href: string) => void
  className?: string
}

const NBSP = String.fromCharCode(160)

function inline(list: Inline[], p: MessageTextProps, key: string): ReactNode[] {
  return list.map((x, i) => {
    const k = `${key}.${i}`
    switch (x.kind) {
      case "text":
        return x.text
      case "bold":
        return <strong key={k}>{inline(x.children, p, k)}</strong>
      case "italic":
        return <em key={k}>{inline(x.children, p, k)}</em>
      case "strike":
        return <s key={k}>{inline(x.children, p, k)}</s>
      case "link":
        return (
          <a
            key={k}
            href={x.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!p.onLink) return
              e.preventDefault()
              p.onLink(x.href)
            }}
          >
            {inline(x.children, p, k)}
          </a>
        )
      case "mention":
        return p.known && !p.known(x.id) ? (
          `@${x.name}`
        ) : (
          <span key={k} className="comment-mention" data-author={x.id}>
            @{x.name}
          </span>
        )
    }
    return null
  })
}

function block(b: Block, i: number, p: MessageTextProps): ReactNode {
  const body = inline(b.inline, p, String(i))
  if (b.kind === "bullet")
    return (
      <div key={i} className="comment-text__item">
        <span className="comment-text__marker">•</span>
        <span>{body}</span>
      </div>
    )
  if (b.kind === "number")
    return (
      <div key={i} className="comment-text__item">
        <span className="comment-text__marker">{b.n}.</span>
        <span>{body}</span>
      </div>
    )
  return (
    <div key={i} className="comment-text__line">
      {body.length ? body : NBSP}
    </div>
  )
}

export function MessageText(p: MessageTextProps) {
  return (
    <div className={p.className ? `comment-text ${p.className}` : "comment-text"}>
      {parseMessage(p.text).map((b, i) => block(b, i, p))}
    </div>
  )
}
