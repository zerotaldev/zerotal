/**
 * Whether a request came from the machine the dev server runs on.
 *
 * The dev server listens on every interface, so a phone on the same Wi-Fi can open the app. That
 * is useful for the app and wrong for the developer's own tools: the request inspector holds every
 * query, every signed-in user's email and every mail the app sent, password-reset links included,
 * and in development it asks nobody before handing them over. So the tools answer only the machine
 * itself unless the app says otherwise.
 *
 * Two things are checked, because each covers what the other cannot:
 *
 * - **The socket address.** Another device on the network connects from its own address. Nobody can
 *   write this one.
 * - **The `Host` header.** A page on another site can make the developer's browser talk to the dev
 *   server by pointing its own domain name at `127.0.0.1`. The connection is then local, but the
 *   browser still sends that domain as `Host`. Only loopback names are accepted.
 *
 * @module
 */

/** Hostnames that only ever name this machine. */
function _isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  // An IPv4 loopback address written as IPv6, which is how a dual-stack socket reports it.
  return /^::ffff:127(?:\.\d{1,3}){3}$/.test(host);
}

/** The hostname part of a `Host` header: `localhost:3000` → `localhost`, `[::1]:3000` → `::1`. */
function _hostname(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  // A bare IPv6 address has more than one colon and no port to strip.
  if (trimmed.split(":").length > 2) return trimmed;
  return trimmed.split(":")[0] ?? trimmed;
}

/**
 * Whether `request` came from this machine and names it by a loopback name.
 *
 * @param request - The request. Its `Host` header is read, or its URL's host when it has none.
 * @param peer - The socket address it came from (`ctx.ip()`, or `server.requestIP(req)?.address`).
 *   `null` or `undefined` means none could be read, as in a test that builds a `Request` by hand;
 *   the `Host` check alone then decides.
 * @returns `true` only when both the peer and the host are loopback.
 * @internal
 */
export function _isLocalDevRequest(request: Request, peer?: string | null): boolean {
  if (peer && !_isLoopbackHost(peer)) return false;
  let host = request.headers.get("host");
  if (!host) {
    try {
      host = new URL(request.url).host;
    } catch {
      return false;
    }
  }
  return _isLoopbackHost(_hostname(host));
}
