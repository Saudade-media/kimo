/**
 * Public docs entry point linked from the placeholder home.
 * TODO(M0): point at the canonical repository once it is published.
 */
export const DOCS_URL = "https://github.com/kimo-design/kimo/tree/main/docs"

/** Current milestone label shown on the placeholder home. */
export const STATUS = "M0 — foundations"

/**
 * Placeholder home screen for M0. The real Home (board 06 in `desing.pen`)
 * replaces this at M1.
 */
export function App() {
  return (
    <main className="home">
      <h1 className="home__wordmark">Kimo</h1>
      <p className="home__status">{STATUS}</p>
      <a className="home__link" href={DOCS_URL} target="_blank" rel="noreferrer">
        Read the docs
      </a>
    </main>
  )
}
