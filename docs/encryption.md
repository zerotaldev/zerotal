---
title: Encryption & Hashing
description: Encrypt values symmetrically with APP_KEY, hash passwords one-way, and sign tamper-proof URLs.
---

# Encryption & Hashing

Three security primitives cover the ways an application protects a value, and
which one you want follows from a single question: do you need to read the value
back?

| Reach for   | When                                     | Reversible                       |
| ----------- | ---------------------------------------- | -------------------------------- |
| **`Crypt`** | Cookies, stored secrets, signed payloads | Yes — you decrypt it             |
| **`Hash`**  | Passwords                                | No — you verify a guess          |
| **`Url`**   | Verification, invite and one-time links  | Not encrypted, only tamper-proof |

A password is never encrypted, only hashed: there is no legitimate reason to
recover the original, and a store you _can_ decrypt is a store an attacker can
decrypt too. A signed URL is the opposite case — its payload stays readable in the
query string, and the signature only proves nobody altered it.

All three are keyed by `APP_KEY`, which `bun create zerotal` generates. Rotate it
with `bun zt key:generate`.

## Getting Started

`Crypt` and the core `Hash` primitive live in `zerotal/security`, with
nothing to install and no provider to register:

```typescript
import { Crypt, Hash } from "zerotal/security";
```

`Url` is a core service exported from `zerotal/http`:

```typescript
import { Url } from "zerotal/http";
```

> **Note** — Two different `Hash` symbols ship, and they are not interchangeable.
> `zerotal/security` exports the zero-config primitive documented here,
> usable anywhere including in a test that never boots the app.
> `@zerotal/auth` exports a facade of the same name that resolves the `hash`
> container binding, reads its algorithm from `config/auth.ts`, and is therefore
> only usable **after `app.boot()`**. Application code that already depends on
> auth should import from `@zerotal/auth` so the configured algorithm applies;
> anything lower-level should use the core primitive.

## Crypt — symmetric encryption

`Crypt` uses **AES-256-GCM** (authenticated encryption) keyed by `APP_KEY`.
Tampered or truncated payloads fail with a `DecryptionError` instead of returning
garbage. Generate a key with `zerotal key:generate` (sets `APP_KEY`).

```ts
// in a controller or service
import { Crypt } from "zerotal/security";

const token = Crypt.encryptString("secret"); // opaque base64 (iv + tag + ciphertext)
Crypt.decryptString(token); // 'secret'

const blob = Crypt.encrypt({ userId: 7 }); // any JSON-serializable value
Crypt.decrypt<{ userId: number }>(blob).userId; // 7
```

