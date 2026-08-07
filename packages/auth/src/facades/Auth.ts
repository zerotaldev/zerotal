import { RequestContext, UnauthorizedError, ForbiddenError, FrameworkEvents } from "@zerotal/core";
import {
  LoginSucceeded,
  LoginFailed,
  LoggedOut,
  PasswordConfirmed,
  OtherDeviceLogout,
} from "../events.ts";
import {
  PASSWORD_CONFIRMED_AT_KEY,
  DEFAULT_PASSWORD_TIMEOUT,
} from "../ConfirmPasswordMiddleware.ts";
import { AUTH_PASSWORD_HASH_KEY } from "../AuthenticateSessionMiddleware.ts";
import {
  TWO_FACTOR_SESSION_KEY,
  TWO_FACTOR_PENDING_KEY,
  TWO_FACTOR_REMEMBER_KEY,
} from "../TwoFactorMiddleware.ts";
import { RequestGuard, requestGuards, type Guard, type RequestGuardResolver } from "../guards.ts";
import type { AuthUser } from "../AuthUser.ts";
import { authUserModel } from "../authUserModel.ts";
import { Hash } from "./Hash.ts";
import {
  mintRememberToken,
  hashRememberToken,
  encodeRememberValue,
  type RememberAction,
} from "../RememberMe.ts";

type SessionLike = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  forget(key: string): void;
  flush?(): void;
  regenerate?(): void;
};

/**
 * Session keys that record a privilege *this identity* earned during *this session* —
 * a completed TOTP challenge, a re-entered password, the password hash the session was
 * authenticated against.
 *
 * `regenerate()` deliberately carries session data across a new id, so without an explicit
 * sweep these outlive both logout and a subsequent login as a different user: on a shared
 * browser, A completing TOTP would leave `two_factor_confirmed` set for whoever logs in
 * next, and `TwoFactorMiddleware` would wave them through. Cleared on every identity
 * change — {@link Auth.login} on the way in, {@link Auth.logout} on the way out.
 */
const PRIVILEGE_SESSION_KEYS = [
  TWO_FACTOR_SESSION_KEY,
  TWO_FACTOR_PENDING_KEY,
  TWO_FACTOR_REMEMBER_KEY,
  PASSWORD_CONFIRMED_AT_KEY,
  AUTH_PASSWORD_HASH_KEY,
] as const;

/** Drop every session-scoped privilege marker. @internal */
function _clearPrivilegeMarkers(session: SessionLike | undefined): void {
  if (!session) return;
  for (const key of PRIVILEGE_SESSION_KEYS) session.forget(key);
}

/**
 * The session hanging off a request context, or `undefined` when `SessionMiddleware` is not
 * active (stateless API routes, console commands, tests).
 *
 * `HttpContext` does not declare `session` — it is contributed by `@zerotal/session`, which
 * `@zerotal/auth` must not depend on — so reaching it needs one structural view. Keeping
 * that view in a single helper is why it is a helper.
 * @internal
 */
function _session(ctx: unknown): SessionLike | undefined {
  return (ctx as { session?: SessionLike } | undefined)?.session;
}

/**
 * The user awaiting a second factor, parked on the context by `PersistUserMiddleware`.
 * Deliberately not `ctx.user`: the request must read as a guest until the factor lands.
 * @internal
 */
function _pendingUser(ctx: unknown): UserModel | undefined {
  return (ctx as { _twoFactorPendingUser?: UserModel } | undefined)?._twoFactorPendingUser;
}

/**
 * True when the user has enrolled *and* confirmed a second factor, so a correct password
 * alone must not produce an authenticated session.
 * @internal
 */
function _requiresTwoFactor(user: unknown): boolean {
  const u = user as Record<string, unknown> | null | undefined;
  if (!u) return false;
  const secret = u["twoFactorSecret"];
  const confirmedAt = u["twoFactorConfirmedAt"];
  return (
    typeof secret === "string" && secret.length > 0 && confirmedAt != null && confirmedAt !== ""
  );
}

/** A user model that can persist a "remember me" token (real ORM models do). */
type Rememberable = {
  setRememberToken?(value: string | null): void;
  save?(): Promise<unknown>;
};

/**
 * Stash a pending remember-cookie action for RememberMeMiddleware to flush.
 * @internal
 */
function _queueRemember(ctx: unknown, action: RememberAction): void {
  (ctx as { _rememberMe?: RememberAction })._rememberMe = action;
}

