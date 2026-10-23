/**
 * Which address a request came from.
 *
 * Several parts of the framework need the answer (the throttles, the audit trail, Flow's
 * connection bookkeeping), and each used to work it out for itself. Three of them read the
 * `X-Forwarded-For` header that the client writes, ahead of or instead of the socket, so the
 * answer was whatever the caller of the request said it was. This is the one rule.
 */
import { config } from "../helpers/config.ts";

/** Where a request's address can be read from. @internal */
export interface ClientAddressSources {
  /**
   * The TCP peer: `ctx.ip()`, or `server.requestIP(request)?.address`. Nobody can write it,
   * and behind a proxy it is the proxy.
   */
  socket?: string | null | undefined;
  /** The `X-Forwarded-For` header, if the request has one. Written by the client and by proxies. */
  forwardedFor?: string | null | undefined;
  /** The `X-Real-IP` header. Only consulted when there is no socket to read. */
  realIp?: string | null | undefined;
}

/**
 * The client's address, given how many proxies of yours sit in front of the app.
 *
 * With none (`undefined` or `0`) `X-Forwarded-For` is not read at all, because the client
 * writes it: the answer is the socket address.
 *
 * With `trustedProxies: n` the header is read from the right. Each proxy appends the address it
 * received the request from, so the last `n` entries were written by your own infrastructure and
 * the `n`-th from the right is the first address a proxy of yours saw: the client. Everything to
 * its left is whatever the client chose to send. One proxy means the last entry; two means the
 * second from the right. A proxy that appends two entries, its peer and its own address, counts
 * twice.
 *
 * A header with fewer entries than `n` means some proxy in the chain does not append, so the
 * count does not describe the deployment; the leftmost entry is then the earliest address anyone
 * recorded. No header at all falls back to the socket.
 *
 * @param sources - What the request offers; see {@link ClientAddressSources}.
 * @param trustedProxies - How many proxies sit in front of the app, if any.
 * @returns The address, or `"unknown"` when the request offers none.
 * @internal
 */
export function _clientAddress(sources: ClientAddressSources, trustedProxies?: number): string {
  const direct = sources.socket ?? sources.realIp ?? "unknown";
  if (trustedProxies === undefined || !(trustedProxies > 0)) return direct;

  const forwarded = sources.forwardedFor;
  if (!forwarded) return direct;

  const addresses = forwarded.split(",").map((entry) => entry.trim());
  const index = addresses.length - Math.floor(trustedProxies);
  const address = index >= 0 ? addresses[index] : addresses[0];
  return address ? address : direct;
}

/**
 * How many proxies the app says sit in front of it: `app.throttle.trustedProxies`, the setting
 * the throttles already read, so one number governs every place that resolves an address.
 *
 * @returns The count, or `undefined` when none is configured.
 * @internal
 */
export function _trustedProxyCount(): number | undefined {
  const count = config.safe("app.throttle", {} as { trustedProxies?: unknown }).trustedProxies;
  // Read as `unknown` on purpose: config is user-written, and a string or a negative number
  // must mean "none", not a header position.
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : undefined;
}
