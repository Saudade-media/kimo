/**
 * A failed action as a Toast/Danger (board 37 `ra5wy`, audit A5): "Couldn't <what>. <cause>."
 * Outside an editor (no M3 controller) the text goes to the console.
 */
import { useCallback, useContext } from "react"
import { failureText } from "./errors"
import { M3Context } from "./m3/controller"

export function useFailureToast(): (what: string, e?: unknown) => void {
  const m3 = useContext(M3Context)
  return useCallback(
    (what, e) => {
      const text = failureText(what, e)
      if (m3) m3.toast({ tone: "danger", text })
      else console.warn(`Kimo: ${text}`)
    },
    [m3],
  )
}

/** Image fill pick / Replace (E6): "Couldn't add the image. <cause>". */
export function useImageError(): (e: unknown) => void {
  const fail = useFailureToast()
  return useCallback((e: unknown) => fail("add the image", e), [fail])
}
