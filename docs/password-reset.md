---
title: Password Reset
description: Generate, email, and verify hashed reset tokens so users can securely set a new password.
---

# Password Reset

`PasswordBroker` handles the full password reset flow: generating and storing a
hashed token, emailing the reset link, verifying the token on submission, and
calling your password-update logic. It is database-agnostic — you supply the query
functions.

The broker never stores or emails the raw token. It generates a random plain token,
**SHA-256 hashes it** before handing it to `storeToken`, and emails the plain token
to the user. On `reset()` it re-hashes the submitted token and compares — so a leaked
database row can't be turned back into a working reset link.

> **Danger** — Store only the hashed token, exactly as the broker hands it to `storeToken`. Persisting the plain token would let anyone with database access forge a working reset link.

## Getting Started

`PasswordBroker` ships in the auth package:

```bash
# in your project root
bun add @zerotal/auth
```

There is no provider or `config/` file to register — you construct the broker
yourself and supply the query functions, so it works with any storage backend.

## Migration

The broker reads and writes through your query functions, so it needs a table to
back them. The default examples below use a `password_reset_tokens` table keyed by
email:

```typescript fragment
// database/migrations/xxxx_create_password_reset_tokens.ts
await Schema.create("password_reset_tokens", (table) => {
  table.string("email").primary();
  table.string("token");
  table.timestamp("expires_at").nullable();
  table.timestamp("created_at").nullable();
});
```

> **Note** — The broker decides validity from `createdAt + expireMinutes`, so the
> table must carry `created_at` and `findToken` must return it.

## Wire up the broker

Create the broker once and export it so controllers can import it. Pass an object
implementing `PasswordBrokerOptions` — each query function maps the broker onto your
storage:

```typescript fragment
// app/auth/passwords.ts
import { PasswordBroker, Hash } from "@zerotal/auth";
import { Notify } from "@zerotal/notifications";
import { DB } from "@zerotal/orm";
import { User } from "#app/models/User.ts";
import { PasswordResetNotification } from "#app/notifications/PasswordResetNotification.ts";

export const broker = new PasswordBroker({
  expireMinutes: 60,

  // The broker decides validity from `createdAt + expireMinutes`, so findToken
  // MUST return createdAt and storeToken MUST persist created_at.
  findToken: async (email) => {
    const row = await DB.table("password_reset_tokens")
      .where("email", email)
      .first<{ token: string; created_at: string }>();
    return row ? { token: row.token, createdAt: new Date(row.created_at) } : null;
  },

  storeToken: (email, hash, expiresAt) =>
    DB.table("password_reset_tokens").upsert(
      { email },
      { token: hash, created_at: new Date(), expires_at: expiresAt },
    ),

  deleteToken: (email) => DB.table("password_reset_tokens").where("email", email).delete(),

  pruneTokens: (cutoff) =>
    DB.table("password_reset_tokens").where("expires_at", "<", cutoff).delete(),

  // PasswordResetNotification implements toMail(); { email } is the on-demand recipient.
  sendResetLink: (email, token) =>
    Notify.queue({ email }, new PasswordResetNotification(token, email)),

  resetPassword: async (email, newPassword) => {
    const user = await User.where("email", email).firstOrFail();
    await user.fill({ password: await Hash.make(newPassword) }).save();
  },
});
```

> **Warning** — `findToken` receives the email and `sendResetLink` receives the
> **plain** token; `storeToken` receives the **hashed** token. Don't swap them — the
> broker hashes the plain token before `storeToken` and re-hashes the submitted
> token on `reset()` to compare.

### The notification

