// ── @presence support (server side) ───────────────────────────────────────────
//
// `@presence` props are filled with the live member list of a broadcast presence
// channel. Broadcasting is an OPTIONAL peer: flow does not depend on it, so we
// resolve `Broadcast` through a variable-specifier dynamic import (not type-checked,
// so no hard dependency) and no-op gracefully when it isn't installed.

import type { Component } from "./Component.ts";
import { getPresenceProps, resolvePresenceChannel } from "./decorators.ts";

/**
 * One member of a broadcast presence channel — the shape used to populate a
 * `@presence` prop (the live "who's here" list).
 *
 * Each member carries a required `id` plus whatever additional member data the
 * broadcasting layer attached when the client joined (name, avatar, etc.).
 *
 * @remarks
 * `@presence` props are server-controlled: flow refills them with the current
 * member list before render and on each join/leave, so they are read-only on the
 * client. Presence requires the optional `@zerotal/broadcasting` peer; without
 * it, populating presence is a no-op and props keep their default.
 *
 * @example
 * ```tsx
 * class RoomHeader extends Component {
 *   @locked roomId = "";
 *   @presence((self) => `room.${self.roomId}`)
 *   members: PresenceMember[] = [];
 *
 *   async render() {
 *     return <div>{this.members.length} online</div>;
 *   }
 * }
 * ```
 */
export interface PresenceMember {
  /** Stable identifier for the member, as reported by broadcasting. */
  id: string | number;
  /** Arbitrary extra member data supplied when the client joined the channel. */
  [key: string]: unknown;
}

interface BroadcastFacade {
  getMembers(channel: string): PresenceMember[];
}

let _broadcast: BroadcastFacade | null | undefined;

async function _resolveBroadcast(): Promise<BroadcastFacade | null> {
  if (_broadcast !== undefined) return _broadcast;
  try {
    // Variable specifier → TypeScript doesn't require the module to exist (optional peer).
    const spec = "@zerotal/broadcasting";
    const mod = (await import(spec)) as { Broadcast?: BroadcastFacade };
    _broadcast = mod.Broadcast ?? null;
  } catch {
    _broadcast = null; // broadcasting not installed → presence is a no-op
  }
  return _broadcast;
}

/**
 * Fill every `@presence` prop on `page` with the current member list for its channel.
 * Called before render on the initial GET and on each `$presence` action (join/leave).
 * No-op when the component has no presence props or broadcasting isn't installed.
 */
export async function populatePresence(page: Component): Promise<void> {
  const props = getPresenceProps(page);
  if (props.size === 0) return;
  const Broadcast = await _resolveBroadcast();
  if (!Broadcast) return;
  for (const [prop, channel] of props) {
    const name = resolvePresenceChannel(channel, page);
    try {
      (page as unknown as Record<string, unknown>)[prop] = Broadcast.getMembers(`presence-${name}`);
    } catch {
      /* leave the prop at its default on any lookup error */
    }
  }
}
