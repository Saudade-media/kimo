/** Vite asset URL imports (browser entry). */
declare module "*.wasm?url" {
  const url: string
  export default url
}

/** The subset of Vite's `import.meta.glob` the browser entry uses. */
interface ImportMeta {
  glob<T>(
    pattern: string | string[],
    options: { query?: string; import?: string; eager: true },
  ): Record<string, T>
}