```typescript
// app/notifications/PasswordResetNotification.ts
import { Notification, MailMessage, type Notifiable } from "@zerotal/notifications";

export class PasswordResetNotification extends Notification {
  constructor(
    private readonly token: string,
    private readonly email: string,
  ) {
    super();
  }

  channels(): string[] {
    return ["mail"];
  }

  toMail(_notifiable: Notifiable): MailMessage {
    const url = `https://myapp.com/reset-password?token=${this.token}&email=${encodeURIComponent(this.email)}`;
    return new MailMessage().subject("Reset your password").html(`
      <p>Click the link below to reset your password. This link expires in 60 minutes.</p>
      <p><a href="${url}">${url}</a></p>
      <p>If you did not request a password reset, no action is needed.</p>
    `);
  }
}
```

## Controller

The controller wires the broker into request handlers: one pair for requesting a
link, one pair for submitting the new password. Compare the broker result against the
[`PASSWORDS` constants](#passwords-constants) rather than raw strings.

```typescript fragment
// app/controllers/PasswordResetController.ts
import { broker } from "#app/auth/passwords.ts";
import { Auth, PASSWORDS } from "@zerotal/auth";
import { User } from "#app/models/User.ts";
import type { HttpContext } from "zerotal";

export class PasswordResetController {
  showForm(ctx: HttpContext) {
    ctx.view(ForgotPasswordPage({ errors: ctx.flashed("errors") }));
  }

  async sendLink(ctx: HttpContext) {
    const { email } = await ctx.body<{ email: string }>();
    await broker.sendResetLink(email);
    // Same response regardless of whether the email exists — don't reveal account presence
    ctx.flash("success", "If that address is registered, a reset link is on its way.");
    ctx.redirect("/login", 303);
  }

  showReset(ctx: HttpContext) {
    ctx.view(
      ResetPasswordPage({
        token: ctx.query("token") ?? "",
        email: ctx.query("email") ?? "",
        errors: ctx.flashed("errors"),
      }),
    );
  }

  async reset(ctx: HttpContext) {
    const { token, email, password } = await ctx.body<{
      token: string;
      email: string;
      password: string;
    }>();

    const result = await broker.reset(token, email, password);

    if (result === PASSWORDS.TOKEN) {
      ctx.flash("errors", { token: ["This reset link is invalid or has expired."] });
      ctx.redirect(`/reset-password?token=${token}&email=${encodeURIComponent(email)}`, 303);
      return;
    }

    // Log the user in immediately after a successful reset
    const user = await User.where("email", email).first();
    if (user) {
      ctx.session.regenerate();
      await Auth.login(user);
    }

    ctx.flash("success", "Your password has been reset.");
    ctx.redirect("/dashboard", 303);
  }
}
```

> **Danger** — Always respond identically whether or not the email exists, as
> `sendLink` does above. Branching the response leaks which addresses have accounts.

## Routes

```typescript fragment
// routes/web.ts
import { GuestMiddleware } from "@zerotal/auth";
import { PasswordResetController } from "#app/controllers/PasswordResetController.ts";

Router.get("/forgot-password", PasswordResetController, "showForm", [GuestMiddleware]);
Router.post("/forgot-password", PasswordResetController, "sendLink", [GuestMiddleware]);
Router.get("/reset-password", PasswordResetController, "showReset", [GuestMiddleware]);
Router.post("/reset-password", PasswordResetController, "reset", [GuestMiddleware]);
```

`GuestMiddleware` keeps already-authenticated users out of the reset flow.

> **Warning** — Add a [rate limiter](/docs/rate-limiting) to `POST /forgot-password` so the endpoint can't be used to spray reset emails or probe which addresses exist.

## Pruning expired tokens

Expired rows accumulate because `reset()` only deletes a token when it's used or
found expired on lookup. Call `broker.prune()` on a schedule to clear the rest — it
delegates to your `pruneTokens` function with the cutoff date:

```typescript fragment
// app/schedules/PrunePasswordTokens.ts
import { Schedule } from "@zerotal/scheduler";
import { broker } from "#app/auth/passwords.ts";

export class PrunePasswordTokens extends Schedule {
  cron = "0 * * * *"; // hourly
  async handle() {
    await broker.prune();
  }
}
```

See [Scheduler](/docs/scheduler) for the worker setup.

## PASSWORDS constants

Always compare against the constants rather than the raw strings — the values are
namespaced and may change.

| Constant          | Value               | Returned by                                            |
| ----------------- | ------------------- | ------------------------------------------------------ |
| `PASSWORDS.SENT`  | `'passwords.sent'`  | `sendResetLink()` once the link is dispatched          |
| `PASSWORDS.TOKEN` | `'passwords.token'` | `reset()` when the token is missing, wrong, or expired |
| `PASSWORDS.RESET` | `'passwords.reset'` | `reset()` after the password is updated                |

## Testing

Set your suite up once as described in [Testing](/docs/testing) — everything
below assumes `createApp()` from your `tests/helpers.ts`.

The broker needs no application at all, because **your options own the
delivery**. `sendResetLink(email, token)` is a callback you wrote, so a test
captures the token instead of sending mail:

```typescript
// tests/auth/password-reset.test.ts
import { test, expect } from "bun:test";
import { PasswordBroker } from "@zerotal/auth";

