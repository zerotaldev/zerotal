import type { I18nConfigShape } from "./config.ts";

/** Parse an `Accept-Language` header into tags ordered by descending quality. */
export function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: (tag ?? "").trim().toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .filter((x) => x.tag.length > 0)
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}

/** Read a single cookie value from a Cookie header. */
function _cookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) {
      return decodeURIComponent(pair.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Resolve the locale for a request by trying each configured resolver in order.
 * Only returns a locale present in `supportedLocales`; otherwise `defaultLocale`.
 */
export function resolveLocale(request: Request, config: I18nConfigShape): string {
  const supported = config.supportedLocales;
  const ok = (l: string | null | undefined): l is string => !!l && supported.includes(l);

  for (const resolver of config.resolvers) {
    if (resolver === "query") {
      const v = new URL(request.url).searchParams.get(config.queryKey);
      if (ok(v)) return v;
    } else if (resolver === "cookie") {
      const v = _cookie(request.headers.get("cookie"), config.cookieKey);
      if (ok(v)) return v;
    } else if (resolver === "accept-header") {
      for (const tag of parseAcceptLanguage(request.headers.get("accept-language"))) {
        if (supported.includes(tag)) return tag;
        const base = tag.split("-")[0]!; // 'en-US' → 'en'
        if (ok(base)) return base;
      }
    }
  }
  return config.defaultLocale;
}
