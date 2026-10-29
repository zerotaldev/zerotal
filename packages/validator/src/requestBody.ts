import type { HttpContext } from "@zerotal/core";

/**
 * The fields `validate()` and `FormRequest` check, read through the request's own body cache.
 *
 * A request body is a stream and can be read once. Reading it straight off `ctx.request` meant
 * the validator and `ctx.body()` each consumed it for the other: a route that awaited
 * `ctx.body()` first had a valid body fail validation as empty, `ctx.body()` after a validation
 * returned `{}`, and a body already read by middleware (a webhook signature check primes the
 * cache from the raw text) was invisible. Going through `ctx.body()` parses once and leaves the
 * raw body cached for every later reader, so `ctx.body()` and `ctx.input()` see what the client
 * sent, not the validated subset.
 *
 * A form keeps its uploads: `ctx.body()` holds only a form's text fields, so `File` entries are
 * added from the same cached `FormData` that `ctx.file()` reads.
 *
 * Returns a copy, so merging the query string for a GET or `prepareForValidation()` changes
 * nothing a later `ctx.body()` returns.
 *
 * A context built by hand in a test, a plain object holding a `request` and none of the
 * context's readers, is read straight off `ctx.request`, as the validator always did: there is
 * no cache on it to share.
 *
 * @internal
 */
export async function _readRequestBody(ctx: HttpContext): Promise<Record<string, unknown>> {
  const readers: { body?: unknown; _parseFormData?: unknown } = ctx;
  if (typeof readers.body !== "function" || typeof readers._parseFormData !== "function") {
    return readUncached(ctx.request);
  }

  const parsed: unknown = await ctx.body();
  const body: Record<string, unknown> =
    parsed !== null && typeof parsed === "object" ? { ...parsed } : {};

  const type = ctx.request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    const form = await ctx._parseFormData();
    form?.forEach((value, key) => {
      if (typeof value !== "string") body[key] = value;
    });
  }

  if (ctx.request.method === "GET") {
    ctx.url.searchParams.forEach((value, key) => {
      body[key] ??= value;
    });
  }

  return body;
}

/**
 * The origin a failed validation redirects back within. A context built by hand in a test may
 * hold only a `request`, with no parsed `url`, so the request's own URL stands in for it.
 *
 * @internal
 */
export function _requestOrigin(ctx: HttpContext): string {
  const { url }: { url?: URL } = ctx;
  return (url ?? new URL(ctx.request.url)).origin;
}

/** The body of a request no context has cached, parsed directly. */
async function readUncached(request: Request): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const parsed: unknown = await request.json();
      if (parsed !== null && typeof parsed === "object") body = { ...parsed };
    } else if (
      type.includes("application/x-www-form-urlencoded") ||
      type.includes("multipart/form-data")
    ) {
      (await request.formData()).forEach((value, key) => {
        body[key] = value;
      });
    }
  } catch {
    body = {};
  }

  if (request.method === "GET") {
    new URL(request.url).searchParams.forEach((value, key) => {
      body[key] ??= value;
    });
  }

  return body;
}
