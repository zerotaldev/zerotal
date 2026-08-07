/**
 * Channel name helpers — channel(), privateChannel(), and presenceChannel().
 *
 * @example
 * broadcastOn() {
 *   return [
 *     channel('posts'),             // public  — anyone can subscribe
 *     privateChannel('user.42'),    // private — requires auth
 *     presenceChannel('chat.room'), // presence — tracks members
 *   ];
 * }
 */

/** Public channel — no authentication required. */
export function channel(name: string): string {
  return name;
}

/** Private channel — subscriber must be authenticated. Name is prefixed with `private-`. */
export function privateChannel(name: string): string {
  return name.startsWith("private-") ? name : `private-${name}`;
}

/** Presence channel — tracks who is subscribed. Prefixed with `presence-`. */
export function presenceChannel(name: string): string {
  return name.startsWith("presence-") ? name : `presence-${name}`;
}

/** Returns true if the channel name indicates a private channel. */
export function isPrivateChannel(name: string): boolean {
  return name.startsWith("private-") || name.startsWith("presence-");
}
