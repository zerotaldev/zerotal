---
title: Authentication
description: Sessions, login, guards, API tokens, passwordless login, and testing — the whole authentication surface on one page.
---

# Authentication

`@zerotal/auth` works out who is making each request — verifying credentials, persisting the user across requests, and exposing them as `ctx.user` / `Auth.user()`. It bundles session login, personal access tokens, passwordless magic links, social OAuth, and RFC 6238 two-factor authentication.

It builds on top of [`@zerotal/session`](/docs/session), so register both providers.

## Getting Started

```bash
# in your project root
bun add @zerotal/session @zerotal/auth
```

## Register the provider

Add `SessionProvider` and `AuthProvider` to the providers array in `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { SessionProvider } from "@zerotal/session";
import { AuthProvider } from "@zerotal/auth";

export default [
  // …other providers
  SessionProvider,
  AuthProvider,
];
```

Registering `AuthProvider` switches on the following (in lifecycle order):

- `onRegister` — binds the `hash`, `gate`, and `two_factor` singletons, and registers schema/policy auto-discovery concerns.
- `onBooting` — resolves the user loader, binds it as `auth.userLoader`, then registers `PersistUserMiddleware` globally via `app.useOnce()` so `ctx.user` is populated on every request.
- `onBooted` — installs `HttpContext.authorize()` and registers the `make:policy` and `auth:sync-permissions` commands.