test("a reset token changes the password, once", async () => {
  const store = new Map<string, { token: string; createdAt: Date }>();
  let sent: string | undefined;
  let password: string | undefined;

  const broker = new PasswordBroker({
    findToken: async (email) => store.get(email) ?? null,
    storeToken: async (email, hash) =>
      void store.set(email, { token: hash, createdAt: new Date() }),
    deleteToken: async (email) => void store.delete(email),
    pruneTokens: async () => {},
    sendResetLink: async (_email, token) => void (sent = token),
    resetPassword: async (_email, next) => void (password = next),
  });

  expect(await broker.sendResetLink("jane@example.com")).toBe("passwords.sent");

  expect(await broker.reset(sent!, "jane@example.com", "new-secret")).toBe("passwords.reset");
  expect(password).toBe("new-secret");

  // Single-use: replaying the same token must fail.
  expect(await broker.reset(sent!, "jane@example.com", "other")).toBe("passwords.token");
});
```

**Every failure returns `"passwords.token"` rather than throwing**, so assert on
the return value — a `expect(...).toThrow()` here will never fire. Three cases
earn a test: a wrong token, an expired one, and the replay above.

On the HTTP side, the case worth pinning down is that a miss is indistinguishable
from a hit:

```typescript fragment
// tests/http/password-reset.test.ts
const res = await app.post("/forgot-password", { email: "nobody@example.com" });

// Deliberately identical to the registered-address case — the response must not
// reveal whether the account exists.
res.assertRedirect("/forgot-password");
```

## References

The constructor takes `PasswordBrokerOptions`; `expireMinutes` is the only optional
field (default `60`), the rest are query functions you must supply.

### Constructor options

| Option                               | Signature                                                                | Description                                                 |
| ------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `expireMinutes`                      | `number` (optional, default `60`)                                        | Minutes until a reset token expires.                        |
| `findToken(email)`                   | `(email: string) => Promise<{ token: string; createdAt: Date } \| null>` | Look up the stored hashed token and its creation time.      |
| `storeToken(email, hash, expiresAt)` | `(email: string, hash: string, expiresAt: Date) => Promise<void>`        | Persist the **hashed** token and its expiry.                |
| `deleteToken(email)`                 | `(email: string) => Promise<void>`                                       | Remove a single user's token after use or expiry.           |
| `pruneTokens(cutoff)`                | `(cutoff: Date) => Promise<void>`                                        | Delete all tokens created before `cutoff`.                  |
| `sendResetLink(email, token)`        | `(email: string, token: string) => Promise<void>`                        | Deliver the **plain** token to the user (usually via mail). |
| `resetPassword(email, newPassword)`  | `(email: string, newPassword: string) => Promise<void>`                  | Apply the new password to the user record.                  |

### Broker methods

| Method                          | Signature                                                                                             | Description                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `sendResetLink(email)`          | `(email: string) => Promise<'passwords.sent'>`                                                        | Generate + store a hashed token and send the link. |
| `reset(token, email, password)` | `(token: string, email: string, password: string) => Promise<'passwords.token' \| 'passwords.reset'>` | Verify the token and update the password.          |
| `prune()`                       | `() => Promise<void>`                                                                                 | Delete tokens older than `expireMinutes`.          |

## Next steps

- [Encryption & Hashing](/docs/encryption) — the `Hash` facade used in `resetPassword`.
- [Authentication](/docs/authentication) — logging the user in after a reset.
- [Notifications](/docs/notifications) — building and queueing the `PasswordResetNotification`.
- [Rate Limiting](/docs/rate-limiting) — throttle the forgot-password endpoint.
- [Scheduler](/docs/scheduler) — run `prune()` on a recurring schedule.
