---
title: Email Verification
description: Confirm a user controls their email address with signed, expiring verification links — no token table required.
---

# Email Verification

Email verification confirms that a user controls the address they signed up with.
Zerotal builds the whole flow from two pieces you already have — the `Url` facade
(from `zerotal`) signs an expiring link, and `ValidateSignatureMiddleware`
(from `@zerotal/auth`) rejects tampered or expired clicks — so there's no separate
table and no plain-text tokens to store.

## Getting Started

Email verification is assembled from pieces you already have — the `Url` facade
in `@zerotal/core` signs the link, and `ValidateSignatureMiddleware` in
`@zerotal/auth` checks it. There is no extra package and no extra table:

```typescript
import { Url } from "zerotal";
import { ValidateSignatureMiddleware } from "@zerotal/auth";
```

## How it works

```
register ──▶ Url.sign(/auth/verify?id&email, ttl) ──▶ email link
                                                         │ user clicks
                                                         ▼
        ValidateSignatureMiddleware  ──(valid)──▶  controller stamps
        (rejects tampered / expired)               email_verified_at
                                                         │
                                                         ▼
                              VerifiedMiddleware gates "verified-only" routes
```

1. After registration, generate a signed verification URL with `Url.sign()` and
   email it to the user.
2. `ValidateSignatureMiddleware` on the verify route rejects links that are
   tampered or expired — your controller only runs for valid clicks.
3. On success, stamp `email_verified_at` on the user record.
4. `VerifiedMiddleware` (you write once, shown below) gates routes that require a
   verified email.

> **Note** — The signed link's secret is your `APP_KEY` (config `app.key`).
> `ValidateSignatureMiddleware` fails closed: if no key is set it throws a config
> error rather than accepting forged links.

## Migration

Add a nullable `email_verified_at` column to your users table:

```typescript
// database/migrations/002_add_email_verified_at.ts
export default class AddEmailVerifiedAt extends Migration {
  async up(schema: Schema) {
    await schema.table("users", (table) => {
      table.timestamp("email_verified_at").nullable();
    });
  }
  async down(schema: Schema) {
    await schema.table("users", (table) => {
      table.dropColumn("email_verified_at");
    });
  }
}
```

## User model

Expose the column and a convenience getter the middleware and controller can read:

```typescript
// app/models/User.ts
import { column, table } from "@zerotal/orm";
import { AuthUser } from "@zerotal/auth";
import { Carbon } from "zerotal/carbon";

@(table("users").withTimestamps())
export class User extends AuthUser {
  @column() name!: string;
  @column() email!: string;
  @column() password!: string;
  @column("datetime") emailVerifiedAt?: Carbon | null;

  get hasVerifiedEmail(): boolean {
    return this.emailVerifiedAt != null;
  }
}
```

## The verification mailer

`Url.sign(base, params, expiresInMinutes?, secret?)` returns the base URL with the
query params plus a `signature` and `expires` appended. Build it inside a mail
`Notification` (mail lives in `@zerotal/notifications`):

```typescript
// app/notifications/VerifyEmailNotification.ts
import { Notification, MailMessage, type Notifiable } from "@zerotal/notifications";
import { env } from "zerotal";
import { Url } from "zerotal/http";

export class VerifyEmailNotification extends Notification {
  constructor(
    private readonly userId: number,
    private readonly email: string,
  ) {
    super();
  }

  channels(): string[] {
    return ["mail"];
  }

  toMail(_notifiable: Notifiable): MailMessage {
    const url = Url.sign(
      `${env("APP_URL", "http://localhost:3000")}/auth/verify`,
      { id: String(this.userId), email: this.email },
      60, // link expires in 60 minutes
    );

    // The recipient defaults to the notifiable's `email` — no need to call to().
    return new MailMessage().subject("Verify your email address").html(`
      <p>Thanks for signing up! Please click the link below to verify your email address.</p>
      <p><a href="${url}">${url}</a></p>
      <p>This link expires in 60 minutes. If you did not create an account, no action is needed.</p>
    `);
  }
}
```