- `Crypt.setKey(key)` overrides the `APP_KEY`-derived key (accepts raw or
  `base64:`-prefixed; any length — it's hashed to 32 bytes via SHA-256).
- Without a key, encryption throws `CryptKeyMissingError`.
- A new IV is generated per call, so encrypting the same value twice yields
  different ciphertexts.

> **Danger** — `APP_KEY` is the root of all `Crypt` security. Rotating it makes
> every existing ciphertext undecryptable, and leaking it exposes every encrypted
> payload. Keep it out of version control and set it per environment — see
> [Config system](/docs/config-system).

## Hash — password hashing

`Hash` wraps `Bun.password` — **argon2id** by default, bcrypt optional. The
algorithm is auto-detected on verify, so changing the default never breaks
existing hashes.

```ts
// in a controller or service
import { Hash } from "zerotal/security";

const hash = await Hash.make("secret123"); // argon2id
const valid = await Hash.verify("secret123", hash); // true (alias: Hash.check)

await Hash.make("secret123", { algorithm: "bcrypt" }); // opt into bcrypt
Hash.setDefault("bcrypt"); // change the default
Hash.needsRehash(oldHash); // true if not the default algorithm
```

`verify` returns `false` (never throws) for a malformed or non-matching hash.
Never store or compare plain-text passwords — `make` always returns a new,
salted hash, so two calls on the same password produce different strings.

> **Tip** — Call `Hash.needsRehash(hash)` right after a successful `verify` at
> login. If it returns `true`, re-hash the plaintext the user just supplied and
> store the new hash to transparently migrate them to the current algorithm.

### Which algorithm should I use?

`Hash.make` accepts `argon2id`, `argon2i`, `argon2d`, or `bcrypt`.

- **`argon2id` (default)** — the recommended choice for new applications; resists
  both GPU and side-channel attacks. Keep it unless you have a specific reason not to.
- **`bcrypt`** — choose it for interop with an existing bcrypt-based password
  store, or to match another system's hashes.
- **`argon2i` / `argon2d`** — niche variants; prefer `argon2id` unless a threat
  model specifically calls for one.

Both algorithms verify correctly against their own stored hashes regardless of the
configured default, because the algorithm is encoded in the hash string itself.
That is what makes switching safe, and what makes a migration a matter of
rehashing on login rather than a mass update.

> **Danger** — bcrypt truncates at 72 bytes. If you must use bcrypt, it silently
> ignores input past 72 bytes, weakening long passwords — a non-issue for
> Argon2id, which is the default.

When authentication is in play the algorithm comes from `config/auth.ts` instead
of `setDefault`:

```ts
// config/auth.ts
import { AuthConfig } from "@zerotal/auth";

export default AuthConfig({
  algorithm: "argon2id", // 'argon2id' (default) | 'bcrypt'
});
```

## Signed URLs

The `Url` facade generates and verifies HMAC-SHA256 signed URLs. Use it for:

- Email verification links
- Password reset links (if you roll your own instead of `PasswordBroker`)
- One-time invite links
- Any time-limited, tamper-proof URL

`Url.sign` / `Url.verify` sign with `APP_KEY` automatically, so you never have to
thread a signing key through your code.

### Generating a signed URL

```ts
function sign(
  base: string,
  params?: Record<string, string>,
  expiresInMinutes?: number,
  secret?: string,
): string;
```

```ts
// in a controller
import { Url } from "zerotal/http";

const url = Url.sign(
  "https://myapp.com/auth/verify",
  { email: "user@example.com", id: "42" }, // extra query params
  60, // expires in 60 minutes (default)
);
// https://myapp.com/auth/verify?email=user%40example.com&id=42&expires=1750000000&signature=abc123…
```

Pass a fourth argument to sign with a key other than `APP_KEY` (e.g. a
per-feature invite secret): `Url.sign(base, params, minutes, inviteSecret)`.

### Verifying a signed URL

```ts
// in a controller
import { Url } from "zerotal/http";

const ok = Url.verify(url);
// false if tampered, expired, or missing signature/expires params

// Verify against an explicit secret instead of APP_KEY:
Url.verify(url, inviteSecret);
```

`Url.verify()` never throws — a malformed URL, bad signature, or expired link all
return `false`, so you can branch on the boolean directly.

### How the signature works

- The signature is `HMAC-SHA256(secret, payload)` where the payload is the full
  URL (minus the `signature` param) with its query parameters **sorted by key** —
  so the order of params in the link doesn't affect verification.
- `expires` is a Unix timestamp **in seconds**; `verify()` checks it before doing
  any crypto, so expired links are rejected cheaply.
- Comparison is **constant-time**, preventing timing attacks against the
  signature.
- `Url.sign` throws `UrlKeyMissingError` if no `APP_KEY` is set and no explicit
  secret is passed — links are never signed with a blank or guessable key.

> **Danger** — Generate a strong `APP_KEY` with `zerotal key:generate` before
> signing anything in production. A weak or shared key lets anyone forge valid
> links.

### ValidateSignatureMiddleware

Apply `ValidateSignatureMiddleware` to any route that receives signed URLs — it
rejects invalid or expired links with a 403 JSON response, so your controller
only runs when the signature is good:

```ts
// routes/web.ts
import { ValidateSignatureMiddleware } from "@zerotal/auth";

// Reads the signing secret from config('app.key') (sourced from APP_KEY)
Router.get("/auth/verify", VerificationController, "verify", [ValidateSignatureMiddleware]);

// Override the secret for a specific route
Router.get("/invite/:token", InviteController, "accept", [
  ValidateSignatureMiddleware.with({ secret: env("INVITE_SECRET", "") }),
]);
```

> **Warning** — If neither `config('app.key')` nor an explicit `secret` resolves,
> the middleware throws a `ConfigError` rather than silently accepting forged
> links. Set `APP_KEY` or pass `.with({ secret })`.

Override `onInvalid()` to return a custom `Response` instead of the default 403
JSON:

```ts
// app/middleware/HtmlSignatureMiddleware.ts
import { ValidateSignatureMiddleware } from "@zerotal/auth";
import type { HttpContext } from "zerotal";

class HtmlSignatureMiddleware extends ValidateSignatureMiddleware {
  protected onInvalid(_ctx: HttpContext): Response {
    return new Response("This link is invalid or has expired.", {
      status: 403,
      headers: { "Content-Type": "text/html" },
    });
  }
}
```

## Testing

Set your suite up once as described in [Testing](/docs/testing). `Crypt` needs an
`APP_KEY` and nothing else, so its tests are ordinary function tests.

**Assert the round trip, not the ciphertext.** Encryption is randomised — the
same input produces a different payload every time — so a test pinned to a
literal string fails on the next run:

```typescript
// tests/security/Crypt.test.ts
import { test, expect } from "bun:test";
import { Crypt } from "zerotal/security";

test("a value survives the round trip", () => {
  const token = Crypt.encryptString("card-4242");

  expect(token).not.toBe("card-4242"); // it is actually encrypted
  expect(Crypt.decryptString(token)).toBe("card-4242");
});

test("encrypting twice produces different payloads", () => {
  expect(Crypt.encryptString("same")).not.toBe(Crypt.encryptString("same"));
});
```

That second test is the one worth having. If it ever fails, the cipher has lost
its randomness and identical plaintexts have become linkable — a real weakness
that a round-trip test alone would never notice.

**Tampering must throw**, and proving it is what tells you the payload is
authenticated rather than merely scrambled:

```typescript
// tests/security/Crypt.test.ts
import { DecryptionError } from "zerotal/security";

test("a modified payload is rejected", () => {
  const token = Crypt.encryptString("card-4242");
  const tampered = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A");

  expect(() => Crypt.decryptString(tampered)).toThrow(DecryptionError);
});
```

**`encrypt()` round-trips any JSON value**, so a test covering an object confirms
the serialisation as well as the cipher:

```typescript
// tests/security/Crypt.test.ts
const payload = Crypt.encrypt({ userId: 7, scopes: ["read"] });

expect(Crypt.decrypt<{ userId: number }>(payload).userId).toBe(7);
```

Hashing has its own trap: every `Hash` method except `needsRehash` is async, and a
forgotten `await` yields a `Promise`, which is always truthy — the one mistake in
this API that silently passes.

```typescript
// tests/security/Hash.test.ts
import { Hash } from "zerotal/security";

test("a password verifies against its own hash", async () => {
  const hash = await Hash.make("correct-horse");

  expect(await Hash.check("correct-horse", hash)).toBe(true);
  expect(await Hash.check("wrong-horse", hash)).toBe(false);
});

test("the same password hashes differently each time", async () => {
  expect(await Hash.make("same")).not.toBe(await Hash.make("same"));
});
```

**Assert the false case.** `expect(await Hash.check(...)).toBe(true)` passes
against a verifier that returns `true` for everything; the wrong-password
assertion is what proves it actually checks. And because hashes are salted, never
compare two of them — the same password hashes differently every time, which is
precisely the property that makes a stolen table unusable.

> **Warning** — Hashing is deliberately slow. A test that hashes in a loop, or a
> factory that hashes a password for every seeded user, will dominate your suite's
> runtime. Hash once and reuse the result, or seed users with a pre-computed hash.

One piece of environment setup applies to all of the above:

> **Warning** — Give the test suite its own `APP_KEY`. Sharing the production key
> with a test environment means a leaked test fixture decrypts real data, and
> rotating the key breaks the suite for reasons nobody will connect to the change.

## References

### `Crypt`

| Method          | Signature                           | Description                                                                 |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| `encryptString` | `(plain: string): string`           | Encrypt a UTF-8 string to an opaque base64 payload (iv + tag + ciphertext). |
| `decryptString` | `(payload: string): string`         | Decrypt an `encryptString` payload; throws `DecryptionError` on failure.    |
| `encrypt`       | `(value: unknown): string`          | JSON-serialize then encrypt any value.                                      |
| `decrypt`       | `<T = unknown>(payload: string): T` | Decrypt and JSON-parse a value produced by `encrypt`.                       |
| `setKey`        | `(key: string): void`               | Override the `APP_KEY`-derived key (raw or `base64:` prefixed).             |

`CryptKeyMissingError` and `DecryptionError` are exported from `zerotal/security`.

### `Hash`

| Method        | Signature                                                                   | Description                                                        |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `make`        | `(value: string, options?: { algorithm?: HashAlgorithm }): Promise<string>` | Hash a value; defaults to the current default algorithm.           |
| `verify`      | `(value: string, hash: string): Promise<boolean>`                           | Verify a value against a stored hash; returns `false` on mismatch. |
| `check`       | `(value: string, hash: string): Promise<boolean>`                           | Alias of `verify`.                                                 |
| `setDefault`  | `(algorithm: HashAlgorithm): void`                                          | Set the default hashing algorithm.                                 |
| `needsRehash` | `(hash: string): boolean`                                                   | `true` when the hash was made with a non-default algorithm.        |

`HashAlgorithm` is `"argon2id" | "argon2i" | "argon2d" | "bcrypt"`.

The `@zerotal/auth` facade of the same name adds `selfTest()` — hashes and
verifies a sentinel value, for health checks — and resolves from the container, so
it works only after the app has booted. In a unit test that never boots, construct
`new HashService("argon2id")` directly or use the core primitive above.

### `Url`

| Method                                   | Signature                                                       | Description                                          |
| ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| `Url.sign(base, params?, min?, secret?)` | `(base: string, params?, expiresInMinutes?, secret?) => string` | Build an HMAC-signed, time-limited URL.              |
| `Url.verify(url, secret?)`               | `(signedUrl: string, secret?: string) => boolean`               | Verify a signed URL; `false` if tampered or expired. |

## Next steps

- [Authentication](/docs/authentication) — where hashed passwords are verified at login.
- [Password Reset](/docs/password-reset) — the `Url` facade and `PasswordBroker` in a full flow.
- [Config system](/docs/config-system) — manage `APP_KEY` and other secrets per environment.
