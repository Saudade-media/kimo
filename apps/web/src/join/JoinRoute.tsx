/**
 * The join route (board 41 section 5): opens a link, shows the card while it takes longer than
 * 400 ms (`JoinState.showCard`), then the joined room as an editor session (`RoomEditor`; its
 * Toast names the role, a View link adds the banner and the read-only chrome, section 9).
 * Errors say what happened and what to do next; Try again backs off, Copy details copies the
 * relay, time and error code (never the link: its fragment holds the key).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { RoomEditor } from "../editor/Editor"
import { useJoin, useMultiplayer } from "../multiplayer/hooks"
import type { MultiplayerModel } from "../multiplayer/model"
import { navigate } from "../router"
import { detailsText, errorCard, type JoinActionId, retryDelay } from "./copy"
import { JoinErrorCardView, JoinProgressCard, JoinStage } from "./JoinCard"
import { joinPath } from "./link"

/** Mounted join routes: an unmount that is a StrictMode remount must not leave the room. */
let active = 0

export function JoinRoute({ link }: { link: string }) {
  const model = useMultiplayer()
  if (!model)
    return (
      <JoinStage>
        <p className="not-found__label">Joining is not available here.</p>
      </JoinStage>
    )
  return <JoinFlow model={model} initialLink={link} />
}

function JoinFlow({ model, initialLink }: { model: MultiplayerModel; initialLink: string }) {
  const [link, setLink] = useState(initialLink)
  const state = useJoin(model)
  const startedFor = useRef<string | null>(null)
  const attempts = useRef(0)
  const [waiting, setWaiting] = useState(false)
  const [copied, setCopied] = useState(false)

  // StrictMode runs effects twice: the ref keeps one join per link.
  useEffect(() => {
    if (startedFor.current === link) return
    startedFor.current = link
    void model.join.join(link)
  }, [model, link])

  // Leaving the route (Home, another file or room tab) leaves the room, unless this is a remount
  // (the same room is still the joined one). Another room's tab starts its own join.
  useEffect(() => {
    active++
    return () => {
      active--
      const session = model.join.getState().session
      setTimeout(() => {
        if (active > 0 && model.join.getState().session === session) return
        if (active === 0) model.join.reset()
        if (session) void session.leave().catch(() => undefined)
      }, 0)
    }
  }, [model])

  const onAction = useCallback(
    (id: JoinActionId) => {
      if (id === "open-kimo") navigate("/")
      else if (id === "copy-details") {
        const text = detailsText(model.join.getState(), new Date())
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          })
          .catch(() => undefined)
      } else if (id === "try-again") {
        setWaiting(true)
        const delay = retryDelay(attempts.current++)
        setTimeout(() => {
          setWaiting(false)
          startedFor.current = link
          void model.join.join(link)
        }, delay)
      } else if (id === "paste-link") {
        void navigator.clipboard
          ?.readText()
          .then((text) => {
            if (!text.trim()) return
            history.replaceState(null, "", `#${joinPath(text.trim())}`)
            attempts.current = 0
            setLink(text.trim())
          })
          .catch(() => undefined)
      }
    },
    [model, link],
  )

  if (state.phase === "joined" && state.session) return <RoomEditor shared={state.session} />
  if (state.phase === "error")
    return (
      <JoinStage>
        <JoinErrorCardView
          card={errorCard(state)}
          busy={waiting}
          copied={copied}
          onAction={onAction}
        />
      </JoinStage>
    )
  // Under 400 ms the card never shows (an empty stage, then the editor opens directly).
  return (
    <JoinStage>{state.showCard && <JoinProgressCard state={state} now={Date.now()} />}</JoinStage>
  )
}
