/**
 * Host-aware routing support for `Router.group({ domain })`.
 *
 * A domain pattern like `:tenant.app.com` is compiled into a matcher that both
 * tests a request's host and extracts the dynamic labels as subdomain params,
 * exposed on the request via `ctx.subdomains`.
 */

/** @internal */
export interface CompiledDomain {
  /** The original pattern, e.g. ':tenant.app.com'. */
  source: string;
  regex: RegExp;
  /** Param names in order, e.g. ['tenant']. */
  params: string[];
}

/** Compile a domain pattern into a host matcher. `:label` segments are dynamic. */
export function compileDomain(pattern: string): CompiledDomain {
  const params: string[] = [];
  const body = pattern
    .split(".")
    .map((segment) => {
      if (segment.startsWith(":")) {
        params.push(segment.slice(1));
        return "([^.]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("\\.");
  return { source: pattern, regex: new RegExp(`^${body}$`, "i"), params };
}

/**
 * Match a request host against a compiled domain. The port is ignored.
 * Returns the extracted subdomain params, or `null` when the host doesn't match.
 *
 * @example
 * matchDomain(compileDomain(':tenant.app.com'), 'acme.app.com'); // { tenant: 'acme' }
 * matchDomain(compileDomain(':tenant.app.com'), 'app.com');      // null
 */
export function matchDomain(compiled: CompiledDomain, host: string): Record<string, string> | null {
  const hostname = (host.split(":")[0] ?? "").toLowerCase();
  const match = compiled.regex.exec(hostname);
  if (!match) return null;
  const subdomains: Record<string, string> = {};
  compiled.params.forEach((paramName, index) => {
    subdomains[paramName] = match[index + 1]!;
  });
  return subdomains;
}

// ── Per-request subdomain store ───────────────────────────────────────────────
// Set by the router's host dispatcher, read by HttpContext.subdomains.

const _store = new WeakMap<Request, Record<string, string>>();

/** @internal Record the subdomain params extracted for a request; read via {@link getRequestSubdomains}. */
export function setRequestSubdomains(req: Request, params: Record<string, string>): void {
  _store.set(req, params);
}

/** @internal The subdomain params extracted for a request, or `{}` if none were set. */
export function getRequestSubdomains(req: Request): Record<string, string> {
  return _store.get(req) ?? {};
}
