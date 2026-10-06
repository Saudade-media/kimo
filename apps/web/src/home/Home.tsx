/**
 * Home (board 06 J3yxNC in the browser, board 16 hnvDX on the desktop host and the memory host
 * that stands in for it in tests), with board 37's sections: Recents (`#/`), All files
 * (`#/all`), a watched folder (`#/folder/<ref>`), Templates (`#/templates`), Design systems
 * (`#/libraries`) and Trash (`#/trash`). The section survives a trip to the editor and back.
 */
import { useEffect } from "react"
import { useRuntime } from "../platform/runtime"
import { type HomeSection, homeSectionPath, rememberHomePath } from "../router"
import { DesktopHomeView } from "./DesktopHomeView"
import "./home.css"
import { WebHomeView } from "./WebHomeView"

export function Home({ section = { kind: "recents" } }: { section?: HomeSection }) {
  const { platform } = useRuntime()
  const path = homeSectionPath(section)
  useEffect(() => rememberHomePath(path), [path])
  return platform.kind === "browser" ? (
    <WebHomeView platform={platform} section={section} />
  ) : (
    <DesktopHomeView platform={platform} section={section} />
  )
}