/** Plain credential bag passed to attempt()/validate()/once(). */
export type Credentials = Record<string, unknown>;

/** Options accepted by login(). */
export interface LoginOptions {
  /** Persist the login beyond the session (advisory — recorded in the session). */
  remember?: boolean;
}

// Minimal structural view of the app's user model used for credential lookup.
interface CredQuery {
  where(column: string, value: unknown): CredQuery;
  first(): Promise<AuthUser | null>;
}
interface QueryableModel {
  query(): CredQuery;
}

/** Find the user matching all non-password credentials, or undefined. */
async function retrieveByCredentials(credentials: Credentials): Promise<AuthUser | undefined> {
  const Model = authUserModel() as unknown as QueryableModel | undefined;
  if (!Model?.query) return undefined;
  // Everything except the password (and the `remember` flag) identifies the user.
  const entries = Object.entries(credentials).filter(
    ([k]) => !/password/i.test(k) && k !== "remember",
  );
  if (entries.length === 0) return undefined;
  let q = Model.query();
  for (const [column, value] of entries) q = q.where(column, value);
  return (await q.first()) ?? undefined;
}

/** Verify the credential bag's password against the user's stored hash. */
async function hasValidPassword(user: AuthUser, credentials: Credentials): Promise<boolean> {
  const plain = credentials["password"];
  const hashed = user.getAuthPassword();
  if (typeof plain !== "string" || plain.length === 0 || !hashed) return false;
  return (await Hash.check(plain, hashed)) as boolean;
}

/**
 * Dummy argon2id hash used to equalise timing when no user matches the
 * credentials. Computed once — the hashed value itself is irrelevant, only the
 * verify cost matters. Prefer {@link warmLoginTiming} at boot so the ~100 ms
 * argon2id hash never lands on the first unknown-user login.
 */
let _timingDummyHash: string | undefined;

/**
 * Precompute the timing-equalisation hash off the request path. Called from
 * `AuthProvider.onBooted()` so the first unknown-user login doesn't pay the
 * one-time ~100 ms argon2id cost (which, on `hashSync`, would block the event
 * loop). Async and best-effort — a failure just leaves the lazy path in place.
 */
export async function warmLoginTiming(): Promise<void> {
  try {
    _timingDummyHash ??= await Bun.password.hash("zerotal-timing-equalizer", {
      algorithm: "argon2id",
    });
  } catch {
    /* best-effort — the lazy path in _preventUserEnumerationTiming still covers it */
  }
}

/**
 * Burn one password-verify's worth of CPU when the user was not found, so
 * "unknown email" and "wrong password" take comparable time (user-enumeration
 * timing defence). Without this, attempt() returns ~100ms
 * faster for unknown emails, letting an attacker enumerate accounts.
 *
 * @internal
 */
async function _preventUserEnumerationTiming(credentials: Credentials): Promise<void> {
  const plain = credentials["password"];
  const candidate = typeof plain === "string" && plain.length > 0 ? plain : "zerotal-dummy";
  try {
    // Falls back to a synchronous hash only if boot-time warming didn't run.
    _timingDummyHash ??= Bun.password.hashSync("zerotal-timing-equalizer", {
      algorithm: "argon2id",
    });
    await Bun.password.verify(candidate, _timingDummyHash);
  } catch {
    /* timing equalisation is best-effort — never break the login path */
  }
}

/**
 * Augmentable interface for the application's concrete user model.
 *
 * By default it is identical to AuthUser. Apps extend it once to make
 * Auth.user() return the fully-typed model:
 *
 * @example
 * // bootstrap/app.ts (or any file imported at boot)
 * import type { User } from '../app/models/User.ts';
 *
 * declare module '@zerotal/auth' {
 *   interface UserModel extends User {}
 * }
 */

export interface UserModel extends AuthUser {}

