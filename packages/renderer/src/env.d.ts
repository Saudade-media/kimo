/** Vite asset URL imports (browser entry). */
declare module "*.wasm?url" {
  const url: string
  export default url
}
