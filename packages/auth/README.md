# @zerotal/auth

> Session authentication, API tokens, and DB-backed authorization for Zerotal.

`@zerotal/auth` authenticates users against the HTTP session, issues and verifies bearer API tokens, and provides Gate/policy authorization with relational roles and permissions. It also ships password hashing, password reset, magic-link login, TOTP two-factor authentication, and WebAuthn passkeys. It builds on [`@zerotal/session`](../session/README.md) — register both providers.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/session @zerotal/auth
```

## Setup

Register the provider in `bootstrap/providers.ts` (after `SessionProvider`):

```ts
import { SessionProvider } from "@zerotal/session";
import { AuthProvider } from "@zerotal/auth";

export default [
  // …other providers
  SessionProvider,
  AuthProvider,
];
```

That's it — `AuthProvider` discovers your authenticatable model from the registry,
so `ctx.user` / `Auth.user()` work with no further wiring. To override how a user is
loaded from the session ID (in `bootstrap/app.ts`, before `Application.create()`):

```ts
import { AuthProvider } from "@zerotal/auth";
import { User } from "../app/models/User.ts";

AuthProvider.resolveUsing((id) => User.find(id)); // optional
```

## Usage

### The User model

Extend `AuthUser` instead of `Model`:

```ts
import { column, table } from "@zerotal/orm";
import { AuthUser } from "@zerotal/auth";

@table("users")
export class User extends AuthUser {
  @column() name!: string;
  @column() email!: string;
  @column() password!: string;
}
```

### The Auth facade

```ts
import { Auth, Hash } from "@zerotal/auth";

Auth.check(); // boolean — authenticated?
Auth.user(); // User    — throws UnauthorizedError for guests
Auth.userOrNull(); // User | undefined
Auth.id(); // number

await Auth.login(user); // write user_id to the session
await Auth.logout(); // clear it

// Verify a password during login:
if (!(await Hash.check(password, user.password))) {
  /* invalid */
}
```

### Authorization (Gate, roles & permissions)

Compose the `Authenticatable` / `Roles` / `Permissions` mixins onto your
model with `Model.using` (flat, left-to-right — no wrapper nesting):

```ts
import { Authenticatable, Roles, Permissions } from "@zerotal/auth";
import { Model, column } from "@zerotal/orm";

export class User extends Model.using(Authenticatable, Permissions, Roles) {
  @column() name!: string;
  @column() email!: string;
}

// `extends Roles(Permissions(AuthUser))` still works — AuthUser is
// just Authenticatable(Model).

// Then:
await user.assignRole("editor");
user.can("post.update"); // synchronous — resolves direct + role-derived grants
Auth.authorize("post.delete"); // throws ForbiddenError when denied

// Policy-based checks:
Gate.allows("update", post);
Gate.authorize("update", post);
```

### API tokens & route protection

```ts
import { createToken, BearerTokenMiddleware } from "@zerotal/auth";

const { plaintext, row } = await createToken({
  tokenableId: user.id,
  name: "cli",
  abilities: ["*"],
});
// store `row`, return `plaintext` to the client once

Router.group({ prefix: "/api", middleware: [BearerTokenMiddleware] }, () => {
  Router.get("/me", UserController, "show");
});
```

## Exports

- **Models & facades** — `AuthUser`, `Authenticatable`, `Auth`, `Hash`
- **Provider & config** — `AuthProvider`, `AuthConfig`
- **Middleware** — `PersistUserMiddleware` (auto-wired; populates `ctx.user`), `AuthMiddleware` (guard — require auth), `GuestMiddleware`, `BearerTokenMiddleware`, `TwoFactorMiddleware`, `ValidateSignatureMiddleware`
- **Authorization** — `Gate`, `GateService`, `Policy`, `RequireRoleMiddleware`, `RequirePermissionMiddleware`
- **Relational RBAC** — `Role`, `Permission`, `Roles`, `Permissions` (mixins), `PermissionRegistry`, `definePermission`
- **Hashing** — `HashService`
- **Tokens** — `createToken`, `hashToken`, `tokenCan`
- **Password reset** — `PasswordBroker`, `PASSWORDS`
- **Magic links** — `MagicLinkBroker`, `MAGIC`
- **Two-factor** — `TwoFactorService`, `TwoFactor`
- **WebAuthn / passkeys** — `PasskeyService`

## Documentation

- [Authentication](../../docs/authentication.md)
- [Authorization](../../docs/authorization.md)
- [Password Reset](../../docs/password-reset.md)
- [Email Verification](../../docs/email-verification.md)
- [Roles & Two-Factor](../../docs/roles-and-2fa.md)