/**
 * The `Auth` facade — reads and manages the authenticated user for the current
 * request. This is the primary developer surface for session-based authentication.
 *
 * @remarks
 * **The current-request user.** `Auth` is request-scoped: every method reads
 * (or writes) `ctx.user` / the session on the active {@link RequestContext}. The
 * user is populated upstream by {@link PersistUserMiddleware} (registered globally
 * by `AuthProvider`), which reads `user_id` from the session and loads the model.
 * Reads like {@link user}, {@link check}, and {@link id} therefore work anywhere
 * in the request lifecycle without wiring.
 *
 * **Session-based auth.** {@link login} writes the user's auth id to the session
 * so subsequent requests re-authenticate automatically; {@link logout} clears it.
 * To *credential-check* a user, use {@link attempt} (find by credentials + verify
 * password), which logs them in on success.
 *
 * **Session regeneration on login.** {@link login} issues a fresh session id
 * (`session.regenerate()`) before elevating privileges, defending against session
 * fixation — a session id planted pre-auth cannot be reused post-auth.
 *
 * **Remember me.** Passing `remember: true` (via {@link attempt} or {@link login})
 * mints a long-lived token, stores its hash on the user, and queues a persistent
 * cookie that {@link RememberMeMiddleware} uses to re-authenticate after the
 * session expires. {@link viaRemember} reports whether the current request was
 * authenticated that way.
 *
 * **Guards.** The top-level `Auth.*` methods read the default session (`web`)
 * guard. Register additional stateless guards with {@link viaRequest} and reach
 * them via {@link guard}.
 *
 * @example
 * A login controller using {@link attempt} + redirect:
 * ```ts
 * import { Auth } from '@zerotal/auth';
 *
 * export class LoginController {
 *   async store(ctx: HttpContext) {
 *     const { email, password, remember } = ctx.validated();
 *
 *     if (await Auth.attempt({ email, password }, remember)) {
 *       // Fresh session id already issued by Auth.login().
 *       return redirect().intended('/dashboard');
 *     }
 *
 *     return back().withErrors({
 *       email: ['These credentials do not match our records.'],
 *     });
 *   }
 *
 *   async destroy() {
 *     await Auth.logout();
 *     return redirect('/login');
 *   }
 * }
 * ```
 */
