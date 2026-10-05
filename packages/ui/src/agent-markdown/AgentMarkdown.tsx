import { type ComponentPropsWithRef, type MouseEvent, type ReactNode, useMemo } from "react"
import { cx } from "../internal/util"
import { type MdBlock, type MdInline, type MdList, parseMarkdown } from "./parse"

/** Props for {@link AgentMarkdown}. Remaining `<div>` props go to the block stack. */
export interface AgentMarkdownProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** The model's reply (Markdown). Rendered as React elements only, never as HTML. */
  source: string
  /**
   * Opens a link (http, https or mailto only). Default: `window.open(href, "_blank", "noopener")`.
   * The desktop shell passes the system browser opener.
   */
  onOpenLink?: (href: string) => void
}

/**
 * A model reply rendered with the board 33 subset (desing.pen ME2DT › Xt0Hx "Bubble"):
 * blocks stack vertically with gap 8; Paragraph sans 13 / 1.5 text-primary (inherited from the
 * Message/Agent text); Strong 600; Em italic; Inline Code (JetBrains Mono 12, bg-app, radius-xs,
 * padding [0, 4]); Code Block (bg-app, 1px border, radius-sm, padding [8, 10], mono 12 / 1.5);
 * Bullet / Numbered List (gap 4) › Item (gap 6) › Marker (width 14, text-tertiary) + Content
 * (vertical, gap 4) › Nested List (padding-left 20); Link underlined.
 */
export function AgentMarkdown({ source, onOpenLink, className, ...rest }: AgentMarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  const open = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault()
    if (onOpenLink) onOpenLink(href)
    else window.open(href, "_blank", "noopener,noreferrer")
  }
  return (
    <div {...rest} className={cx("kimo-md", className)}>
      {blocks.map((b, i) => renderBlock(b, i, open))}
    </div>
  )
}

type Open = (e: MouseEvent<HTMLAnchorElement>, href: string) => void

function renderBlock(b: MdBlock, key: number, open: Open): ReactNode {
  if (b.t === "p")
    return (
      <p key={key} className="kimo-md__p">
        {renderInlines(b.c, open)}
      </p>
    )
  if (b.t === "code")
    return (
      <pre key={key} className="kimo-md__pre">
        <code>{b.v}</code>
      </pre>
    )
  return renderList(b, key, open, false)
}

function renderList(l: MdList, key: number, open: Open, nested: boolean): ReactNode {
  const Tag = l.ordered ? "ol" : "ul"
  return (
    <Tag
      key={key}
      className={cx("kimo-md__list", nested && "kimo-md__list--nested")}
      {...(l.ordered && l.start !== 1 ? { start: l.start } : {})}
    >
      {l.items.map((it, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static parse output, order is identity
        <li key={i} className="kimo-md__item">
          <span className="kimo-md__marker" aria-hidden="true">
            {l.ordered ? `${l.start + i}.` : "•"}
          </span>
          <div className="kimo-md__content">
            <p className="kimo-md__p">{renderInlines(it.c, open)}</p>
            {it.sub && renderList(it.sub, 1, open, true)}
          </div>
        </li>
      ))}
    </Tag>
  )
}

function renderInlines(c: MdInline[], open: Open): ReactNode[] {
  return c.map((x, i) => {
    switch (x.t) {
      case "text":
        return x.v
      case "br":
        // biome-ignore lint/suspicious/noArrayIndexKey: static parse output
        return <br key={i} />
      case "strong":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: static parse output
          <strong key={i} className="kimo-md__strong">
            {renderInlines(x.c, open)}
          </strong>
        )
      case "em":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: static parse output
          <em key={i} className="kimo-md__em">
            {renderInlines(x.c, open)}
          </em>
        )
      case "code":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: static parse output
          <code key={i} className="kimo-md__code">
            {x.v}
          </code>
        )
      default:
        return (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: static parse output
            key={i}
            className="kimo-md__link"
            href={x.href}
            target="_blank"
            rel="noopener noreferrer"
            title={x.href}
            onClick={(e) => open(e, x.href)}
          >
            {renderInlines(x.c, open)}
          </a>
        )
    }
  })
}
