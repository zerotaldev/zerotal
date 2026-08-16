---
title: Two-Factor Authentication
description: Add TOTP-based two-factor authentication so logins require a one-time code from an authenticator app.
---

# Two-Factor Authentication

`@zerotal/auth` ships TOTP-based two-factor authentication (2FA) — generate a
secret, show a QR code, verify six-digit codes, and gate routes until the user
completes a challenge. It is RFC 6238 (TOTP) implemented natively for Bun with no
external dependencies.

> **Note** — Looking for roles & permissions? RBAC lives in its own relational
> model — the `Roles` and `Permissions` mixins composed via
> `Model.using(Authenticatable, Permissions, Roles)`. See
> [Authorization](/docs/authorization).

## Getting Started

```bash
# in your project root
bun add @zerotal/auth
```

## Register the provider

2FA is part of `@zerotal/auth`, so registering `AuthProvider` in
`bootstrap/providers.ts` is all the wiring it needs:

```ts
// bootstrap/providers.ts
import { AuthProvider } from "@zerotal/auth";

const providers = [
  // …your other providers
  AuthProvider,
];

export default providers;
```

Registering the provider switches on the following (2FA-relevant hooks):

- `onRegister` — binds the `two_factor` singleton (`TwoFactorService`), built from
  your `auth.twoFactor` config.
- `onBooting` — pre-resolves the `two_factor` singleton so the `TwoFactor` facade
  is ready in any provider's `onBooted`.

The `TwoFactor` facade resolves the `two_factor` container binding.

## Configuration

2FA is tuned inside the `auth` config under the `twoFactor` key. Use the
`AuthConfig()` helper so every field stays type-checked:

```ts
// config/auth.ts
import { AuthConfig } from "@zerotal/auth";

export default AuthConfig({
  algorithm: "argon2id",
  twoFactor: {
    issuer: "My App", // shown in authenticator apps
    window: 1, // ±1 TOTP period (30s) clock tolerance
    recoveryCodeCount: 8,
  },
});
```

| Field               | Required | Default     | Description                                                   |
| ------------------- | -------- | ----------- | ------------------------------------------------------------- |
| `issuer`            | no       | `"Zerotal"` | Issuer label shown in authenticator apps (your app name).     |
| `window`            | no       | `1`         | TOTP periods checked on each side of now (each period = 30s). |
| `recoveryCodeCount` | no       | `8`         | Number of one-time recovery codes generated.                  |

> **Tip** — Prefer the `AuthConfig()` helper over `satisfies AuthConfigShape`: it
> fills defaults, so you only specify the fields you want to override.

## Data model

2FA stores three columns on the user. Add a migration:

```typescript
// database/migrations/003_add_two_factor_to_users.ts
export default class AddTwoFactorToUsers extends Migration {
  async up(schema: Schema): Promise<void> {
    await schema.table("users", (table) => {
      table.string("two_factor_secret").nullable();
      table.text("two_factor_recovery_codes").nullable(); // JSON array of hashed codes
      table.timestamp("two_factor_confirmed_at").nullable();
    });
  }
  async down(schema: Schema): Promise<void> {
    await schema.table("users", (table) => {
      table.dropColumn("two_factor_secret");
      table.dropColumn("two_factor_recovery_codes");
      table.dropColumn("two_factor_confirmed_at");
    });
  }
}
```

Then expose them on the model:

```typescript
// app/models/User.ts
@(table("users").withTimestamps())
export class User extends AuthUser {
  // ... existing columns ...

  @column() twoFactorSecret?: string | null;
  @column("json") twoFactorRecoveryCodes?: string[] | null; // stored hashed
  @column("datetime") twoFactorConfirmedAt?: Carbon | null;
}
```

> **Danger** — `twoFactorRecoveryCodes` holds SHA-256 hashes of the recovery
> codes, never the plaintext. Show the plaintext to the user exactly once at
> generation time — there is no way to recover it afterwards.