> **Note** — `PersistUserMiddleware` is the _populate_ step (it never blocks a request). Requiring a signed-in user on a route is a separate, opt-in concern — see [Route protection](#the-auth-facade).

## Configuration

Create `config/auth.ts` with the `AuthConfig()` helper so every field stays type-checked:

```typescript
// config/auth.ts
import { AuthConfig } from "@zerotal/auth";

export default AuthConfig({
  algorithm: "argon2id",
});
```

| Field                         | Required | Default      | Description                                                                |
| ----------------------------- | -------- | ------------ | -------------------------------------------------------------------------- |
| `algorithm`                   | no       | `"argon2id"` | Password hashing algorithm — `"argon2id"` or `"bcrypt"`.                   |
| `twoFactor`                   | no       | `undefined`  | Two-factor options (see [Two-Factor Authentication](/docs/roles-and-2fa)). |
| `twoFactor.issuer`            | no       | `"Zerotal"`  | Issuer name shown in the authenticator app.                                |
| `twoFactor.window`            | no       | `1`          | TOTP periods (30 s each) of clock tolerance per side.                      |
| `twoFactor.recoveryCodeCount` | no       | `8`          | Number of recovery codes generated.                                        |

## Wire the User model

`AuthProvider` needs to know how to load a user from their session-stored ID. Call `AuthProvider.resolveUsing()` in `bootstrap/app.ts` **before** `Application.create()`:

```typescript fragment
// bootstrap/app.ts
import { Application, basePath } from "zerotal";
import { AuthProvider } from "@zerotal/auth";
import { User } from "../app/models/User.ts";
import providers from "./providers.ts";

AuthProvider.resolveUsing((id) => User.find(id));

export default Application.create({ providers }).routing({ web: basePath("routes/web.ts") });
```

> **Tip** — `resolveUsing()` is optional. When omitted, the provider falls back to a convention default that loads the registered `AuthUser` subclass — registering `AuthProvider` is enough for the common case.

The user model extends `AuthUser` instead of `Model`:

```typescript
// app/models/User.ts
import { column, table } from "@zerotal/orm";
import { AuthUser } from "@zerotal/auth";

@(table("users").withTimestamps())
export class User extends AuthUser {
  @column() name!: string;
  @column() email!: string;
  @column() password!: string; // always stored hashed — see /docs/encryption
}
```

`AuthUser` provides `getAuthId()` (returns `this.id`) and `getAuthPassword()` (returns `this.password`).

### Bind the type — a required step

Do this once, or every `Auth.user()` in the app returns the framework's minimal `UserModel`
and reading your own columns off it is a type error:

```typescript fragment
// bootstrap/app.ts (or any file imported at boot)
import type { User } from "../app/models/User.ts";

declare module "@zerotal/auth" {
  interface UserModel extends User {}
}
```

**The empty body is the point.** The interface is not being given members — it is being
pointed at your class, so that everywhere the framework says `UserModel` it means `User`.
That is not a shape anyone guesses, which is why it is here in setup rather than filed
under advanced usage. Put it somewhere that is imported at boot and leave a comment saying
what it is for; it looks like dead code otherwise.

## How it works

On every request `PersistUserMiddleware` reads `user_id` from the session and populates `ctx.user`. If `user_id` is present but the user no longer exists, the stale key is cleared.

| Situation                     | `ctx.user`                     |
| ----------------------------- | ------------------------------ |
| No session / no `user_id`     | `undefined` (guest)            |
| Valid `user_id`, user found   | User model instance            |
| `user_id` found, user deleted | `undefined` (key auto-cleared) |

## The Auth facade

`Auth` reads the current user from async local storage — use it from controllers, services, or anywhere in the request tree:

```typescript fragment
// in a controller or service
import { Auth } from "@zerotal/auth";

Auth.check(); // boolean — true if authenticated
Auth.guest(); // boolean — inverse of check()
Auth.user(); // UserModel — throws UnauthorizedError for guests
Auth.userOrNull(); // UserModel | undefined — safe version
Auth.id(); // number — throws for guests

await Auth.login(user); // write user_id to session, set ctx.user
await Auth.logout(); // clear user_id from session, unset ctx.user
```

> **`Auth.user()` throws for a guest, and the name does not telegraph that.** It is the right
> call behind `AuthMiddleware`, where a user is guaranteed — that guarantee is what makes its
> non-optional return type honest. It is the wrong call on any route a signed-out person can
> reach. Plenty of audited things happen with nobody signed in: a storefront checkout, a
> customer approving a change from a tokenised link, an incoming webhook. On those routes an
> audit line that reaches for `Auth.user()` turns into a 401 on a public page, and the 401 is
> about the audit line rather than about the request.
>
> ```typescript fragment
> // A guest is a normal outcome here, not a failure.
> const actor = Auth.userOrNull();
> await Audit.record("checkout.completed", { actorId: actor?.getAuthId() ?? null });
> ```

`Auth.attempt()` rolls credential lookup, password verification, and login into one call:

```typescript fragment
function attempt(credentials: Credentials, remember?: boolean): Promise<boolean>;
```

```typescript fragment
// in a controller
if (await Auth.attempt({ email, password })) {
  ctx.redirect("/dashboard", 303);
  return;
}
ctx.flash("errors", { email: ["These credentials do not match our records."] });
ctx.redirect("/login", 303);
```

> **Tip** — `Auth.attempt()` finds the user by every credential _except_ `password`, then checks the password against the stored hash — so the verbose manual lookup below is optional. Use `Auth.validate()` to check credentials without logging in, or `Auth.once()` to authenticate for a single request without touching the session.

### Route protection

#### AuthMiddleware

`AuthMiddleware` is the built-in guard — the inverse of `GuestMiddleware`. It lets authenticated requests through, returns `401` JSON for API clients, and redirects HTML guests to `/login` (saving the originating URL to the session as `intended_url`):

```typescript fragment
// routes/web.ts
import { AuthMiddleware } from "@zerotal/auth";
import { Router } from "zerotal";

Router.group({ prefix: "/app", middleware: [AuthMiddleware] }, () => {
  Router.get("/dashboard", DashboardController, "index");
  Router.get("/profile", ProfileController, "show");
  Router.put("/profile", ProfileController, "update");
});
```

Override the redirect target, or also require a verified email:

```typescript fragment
// routes/web.ts
AuthMiddleware.with({ redirectTo: "/sign-in" });
AuthMiddleware.with({ mustVerifyEmail: true, verifyRedirectTo: "/confirm-email" });
```

| Option             | Default           | Description                                                                                   |
| ------------------ | ----------------- | --------------------------------------------------------------------------------------------- |
| `redirectTo`       | `"/login"`        | Where HTML guests are sent.                                                                   |
| `mustVerifyEmail`  | `false`           | Also require a verified email (no-op without [Email Verification](/docs/email-verification)). |
| `verifyRedirectTo` | `"/verify-email"` | Where unverified users are sent when `mustVerifyEmail` is on.                                 |

> **Note** — After a guest logs in, send them back to where they were headed with `redirect().intended()` / `url().intended()`, which reads the `intended_url` session key.

#### GuestMiddleware

Redirects authenticated users away from login/register pages:

```typescript fragment
// routes/web.ts
import { GuestMiddleware } from "@zerotal/auth";

Router.get("/login", AuthController, "showLogin", [GuestMiddleware]);
Router.post("/login", AuthController, "login", [GuestMiddleware]);
Router.get("/register", AuthController, "showRegister", [GuestMiddleware]);
Router.post("/register", AuthController, "register", [GuestMiddleware]);

// Custom redirect target (default: '/')
Router.get("/login", AuthController, "showLogin", [
  GuestMiddleware.with({ redirectTo: "/dashboard" }),
]);
```

Between them, `AuthMiddleware` protects pages and APIs that require a signed-in
user and `GuestMiddleware` keeps signed-in users off the login and register
routes. Requests that carry no session — API clients, mobile apps, internal
endpoints — are handled by the guards covered in
[Which guard do I use?](#which-guard-do-i-use) below.

## Login, logout & registration

> **Note** — Password hashing is covered in [Encryption & Hashing](/docs/encryption); password reset in [Password Reset](/docs/password-reset).

```typescript fragment
// app/controllers/AuthController.ts
import { Auth, Hash } from "@zerotal/auth";
import type { HttpContext } from "zerotal";
import { User } from "#app/models/User.ts";

export class AuthController {
  showLogin(ctx: HttpContext) {
    ctx.view(LoginPage({ errors: ctx.flashed("errors"), old: ctx.flashed("old") }));
  }

  async login(ctx: HttpContext) {
    const { email, password } = await ctx.body<{ email: string; password: string }>();

    const user = await User.query().where("email", email).first();

    if (!user || !(await Hash.check(password, user.password ?? ""))) {
      ctx.flash("errors", { email: ["These credentials do not match our records."] });
      ctx.flash("old", { email });
      ctx.redirect("/login", 303);
      return;
    }

    ctx.session.regenerate();
    await Auth.login(user);

    const intended = ctx.session.get("intended_url") as string | undefined;
    ctx.session.forget("intended_url");
    ctx.redirect(intended ?? "/dashboard", 303);
  }

  async logout(ctx: HttpContext) {
    await Auth.logout();
    ctx.session.flush();
    ctx.session.regenerate();
    ctx.redirect("/login", 303);
  }

  showRegister(ctx: HttpContext) {
    ctx.view(RegisterPage());
  }

  async register(ctx: HttpContext) {
    const body = await ctx.body<{ name: string; email: string; password: string }>();

    if (await User.query().where("email", body.email).exists()) {
      ctx.flash("errors", { email: ["Email already taken."] });
      ctx.redirect("/register", 303);
      return;
    }

    const user = await User.create({
      name: body.name,
      email: body.email,
      password: await Hash.make(body.password),
    });

    ctx.session.regenerate();
    await Auth.login(user);
    ctx.redirect("/dashboard", 303);
  }
}
```

> **Warning** — Always call `ctx.session.regenerate()` immediately after a successful login to rotate the session ID and prevent session fixation.

### Remember me

A "remember me" checkbox keeps a user signed in after their session expires. Pass `{ remember: true }` to `Auth.login()` (or as the second argument to `Auth.attempt()`) and the framework does the rest:

```typescript fragment
await Auth.login(user, { remember: true });
// or
await Auth.attempt({ email, password }, remember);
```

Behind the scenes a high-entropy token is minted, its SHA-256 hash is stored in the user's `remember_token` column, and the raw token is written to a long-lived `remember_web` cookie. The column is provisioned automatically for every authenticatable model — you don't declare it or write a migration. On a later visit, after the session has lapsed, `RememberMeMiddleware` (registered globally by `AuthProvider`) reads the cookie, looks the user up, constant-time-compares the token against the stored hash, and signs them back in — re-seeding a fresh session.

Only the hash is persisted, so a leaked database row can't be replayed as a valid cookie. `Auth.logout()` clears the stored token and deletes the cookie, invalidating the persistent login everywhere.

When a request was restored from the cookie rather than an active session, `Auth.viaRemember()` returns `true`. Use it to demand a fresh login (or password confirmation) before sensitive actions:

```typescript fragment
if (Auth.viaRemember()) {
  return ctx.redirect("/confirm-password");
}
```

### Login throttling

To blunt credential-stuffing and brute-force attempts, throttle failed logins per identifier and IP. The shared `loginThrottle` limiter (5 attempts per 60 seconds by default) records misses, locks the pair out once the limit is reached, and emits a `Lockout` event you can hook for alerting:

```typescript fragment
import { Auth, loginThrottle } from "@zerotal/auth";

async login(ctx: HttpContext) {
  const { email, password } = await ctx.body<{ email: string; password: string }>();

  const retryAfter = loginThrottle.ensureNotLocked(ctx, email);
  if (retryAfter !== null) {
    ctx.flash("errors", { email: [`Too many attempts. Try again in ${retryAfter}s.`] });
    return ctx.redirect("/login", 303);
  }

  if (await Auth.attempt({ email, password })) {
    loginThrottle.clearFor(ctx, email); // reset the counter on success
    ctx.session.regenerate();
    return ctx.redirect("/dashboard", 303);
  }

  loginThrottle.recordFailure(ctx, email); // count the miss
  ctx.flash("errors", { email: ["These credentials do not match our records."] });
  return ctx.redirect("/login", 303);
}
```

Tune the window with `new LoginRateLimiter({ maxAttempts, decaySeconds })` for a dedicated limiter, or listen for the lockout:

```typescript fragment
FrameworkEvents.on(Lockout, ({ identifier }) => {
  // notify the account owner, feed intrusion detection, etc.
});
```

### Automatic password rehashing

Hashing costs rise over time: you raise the work factor, or move from bcrypt to
argon2id. The stored hashes do not update themselves, and you cannot re-hash a
password you do not have — you only see it at login.

So that is when it happens. `Auth.attempt()` (and `attemptWhen`) compare the
stored hash's algorithm against `auth.algorithm`, and on a mismatch re-hash the
password the user just proved they know and persist it:

```typescript fragment
// config/auth.ts — raise the cost, and logins migrate themselves
export default AuthConfig({
  algorithm: "argon2id",
});
```

No code change is needed at the call site. Users are upgraded silently as they
sign in, and one that never returns keeps its old hash — which is correct, since
the account is dormant.

**It is best-effort.** A hashing or save failure never breaks the login: the user
gets in, and the upgrade is retried on their next sign-in. That trade is
deliberate — a rehash is an optimisation, and failing a login over one would be
an outage caused by a maintenance task.

To drive a migration rather than wait for it, check the hash yourself:

```typescript fragment
// in a command or service
import { Hash } from "zerotal/security";

if (Hash.needsRehash(user.password)) {
  // You still need the plaintext, so this only works at a point where you
  // have it — a login hook, or a forced password reset.
  await user.update({ password: await Hash.make(plaintext) });
}
```

> **Note** — `needsRehash()` reports whether the stored hash matches the current
> algorithm and cost. It cannot re-hash on its own: without the plaintext there
> is nothing to hash, which is the whole point of storing a hash.

### Password confirmation

Some actions — changing a password, deleting an account, viewing recovery codes — warrant re-entering the password even within an active session. Gate those routes with `ConfirmPasswordMiddleware`: it lets the request through if the user confirmed their password within the window (default 3 hours), otherwise it stores the intended URL and redirects to `/confirm-password` (or returns `423 Locked` for JSON).

```typescript fragment
Router.group({ middleware: [AuthMiddleware, ConfirmPasswordMiddleware] }, () => {
  Router.get("/settings/security", SecurityController, "show");
});
```

Your confirm-password route verifies the password and records the confirmation:

```typescript fragment
async confirm(ctx: HttpContext) {
  const { password } = await ctx.body<{ password: string }>();
  if (await Auth.confirmPassword(password)) {
    return ctx.redirect(ctx.session.get("intended_url") as string ?? "/", 303);
  }
  ctx.flash("errors", { password: ["Incorrect password."] });
  return ctx.redirect("/confirm-password", 303);
}
```

`Auth.hasRecentlyConfirmedPassword()` checks the window manually; `Auth.markPasswordConfirmed()` records a confirmation you verified yourself.

### Logging out other devices

Let a user end their sessions on every _other_ device while staying signed in on the current one — typically offered after a password change. Attach `AuthenticateSessionMiddleware` to your authenticated routes; it binds each session to a snapshot of the user's password hash. Then call `Auth.logoutOtherDevices(currentPassword)`:

```typescript fragment
Router.group({ middleware: [AuthMiddleware, AuthenticateSessionMiddleware] }, () => {
  // ...the bulk of your authenticated routes
});

// In a controller — requires the user to confirm their current password:
if (!(await Auth.logoutOtherDevices(currentPassword))) {
  return back().withErrors({ password: ["Incorrect password."] });
}
```

It re-hashes the same password and persists it, so every other session's snapshot stops matching and `AuthenticateSessionMiddleware` tears it down on that device's next request. The mechanism is driver-agnostic — it works with cookie and Redis sessions alike, with no server-side session store. An `OtherDeviceLogout` event fires for auditing.

### Checking for compromised passwords

`isPasswordCompromised()` checks a password against the Have I Been Pwned breach corpus using the k-anonymity range API — only the first five characters of the SHA-1 hash ever leave the process. Use it during registration or password changes:

```typescript fragment
import { isPasswordCompromised } from "@zerotal/auth";

if (await isPasswordCompromised(password)) {
  return back().withErrors({ password: ["This password has appeared in a data breach."] });
}
```

It fails open (returns `false`) on a network error, so an outage never blocks a sign-up. Raise the `{ threshold }` option to tolerate low-frequency hits.

Failing open is the right default for a check that depends on a third party, but it
does make the check advisory: it cannot be the only thing standing between a weak
password and an account. Keep your length and complexity rules alongside it.

## Passwordless login

Both approaches here prove that someone controls an inbox and sign them in on that
basis, so neither needs a stored password. They differ in where the reader finishes
the flow, which is the thing to decide first:

- **One-time codes** keep the user on the page they started from — they read a code
  and type it back. That survives the link-rewriting and click-tracking some mail
  clients apply, and works when mail is read on a different device from the browser.
- **Magic links** ask for no typing at all, which is smoother on a phone, but the
  session is established wherever the link is opened — including inside an email
  client's in-app browser.

### Email OTP (passwordless codes)

`EmailOtpBroker` powers passwordless login by emailing a short numeric code. Like `PasswordBroker`, it's DB-agnostic via injected callbacks and stores only the code's hash.

```typescript fragment
const otp = new EmailOtpBroker({
  findCode: (email) => LoginCode.query().where("email", email).first(),
  storeCode: (email, hash, expiresAt) => LoginCode.upsert({ email, code: hash, expiresAt }),
  deleteCode: (email) => LoginCode.where("email", email).delete(),
  // Deliver via the notifications mail channel — LoginCodeNotification implements toMail().
  sendCode: (email, code) => Notify.send({ email }, new LoginCodeNotification(code)),
});

await otp.send(email); // emails a 6-digit code (valid 10 min)
if (await otp.attempt(email, submittedCode)) {
  // true once, then the code is consumed
  await Auth.login(await User.query().where("email", email).firstOrFail());
}
```

Three options tune the security trade-off, and the defaults are chosen to sit
together:

| Option          | Default | Effect                                        |
| --------------- | ------- | --------------------------------------------- |
| `length`        | `6`     | Digits in the generated code                  |
| `expireMinutes` | `10`    | How long a code stays valid                   |
| `maxAttempts`   | `5`     | Failed guesses before the code is invalidated |

`maxAttempts` is the one not to disable. A six-digit code is one of a million
possibilities — trivial to exhaust by automation inside a ten-minute window, and
the only thing preventing that is a cap on guesses. Lengthening the code or
shortening its life are both reasonable adjustments; removing the attempt limit is
not, and lengthening the code is a poor substitute for it.

Shortening `expireMinutes` also has a cost worth weighing: mail delivery is not
instant, and a code that expires before it arrives reads to the user as a broken
login rather than a strict one.

`attempt()` returns `true` exactly once — the code is consumed on success — so a
replayed submission fails even inside the expiry window.

Treat a request for a code the same way you treat magic links below: respond
identically whether or not the address has an account, or the endpoint becomes a
way to discover who has registered.

### Magic link login

`MagicLinkBroker` generates signed, time-limited login URLs and establishes a session on verify.

```typescript fragment
// app/auth/magicLinks.ts
import { MagicLinkBroker } from "@zerotal/auth";
import { env } from "zerotal";
import { Notify } from "@zerotal/notifications";
import { User } from "#app/models/User.ts";

export const magicLinks = new MagicLinkBroker({
  secret: env("APP_KEY", ""),
  verifyUrl: `${env("APP_URL", "")}/magic/verify`,
  expiresInMinutes: 15,
  findUser: (email) => User.where("email", email).first(),
  // MagicLinkNotification implements toMail(); queue() sends it in the background.
  sendLink: (email, url) => Notify.queue({ email }, new MagicLinkNotification(url)),
});
```

```typescript fragment
// app/controllers/MagicLinkController.ts
import { magicLinks } from "#app/auth/magicLinks.ts";
import { MAGIC } from "@zerotal/auth";

export class MagicLinkController {
  async send(ctx: HttpContext) {
    const { email } = await ctx.body<{ email: string }>();
    await magicLinks.sendLink(email);
    ctx.flash("success", "Check your inbox for a login link.");
    ctx.redirect("/login", 303);
  }

  async verify(ctx: HttpContext) {
    const email = ctx.query("email") ?? "";

    if (!magicLinks.verify(ctx.fullUrl())) {
      ctx.flash("errors", { link: ["This link is invalid or has expired."] });
      ctx.redirect("/login", 303);
      return;
    }

    const result = await magicLinks.login(email, ctx);

    if (result === MAGIC.INVALID) {
      ctx.flash("errors", { link: ["No account found for this email."] });
      ctx.redirect("/login", 303);
      return;
    }

    ctx.redirect("/dashboard", 303);
  }
}
```

Routes:

```typescript fragment
// routes/web.ts
Router.post("/magic", MagicLinkController, "send");
Router.get("/magic/verify", MagicLinkController, "verify");
```

> **Note** — `sendLink()` returns `MAGIC.SENT` or `MAGIC.USER_NOT_FOUND`; `login()` returns `MAGIC.OK` or `MAGIC.INVALID`. Treat `USER_NOT_FOUND` as success in the UI so the endpoint doesn't reveal which emails have accounts.

## Guards & tokens

The default `web` guard reads a session cookie, which is the right answer for a
browser login and the wrong one for everything else. This page covers the rest:
proving who is making a request when there is no session to read.

### Which guard do I use?

| Middleware              | Authenticates                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `AuthMiddleware`        | Pages and APIs that require a signed-in user                                                                      |
| `GuestMiddleware`       | Login/register routes, kept from signed-in users                                                                  |
| `BasicAuthMiddleware`   | Internal endpoints, straight from a Basic header                                                                  |
| `BearerTokenMiddleware` | API and mobile clients holding a personal token                                                                   |
| `JwtGuardMiddleware`    | API clients holding a signed JWT                                                                                  |
| `TwoFactorMiddleware`   | Layers over `AuthMiddleware` to require a passed challenge — see [Two-Factor Authentication](/docs/roles-and-2fa) |

The bearer and JWT middleware differ in where the truth lives. A personal access
token is a row you control: it can be listed, scoped to abilities, and revoked the
moment it is deleted. A JWT carries its own claims and is trusted until it expires,
so it needs no lookup — and cannot be withdrawn early without building a revocation
list that gives back the lookup you avoided. Choose tokens when revocation matters,
JWTs when statelessness does.

### Multiple guards

The top-level `Auth` facade is the default session-backed `web` guard. For separate auth schemes — most often a stateless API guard alongside the session UI — register a **request guard** with `Auth.viaRequest()` and reach it via `Auth.guard(name)`:

```typescript fragment
import { Auth, Jwt } from "@zerotal/auth";

Auth.viaRequest("api", async (req) => {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const claims = token ? Jwt.verify<{ sub: number }>(token, Bun.env.JWT_SECRET!) : null;
  return claims ? await User.find(claims.sub) : null;
});

// Anywhere in a request:
const user = await Auth.guard("api").userOrNull();
if (await Auth.guard("api").check()) {
  /* ... */
}
```

`Auth.guard()` / `Auth.guard("web")` return the default guard — the same identity the top-level `Auth.*` methods read. Request guards are resolved lazily and cached per request.

Register guards where the rest of your bootstrapping happens — a service provider —
so the definition runs once at boot and is in place before any request arrives.
`Auth.guard()` throws when handed a name that was never registered, which turns a
typo or a missing provider into an immediate, clearly-worded failure rather than a
guard that quietly reports everyone as a guest.

Because a request guard is resolved lazily and then cached for the rest of the
request, its resolver runs at most once per request however many times you ask.
That makes it safe to hit the database or verify a token inside one.

### Reading the current identity

Every guard exposes the same five methods, and the two that differ only in how they
fail are worth choosing between deliberately:

| Method         | Returns                          | Reach for it when                    |
| -------------- | -------------------------------- | ------------------------------------ |
| `user()`       | The user, or throws              | The route is already guarded         |
| `userOrNull()` | The user, or `null`              | Both outcomes are expected           |
| `id()`         | The identifier, or `undefined`   | You need the key, not the record     |
| `check()`      | `true` when someone is signed in | Branching on signed-in state         |
| `guest()`      | `true` when nobody is            | Branching the other way reads better |

Prefer `user()` behind middleware that has already established there is a user: it
returns a non-nullable value, so the code after it needs no defensive check, and a
misconfigured route fails loudly instead of proceeding with `null`. Reach for
`userOrNull()` on pages that render for signed-in and anonymous visitors alike.

`id()` skips loading the record entirely, which is what you want when the value is
only going into a foreign key or being compared against one.

### HTTP Basic authentication

For quick internal endpoints, `BasicAuthMiddleware` authenticates straight from the `Authorization: Basic` header — no login page. It's stateless (sets `ctx.user` for the request only) and challenges with `401 WWW-Authenticate` when credentials are missing or wrong.

```typescript fragment
Router.get("/internal/metrics", MetricsController, "show", [BasicAuthMiddleware]);
// Authenticate by a different column / realm:
BasicAuthMiddleware.with({ field: "username", realm: "Admin" });
```

| Option  | Default      | Effect                                        |
| ------- | ------------ | --------------------------------------------- |
| `field` | `email`      | The credential column treated as the username |
| `realm` | `Restricted` | The realm shown in the browser's auth prompt  |

Being stateless, it re-verifies the password on every request, and because the
`401` carries a `WWW-Authenticate` challenge a browser hitting the URL directly
gets the native credential prompt — which is what makes this convenient for an
internal dashboard nobody wants to build a login page for.

> **Warning** — Basic credentials are base64-encoded, not encrypted, so anything
> that can see the request can read them. Serve these endpoints over HTTPS only,
> and prefer a token guard for anything beyond internal use.

### JWT authentication

For stateless API or mobile clients, issue and verify HS256 JSON Web Tokens with the `Jwt` helper (no external dependency), and authenticate requests with `JwtGuardMiddleware`:

```typescript fragment
import { Jwt, JwtGuardMiddleware, AuthMiddleware } from "@zerotal/auth";

// Issue on login:
const token = Jwt.sign({ sub: user.id, role: "admin" }, Bun.env.JWT_SECRET!, { expiresIn: 3600 });

// Authenticate requests (a populate step — pair with AuthMiddleware to guard):
const JwtGuard = JwtGuardMiddleware.with({
  secret: Bun.env.JWT_SECRET!,
  resolve: (claims) => User.find(Number(claims.sub)),
});
Router.get("/api/me", MeController, "show", [JwtGuard, AuthMiddleware]);
```

`Jwt.verify()` returns the claims or `null` (invalid signature, tampering, or past `exp`). The middleware reads the `Bearer` token, verifies it, and sets `ctx.user` from `resolve`; the secret falls back to `JWT_SECRET` then `APP_KEY` from the environment.

The pairing above is deliberate. `JwtGuardMiddleware` _populates_ `ctx.user` when a
valid token is present and stays quiet otherwise, so on its own it refuses nothing —
`AuthMiddleware` is what turns an unauthenticated request away. Applying the guard
without it leaves the route open to anyone who sends no token at all.

### API token authentication

For SPAs and mobile apps, issue personal access tokens instead of (or alongside) sessions.

#### API token migration

```typescript fragment
// database/migrations/xxxx_create_personal_access_tokens.ts
await Schema.create("personal_access_tokens", (table) => {
  table.increments("id");
  table.integer("tokenable_id");
  table.string("tokenable_type").default("user");
  table.string("name");
  table.string("token", 64).unique(); // SHA-256 hex of the plaintext
  table.text("abilities").nullable(); // JSON array e.g. ["read","write"]
  table.timestamp("last_used_at").nullable();
  table.timestamp("expires_at").nullable();
  table.timestamps();
});
```

#### Issuing tokens

```typescript fragment
function createToken(options: {
  tokenableId: number;
  tokenableType?: string;
  name: string;
  abilities?: string[];
  expiresAt?: Date;
}): Promise<{ plaintext: string; row: Omit<TokenRow, "id" | "created_at" | "updated_at"> }>;
```

> **Danger** — The plain-text token is returned to the client exactly once and is never stored — only its SHA-256 hash lives in the database. If the user loses it, issue a new one.

```typescript fragment
// in a controller
import { createToken } from "@zerotal/auth";
import { DB } from "@zerotal/orm";

async issue(ctx: HttpContext) {
  const user = Auth.user();
  const { name, abilities } = await ctx.body<{ name: string; abilities?: string[] }>();

  const { plaintext, row } = await createToken({
    tokenableId: user.id,
    name,
    abilities:  abilities ?? ["*"],
    expiresAt:  new Date(Date.now() + 90 * 86400 * 1000),
  });

  await DB.table("personal_access_tokens").insert(row);

  // Return the plain-text token ONCE — it is never stored
  ctx.json({ token: plaintext }, 201);
}
```

`createToken` builds the row but does not persist it, which is what lets you insert
it inside the same transaction as whatever else the request creates.

#### Setting up BearerTokenMiddleware

`BearerTokenMiddleware` reads `Authorization: Bearer <token>`, hashes it, looks it up via the registered loader, and sets `ctx.user` when valid. Register the loader (and an optional toucher to track `last_used_at`) once:

```typescript
// in AuthProvider.onBooted() or a custom AppProvider
import { BearerTokenMiddleware } from "@zerotal/auth";
import { DB } from "@zerotal/orm";

BearerTokenMiddleware.setLoader(async (hash) =>
  DB.table("personal_access_tokens").where("token", hash).first(),
);

BearerTokenMiddleware.setToucher(async (id) => {
  await DB.table("personal_access_tokens")
    .where("id", id)
    .update({ last_used_at: new Date().toISOString() });
});
```

The loader receives the _hash_, never the plaintext — the middleware hashes the
incoming header before looking anything up, which is why a leaked database still
yields no usable tokens. The toucher is optional; skip it when you do not need
last-used tracking, since it adds a write to every authenticated request.

Apply to API routes, and check abilities with `ctx.tokenCan()`:

```typescript fragment
// routes/api.ts
Router.group({ prefix: "/api", middleware: [BearerTokenMiddleware] }, () => {
  Router.get("/me", UserController, "show");
  Router.post("/posts", PostController, "store");
});
```

## Testing

Authentication is worth testing from the outside in: what matters is whether a
request reaches the route, not which internal method decided that it could.
`@zerotal/testing` gives you a genuinely signed-in request and assertions about
who the server thinks is making it.

### Acting as a user

`actingAs(user)` makes the next request arrive authenticated. It is not a mock —
the test client encodes a session through your app's own session driver and sends
a real cookie, so the request travels the same middleware path a browser's would
and anything reading the current user sees the one you named.

```typescript fragment
// tests/http/auth.test.ts
import { createTestApp } from "@zerotal/testing";
import { UserFactory } from "../../database/factories/UserFactory.ts";
import { Hash } from "@zerotal/auth";

it("dashboard is accessible to authenticated users", async () => {
  const user = await UserFactory.create();
  const res = await testApp.actingAs(user).get("/dashboard");
  res.assertOk();
});

it("dashboard redirects guests to login", async () => {
  const res = await testApp.get("/dashboard");
  res.assertRedirect("/login");
});
```

`actingAs` only needs an object carrying an `id`, so a full model is optional when
the route reads nothing else:

```typescript fragment
const res = await testApp.actingAs({ id: 42 }).get("/profile");
```

The acting user persists on the test client across requests — what you want inside
one test, and a leak across several. Clear it between tests:

```typescript fragment
afterEach(() => testApp.actingAsGuest());
```

`withSession(data)` seeds extra session values alongside the acting user, for
routes that read something the real login flow would have put there:

```typescript fragment
const res = await testApp.actingAs(user).withSession({ locale: "fr" }).get("/profile");
```

### Asserting who is signed in

These three describe the session the response left behind, which is how you test
the login flow itself rather than a route it protects.

| Assertion                     | Passes when                                 |
| ----------------------------- | ------------------------------------------- |
| `assertAuthenticated()`       | Someone is signed in                        |
| `assertAuthenticatedAs(user)` | That specific user is — takes a model or id |
| `assertGuest()`               | Nobody is                                   |

```typescript fragment
it("signs the user in on valid credentials", async () => {
  const user = await UserFactory.create({ password: await Hash.make("secret") });

  const res = await testApp.post("/login", { email: user.email, password: "secret" });

  res.assertRedirect("/dashboard");
  res.assertAuthenticatedAs(user);
});

it("signs the user out", async () => {
  const res = await testApp.actingAs(user).post("/logout");
  res.assertGuest();
});
```

### Testing a rejected request

How a guarded route refuses differs by style, and asserting the wrong one lets a
test pass for the wrong reason:

- **Session routes** send an unauthenticated visitor to the login page — assert
  `assertRedirect("/login")`.
- **API routes** answer with a status — `assertUnauthorized()` for 401 (not signed
  in) and `assertForbidden()` for 403 (signed in, not permitted).

```typescript fragment
it("rejects an API request with no token", async () => {
  const res = await testApp.asJson().get("/api/orders");
  res.assertUnauthorized();
});

it("rejects a signed-in user without the ability", async () => {
  const res = await testApp.actingAs(viewer).delete("/api/orders/1");
  res.assertForbidden();
});
```

A failed login usually redirects back carrying validation errors rather than a
status code, so assert on the errors:

```typescript fragment
it("login with wrong password redirects back", async () => {
  const user = await UserFactory.create({ password: await Hash.make("correct") });

  const res = await testApp.post("/login", { email: user.email, password: "wrong" });

  res.assertRedirect("/login");
  res.assertSessionHasErrors("email");
});
```

### Token-authenticated requests

A bearer guard reads a header rather than a cookie, so `actingAs` plays no part —
issue a token and send it the way a client would. `createToken` returns the
plain-text value once, which is the value the header carries:

```typescript fragment
import { createToken } from "@zerotal/auth";
import { DB } from "@zerotal/orm";

it("serves the API with a valid token", async () => {
  const user = await UserFactory.create();
  const { plaintext, row } = await createToken({ tokenableId: user.id, name: "tests" });
  await DB.table("personal_access_tokens").insert(row);

  const res = await testApp
    .withHeaders({ Authorization: `Bearer ${plaintext}` })
    .asJson()
    .get("/api/me");

  res.assertOk();
});
```

### Following the redirect

By default the client hands back the redirect itself, which is what a login flow
should assert on. When the page the user lands on is the point, ask for it:

```typescript fragment
const res = await testApp.followingRedirects().post("/login", { email, password });
res.assertOk();
res.assertSee("Welcome back");
```

## References

### Commands

`@zerotal/auth` ships two commands:

| Command                                      | What it does                                                          |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `bun zt make:policy PostPolicy --model Post` | Create a new authorization policy class                               |
| `bun zt auth:sync-permissions`               | Create code-declared permissions that don't yet exist in the database |

### Auth facade

| Method                                | Signature                                                      | Description                                          |
| ------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| `Auth.check()`                        | `(): boolean`                                                  | `true` if request has an authenticated user          |
| `Auth.guest()`                        | `(): boolean`                                                  | Inverse of `check()`                                 |
| `Auth.viaRemember()`                  | `(): boolean`                                                  | `true` if authenticated via the remember-me cookie   |
| `Auth.user()`                         | `(): UserModel`                                                | Current user; throws `UnauthorizedError` for guests  |
| `Auth.userOrNull()`                   | `(): UserModel \| undefined`                                   | Safe — never throws                                  |
| `Auth.id()`                           | `(): number`                                                   | Current user's ID; throws for guests                 |
| `Auth.login(user, opts?)`             | `(user: UserModel, opts?: LoginOptions): Promise<void>`        | Write `user_id` to session and set `ctx.user`        |
| `Auth.logout()`                       | `(): Promise<void>`                                            | Clear `user_id` from session and unset `ctx.user`    |
| `Auth.attempt(creds, rem?)`           | `(creds: Credentials, remember?: boolean): Promise<boolean>`   | Find user, verify password, log in on success        |
| `Auth.attemptWhen(...)`               | `(creds, cb, remember?): Promise<boolean>`                     | Like `attempt`, gated by a callback check            |
| `Auth.validate(creds)`                | `(creds: Credentials): Promise<boolean>`                       | Verify credentials without logging in                |
| `Auth.once(creds)`                    | `(creds: Credentials): Promise<boolean>`                       | Authenticate for this request only (no session)      |
| `Auth.loginUsingId(id)`               | `(id: number, remember?: boolean): Promise<UserModel \| null>` | Log in by primary key                                |
| `Auth.confirmPassword(pw)`            | `(password: string): Promise<boolean>`                         | Verify password & stamp a fresh confirmation         |
| `Auth.hasRecentlyConfirmedPassword()` | `(timeoutSeconds?: number): boolean`                           | True if confirmed within the window (default 3h)     |
| `Auth.logoutOtherDevices(pw)`         | `(password: string): Promise<boolean>`                         | Invalidate the user's other sessions                 |
| `Auth.guard(name?)`                   | `(name?: string): Guard`                                       | Access a guard (`web` default; named via viaRequest) |
| `Auth.viaRequest(name, fn)`           | `(name: string, resolver): void`                               | Register a custom request guard                      |
| `Auth.hasRole(role)`                  | `(role: string): boolean`                                      | True when user has the given role                    |
| `Auth.hasAnyRole(roles)`              | `(roles: string[]): boolean`                                   | True when user has at least one role                 |
| `Auth.hasAllRoles(roles)`             | `(roles: string[]): boolean`                                   | True when user has every role                        |
| `Auth.can(ability)`                   | `(ability: string): boolean`                                   | True when user has the given permission              |
| `Auth.authorize(ability)`             | `(ability: string): void`                                      | Throws `ForbiddenError` if user lacks the ability    |
| `Auth.roles()`                        | `(): string[]`                                                 | Array of role names (empty for guests)               |

> **Note** — The role and permission helpers (`hasRole`, `can`, `authorize`, …) require a user model that composes the relevant mixins. See [Authorization](/docs/authorization) and [Roles & 2FA](/docs/roles-and-2fa).

### Two-factor API

| Method                                             | Signature                                                                         | Description                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------- |
| `TwoFactor.generateSecret()`                       | `(): string`                                                                      | 20-byte random base-32 secret    |
| `TwoFactor.getQrCodeUrl(label, secret, issuer?)`   | `(label: string, secret: string, issuer?: string): string`                        | `otpauth://totp/…` URI           |
| `TwoFactor.verifyCode(secret, token)`              | `(secret: string, token: string): boolean`                                        | Verify a 6-digit TOTP code       |
| `TwoFactor.generateRecoveryCodes()`                | `(): { plain: string[]; hashed: string[] }`                                       | Generate one-time recovery codes |
| `TwoFactor.verifyRecoveryCode(storedHashed, code)` | `(storedHashed: string[], code: string): { valid: boolean; remaining: string[] }` | Consume a recovery code          |

### Personal access tokens

| Function                 | Signature                                   | Description                                    |
| ------------------------ | ------------------------------------------- | ---------------------------------------------- |
| `createToken(options)`   | `(options): Promise<NewToken>`              | Generate a token; returns `{ plaintext, row }` |
| `hashToken(plaintext)`   | `(plaintext: string): Promise<string>`      | SHA-256 hex of a plain-text token              |
| `tokenCan(row, ability)` | `(row: TokenRow, ability: string): boolean` | True when the token grants the ability         |
