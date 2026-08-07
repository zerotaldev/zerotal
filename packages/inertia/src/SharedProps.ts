import { RequestContext } from "@zerotal/core";
import { always } from "./props/PropTypes.ts";
import { registeredShared } from "./share.ts";

/**
 * Data automatically merged into every Inertia page's props.
 * Controllers never need to pass auth or flash — it's always there.
 *
 * `errors` is wrapped in `always()` so it survives partial reloads (the Inertia client always
 * expects an `errors` bag). When the request carries an `X-Inertia-Error-Bag` header, errors are
 * namespaced under that bag. Other shared props (auth/flash/old) are normal props and are therefore
 * subject to partial-reload `only`/`except` filtering, matching Inertia's semantics.
 *
 * @returns The built-in shared props (`auth`, `flash`, `errors`, `old`) merged with anything registered via {@link share}.
 * @internal Called by {@link buildPageObject} to seed every page; app code registers extras via `Inertia.share()`.
 */
export function sharedProps(): Record<string, unknown> {
  const ctx = RequestContext.get();
  // Session may not exist outside HTTP context — use optional chaining
  const session = (
    ctx as unknown as {
      session?: { get<T>(key: string): T | undefined };
    }
  ).session;

  // `user` is set on the context by the auth/session middleware (typed via auth's augment).
  const ctxUser = (ctx as unknown as { user?: unknown }).user;

  const rawErrors = session?.get<Record<string, string>>("errors") ?? {};
  const errorBag = ctx.request.headers.get("X-Inertia-Error-Bag");
  const errors = errorBag ? { [errorBag]: rawErrors } : rawErrors;

  return {
    auth: {
      // Serialize only scalar properties — model instances with un-loaded @hasMany
      // relations will throw RelationNotLoadedError when JSON.stringify tries
      // to access the relation getter. A plain object is always safe to serialize.
      user: ctxUser ? _serializeUser(ctxUser as Record<string | symbol, unknown>) : null,
    },
    flash: {
      success: session?.get<string>("success") ?? null,
      error: session?.get<string>("error") ?? null,
    },
    errors: always(errors),
    old: session?.get<Record<string, unknown>>("old") ?? {},
    // App-registered shared props via Inertia.share(...).
    ...registeredShared(),
  };
}

/**
 * Convert an AuthenticatedUser (which may be a BaseModel instance) into a
 * plain object containing only scalar values. This prevents JSON.stringify
 * from triggering relation property getters that throw when not eager-loaded.
 *
 * @internal
 */
function _serializeUser(user: Record<string | symbol, unknown>): Record<string, unknown> {
  // Prefer the model's own toJSON(). That is the method which honours `static hidden`
  // (password, rememberToken), skips `_`-prefixed internals such as `_original` — the
  // untouched DB row — and applies casts. Walking Object.keys() instead meant every
  // authenticated Inertia response embedded the user's password hash and remember token in the
  // page JSON, where it was also cached in history.state.
  if (typeof user["toJSON"] === "function") {
    const json = (user as { toJSON(): unknown }).toJSON();
    if (json && typeof json === "object") return json as Record<string, unknown>;
  }

  // Fallback for a plain object (a test double, or an app that does not use the ORM).
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(user)) {
    if (key.startsWith("_")) continue;
    try {
      const val = user[key];
      // Skip functions — those are methods, not data.
      if (typeof val === "function") continue;
      out[key] = val;
    } catch {
      // Property getter throws (e.g. un-loaded @hasMany relation) — skip silently
    }
  }
  return out;
}