export const Auth = {
  /**
   * Returns the authenticated user for the current request.
   *
   * @returns The current user, typed as the app's {@link UserModel}.
   * @throws {UnauthorizedError} when there is no authenticated user (a guest).
   * @category Current user
   */
  user(): UserModel {
    const u = RequestContext.tryGet()?.user;
    if (!u) throw new UnauthorizedError("Not authenticated");
    return u as UserModel;
  },

  /**
   * Returns the authenticated user, or `undefined` when the request is a guest —
   * the non-throwing counterpart to {@link user}.
   *
   * @category Current user
   */
  userOrNull(): UserModel | undefined {
    return RequestContext.tryGet()?.user as UserModel | undefined;
  },

  /**
   * Returns the authenticated user's identifier (`getAuthId()`).
   *
   * @throws {UnauthorizedError} when there is no authenticated user (delegates to {@link user}).
   * @category Current user
   */
  id(): number {
    return Auth.user().getAuthId();
  },

  /**
   * True when the current request has an authenticated user.
   *
   * @category Current user
   */
  check(): boolean {
    return RequestContext.tryGet()?.user !== undefined;
  },

  /**
   * True when the current request has no authenticated user — the inverse of
   * {@link check}.
   *
   * @category Current user
   */
  guest(): boolean {
    return !Auth.check();
  },

  /**
   * True when the current request was authenticated via the persistent
   * "remember me" cookie rather than an active session. Set by
   * {@link RememberMeMiddleware}. Use it to require a fresh login (or password
   * confirmation) before sensitive actions.
   *
   * @category Current user
   */
  viaRemember(): boolean {
    return (
      (RequestContext.tryGet() as { _viaRemember?: boolean } | undefined)?._viaRemember === true
    );
  },

  // ── Password confirmation (sensitive-action gate) ─────────────────────────────

  /**
   * Verify the authenticated user's password and, on success, mark the password
   * as freshly confirmed for this session. Pairs with
   * {@link ConfirmPasswordMiddleware} to gate sensitive routes. Returns
   * `false` (without marking) when the password is wrong or there is no user.
   *
   * @param password - The plain-text password to verify against the current user's hash.
   * @returns `true` when the password matched and confirmation was recorded.
   * @example
   * ```ts
   * if (await Auth.confirmPassword(password)) return redirect().intended();
   * return back().withErrors({ password: ['Incorrect password.'] });
   * ```
   * @category Password confirmation
   */
  async confirmPassword(password: string): Promise<boolean> {
    const user = Auth.userOrNull();
    const hashed = user?.getAuthPassword();
    if (!user || !hashed || !(await Hash.check(password, hashed))) return false;
    Auth.markPasswordConfirmed();
    return true;
  },

  /**
   * Record that the user's password was confirmed just now, without re-checking
   * it (use when you've already verified the password yourself). Emits
   * `PasswordConfirmed`.
   *
   * @category Password confirmation
   */
  markPasswordConfirmed(): void {
    const ctx = RequestContext.tryGet();
    const session = _session(ctx);
    session?.set(PASSWORD_CONFIRMED_AT_KEY, Date.now());
    const userId = Auth.userOrNull()?.getAuthId();
    if (userId !== undefined && userId !== null) {
      FrameworkEvents.emit(new PasswordConfirmed(userId, ctx));
    }
  },

  /**
   * True when the user confirmed their password within `timeoutSeconds`
   * (default 3 hours). Mirrors the check {@link ConfirmPasswordMiddleware} makes.
   *
   * @param timeoutSeconds - Confirmation validity window in seconds (default {@link DEFAULT_PASSWORD_TIMEOUT}, 3 hours).
   * @category Password confirmation
   */
  hasRecentlyConfirmedPassword(timeoutSeconds: number = DEFAULT_PASSWORD_TIMEOUT): boolean {
    const session = (RequestContext.tryGet() as unknown as { session?: SessionLike } | undefined)
      ?.session;
    const at = session?.get(PASSWORD_CONFIRMED_AT_KEY);
    return typeof at === "number" && Date.now() - at < timeoutSeconds * 1000;
  },

  // ── Authorization (reads the current user; false/[] for guests) ───────────────

  /**
   * True when the authenticated user has the given role. Always `false` for
   * guests, or for user models that don't compose the roles concern.
   *
   * @category Authorization
   */
  hasRole(role: string): boolean {
    const u = Auth.userOrNull() as unknown as { hasRole?(r: string): boolean } | undefined;
    return typeof u?.hasRole === "function" ? !!u.hasRole(role) : false;
  },

  /**
   * True when the authenticated user has at least one of the given roles.
   *
   * @category Authorization
   */
  hasAnyRole(roles: string[]): boolean {
    const u = Auth.userOrNull() as unknown as { hasAnyRole?(r: string[]): boolean } | undefined;
    return typeof u?.hasAnyRole === "function" ? !!u.hasAnyRole(roles) : false;
  },

  /**
   * True when the authenticated user has every one of the given roles.
   *
   * @category Authorization
   */
  hasAllRoles(roles: string[]): boolean {
    const u = Auth.userOrNull() as unknown as { hasAllRoles?(r: string[]): boolean } | undefined;
    return typeof u?.hasAllRoles === "function" ? !!u.hasAllRoles(roles) : false;
  },

  /**
   * True when the authenticated user has the ability (directly or via a role).
   * For richer, model-aware authorization prefer the {@link Gate} facade.
   *
   * @category Authorization
   */
  can(ability: string): boolean {
    const u = Auth.userOrNull() as unknown as { can?(a: string): boolean } | undefined;
    return typeof u?.can === "function" ? !!u.can(ability) : false;
  },

  /**
   * Alias of {@link can} — reads naturally for permission names.
   *
   * @category Authorization
   */
  hasPermission(ability: string): boolean {
    return Auth.can(ability);
  },

  /**
   * Assert the authenticated user has the ability, throwing otherwise.
   *
   * @throws {ForbiddenError} when the user lacks the ability (or is a guest).
   * @category Authorization
   */
  authorize(ability: string): void {
    if (!Auth.can(ability)) throw new ForbiddenError();
  },

  /**
   * The authenticated user's role names (empty for guests).
   *
   * @category Authorization
   */
  roles(): string[] {
    const u = Auth.userOrNull() as unknown as
      { getRoleNames?(): string[]; getRoles?(): string[] } | undefined;
    if (typeof u?.getRoleNames === "function") return u.getRoleNames();
    if (typeof u?.getRoles === "function") return u.getRoles();
    return [];
  },

  /**
   * Attempt to authenticate a user with the given credentials.
   *
   * Finds the user by every credential except `password`, verifies the password against the
   * stored hash, and — on success — logs them in (session + ctx.user) and returns `true`.
   * Returns `false` without logging in when the user is not found or the password is wrong.
   *
   * On success it also transparently re-hashes the stored password when its
   * algorithm is outdated (see {@link Hash.needsRehash}). On failure it emits a
   * `LoginFailed` event and, for an unknown user, burns one password-verify's
   * worth of CPU so timing can't be used to enumerate accounts.
   *
   * @param credentials - Bag of columns to match plus `password`. Keys matching
   *   `/password/i` and the `remember` key are excluded from the user lookup.
   * @param remember - When `true`, also issue a persistent "remember me" token/cookie.
   * @returns `true` when the user was found and the password matched (they are now logged in).
   * @example
   * ```ts
   * if (await Auth.attempt({ email, password })) {
   *   return redirect('/dashboard');
   * }
   * return redirect().back().withErrors({ email: 'These credentials do not match our records.' });
   *
   * // "Remember me":
   * await Auth.attempt({ email, password }, remember);
   * ```
   * @category Attempting
   */
  async attempt(credentials: Credentials, remember = false): Promise<boolean> {
    const user = await retrieveByCredentials(credentials);
    if (user && (await hasValidPassword(user, credentials))) {
      await Auth.login(user as UserModel, { remember });
      await _rehashIfNeeded(user, credentials);
      return true;
    }
    // No user found: verify against a dummy hash so the response time matches
    // the "wrong password" path (user-enumeration timing defence).
    if (!user) await _preventUserEnumerationTiming(credentials);
    const ctx = RequestContext.tryGet();
    FrameworkEvents.emit(
      new LoginFailed("web", String(credentials["email"] ?? ""), "invalid_credentials", ctx),
    );
    return false;
  },

  /**
   * Like {@link attempt}, but only logs the user in when `callback(user)` also returns truthy.
   * Useful for extra checks such as "is the account active?".
   *
   * @param credentials - Credential bag, as in {@link attempt}.
   * @param callback - Extra predicate run on the matched user; login proceeds only when it returns truthy.
   * @param remember - When `true`, also issue a persistent "remember me" token/cookie.
   * @returns `true` only when the credentials matched AND the callback passed.
   * @example
   * ```ts
   * await Auth.attemptWhen({ email, password }, (user) => user.active === true);
   * ```
   * @category Attempting
   */
  async attemptWhen(
    credentials: Credentials,
    callback: (user: UserModel) => boolean | Promise<boolean>,
    remember = false,
  ): Promise<boolean> {
    const user = await retrieveByCredentials(credentials);
    if (!user) {
      await _preventUserEnumerationTiming(credentials);
      return false;
    }
    if (!(await hasValidPassword(user, credentials))) return false;
    if (!(await callback(user as UserModel))) return false;
    await Auth.login(user as UserModel, { remember });
    await _rehashIfNeeded(user, credentials);
    return true;
  },

  /**
   * Validate credentials WITHOUT logging the user in.
   * Neither the session nor `ctx.user` is touched. Applies the same
   * user-enumeration timing defence as {@link attempt} when no user matches.
   *
   * @returns `true` when the credentials are valid.
   * @category Attempting
   */
  async validate(credentials: Credentials): Promise<boolean> {
    const user = await retrieveByCredentials(credentials);
    if (!user) {
      await _preventUserEnumerationTiming(credentials);
      return false;
    }
    return hasValidPassword(user, credentials);
  },

  /**
   * Authenticate for THIS request only — sets ctx.user but writes nothing to the session.
   * The next request is a guest again. Underpins
   * {@link BasicAuthMiddleware} and other stateless flows.
   *
   * @returns `true` when the credentials matched and `ctx.user` was set for this request.
   * @category Attempting
   */
  async once(credentials: Credentials): Promise<boolean> {
    const user = await retrieveByCredentials(credentials);
    if (!user) {
      await _preventUserEnumerationTiming(credentials);
      return false;
    }
    if (!(await hasValidPassword(user, credentials))) return false;
    RequestContext.get().user = user;
    return true;
  },

  /**
   * Log a user in by their primary key. Looks the
   * user up via the model's `find(id)` and, when found, delegates to {@link login}.
   *
   * @param id - Primary key of the user to log in.
   * @param remember - When `true`, also issue a persistent "remember me" token/cookie.
   * @returns The logged-in user, or `null` when no user has that id.
   * @category Sessions & login
   */
  async loginUsingId(id: number, remember = false): Promise<UserModel | null> {
    const Model = authUserModel() as unknown as
      { find?(id: number): Promise<AuthUser | null> } | undefined;
    const user = (await Model?.find?.(id)) ?? null;
    if (!user) return null;
    await Auth.login(user as UserModel, { remember });
    return user as UserModel;
  },

  /**
   * Log a user in for the current request.
   *
   * Regenerates the session id (session-fixation defence), writes the user's auth
   * id to the session so subsequent requests are automatically authenticated by
   * {@link PersistUserMiddleware}, and sets `ctx.user` so {@link user} works for
   * the rest of this request. With `options.remember`, also mints and queues a
   * persistent "remember me" token/cookie. Emits `LoginSucceeded`.
   *
   * **Second factor.** When the user has a confirmed second factor, the session is left
   * *pending* instead: `ctx.user` stays unset, `PersistUserMiddleware` keeps subsequent
   * requests as guests, and any `remember` cookie is withheld, until
   * {@link completeTwoFactor} runs. Use {@link twoFactorPending} to branch after login and
   * {@link pendingTwoFactorUser} to render the challenge.
   *
   * @param user - The already-resolved user model to sign in.
   * @param options - Login options; set `remember: true` for a persistent login.
   * @example
   * ```ts
   * const user = await User.where('email', email).first();
   * await Auth.login(user);
   * if (Auth.twoFactorPending()) return redirect('/two-factor/challenge');
   * ctx.redirect('/dashboard');
   * ```
   * @category Sessions & login
   */
  async login(user: UserModel, options: LoginOptions = {}): Promise<void> {
    const ctx = RequestContext.get();
    const session = _session(ctx);
    // Issue a fresh session ID before elevating privileges so a session ID
    // planted pre-auth cannot be reused post-auth (session fixation).
    // Mirrors MagicLinkBroker.login() and Passkeys — same defence, same order.
    session?.regenerate?.();
    // regenerate() keeps the data bag, so sweep the previous identity's earned privileges
    // before this one inherits them. Without this a session that completed TOTP hands
    // `two_factor_confirmed` to the next login on the same browser.
    _clearPrivilegeMarkers(session);
    session?.set("user_id", user.getAuthId());

    // A confirmed second factor makes the session half-authenticated: the id is recorded so
    // the challenge page can identify the user, but neither `ctx.user` here nor
    // PersistUserMiddleware on subsequent requests will treat the request as signed in until
    // completeTwoFactor() runs. Enforcing it here rather than in route middleware is what
    // keeps API routes, the admin panel and Flow actions from being a way around it.
    if (_requiresTwoFactor(user)) {
      session?.set(TWO_FACTOR_PENDING_KEY, true);
      // The remember cookie is a credential that skips the password entirely, so it is
      // withheld until the second factor lands. completeTwoFactor() honours the intent.
      if (options.remember) session?.set(TWO_FACTOR_REMEMBER_KEY, true);
      FrameworkEvents.emit(new LoginSucceeded("web", user.getAuthId(), ctx));
      return;
    }

    ctx.user = user;

    // Persistent "remember me": mint a token, store its hash on the user, and
    // queue the long-lived cookie. RememberMeMiddleware writes it to the response
    // and re-authenticates the user from it after the session expires.
    if (options.remember) await _issueRememberToken(ctx, user);

    FrameworkEvents.emit(new LoginSucceeded("web", user.getAuthId(), ctx));
  },

  /**
   * True when the password matched but the session is still waiting on its second factor.
   *
   * While this is true the request is a guest everywhere — `ctx.user` is unset and
   * {@link check} is `false` — so branch on it right after {@link attempt}/{@link login}
   * to send the user to the challenge page.
   *
   * @example
   * ```ts
   * if (!(await Auth.attempt({ email, password }))) return back().withErrors(…);
   * if (Auth.twoFactorPending()) return redirect('/two-factor/challenge');
   * return redirect('/dashboard');
   * ```
   * @category Two-factor
   */
  twoFactorPending(): boolean {
    const ctx = RequestContext.tryGet();
    const session = _session(ctx);
    return session?.get(TWO_FACTOR_PENDING_KEY) === true;
  },

  /**
   * The half-authenticated user behind a pending second factor, for the challenge page to
   * render and to verify the submitted code against. `undefined` when nothing is pending.
   *
   * This is deliberately *not* `ctx.user`: the request must stay a guest to every guard,
   * route and Flow action until the factor is presented.
   *
   * @returns The user awaiting their second factor, or `undefined`.
   * @category Two-factor
   */
  pendingTwoFactorUser(): UserModel | undefined {
    const ctx = RequestContext.tryGet();
    if (!ctx) return undefined;
    return _pendingUser(ctx);
  },

  /**
   * Complete the second-factor challenge for the pending session.
   *
   * Call this **only after** the submitted TOTP or recovery code has been verified. It
   * rotates the session id (the privilege level just changed), clears the pending marker,
   * records the challenge as met for the rest of the session, promotes the user to
   * `ctx.user`, and issues the remember cookie if the original login asked for one.
   *
   * @returns The now fully-authenticated user, or `null` when no challenge was pending.
   * @example
   * ```ts
   * const user = Auth.pendingTwoFactorUser();
   * if (!user || !tf.verifyCode(user.twoFactorSecret, code)) return back().withErrors(…);
   * await Auth.completeTwoFactor();
   * return redirect().intended('/dashboard');
   * ```
   * @category Two-factor
   */
  async completeTwoFactor(): Promise<UserModel | null> {
    const ctx = RequestContext.get();
    const session = _session(ctx);
    if (session?.get(TWO_FACTOR_PENDING_KEY) !== true) return null;

    const user = _pendingUser(ctx);
    if (!user) return null;

    const wantsRemember = session.get(TWO_FACTOR_REMEMBER_KEY) === true;

    // Privilege elevation — same session-fixation defence as the password step.
    session.regenerate?.();
    session.forget(TWO_FACTOR_PENDING_KEY);
    session.forget(TWO_FACTOR_REMEMBER_KEY);
    session.set(TWO_FACTOR_SESSION_KEY, true);
    ctx.user = user;

    if (wantsRemember) await _issueRememberToken(ctx, user);
    return user;
  },

  /**
   * Log the current user out.
   *
   * Flushes the session bag, issues a fresh session id, and clears `ctx.user`, so no
   * state the authenticated session earned — a completed 2FA challenge, a confirmed
   * password, an intended URL — survives into whoever uses the browser next. Also
   * invalidates the persistent "remember me" token (nulling it on the user and
   * persisting) and queues the remember cookie for deletion, so it can't
   * re-authenticate. Emits `LoggedOut`.
   *
   * @example
   * ```ts
   * await Auth.logout();
   * ctx.redirect('/login');
   * ```
   * @category Logout
   */
  async logout(): Promise<void> {
    const ctx = RequestContext.get();
    const session = _session(ctx);
    const user = ctx.user as (UserModel & Rememberable) | undefined;
    const userId = user?.getAuthId();
    // Discard the whole bag, not just `user_id`. Anything the authenticated session
    // accumulated — 2FA confirmation, password-confirm timestamp, cart, intended URL —
    // belongs to the identity that is leaving. Then take a fresh id so a captured
    // pre-logout session cookie is not the id of the post-logout session.
    if (typeof session?.flush === "function") {
      session.flush();
    } else {
      _clearPrivilegeMarkers(session);
      session?.forget("user_id");
    }
    session?.regenerate?.();
    ctx.user = undefined;

    // Invalidate the persistent token so the remember cookie can't re-auth, then
    // queue the cookie for deletion.
    if (user && typeof user.setRememberToken === "function") {
      user.setRememberToken(null);
      if (typeof user.save === "function") await user.save();
    }
    _queueRemember(ctx, { type: "clear" });

    if (userId !== undefined && userId !== null) {
      FrameworkEvents.emit(new LoggedOut("web", userId, ctx));
    }
  },

  /**
   * Invalidate the user's sessions on *other* devices while keeping the current
   * session signed in. Requires the user to confirm their current password.
   *
   * Driver-agnostic: it re-hashes the same password and persists the new hash, so
   * every other session — whose {@link AuthenticateSessionMiddleware} snapshot no
   * longer matches — is torn down on its next request. The current session's
   * snapshot is refreshed so it survives. Returns `false` when the password is
   * wrong. Attach `AuthenticateSessionMiddleware` to your routes for this to take
   * effect.
   *
   * @param password - The current user's plain-text password, re-verified before proceeding.
   * @returns `false` when the password is wrong; `true` once other sessions are invalidated. Emits `OtherDeviceLogout`.
   * @example
   * ```ts
   * if (!(await Auth.logoutOtherDevices(currentPassword))) {
   *   return back().withErrors({ password: ['Incorrect password.'] });
   * }
   * ```
   * @category Logout
   */
  async logoutOtherDevices(password: string): Promise<boolean> {
    const ctx = RequestContext.tryGet();
    const user = Auth.userOrNull() as (UserModel & { save?(): Promise<unknown> }) | undefined;
    const hashed = user?.getAuthPassword();
    if (!user || !hashed || !(await Hash.check(password, hashed))) return false;

    // Re-hash the same password: other sessions' stored snapshots stop matching.
    const fresh = (await Hash.make(password)) as string;
    (user as unknown as Record<string, unknown>)["password"] = fresh;
    if (typeof user.save === "function") await user.save();

    // Keep THIS session valid by refreshing its snapshot.
    const session = _session(ctx);
    session?.set(AUTH_PASSWORD_HASH_KEY, fresh);

    FrameworkEvents.emit(new OtherDeviceLogout("web", user.getAuthId(), ctx));
    return true;
  },

  // ── Multiple guards ───────────────────────────────────────────────────────────

  /**
   * Register a custom **request guard** that resolves a user directly from the
   * incoming request. Reach it with `Auth.guard(name)`. Typically used for
   * stateless API auth (bearer tokens,
   * JWTs, API keys).
   *
   * @param name - Guard name to register (used later with {@link guard}).
   * @param resolver - Resolves a user (or null) from the incoming `Request`.
   * @category Guards
   */
  viaRequest(name: string, resolver: RequestGuardResolver): void {
    requestGuards.set(name, resolver);
  },

  /**
   * Access an authentication guard by name. With no name (or `"web"`) you get the
   * default session guard — the same identity the top-level `Auth.*` methods read.
   * Named guards registered via {@link viaRequest} resolve from the request.
   *
   * @param name - Guard name, or omit / `"web"` for the default session guard.
   * @returns A {@link Guard} whose read methods are all async.
   * @throws {Error} when `name` is not `"web"` and no guard was registered under it via {@link viaRequest}.
   * @example
   * ```ts
   * await Auth.guard("api").userOrNull();
   * ```
   * @category Guards
   */
  guard(name?: string): Guard {
    if (!name || name === "web") return _webGuard;
    const resolver = requestGuards.get(name);
    if (!resolver) {
      throw new Error(
        `[Zerotal Auth] Guard "${name}" is not defined. Register it with Auth.viaRequest("${name}", resolver).`,
      );
    }
    return new RequestGuard(name, resolver);
  },
};

