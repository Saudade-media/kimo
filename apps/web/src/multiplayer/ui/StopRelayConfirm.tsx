/**
 * Board 42 rule "This computer": the relay stops when Kimo quits, after a confirm when people are
 * connected through it. Shown over the window that runs it; Cancel keeps Kimo open.
 */
import { Dialog, DialogScrim } from "@kimo/ui"
import { createRoot } from "react-dom/client"
import { Icon } from "../../lib/icons"
import "./relay-wizard.css"

/** Who stopping the relay disconnects now: names (up to three), then "and n more". */
export interface DisconnectImpact {
  people: readonly string[]
  more: number
}

function stopRelayDescription(impact: DisconnectImpact): string {
  const count = impact.people.length + impact.more
  const names =
    impact.more > 0
      ? `${impact.people.join(", ")} and ${impact.more} more`
      : impact.people.length > 1
        ? `${impact.people.slice(0, -1).join(", ")} and ${impact.people.at(-1)}`
        : (impact.people[0] ?? "")
  return `The relay on this computer stops with Kimo. ${names} ${
    count === 1 ? "is" : "are"
  } disconnected and can't reach the shared files until you open Kimo again.`
}

/** Resolves true to quit (and stop the relay), false to keep Kimo open. */
export function confirmStopRelay(impact: DisconnectImpact): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (quit: boolean) => {
      root.unmount()
      host.remove()
      resolve(quit)
    }
    root.render(
      <DialogScrim>
        <Dialog
          className="rw-stop-dialog"
          size="sm"
          icon={<Icon name="power" size={16} />}
          title="Quit and stop the relay?"
          description={stopRelayDescription(impact)}
          confirmLabel="Quit"
          onCancel={() => done(false)}
          onConfirm={() => done(true)}
        />
      </DialogScrim>,
    )
  })
}
