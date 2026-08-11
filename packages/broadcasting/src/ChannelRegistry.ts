// ── Channel authorization registry ────────────────────────────────────────────
//
// Holds the per-pattern channel-authorization callbacks registered in `routes/channels.ts`
// via `Broadcast.channel(...)`. The `/broadcasting/auth` route consults it to decide whether a
// connection may subscribe to a private/presence channel.
//
// Patterns use the framework's file-routing `[param]` placeholder syntax, e.g.
//   Broadcast.channel("orders.[orderId]", (user, orderId) => ...)
// Each `[param]` matches one channel segment (no dots) and is passed to the callback positionally
// after the authenticated user.

/** Member data returned by a presence-channel authorizer. `id` identifies the member. */
export interface PresenceMemberData {
  id: string | number;
  [key: string]: unknown;
}

/**
 * A channel authorization callback.
 * - Private channel: return a boolean (`true` = authorized).
 * - Presence channel: return a member-data object to authorize + publish presence, or
 *   `false`/`null`/`undefined` to deny.
 */
export type ChannelCallback = (
  user: unknown,
  ...params: string[]
) =>
  | boolean
  | PresenceMemberData
  | null
  | undefined
  | Promise<boolean | PresenceMemberData | null | undefined>;

interface CompiledChannel {
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  callback: ChannelCallback;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile a `[param]` pattern into a regex + ordered param names.
 *
 * @internal
 */
export function compileChannelPattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  let regexStr = "^";
  let lastIndex = 0;
  const re = /\[(\w+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern)) !== null) {
    regexStr += escapeRegex(pattern.slice(lastIndex, m.index));
    regexStr += "([^.]+)";
    paramNames.push(m[1]!);
    lastIndex = m.index + m[0].length;
  }
  regexStr += escapeRegex(pattern.slice(lastIndex)) + "$";
  return { regex: new RegExp(regexStr), paramNames };
}

/** Result of authorizing a channel subscription. */
export type AuthorizeResult =
  | { matched: false } // no registered pattern claims this channel
  | { matched: true; result: boolean | PresenceMemberData | null | undefined };

/** @internal */
export class ChannelRegistry {
  private _channels: CompiledChannel[] = [];

  /**
   * Register an authorization callback for a channel pattern.
   *
   * @example
   * registry.register("orders.[orderId]", (user, orderId) => user.id === ownerOf(orderId));
   */
  register(pattern: string, callback: ChannelCallback): void {
    const { regex, paramNames } = compileChannelPattern(pattern);
    this._channels.push({ pattern, regex, paramNames, callback });
  }

  /** Registered channel patterns (for `channel:list` / introspection). */
  all(): { pattern: string; paramNames: string[] }[] {
    return this._channels.map((c) => ({ pattern: c.pattern, paramNames: c.paramNames }));
  }

  /** Remove all registrations (test isolation). */
  clear(): void {
    this._channels = [];
  }

  /**
   * Authorize a subscription. The channel name may carry a `private-`/`presence-` prefix; it is
   * stripped before matching (patterns are registered without the prefix).
   *
   * Returns `{ matched: false }` when no pattern claims the channel (caller should deny), or
   * `{ matched: true, result }` where `result` is the callback's return value.
   */
  async authorize(channelName: string, user: unknown): Promise<AuthorizeResult> {
    const bare = channelName.replace(/^private-/, "").replace(/^presence-/, "");
    for (const ch of this._channels) {
      const match = ch.regex.exec(bare);
      if (!match) continue;
      const params = match.slice(1);
      const result = await ch.callback(user, ...params);
      return { matched: true, result };
    }
    return { matched: false };
  }
}

/** Process-wide registry shared by the `Broadcast` facade and `BroadcastProvider`.
 *
 * @internal
 */
export const channelRegistry = new ChannelRegistry();