/**
 * The default session guard as a {@link Guard} adapter, so `Auth.guard()` and
 * `Auth.guard("web")` share one identity with the top-level `Auth.*` methods.
 *
 * @internal
 */
const _webGuard: Guard = {
  user: async () => Auth.user(),
  userOrNull: async () => Auth.userOrNull(),
  id: async () => Auth.userOrNull()?.getAuthId(),
  check: async () => Auth.check(),
  guest: async () => Auth.guest(),
};

/**
 * Re-hash a user's password after a successful login when the stored hash uses
 * an outdated algorithm (automatic password rehashing). Best-effort:
 * a stub user without `save`, or any hashing/persistence error, leaves the
 * existing hash untouched and never breaks the login.
 *
 * @internal
 */
async function _rehashIfNeeded(user: AuthUser, credentials: Credentials): Promise<void> {
  const plain = credentials["password"];
  if (typeof plain !== "string" || plain.length === 0) return;
  try {
    const hashed = user.getAuthPassword();
    if (!hashed || !Hash.needsRehash(hashed)) return;
    (user as unknown as Record<string, unknown>)["password"] = await Hash.make(plain);
    const u = user as unknown as { save?: () => Promise<unknown> };
    if (typeof u.save === "function") await u.save();
  } catch {
    /* never let a rehash failure break authentication */
  }
}

/**
 * Mint a remember token, persist its hash on the user, and queue the cookie.
 * Best-effort persistence: stub users without `setRememberToken`/`save` (e.g. in
 * unit tests) still get a queued cookie, they just won't survive a session reset.
 *
 * @internal
 */
async function _issueRememberToken(ctx: unknown, user: UserModel & Rememberable): Promise<void> {
  const raw = mintRememberToken();
  if (typeof user.setRememberToken === "function") {
    user.setRememberToken(hashRememberToken(raw));
    if (typeof user.save === "function") await user.save();
  }
  _queueRemember(ctx, { type: "set", value: encodeRememberValue(user.getAuthId(), raw) });
}
