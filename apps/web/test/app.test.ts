import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { App, DOCS_URL, STATUS } from "../src/App"

describe("placeholder home", () => {
  const html = renderToStaticMarkup(createElement(App))

  test("renders the Kimo wordmark", () => {
    expect(html).toContain(">Kimo</h1>")
  })

  test("shows the M0 status line", () => {
    expect(STATUS).toBe("M0 — foundations")
    expect(html).toContain(STATUS)
  })

  test("links to the docs in a new tab safely", () => {
    expect(html).toContain(`href="${DOCS_URL}"`)
    expect(html).toContain('rel="noreferrer"')
  })
})
