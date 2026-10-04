/** One emitted file: a path relative to the output folder and its contents. */
export interface ExportFile {
  path: string
  contents: string | Uint8Array
}
