import { useEffect, useState } from "react"
import type { Route } from "../router"
import { pairLinkFromLocation, pairPath } from "./link"

/**
 * The pairing route of the window, like `useJoinRoute`: a page opened at `/pair#...` shows that
 * link; the URL is then rewritten to the in-app form (`<app>/#/pair/<link>`) so Open Kimo and
 * every other hash route work from the app root.
 */
export function usePairRoute(route: Route, hash: string): Route {
  const [startup] = useState(() => {
    const link = pairLinkFromLocation(location)
    return link === null ? null : { link, hash }
  })
  useEffect(() => {
    if (!startup) return
    history.replaceState(null, "", `${new URL(".", location.href).href}#${pairPath(startup.link)}`)
  }, [startup])
  return startup && hash === startup.hash ? { name: "pair", link: startup.link } : route
}
