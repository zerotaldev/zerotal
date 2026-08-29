---
title: Social Login
description: Authenticate users through GitHub, Google, and Apple with OAuth2 drivers that handle CSRF state, token exchange, and profile normalisation for you.
---

# Social Login

Social login ships as part of `@zerotal/auth` — OAuth2-based authentication with
built-in drivers for GitHub, Google, and Apple. CSRF state management, GET/POST
normalisation, GitHub's hidden-email fallback, and Apple's JWT signing are all
handled inside the driver — your controller stays thin.

## Getting Started

Social login is included in `@zerotal/auth`; if you already have the auth
package installed there is nothing extra to add. Otherwise:

```bash
# in your project root
bun add @zerotal/auth
```

## Register the provider

Add `SocialProvider` to the providers array in `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { SocialProvider } from "@zerotal/auth";

const providers = [
  // …your other providers
  SocialProvider,
];

export default providers;
```

Registering the provider switches on the following (in lifecycle order):

- `onRegister` — binds the `SocialManager` as the `"social"` singleton and
  registers the `Router.social()` router macro, so the macro is available in
  every route file before the app boots.
- `onBooted` — reads `config/social.ts` from the container's `config` service
  and instantiates a built-in driver (`github`, `google`, `apple`) for every key
  it recognises. Unrecognised keys are silently skipped.

