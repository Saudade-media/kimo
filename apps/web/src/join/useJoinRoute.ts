import { useEffect, useState } from "react"
import type { Route } from "../router"
import { joinLinkFromLocation, joinPath } from "./link"

/**
 * The join route of the window (board 41 section 5). A page opened at `/join#...` joins that
 * link; the URL is then rewritten to the in-app form (`<app>/#/join/<link>`) so Back to files
 * and every other hash route work from the app root. Until the hash changes (the user
 * navigates), the startup link stays the route.
 */
export function useJoinRoute(route: Route, hash: string): Route {
  const [startup] = useState(() => {
    const link = joinLinkFromLocation(location)
    return link === null ? null : { link, hash }
  })
  useEffect(() => {
    if (!startup) return
    history.replaceState(null, "", `${new URL(".", location.href).href}#${joinPath(startup.link)}`)
  }, [startup])
  return startup && hash === startup.hash ? { name: "join", link: startup.link } : route
}