## Enabling 2FA

Enrolment is a two-step flow: generate a secret and show its QR code, then verify
the user's first code before persisting. `TwoFactor.verifyCode()` and
`TwoFactor.generateRecoveryCodes()` are synchronous.

```typescript
// app/controllers/TwoFactorController.ts
import { TwoFactor } from "@zerotal/auth";

export class TwoFactorController extends Controller {
  // GET /user/two-factor — show setup page with QR code
  async setup(ctx: HttpContext) {
    const secret = TwoFactor.generateSecret();
    ctx.session.put("two_factor_pending_secret", secret);

    // The scannable code, plus the URI as a link and the secret as text for
    // anyone enrolling on the phone that holds the authenticator.
    const qr = TwoFactor.getQrCodeSvg(ctx.user!.email, secret, { size: 220 });
    const uri = TwoFactor.getQrCodeUrl(ctx.user!.email, secret);
    return this.render("two-factor/setup", { qr, uri, secret });
  }

  // POST /user/two-factor — confirm and save
  async confirm(ctx: HttpContext) {
    const secret = ctx.session.get("two_factor_pending_secret") as string;
    const code = ctx.input("code") as string;

    if (!TwoFactor.verifyCode(secret, code)) {
      return this.back().withErrors({ code: "Invalid code." });
    }

    const { plain, hashed } = TwoFactor.generateRecoveryCodes();

    await ctx
      .user!.fill({
        twoFactorSecret: secret,
        twoFactorRecoveryCodes: JSON.stringify(hashed),
        twoFactorConfirmedAt: Carbon.now(),
      })
      .save();

    ctx.session.forget("two_factor_pending_secret");

    // Show recovery codes once:
    return this.render("two-factor/recovery-codes", { codes: plain });
  }

  // DELETE /user/two-factor — disable
  async disable(ctx: HttpContext) {
    await ctx
      .user!.fill({
        twoFactorSecret: null,
        twoFactorRecoveryCodes: null,
        twoFactorConfirmedAt: null,
      })
      .save();
    return this.redirect("/profile");
  }
}
```

> **Warning** — Setting `twoFactorConfirmedAt` is what makes
> `TwoFactorMiddleware` start challenging the user. Persist the secret and a
> non-null `twoFactorConfirmedAt` together, only after a successful
> `verifyCode()`, so a half-finished enrolment never locks anyone out.

## The challenge flow

After login, the challenge controller verifies a TOTP code (falling back to a
recovery code) and marks the session as confirmed. `verifyRecoveryCode()` returns
the remaining codes synchronously so you can persist the consumed set:

```typescript
// app/controllers/TwoFactorChallengeController.ts
import { TwoFactor, TWO_FACTOR_SESSION_KEY } from "@zerotal/auth";

export class TwoFactorChallengeController extends Controller {
  // GET /two-factor/challenge
  async show(ctx: HttpContext) {
    return this.render("two-factor/challenge");
  }

  // POST /two-factor/challenge
  async verify(ctx: HttpContext) {
    const user = ctx.user! as User;
    const code = ctx.input("code") as string;
    const secret = user.twoFactorSecret!;

    // Try TOTP code first, then recovery code
    const totpOk = TwoFactor.verifyCode(secret, code);

    if (!totpOk) {
      const storedHashed = JSON.parse(user.twoFactorRecoveryCodes ?? "[]") as string[];
      const recoveryResult = TwoFactor.verifyRecoveryCode(storedHashed, code);

      if (!recoveryResult.valid) {
        return this.back().withErrors({ code: "Invalid code." });
      }

      // Consume the recovery code
      await user
        .fill({
          twoFactorRecoveryCodes: JSON.stringify(recoveryResult.remaining),
        })
        .save();
    }

    // Mark 2FA as confirmed for this session
    ctx.session.put(TWO_FACTOR_SESSION_KEY, true);
    return this.redirect(ctx.session.get("url.intended", "/") as string);
  }
}
```

