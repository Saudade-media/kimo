/**
 * "Banner · View only" (p5lo7, an instance of Banner R6VHG): under the topbar of a View link.
 * Icon `eye`, Title "View only" (sans 12 / 600), Body (sans 12, text-secondary) naming the owner;
 * Secondary / Primary actions and Dismiss are off (`enabled: false` in the instance).
 */
import { Banner } from "@kimo/ui"
import { Icon } from "../lib/icons"
import { roomKeyOf } from "../multiplayer/backend"
import { useCollaborators, useMultiplayer } from "../multiplayer/hooks"
import type { MultiplayerModel } from "../multiplayer/model"
import type { SharedSession } from "../multiplayer/share"

/** The body copy; `owner` is the owner's display name (null until they are seen). */
function viewOnlyBody(owner: string | null): string {
  const who = owner ?? "The owner"
  return `${who} shared this file with view access. Ask ${owner ? "them" : "the owner"} for an edit link to make changes.`
}

function BannerView({ body }: { body: string }) {
  return (
    <Banner
      icon={<Icon name="eye" size={16} />}
      title="View only"
      body={body}
      data-testid="view-only-banner"
    />
  )
}

function OwnerBanner({ model, room }: { model: MultiplayerModel; room: string }) {
  const people = useCollaborators(model, roomKeyOf(room))
  const owner = people.find((p) => p.owner && !p.isYou)
  return <BannerView body={viewOnlyBody(owner ? owner.label : null)} />
}

export function ViewOnlyBanner({ shared }: { shared: SharedSession | null }) {
  const model = useMultiplayer()
  if (!model || !shared) return <BannerView body={viewOnlyBody(null)} />
  return <OwnerBanner model={model} room={shared.room} />
}
