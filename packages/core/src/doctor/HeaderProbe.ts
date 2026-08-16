/**
 * Read a deployed app's security headers from the outside, and report the ones
 * that arrive twice.
 *
 * A header the app sets and the proxy also sets is invisible from inside the
 * process: the app's own view is the value it wrote, and the app is right about
 * that. Only a request that has been through the proxy sees both. Deploying
 * zerotal.dev turned up exactly that — `X-Frame-Options: DENY` from the proxy
 * and `SAMEORIGIN` from the app, on the same response — and browsers do not
 * agree on which one wins. A security control that applies inconsistently is
 * worse than one that is simply absent, because it looks configured.
 *
 * ## How a duplicate is visible at all
 *
 * `fetch` folds repeated headers into one comma-joined value, so
 * `X-Frame-Options` sent twice reads back as `"DENY, SAMEORIGIN"`. For headers
 * whose grammar has no comma in it that is unambiguous evidence of a duplicate.
 * For `Permissions-Policy` and `Referrer-Policy` it is not — a comma is
 * legitimate syntax there — so those are deliberately not checked. A probe that
 * cried wolf on a correct `Permissions-Policy` would be switched off within a
 * week, and then it would not catch the `X-Frame-Options` either.
 */

/** One header's finding. */
export interface HeaderProbeResult {
  /** The URL that was read. */
  url: string;
  /** The header, in the casing it is conventionally written. */
  header: string;
  /** The distinct values received, in the order sent. */
  values: string[];
  /** False when this needs attention. */
  ok: boolean;
  /** Whether the duplicated values disagree — the case browsers handle inconsistently. */
  conflicting: boolean;
  message: string;
  fix?: string;
}

/**
 * Headers that take exactly one value, so a comma in the received value means
 * the header was sent more than once.
 *
 * `Permissions-Policy`, `Referrer-Policy` and `Accept-CH` are absent on purpose:
 * each takes a comma-separated list, so duplication is undetectable this way.
 */
const SINGLE_VALUE_HEADERS: Record<string, string> = {
  "x-frame-options": "X-Frame-Options",
  "x-content-type-options": "X-Content-Type-Options",
  "strict-transport-security": "Strict-Transport-Security",
  "cross-origin-opener-policy": "Cross-Origin-Opener-Policy",
  "cross-origin-resource-policy": "Cross-Origin-Resource-Policy",
  "cross-origin-embedder-policy": "Cross-Origin-Embedder-Policy",
  "x-xss-protection": "X-XSS-Protection",
};

/**
 * CSP is its own case: a comma separates *whole policies*, and a browser
 * enforces every one of them — the effective policy is their intersection. Two
 * policies that were each written to be sufficient usually intersect into
 * something that blocks the page.
 */
const CSP_HEADERS: Record<string, string> = {
  "content-security-policy": "Content-Security-Policy",
  "content-security-policy-report-only": "Content-Security-Policy-Report-Only",
};

/** Split a folded header value into the values that were actually sent. */
export function splitFolded(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Inspect a set of response headers for duplicates.
 *
 * Exported separately from {@link probeHeaders} so the analysis can be tested
 * without a network round-trip — the fetch is the only part that needs one.
 */
export function analyseHeaders(url: string, headers: Headers): HeaderProbeResult[] {
  const findings: HeaderProbeResult[] = [];

  for (const [key, label] of Object.entries(SINGLE_VALUE_HEADERS)) {
    const raw = headers.get(key);
    if (raw === null) continue;
    const values = splitFolded(raw);
    if (values.length < 2) continue;

    const distinct = [...new Set(values.map((value) => value.toLowerCase()))];
    if (distinct.length > 1) {
      findings.push({
        url,
        header: label,
        values,
        ok: false,
        conflicting: true,
        message:
          `sent ${values.length} times with different values (${values.join(" / ")}). ` +
          `Browsers do not agree on which one applies, so this control is enforced ` +
          `inconsistently across your visitors.`,
        fix:
          `Set ${label} in exactly one place — either the app (config/app.ts → ` +
          `app.secureHeaders) or the proxy — and remove the other.`,
      });
      continue;
    }

    findings.push({
      url,
      header: label,
      values,
      ok: false,
      conflicting: false,
      message:
        `sent ${values.length} times with the same value (${values[0]}). Harmless today, ` +
        `and a conflict the moment either side is changed without the other.`,
      fix: `Remove the duplicate — keep ${label} in one place.`,
    });
  }

  for (const [key, label] of Object.entries(CSP_HEADERS)) {
    const raw = headers.get(key);
    if (raw === null) continue;
    // A comma inside a policy is not valid in the directives apps actually use,
    // so one here means a second policy was appended.
    const policies = splitFolded(raw);
    if (policies.length < 2) continue;

    findings.push({
      url,
      header: label,
      values: policies,
      ok: false,
      conflicting: true,
      message:
        `${policies.length} separate policies were sent. A browser enforces all of them at ` +
        `once, so the policy in force is their intersection — usually stricter than either ` +
        `author intended, and a page that breaks for no visible reason.`,
      fix: `Send one ${label}, from the app or the proxy but not both.`,
    });
  }

  return findings;
}

/**
 * Fetch `url` and report every duplicated security header on the response.
 *
 * Returns an empty array when the request fails: an unreachable URL is the
 * transport probe's finding to make, and reporting it twice would be noise.
 */
export async function probeHeaders(url: string): Promise<HeaderProbeResult[]> {
  let response: Response;
  try {
    // `redirect: "manual"` on purpose: a redirect's own headers are what the
    // proxy adds, and following it would report the destination's instead.
    response = await fetch(url, { method: "GET", redirect: "manual" });
  } catch {
    return [];
  }
  return analyseHeaders(url, response.headers);
}