> **Tip** — `TWO_FACTOR_SESSION_KEY` (the string `"two_factor_confirmed"`) is
> exported from `@zerotal/auth`. Use the constant rather than re-typing the key so
> your controller and the middleware always agree.

## Protecting routes

Add `TwoFactorMiddleware` **after** `AuthMiddleware` in any group that should
require 2FA:

```typescript
// routes/web.ts
import { AuthMiddleware, TwoFactorMiddleware } from "@zerotal/auth";

Router.group({ middleware: [AuthMiddleware, TwoFactorMiddleware] }, () => {
  Router.get("/dashboard", DashboardController, "index");
  Router.get("/settings", SettingsController, "index");
});
```

`TwoFactorMiddleware` passes the request through if:

- The request is authenticated but the user has no `twoFactorSecret`, or
- `twoFactorConfirmedAt` is null (enrolment never confirmed), or
- The session already contains `two_factor_confirmed === true`.

If the user has a confirmed secret but this session has not passed the challenge,
it redirects to `TwoFactorMiddleware.challengeRoute` (default
`/two-factor/challenge`). An unauthenticated request throws `UnauthorizedError`.

Override the redirect target globally by setting the static property:

```typescript
// bootstrap/app.ts
import { TwoFactorMiddleware } from "@zerotal/auth";

TwoFactorMiddleware.challengeRoute = "/auth/2fa";
```

## Displaying the QR code

`getQrCodeSvg()` returns the scannable code as an inline `<svg>`, drawn in your
process. Inline it — do not fetch it, and do not log it:

```tsx
// in a Flow page
const qr = TwoFactor.getQrCodeSvg(user.email, secret, { size: 220 });

return <div dangerouslySetInnerHTML={{ __html: qr }} />;
```

> **Danger** — never hand the `otpauth://` URI to a QR image service. It carries
> the TOTP secret, so a request to `api.qrserver.com` or any similar endpoint
> posts the second factor to a third party and leaves it in their logs. Serving
> the image from a route of your own has the same shape of problem: it turns the
> secret into something requestable, proxy-loggable and browser-cacheable. That
> is why this renders in-process and returns markup rather than a URL.

Options: `issuer` overrides the configured one for this code; `size` sets width
and height in pixels (omit it and the symbol scales to its container);
`dark`/`light` set the colours, with `light: null` for a transparent background;
`quietZone` is the light margin in modules, which defaults to the 4 the spec
requires — drop it to `0` only when the surrounding element already provides a
light margin, because scanners use that margin to find the symbol's edges;
`alt` and `class` set the accessible name and the CSS class.

**Offer the secret as text too.** A phone cannot photograph its own screen, so
anyone enrolling on the device that holds the authenticator needs another way in
— the secret in readable blocks to type, or the `otpauth://` URI from
`getQrCodeUrl()` as a link, which opens the authenticator app directly:

```tsx
<a href={TwoFactor.getQrCodeUrl(user.email, secret)}>Open in my authenticator</a>
```

To draw the code yourself — to a canvas, a PNG, or your own markup — `encodeQr()`
returns the module matrix and `qrSvg()` renders one:

```ts
import { encodeQr } from "@zerotal/auth";

const matrix = encodeQr(TwoFactor.getQrCodeUrl(user.email, secret));
for (let row = 0; row < matrix.size; row++) {
  for (let col = 0; col < matrix.size; col++) {
    if (matrix.isDark(row, col)) ctx.fillRect(col * 4, row * 4, 4, 4);
  }
}
```

The encoder covers byte mode at error-correction level M, versions 1 through 20
— `maxPayloadBytes()` bytes in all. A typical `otpauth://` URI is about 130
bytes; past the ceiling, `QrError` is thrown rather than a truncated symbol
produced, and the fix is a shorter issuer or account label.

Authenticator apps that support TOTP: Google Authenticator, Authy, 1Password,
Bitwarden, Microsoft Authenticator.

