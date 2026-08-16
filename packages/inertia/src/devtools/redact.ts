/**
 * Redaction — the part of the recorder that decides what never reaches the panel.
 *
 * DevTools entries are readable by anyone who can reach the read API, and they
 * are recorded from live requests, so they would otherwise contain the session
 * cookie, the `Authorization` header, and whatever a login form just posted.
 * Redaction runs before an entry is stored, not when it is served: an entry that
 * was never written cannot leak from a store that is later exposed by mistake.
 *
 * The walk is `redactGraph` from `@zerotal/core/security`; the *markers* below
 * are not ours to choose. `[REDACTED]`, `[Circular]` and `[Max depth]` are what
 * the published protocol specifies, so sharing an implementation with the
 * devtools panel — which spells them `‹redacted›` — means sharing the traversal
 * and nothing else.
 */
import { redactGraph } from "@zerotal/core/security";

/** The marker the protocol uses for a value that was withheld. */
export const REDACTED = "[REDACTED]";

/**
 * Header names always withheld. Compared case-insensitively — HTTP header names
 * are case-insensitive and `Headers` normalises to lower case, but an adapter
 * that only matched the canonical spelling would be one `AUTHORIZATION` away
 * from leaking a bearer token.
 */
export const DEFAULT_REDACTED_HEADERS: readonly string[] = [
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "x-csrf-token",
  "x-xsrf-token",
];

/**
 * Prop and body keys always withheld. Matched as case-insensitive *substrings*
 * so `password`, `password_confirmation`, and `currentPassword` are all caught
 * by one entry — an exact-match list is a list of the spellings someone thought
 * of, and the one that leaks is always the one they did not.
 */
export const DEFAULT_REDACTED_KEYS: readonly string[] = [
  "password",
  "secret",
  "token",
  "authorization",
  "api_key",
  "apikey",
  "credit_card",
  "card_number",
  "cvv",
  "ssn",
  "private_key",
];

/** True when `key` matches any of `patterns` as a case-insensitive substring. */
export function isSensitiveKey(key: string, patterns: readonly string[]): boolean {
  const lower = key.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

/**
 * Copy a `Headers` into a plain object, replacing sensitive values.
 *
 * @param headers - The request or response headers.
 * @param patterns - Header names to withhold, case-insensitive.
 */
export function redactHeaders(
  headers: Headers,
  patterns: readonly string[] = DEFAULT_REDACTED_HEADERS,
): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = isSensitiveKey(key, patterns) ? REDACTED : value;
  });
  return out;
}

/**
 * Deep-copy a value, replacing sensitive keys and summarising things that must
 * not be inlined.
 *
 * Guards three separate hazards, all of which have to be handled before the
 * value is serialised:
 *
 *  - **Sensitive keys** become `[REDACTED]`, at any depth.
 *  - **Cycles** become `"[Circular]"`. A prop bag holding a model with a
 *    back-reference to its parent is ordinary, and `JSON.stringify` throws on it.
 *  - **Files and blobs** become a short summary. A 4 MB upload does not belong
 *    in a debug entry, and `File` does not survive `JSON.stringify` anyway.
 *
 * @param value - Any prop value.
 * @param patterns - Key patterns to withhold.
 */
export function redactValue(
  value: unknown,
  patterns: readonly string[] = DEFAULT_REDACTED_KEYS,
): unknown {
  return redactGraph(value, {
    sensitive: (key) => isSensitiveKey(key, patterns),
    mask: REDACTED,
    circular: "[Circular]",
    tooDeep: "[Max depth]",
    // Bounded rather than unbounded: recording is on the request path, and a
    // pathological object graph should slow nothing down. Thirteen because that
    // is the depth this recorder has always stopped at.
    maxDepth: 13,
    flatten: _summarise,
  });
}

/** Values that must not be inlined, rendered as a one-line summary instead. */
function _summarise(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof File) {
    return `[File: ${value.name}, ${value.size} bytes, ${value.type || "unknown"}]`;
  }
  if (value instanceof Blob) return `[Blob: ${value.size} bytes, ${value.type || "unknown"}]`;
  return undefined;
}