> **Tip** — Keep the expiry short (15–60 minutes). A stale link is harmless: the
> user just requests a fresh one from the notice page (see [`resend`](#controller)).

## Controller

The verify route is already guarded by `ValidateSignatureMiddleware`, so the
controller can trust that the URL is intact — it only checks that the `id`/`email`
pair still resolves to a real user:

```typescript
// app/controllers/VerificationController.ts
import { Auth } from "@zerotal/auth";
import { Notify } from "@zerotal/notifications";
import { Carbon } from "zerotal/carbon";
import { User } from "#app/models/User.ts";
import { VerifyEmailNotification } from "#app/notifications/VerifyEmailNotification.ts";
import type { HttpContext } from "zerotal";

export class VerificationController {
  // GET /auth/verify  (protected by ValidateSignatureMiddleware)
  async verify(ctx: HttpContext) {
    const id = Number(ctx.query("id"));
    const email = ctx.query("email") ?? "";

    const user = await User.find(id);

    if (!user || user.email !== email) {
      ctx.flash("errors", { link: ["Verification link is invalid."] });
      ctx.redirect("/login", 303);
      return;
    }

    if (!user.hasVerifiedEmail) {
      await user.fill({ emailVerifiedAt: Carbon.now() }).save();
    }

    ctx.flash("success", "Email verified! You are now logged in.");
    if (!Auth.check()) {
      ctx.session.regenerate();
      await Auth.login(user);
    }
    ctx.redirect("/dashboard", 303);
  }

  // POST /auth/verify/resend  (requires auth)
  async resend(ctx: HttpContext) {
    const user = Auth.user() as User;

    if (user.hasVerifiedEmail) {
      ctx.redirect("/dashboard", 303);
      return;
    }

    await Notify.queue(user, new VerifyEmailNotification(user.id, user.email));

    ctx.flash("success", "A fresh verification link has been sent to your email.");
    ctx.redirect("/auth/verify/notice", 303);
  }

  // GET /auth/verify/notice
  notice(ctx: HttpContext) {
    ctx.view(VerifyEmailNoticePage({ email: (Auth.user() as User).email }));
  }
}
```

## Routes

```typescript
// routes/web.ts
import { ValidateSignatureMiddleware } from "@zerotal/auth";
import { RequireAuthMiddleware } from "#app/middleware/RequireAuth.ts";
import { VerificationController } from "#app/controllers/VerificationController.ts";

// The verify route is guarded by the signature middleware — no controller-level check needed
Router.get("/auth/verify", VerificationController, "verify", [ValidateSignatureMiddleware]);
Router.get("/auth/verify/notice", VerificationController, "notice", [RequireAuthMiddleware]);
Router.post("/auth/verify/resend", VerificationController, "resend", [RequireAuthMiddleware]);
```

> **Warning** — Do not add a controller-level signature check on `/auth/verify`;
> `ValidateSignatureMiddleware` already rejects invalid links with a 403 before the
> controller runs. Double-checking just risks the two paths drifting apart.

## Send the verification email on registration

Call `Notify.queue()` at the end of your registration handler so the HTTP response
returns immediately while delivery happens in the background:

```typescript
// app/controllers/AuthController.ts
import { Notify } from "@zerotal/notifications";
import { VerifyEmailNotification } from "#app/notifications/VerifyEmailNotification.ts";

async register(ctx: HttpContext) {
  // … validate, create user …

  await Notify.queue(user, new VerifyEmailNotification(user.id, user.email));

  ctx.session.regenerate();
  await Auth.login(user);
  ctx.redirect("/auth/verify/notice", 303); // send to the "check your email" page
}
```

## Protecting routes that require a verified email

Write a `VerifiedMiddleware` once and apply it to routes that must only be
accessible to verified users. It extends `BaseMiddleware` (from `zerotal`)
and reads the current user via `Auth.userOrNull()`:

```typescript
// app/middleware/Verified.ts
import { BaseMiddleware } from "zerotal";
import type { HttpContext, NextFn } from "zerotal";
import { Auth } from "@zerotal/auth";
import { User } from "#app/models/User.ts";

export class VerifiedMiddleware extends BaseMiddleware {
  protected options = {};

  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    const user = Auth.userOrNull() as User | undefined;

    if (!user) {
      ctx.redirect("/login", 302);
      return ctx.response;
    }

    if (!user.hasVerifiedEmail) {
      ctx.redirect("/auth/verify/notice", 302);
      return ctx.response;
    }

    return next();
  }
}
```

Apply it alongside `RequireAuthMiddleware` so unverified users are bounced to the
notice page:

```typescript
// routes/web.ts
Router.group({ middleware: [RequireAuthMiddleware, VerifiedMiddleware] }, () => {
  Router.get("/dashboard", DashboardController, "index");
  Router.get("/settings", SettingsController, "index");
  Router.post("/posts", PostController, "store");
});
```

## Testing

```typescript
// tests/email-verification.test.ts
it("unverified user is redirected to notice page", async () => {
  const user = await UserFactory.create({ emailVerifiedAt: null });
  const res = await testApp.actingAs(user).get("/dashboard");
  res.assertRedirect("/auth/verify/notice");
});

it("verified user can access dashboard", async () => {
  const user = await UserFactory.create({ emailVerifiedAt: new Date() });
  const res = await testApp.actingAs(user).get("/dashboard");
  res.assertOk();
});
```

## References

| Member                        | Signature                                                                                                 | Description                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Url.sign`                    | `sign(base: string, params?: Record<string, string>, expiresInMinutes?: number, secret?: string): string` | Append signed `signature`/`expires` params to a URL. Defaults to a 60-minute expiry and `app.key` as the secret. |
| `Url.verify`                  | `verify(signedUrl: string, secret?: string): boolean`                                                     | True when the signature matches and the link has not expired.                                                    |
| `ValidateSignatureMiddleware` | `class extends BaseMiddleware`                                                                            | Rejects requests whose signature is missing, tampered, or expired with a 403.                                    |
| `Auth.check`                  | `check(): boolean`                                                                                        | True when the current request has an authenticated user.                                                         |
| `Auth.login`                  | `login(user: UserModel, options?: LoginOptions): Promise<void>`                                           | Write the user to the session and populate the request context.                                                  |
| `Auth.user`                   | `user(): UserModel`                                                                                       | The authenticated user; throws when there is none.                                                               |
| `Auth.userOrNull`             | `userOrNull(): UserModel \| undefined`                                                                    | The authenticated user, or `undefined` for guests.                                                               |
| `Notify.queue`                | `queue(notifiable: Notifiable, notification: Notification): Promise<void>`                                | Serialise the notification and dispatch a background delivery job.                                               |

## Next steps

- [Authentication](/docs/authentication) — sign users in before verifying their address.
- [Password reset](/docs/password-reset) — another signed-URL flow built the same way.
- [Notifications](/docs/notifications) — configure the transport that delivers the verification email.
- [Middleware](/docs/middleware) — how `VerifiedMiddleware` plugs into the request pipeline.