## Testing

Set your suite up once as described in [Testing](/docs/testing) — everything
below assumes `createApp()` from your `tests/helpers.ts`.

Most of the two-factor surface is pure, so it tests without an application, a
database, or a clock:

```typescript
// tests/auth/two-factor.test.ts
import { test, expect } from "bun:test";
import { TwoFactorService } from "@zerotal/auth";

test("a recovery code verifies once and is then consumed", () => {
  const tf = new TwoFactorService();
  const { plain, hashed } = tf.generateRecoveryCodes();

  const first = tf.verifyRecoveryCode(hashed, plain[0]!);
  expect(first.valid).toBe(true);
  expect(first.remaining).toHaveLength(hashed.length - 1);

  // The same code must not work twice.
  expect(tf.verifyRecoveryCode(first.remaining, plain[0]!).valid).toBe(false);
});
```

**Drive the challenge with a real code.** `generateCode(secret)` produces exactly
what an authenticator app would show, so the test exercises the TOTP path rather
than working around it:

```typescript
// tests/http/two-factor.test.ts
import { test } from "bun:test";
import { createApp } from "../helpers.ts";
import { TwoFactorService } from "@zerotal/auth";
import { User } from "../../app/models/User.ts";

test("a valid code clears the challenge", async () => {
  const app = await createApp();
  const tf = new TwoFactorService();
  const secret = tf.generateSecret();

  const user = await User.create({
    email: "jane@example.com",
    twoFactorSecret: secret,
    twoFactorConfirmedAt: new Date(),
  });

  const res = await app
    .actingAs(user)
    .post("/two-factor/challenge", { code: tf.generateCode(secret) });

  res.assertRedirect("/dashboard");
  await app.close();
});
```

`generateCode(secret, -1)` returns the previous slot's code, which is how you
assert that your replay guard rejects a code that has already been used.

A recovery code works the same way and needs no clock at all — pass one of the
`plain` values from `generateRecoveryCodes()` to the same endpoint.

To prove a route is _protected_, assert the challenge redirect rather than trying
to get past it — `assertRedirect("/two-factor/challenge")` is the whole test.

## References

The `TwoFactor` facade proxies the `two_factor` singleton (a `TwoFactorService`).
All methods are synchronous.

| Method                                   | Signature                                                                           | Description                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `generateSecret()`                       | `() => string`                                                                      | Random 20-byte base-32 secret for a new enrolment.                                 |
| `getQrCodeUrl(label, secret, issuer?)`   | `(label: string, secret: string, issuer?: string) => string`                        | `otpauth://totp/...` URI for an authenticator app.                                 |
| `getQrCodeSvg(label, secret, options?)`  | `(label: string, secret: string, options?: TwoFactorQrOptions) => string`           | The same URI as an inline `<svg>`, drawn in-process. Inline it; never fetch it.    |
| `generateCode(secret, offset?)`          | `(secret: string, offset?: number) => string`                                       | Produce the code an authenticator would show. For tests — never send it to a user. |
| `verifyCode(secret, token)`              | `(secret: string, token: string) => boolean`                                        | Verify a 6-digit TOTP code within the time window.                                 |
| `generateRecoveryCodes()`                | `() => { plain: string[]; hashed: string[] }`                                       | Fresh one-time recovery codes (plaintext + hashes).                                |
| `verifyRecoveryCode(storedHashed, code)` | `(storedHashed: string[], code: string) => { valid: boolean; remaining: string[] }` | Consume a recovery code, returning the unused ones.                                |

## Next steps

- [Authentication](/docs/authentication) — login, the auth middleware, and the session flow 2FA builds on.
- [Authorization](/docs/authorization) — gates, policies, roles, and permissions.
- [Session](/docs/session) — how the per-request session that stores `two_factor_confirmed` works.
- [Encryption & Hashing](/docs/encryption) — how passwords and other secrets are hashed.