> **Note** — `SocialProvider` only runs in the `web` and `test` environments
> (`static environments = ["web", "test"]`). If the `config` service is
> unavailable at boot, no drivers are auto-registered — register them yourself
> with `Social.register()` (see [Writing a custom driver](#writing-a-custom-driver)).

## Configuration

Create `config/social.ts` using the `SocialConfig()` helper (or `satisfies
SocialConfigShape`). The config maps each provider name to its OAuth2
credentials — there are no framework defaults, so include only the providers you
use and source secrets from the environment with `env()`:

```typescript
// config/social.ts
import { SocialConfig } from "@zerotal/auth";
import { env } from "zerotal";

export default SocialConfig({
  github: {
    clientId: env("GITHUB_CLIENT_ID", ""),
    clientSecret: env("GITHUB_CLIENT_SECRET", ""),
    redirectUrl: env("GITHUB_REDIRECT_URL", ""), // https://myapp.com/auth/github/callback
  },
  google: {
    clientId: env("GOOGLE_CLIENT_ID", ""),
    clientSecret: env("GOOGLE_CLIENT_SECRET", ""),
    redirectUrl: env("GOOGLE_REDIRECT_URL", ""),
  },
  // apple: { … }   ← see the Apple section below
});
```

Each provider entry accepts the following fields:

| Field          | Required | Default             | Description                                                         |
| -------------- | -------- | ------------------- | ------------------------------------------------------------------- |
| `clientId`     | yes      | —                   | OAuth2 client ID (Apple Service ID).                                |
| `clientSecret` | no\*     | —                   | Static client secret. Apple may omit it and supply raw credentials. |
| `redirectUrl`  | yes      | —                   | The callback URL registered with the provider.                      |
| `scopes`       | no       | per-driver defaults | Override the driver's default scopes (see each provider section).   |

\* For Apple you supply either `clientSecret` (a pre-signed JWT) or the raw
`teamId` / `keyId` / `privateKey` trio — see [Apple](#apple).

## Login flow

### 1. Write a controller

The driver handles CSRF state, session storage, and code extraction. Your
controller is a few lines per action — read the provider from `ctx.params`:

```typescript fragment
// app/controllers/SocialController.ts
import { Social } from "@zerotal/auth";
import type { HttpContext } from "zerotal";
import { User } from "../models/User.ts";

export class SocialController {
  // Step 1 — generate state, store in session, redirect to provider
  async redirect(ctx: HttpContext) {
    return Social.driver(ctx.params.provider).redirect();
  }

  // Step 2 — verify state, extract code, fetch user profile
  async callback(ctx: HttpContext) {
    try {
      const socialUser = await Social.driver(ctx.params.provider).user();

      // Find or create the local user — that's all you need to write
      const user = await User.firstOrCreate(
        { provider_id: socialUser.id },
        {
          name: socialUser.name,
          email: socialUser.email,
          provider: ctx.params.provider,
        },
      );

      ctx.session.regenerate();
      ctx.session.set("user_id", user.id);
      ctx.redirect("/dashboard");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown_error";
      ctx.redirect(`/login?error=${msg}`);
      // e.message is 'invalid_state' or 'missing_code' on validation failure,
      // or a provider error message on token/profile fetch failure.
    }
  }
}
```

> **Note** — On a stateful (session) flow, `.user()` is called with no arguments;
> the driver reads the active request from async-local storage, extracts `code`
> and `state`, and verifies `state` against the session before exchanging the
> code.

### 2. Register routes

`SocialProvider` registers `Router.social()` as a router macro — the same
mechanism used by `@zerotal/flow` (`Router.flow`) and `@zerotal/inertia`
(`Router.inertia`). Once `SocialProvider` is in your bootstrap, the macro is
available in every route file with no additional import:

```typescript fragment
// routes/auth.ts
import { Router } from "zerotal";
import { SocialController } from "../app/controllers/SocialController.ts";

Router.social("/auth", SocialController);
// Expands to:
//   Router.get('/auth/:provider',           SocialController, 'redirect');
//   Router.get('/auth/:provider/callback',  SocialController, 'callback');
//   Router.post('/auth/:provider/callback', SocialController, 'callback');  // Apple
```

Or register routes individually for full control:

```typescript fragment
// routes/auth.ts
import { Router } from "zerotal";
import { SocialController } from "../app/controllers/SocialController.ts";

Router.get("/auth/:provider", SocialController, "redirect");
Router.get("/auth/:provider/callback", SocialController, "callback");
Router.post("/auth/:provider/callback", SocialController, "callback");
```

### The SocialUser shape

Every driver normalises the raw provider response into the same interface:

| Property       | Type                      | Description                                             |
| -------------- | ------------------------- | ------------------------------------------------------- |
| `id`           | `string`                  | Provider-unique user ID.                                |
| `name`         | `string`                  | Display name.                                           |
| `email`        | `string \| null`          | Primary email (always resolved — see per-driver notes). |
| `avatar`       | `string \| null`          | Profile picture URL.                                    |
| `token`        | `string`                  | Raw access token.                                       |
| `refreshToken` | `string \| null`          | Refresh token, when the provider issues one.            |
| `expiresIn`    | `number \| null`          | Access-token lifetime in seconds, when provided.        |
| `raw`          | `Record<string, unknown>` | Full provider payload for custom fields.                |

Most providers only return a `refreshToken` when you explicitly request offline
access — see [Requesting scopes and parameters](#requesting-scopes-and-parameters)
for Google's `access_type=offline` example. Store the refresh token if you need to
call the provider's API on the user's behalf later.

## GitHub

Default scopes: `read:user user:email`.

```typescript fragment
// config/social.ts
github: {
  clientId:     env("GITHUB_CLIENT_ID", ""),
  clientSecret: env("GITHUB_CLIENT_SECRET", ""),
  redirectUrl:  env("GITHUB_REDIRECT_URL", ""),
  scopes: ['read:user', 'user:email', 'repo'],   // override only if you need extra scopes
},
```

GitHub returns `null` for `email` when the user has a private address.
`GitHubDriver` calls `/user/emails` internally and populates the verified
primary email before returning `SocialUser` — no extra code in your controller.

> **Note** — `GitHubDriver` omits `response_type=code` from the authorization URL;
> GitHub returns a 404 if it is present. Custom GitHub-style drivers can do the
> same by overriding `includeResponseType()` to return `false`.

## Google

Default scopes: `openid profile email`.

```typescript fragment
// config/social.ts
google: {
  clientId:     env("GOOGLE_CLIENT_ID", ""),
  clientSecret: env("GOOGLE_CLIENT_SECRET", ""),
  redirectUrl:  env("GOOGLE_REDIRECT_URL", ""),
},
```

Google always returns a verified email. `socialUser.email` is never null with
the default scopes.

## Apple

Sign in with Apple has three quirks — all handled internally by `AppleDriver`:

1. **User profile is sent only once.** Apple sends `name` and `email` on the very
   first authorization. On every subsequent login those fields are absent. Store
   them in your database on the first callback.
2. **Callbacks arrive as POST requests.** Apple uses `response_mode: form_post`.
   The driver reads `code` and `state` from the POST body automatically — your
   controller code is identical to other providers.
3. **`clientSecret` is a signed ES256 JWT.** You have two options below.

> **Warning** — Because Apple sends the profile only on the first login, you must
> persist `socialUser.name` and `socialUser.email` on the first callback. Later
> logins will have `name` empty and `email` populated only from the `id_token`.

**Option A — supply raw credentials (recommended).** Pass your Apple Developer
credentials and the driver signs the JWT automatically using the Web Crypto API.
No extra dependency needed:

```typescript fragment
// config/social.ts
apple: {
  clientId:    'com.myapp.service',          // your Service ID
  teamId:      env("APPLE_TEAM_ID", ""),     // 10-character Team ID
  keyId:       env("APPLE_KEY_ID", ""),      // Key ID from App Store Connect
  privateKey:  env("APPLE_PRIVATE_KEY", ""), // full PEM string (-----BEGIN PRIVATE KEY-----)
  redirectUrl: env("APPLE_REDIRECT_URL", ""),
},
```

**Option B — pre-sign the JWT yourself** (e.g. with `apple-signin-auth`) and pass
it as `clientSecret`. Useful if you rotate the JWT externally:

```typescript fragment
// config/social.ts
apple: {
  clientId:     'com.myapp.service',
  clientSecret: generateAppleClientSecret(),   // your pre-signed JWT
  redirectUrl:  env("APPLE_REDIRECT_URL", ""),
},
```

> **Note** — If you supply neither a `clientSecret` nor the `teamId` / `keyId` /
> `privateKey` trio, `AppleDriver` throws `AppleClientSecretError` on the first
> token exchange.

## More built-in providers

Alongside GitHub, Google, and Apple, six more drivers ship built-in and are
auto-registered from `config/social.ts` by their key — just supply credentials:

| Key         | Driver            | Default scopes                   | Notes                                                                |
| ----------- | ----------------- | -------------------------------- | -------------------------------------------------------------------- |
| `discord`   | `DiscordDriver`   | `identify email`                 | Avatar URL is built from the user id + avatar hash.                  |
| `microsoft` | `MicrosoftDriver` | `openid profile email User.Read` | Uses the common tenant + Microsoft Graph `/me`.                      |
| `facebook`  | `FacebookDriver`  | `email public_profile`           | Requests `picture.type(large)` for the avatar.                       |
| `twitter`   | `TwitterDriver`   | `tweet.read users.read`          | OAuth2; the profile is under `data`, and email is `null` by default. |
| `linkedin`  | `LinkedInDriver`  | `openid profile email`           | OpenID Connect userinfo (`sub` is the id).                           |
| `gitlab`    | `GitLabDriver`    | `read_user`                      | Targets gitlab.com.                                                  |

```typescript fragment
// config/social.ts — same shape as github/google/apple
discord: {
  clientId:     env("DISCORD_CLIENT_ID", ""),
  clientSecret: env("DISCORD_CLIENT_SECRET", ""),
  redirectUrl:  env("DISCORD_REDIRECT_URL", ""),
},
```

Each is also exported (`DiscordDriver`, `MicrosoftDriver`, …) for manual
registration via `Social.register()`, and you can still
[write a custom driver](#writing-a-custom-driver) for anything not covered.

## Requesting scopes and parameters

Scopes can be set per-provider in `config/social.ts`, but you can also add or
replace them fluently at redirect time. `.scopes()` merges with the configured /
default scopes; `.setScopes()` replaces them outright:

```typescript fragment
// Ask for extra GitHub scopes on top of the defaults
Social.driver("github").scopes(["repo", "read:org"]).redirect();

// Replace the scope list entirely
Social.driver("github").setScopes(["read:user"]).redirect();
```

Use `.with()` to append provider-specific query parameters to the authorization
URL. This is how you request a refresh token from Google — Google only returns one
when you ask for offline access and force the consent screen:

```typescript fragment
Social.driver("google").with({ access_type: "offline", prompt: "consent" }).redirect();

// On callback, socialUser.refreshToken is now populated.
```

Each fluent call returns a fresh copy of the driver, so the singleton registered
by `SocialProvider` is never mutated and concurrent requests don't interfere.

## Retrieving a user from a token

If your client already holds an access token — for example a mobile app that ran
its own native OAuth SDK — skip the code exchange and fetch the profile directly
with `userFromToken()`:

```typescript fragment
const socialUser = await Social.driver("github").userFromToken(accessToken);
```

The returned user has no `refreshToken` or `expiresIn` (those only come from a
code exchange), but `id`, `name`, `email`, and `avatar` are fully resolved.

## Stateless mode

When you're building an API backend for an SPA or mobile app, you may receive a
raw `code` from the client without a session. Call `.stateless()` to skip CSRF
state verification and pass the code directly to `.user()`:

```typescript fragment
// app/controllers/SocialApiController.ts — POST /auth/callback { provider, code }
import { Social } from "@zerotal/auth";
import type { HttpContext } from "zerotal";

async callback(ctx: HttpContext) {
  const { provider, code } = await ctx.request.json<{ provider: string; code: string }>();
  const socialUser = await Social.driver(provider).stateless().user(code);
  // … find or create user, return JWT …
}
```

`.stateless()` returns a shallow copy of the driver — the singleton registered by
`SocialProvider` is never mutated.

### Stateful or stateless — which should I use?

- **Stateful (the default).** Server-rendered apps where the browser holds a
  session cookie. Call `.redirect()` then `.user()` with no arguments; the driver
  generates and verifies the CSRF `state` for you.
- **Stateless.** API backends for an SPA or native app that send the raw `code`
  themselves and have no server session. Call `.stateless().user(code)`; CSRF
  state verification is skipped, so verify the request another way (e.g. PKCE on
  the client).

> **Warning** — Stateless mode disables CSRF `state` verification. Only use it
> when the client performs its own request integrity check; otherwise prefer the
> stateful flow.

## Testing

`Social.fake()` swaps a provider for a stub driver that never touches the network.
`redirect()` still issues a real redirect (so redirect-route tests pass), while
`user()` returns a canned profile. Build that profile with `fakeSocialUser()`,
overriding only the fields your test cares about:

```typescript fragment
import { Social, fakeSocialUser } from "@zerotal/auth";

test("logs a user in via GitHub", async () => {
  Social.fake("github", fakeSocialUser({ id: "github-123", email: "jane@example.com" }));

  const res = await app.get("/auth/github/callback");

  res.assertRedirect("/dashboard");
  await assertDatabaseHas("users", { email: "jane@example.com", github_id: "github-123" });
});
```

`fakeSocialUser()` fills complete, valid defaults (including `token`,
`refreshToken`, and `expiresIn`), so you only specify what matters to the
assertion.

## Writing a custom driver

Extend `OAuth2Driver` and implement the five abstract members — `authUrl()`,
`tokenUrl()`, `userUrl()`, `defaultScopes()`, and `normalise()`:

```typescript
// app/social/TwitterDriver.ts
import { OAuth2Driver } from "@zerotal/auth";
import type { SocialUser } from "@zerotal/auth";

export class TwitterDriver extends OAuth2Driver {
  protected authUrl() {
    return "https://twitter.com/i/oauth2/authorize";
  }
  protected tokenUrl() {
    return "https://api.twitter.com/2/oauth2/token";
  }
  protected userUrl() {
    return "https://api.twitter.com/2/users/me?user.fields=profile_image_url";
  }

  protected defaultScopes() {
    return ["tweet.read", "users.read"];
  }

  protected normalise(raw: Record<string, unknown>, token: string): SocialUser {
    const data = raw["data"] as Record<string, unknown>;
    return {
      id: String(data["id"]),
      name: String(data["name"] ?? ""),
      email: null, // requires extra scope
      avatar: typeof data["profile_image_url"] === "string" ? data["profile_image_url"] : null,
      token,
      raw,
    };
  }
}
```

Register it via the `Social` facade — typically in an `AppProvider`'s `onBooted`
hook, since the `"social"` singleton is bound during `onRegister`:

```typescript fragment
// app/providers/AppProvider.ts
import { ServiceProvider } from "zerotal";
import { Social } from "@zerotal/auth";
import { TwitterDriver } from "../social/TwitterDriver.ts";

export class AppProvider extends ServiceProvider {
  override async onBooted(): Promise<void> {
    Social.register(
      "twitter",
      new TwitterDriver({
        clientId: Bun.env.TWITTER_CLIENT_ID!,
        clientSecret: Bun.env.TWITTER_CLIENT_SECRET!,
        redirectUrl: Bun.env.TWITTER_REDIRECT_URL!,
      }),
    );
  }
}
```

`Social.register()` adds the driver to the manager directly, so a custom driver
does not need a `config/social.ts` entry (built-in keys are the only ones
auto-registered by `SocialProvider`).

> **Tip** — Override `afterNormalise()` to enrich the profile with a second
> request (this is how `GitHubDriver` resolves hidden emails), `extraAuthParams()`
> to append query params to the redirect, or `_extractCodeAndState()` to read the
> callback from somewhere other than the query string (this is how `AppleDriver`
> handles `form_post`).

## References

### `Social` facade

Resolves the `"social"` singleton (`SocialManager`).

| Method     | Signature                                            | Description                                      |
| ---------- | ---------------------------------------------------- | ------------------------------------------------ |
| `driver`   | `driver(name: string): OAuth2Driver`                 | Get a registered driver. Throws if not found.    |
| `register` | `register(name: string, driver: OAuth2Driver): this` | Register a driver under a name.                  |
| `drivers`  | `drivers(): string[]`                                | List all registered driver names.                |
| `fake`     | `fake(name: string, user?: SocialUser): SocialUser`  | Swap a provider for a no-network stub (testing). |

### `OAuth2Driver` (public methods)

| Method          | Signature                                           | Description                                                             |
| --------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| `redirect`      | `redirect(): void`                                  | Generate CSRF state, store it in the session, redirect to the provider. |
| `user`          | `user(code?: string): Promise<SocialUser>`          | Exchange the callback for a profile. With `code`, runs stateless.       |
| `userFromToken` | `userFromToken(token: string): Promise<SocialUser>` | Fetch a profile from an access token you already hold.                  |
| `scopes`        | `scopes(scopes: string[]): this`                    | Add scopes (merged with defaults). Returns a copy.                      |
| `setScopes`     | `setScopes(scopes: string[]): this`                 | Replace all scopes. Returns a copy.                                     |
| `with`          | `with(params: Record<string, string>): this`        | Append optional auth-URL params (e.g. `access_type`). Returns a copy.   |
| `stateless`     | `stateless(): this`                                 | Return a copy of the driver with CSRF state verification disabled.      |
| `redirectUrl`   | `redirectUrl(state: string): string`                | Build the raw authorization URL (low-level / testing).                  |

### Errors

All extend `SocialError` (which extends `ZerotalError`). The `message` of the two
validation errors is exactly the string you forward to `?error=`.

| Error                           | `message`                 | When                                               |
| ------------------------------- | ------------------------- | -------------------------------------------------- |
| `OAuthStateMismatchError`       | `invalid_state`           | Callback `state` missing or doesn't match session. |
| `OAuthMissingCodeError`         | `missing_code`            | Callback has no authorization `code`.              |
| `UnknownSocialDriverError`      | driver-name message       | `Social.driver(name)` with an unregistered name.   |
| `SocialContextUnavailableError` | context message           | Stateful flow run outside an HTTP request.         |
| `OAuthTokenExchangeError`       | provider message          | Token exchange failed or returned no token.        |
| `OAuthUserFetchError`           | provider message          | User-profile fetch failed.                         |
| `AppleClientSecretError`        | Apple credentials message | Apple driver has neither a JWT nor raw key trio.   |

## Types

| Type                | What it is                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `OAuth2Config`      | What a provider entry in `config/services.ts` holds — id, secret, redirect URI.                                              |
| `AppleOAuth2Config` | Apple's, which needs more: a team id, a key id, and the private key it signs with.                                           |
| `SocialSession`     | What the driver stashes between the redirect out and the callback back.                                                      |
| `GoogleDriver`      | Exported so a custom driver can extend it rather than reimplement OIDC.                                                      |
| `FakeSocialDriver`  | What `Social.fake()` installs — returns a canned profile instead of exchanging a code. See [Mocking](/docs/testing/mocking). |

## Next steps

- [Authentication](/docs/authentication) — establish the session after a social login.
- [Authorization](/docs/authorization) — gate routes once the user is signed in.
- [CSRF](/docs/csrf) — understand the state protection the drivers apply.
- [Session](/docs/session) — manage the logged-in user across requests.
