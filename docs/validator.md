---
title: Validation
description: Validate request input against typed rule chains and turn failures into the right HTTP response automatically.
---

# Validation

The validator checks incoming request data against rule chains and produces
fully-typed output — no manual type assertions needed. It offers two entry
points: `FormRequest` (class-based, recommended) and the standalone `validate()`
function (for one-off use).

## Getting Started

```bash
# in your project root
bun add @zerotal/validator
```

The validator has no provider to register — import its classes and functions
directly. Database-aware rules (`unique()`, `exists()`) do require
[`DatabaseProvider`](/docs/database) to be registered; see
[Database rules](#database-rules).

## Configuration

Create `config/validator.ts` with the `ValidatorConfig()` helper so every field
stays type-checked while defaults are filled in:

```typescript
// config/validator.ts
import { ValidatorConfig } from "@zerotal/validator";

export default ValidatorConfig({
  stopOnFirstFailure: true, // stop after the first failure per field
  locale: "en", // default locale for error messages
});
```

| Field                | Required | Default | Description                                        |
| -------------------- | -------- | ------- | -------------------------------------------------- |
| `stopOnFirstFailure` | no       | `true`  | Stop validation after the first failure per field. |
| `locale`             | no       | `"en"`  | Default locale for error messages.                 |

## Which entry point should I use?

- **`FormRequest`** — the default for HTTP handlers. Encapsulates rules and
  authorization in a reusable, testable class, reads the request from the active
  context, and throws the right error on failure.
- **`validate(ctx, factory)`** — for one-off HTTP validation where a dedicated
  class would be overkill. Same failure behavior as `FormRequest`.
- **`Validator.check(data, factory)`** — for non-HTTP code (CLI commands,
  services, background jobs). Returns a result object and never throws or
  redirects. See [Non-HTTP validation](#non-http-validation).

## FormRequest

### Defining a request

```typescript
// app/requests/posts/StorePostRequest.ts
import { FormRequest, RuleBuilder } from "@zerotal/validator";

export class StorePostRequest extends FormRequest {
  // Return true to allow, false to deny with a 403 ForbiddenError.
  // Access the current request via this.context.
  authorize(): boolean {
    return !!this.context.user;
  }

  // Do NOT annotate the return type — TypeScript needs to infer the narrow shape
  // for validate() to produce a typed result.
  rules(r: RuleBuilder) {
    return {
      title: r.string().min(3).max(255),
      body: r.string().min(10),
      tags: r.array(r.string()).optional(),
    };
  }
}
```

> **Warning** — Do not add an explicit return type to `rules()`. Annotating it
> (e.g. as `Record<string, FieldRule>`) widens the inferred type and makes
> `validate()` return `Record<string, unknown>` instead of your typed shape.

### Calling validate

Call `validate()` as a static method on the class. It reads `HttpContext` from
`AsyncLocalStorage` — no arguments needed.

```typescript fragment
// in a controller
const data = await StorePostRequest.validate();

data.title; // string — fully typed, no cast needed
data.body; // string
data.tags; // string[] | undefined
```

On failure, `validate()` stores `errors` and `old` (previous input) in the
session, then branches on the request type:

| Request type | Detected by                                            | Error thrown              | HTTP result                                     |
| ------------ | ------------------------------------------------------ | ------------------------- | ----------------------------------------------- |
| JSON / API   | `Accept: application/json` (and no `X-Inertia` header) | `ValidationJsonError`     | 422 JSON with field errors                      |
| Inertia      | `X-Inertia: true` header                               | `ValidationRedirectError` | Redirect back; errors surfaced via shared props |
| HTML form    | neither header                                         | `ValidationRedirectError` | Redirect back; errors in session                |

Both `ValidationJsonError` and `ValidationRedirectError` are exported from
`@zerotal/validator`. The exception handler renders them appropriately — you
never need to catch them yourself.

### Authorization

`authorize()` runs **before** validation. Returning `false` throws a
`ForbiddenError` (403) without touching the request body.

```typescript fragment
// in a FormRequest subclass

// Check the current user's role:
authorize(): boolean {
  return (this.context.user as { role?: string })?.role === "admin";
}

// Use Gate.allows() for policy-based auth:
authorize(): boolean {
  return Gate.via(PostPolicy).allows("create", new Post());
}

// Async authorize is also supported:
async authorize(): Promise<boolean> {
  const post = await Post.findOrFail(Number(this.context.params["id"]));
  return Gate.via(PostPolicy).allows("update", post);
}
```

### Accessing context inside rules

Because `rules()` is an instance method, you have full access to `this.context`
for rules that depend on the current user, route params, or session state:

```typescript fragment
// in a FormRequest subclass
rules(r: RuleBuilder) {
  const userId = this.context.user?.id;
  return {
    email: r.string().email()
      .unique("users", "email", userId), // ignore current user on update
    name: r.string().min(2).max(100),
  };
}
```

## Standalone validate

For simple one-off validation without a dedicated class:

```typescript fragment
// in a controller
import { validate } from "@zerotal/validator";

// validate(ctx, factory) reads the request body from the HttpContext and
// returns the validated, typed data directly. On failure it throws —
// ValidationJsonError (→ 422 JSON) or ValidationRedirectError (→ 303 back) —
// which the global exception handler turns into the right response.
const data = await validate(ctx, (r) => ({
  title: r.string().min(3),
  count: r.number().integer().min(1),
}));

data.title; // string — fully typed, no cast needed
data.count; // number
```

## Non-HTTP validation

For CLI commands, services, or background jobs — where there is no request to
redirect and no response to throw — use the `Validator` facade. It returns a
`{ success, data, errors }` outcome and never throws.

```typescript fragment
// in a command or service
import { Validator } from "@zerotal/validator";

const result = Validator.check(payload, (r) => ({
  email: r.string().email(),
  age: r.number().min(0),
}));

if (!result.success) {
  console.error(result.errors);
} else {
  result.data.email; // string — fully typed
}
```

## RuleBuilder types

Start every rule chain with a type method on `RuleBuilder`:

```typescript fragment
// in a rules() method or factory
const r = new RuleBuilder(); // or the `r` param in rules()

r.string(); // StringRule
r.number(); // NumberRule
r.boolean(); // BooleanRule
r.date(); // DateRule
r.file(); // FileRule — multipart/form-data uploads
r.password(); // PasswordRule — strength validation

// Convenience shorthands on RuleBuilder:
r.required(); // r.string().required() — required string, the common case
r.email(); // r.string().email()
r.url(); // r.string().url()
r.uuid(); // r.string().uuid()

r.array(r.string()); // ArrayRule<StringRule> — array of strings
r.object({/* … */}); // ObjectRule — nested object
```

## Common modifiers

These are available on **every** rule type:

| Method                            | Description                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `.required(msg?)`                 | Field must be present and non-empty                                          |
| `.optional()`                     | Field may be absent; result type becomes `T \| undefined`                    |
| `.nullable()`                     | Field may be `null`                                                          |
| `.default(val)`                   | Use `val` when field is absent; implies `.optional()`                        |
| `.sometimes()`                    | Only validate when field is present in input (PATCH-friendly)                |
| `.bail()`                         | Stop after the first failing rule on this field                              |
| `.custom(fn)`                     | Run a custom sync/async function; return `true`, `false`, or an error string |
| `.requiredIf(field, value)`       | Required when another field equals `value`                                   |
| `.requiredUnless(field, value)`   | Required unless another field equals `value`                                 |
| `.requiredWith(fields[])`         | Required when ANY listed field is present                                    |
| `.requiredWithout(fields[])`      | Required when ANY listed field is absent                                     |
| `.requiredWithAll(fields[])`      | Required when ALL listed fields are present                                  |
| `.requiredWithoutAll(fields[])`   | Required when ALL listed fields are absent                                   |
| `.prohibitedIf(field, value)`     | Must be absent when another field equals `value`                             |
| `.prohibitedUnless(field, value)` | Must be absent unless another field equals `value`                           |
| `.accepted()`                     | Truthy: `true`, `1`, `'1'`, `'yes'`, `'on'`, `'true'`                        |
| `.declined()`                     | Falsy: `false`, `0`, `'0'`, `'no'`, `'off'`, `'false'`                       |

### Custom validator

```typescript fragment
// in a rules() method or factory
username: r.string().custom(async (value) => {
  const taken = await User.findBy("username", value as string);
  return taken ? "This username is already taken." : true;
});
```

## String rules

```typescript fragment
// in a rules() method or factory
r.string()
  .min(3) // minimum character length
  .max(255) // maximum character length
  .size(10) // exact character length
  .email() // valid email address
  .url() // valid URL
  .uuid() // valid UUID v4
  .ip() // valid IPv4 or IPv6
  .json() // parseable JSON string
  .regex(/^[A-Z]+$/) // matches regex
  .matches(/^[A-Z]+$/, "msg") // alias for regex()
  .in(["a", "b", "c"]) // value in list
  .notIn(["x", "y"]) // value not in list
  .alpha() // letters only (a-z, A-Z)
  .alphaNum() // letters and digits
  .alphaDash() // letters, digits, hyphens, underscores
  .numeric() // digits only (optional leading minus)
  .digits(6) // exactly 6 digits
  .digitsBetween(4, 8) // between 4 and 8 digits
  .startsWith("https://") // must start with prefix
  .endsWith(".pdf") // must end with suffix
  .trim() // strip leading/trailing whitespace (transform)
  .lowercase() // convert to lowercase (transform)
  .uppercase() // convert to uppercase (transform)
  .confirmed() // value must equal `{field}_confirmation` in input
  .sameAs("password") // value must equal another field
  .present() // key must exist in input (may be empty)
  .prohibited() // key must be absent from input
  .password(); // semantic alias — chain constraints after this
```

## Number rules

```typescript fragment
// in a rules() method or factory
r.number()
  .min(0) // minimum value (inclusive)
  .max(100) // maximum value (inclusive)
  .between(1, 10) // min and max in one call
  .integer() // must be a whole number
  .positive() // shorthand for .min(0)
  .notIn([0, -1]); // value not in list
```

## Boolean rules

```typescript fragment
// in a rules() method or factory
r.boolean()
  .accepted() // truthy — for "agree to terms" checkboxes
  .declined(); // falsy
```

## Date rules

```typescript fragment
// in a rules() method or factory
r.date()
  .after("2026-01-01") // strictly after date
  .before(new Date()) // strictly before date
  .afterOrEqual("2026-01-01") // on or after
  .beforeOrEqual("2026-12-31"); // on or before
```

## Array rules

```typescript fragment
// in a rules() method or factory
r.array(r.string()) // array of strings
  .min(1) // minimum item count
  .max(10) // maximum item count
  .size(3); // exact item count

r.array(r.number().integer()); // array of integers

// Nested objects in an array:
r.array(r.object({ name: r.string(), age: r.number() }));
```

## Object rules

```typescript fragment
// in a rules() method or factory
r.object({
  street: r.string(),
  city: r.string(),
  country: r.string().in(["US", "CA", "GB"]),
  zip: r
    .string()
    .regex(/^\d{5}$/)
    .optional(),
});
```

## File rules

Validates `File` objects from `multipart/form-data` uploads:

```typescript fragment
// in a rules() method or factory
avatar: r.file()
  .mimes(["jpg", "jpeg", "png", "webp"]) // allowed extensions
  .max(2048) // maximum KB
  .min(1) // minimum KB
  .optional();
```

## Password rules

```typescript fragment
// in a rules() method or factory
r.password()
  .min(8) // minimum length (default: 8)
  .mixedCase() // requires upper + lower case letters
  .numbers() // requires at least one digit
  .symbols() // requires at least one symbol
  .uncompromised() // must not contain spaces
  .confirmed(); // must equal password_confirmation field
```

## Database rules

These rules require [`DatabaseProvider`](/docs/database) to be registered; they
throw at runtime otherwise.

### unique — value must not already exist in the DB

The third argument ignores a record on update — pass the current record's ID, or
a `UniqueOptions` object (`{ ignoreId }`) for clarity. A fourth argument
overrides the error message.

```typescript fragment
// in a rules() method or factory
email: r.string().email().unique("users", "email");

// Ignore the current record when updating (pass the record's ID):
email: r.string().email().unique("users", "email", this.context.user?.id);

// Equivalent, using the options object:
email: r.string().email().unique("users", "email", { ignoreId: userId });
```

### exists — value must exist in the DB

```typescript fragment
// in a rules() method or factory
userId: r.number().exists("users", "id");
roleSlug: r.string().exists("roles", "slug");
```

> **Note** — These rules stay decoupled from the ORM: `DatabaseProvider`
> registers the query executor via `registerDbRuleRunner()` during its boot, so
> `@zerotal/validator` never depends directly on `@zerotal/orm`.

## Precognition

When a request carries a `Precognition: true` header, `FormRequest.validate()`
runs the rules without executing the controller body, then short-circuits with a
`204` (no errors) or `422` (with errors). A `Precognition-Validate-Only` header
(comma-separated field names) narrows the validated set to just those fields —
useful for live, field-by-field client validation.

## Error handling

### JSON / API requests

When `Accept: application/json` is present (and no `X-Inertia` header),
validation throws `ValidationJsonError`:

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "title": ["The title must be at least 3 characters."],
    "email": ["The email has already been taken."]
  }
}
```

The response is sent as `422 Unprocessable Entity`. `ExceptionHandler` catches
the error and renders this automatically.

### Inertia / HTML form requests

When the request is an Inertia request or has no JSON `Accept` header, validation
throws `ValidationRedirectError`. `ExceptionHandler` converts this to a redirect
back to the previous page.

Errors and old input are stored in the [session](/docs/session) under the keys
`'errors'` and `'old'`. Read them on the next request:

```typescript fragment
// in a controller
const errors = ctx.flashed<Record<string, string[]>>("errors");
const old = ctx.flashed<Record<string, unknown>>("old");
```

In [Inertia](/docs/inertia), errors are passed automatically as the `errors`
prop via shared props — no manual session reading required.

## Testing

Set your suite up once as described in [Testing](/docs/testing). Validation is
worth testing at the rule level, because that is where the mistakes are and it
needs no request.

**`Validator.check()` never throws**, so a rule set tests as a pure function —
assert on the outcome rather than on a caught error:

```typescript
// tests/validation/RegisterRules.test.ts
import { test, expect } from "bun:test";
import { Validator } from "@zerotal/validator";

const rules = (r) => ({
  email: r.string().email(),
  age: r.number().min(18),
});

test("rejects an underage applicant", () => {
  const result = Validator.check({ email: "jane@example.com", age: 17 }, rules);

  expect(result.success).toBe(false);
  expect(result.errors.age).toBeDefined();
});

test("returns typed data on success", () => {
  const result = Validator.check({ email: "jane@example.com", age: 30 }, rules);

  expect(result.success).toBe(true);
  if (result.success) expect(result.data.email).toBe("jane@example.com");
});
```

**Test the values that sit either side of a boundary**, not a comfortable middle.
`age: 18` and `age: 17` prove `min(18)`; `age: 30` proves nothing that `age: 19`
would not.

**A `FormRequest` fails the HTTP request**, so test it through the route it
guards. The status tells you which failure mode you got:

```typescript fragment
// tests/http/register.test.ts
const res = await app.post("/register", { email: "not-an-email" });

res.assertUnprocessable(); // 422 for a JSON request
```

> **Note** — The same failure redirects with flashed errors for a form request
> and returns `422` for a JSON one. Assert the shape your route actually serves;
> a test posting JSON to a form endpoint will pass for the wrong reason.

## References

### RuleBuilder

| Method     | Signature                                           | Description                               |
| ---------- | --------------------------------------------------- | ----------------------------------------- |
| `required` | `required(message?: string): StringRule`            | Required string — the common entry point. |
| `string`   | `string(): StringRule`                              | Begin a string rule chain.                |
| `number`   | `number(): NumberRule`                              | Begin a number rule chain.                |
| `boolean`  | `boolean(): BooleanRule`                            | Begin a boolean rule chain.               |
| `date`     | `date(): DateRule`                                  | Begin a date rule chain.                  |
| `file`     | `file(): FileRule`                                  | Validate a multipart/form-data upload.    |
| `password` | `password(): PasswordRule`                          | Validate password strength.               |
| `email`    | `email(message?): StringRule`                       | Shorthand for `string().email()`.         |
| `url`      | `url(message?): StringRule`                         | Shorthand for `string().url()`.           |
| `uuid`     | `uuid(message?): StringRule`                        | Shorthand for `string().uuid()`.          |
| `array`    | `array<T extends FieldRule>(item: T): ArrayRule<T>` | Array whose items match `item`.           |
| `object`   | `object<S>(shape): ObjectRule<S>`                   | Nested object matching `shape`.           |

### Entry points

| Member            | Signature                                    | Description                                          |
| ----------------- | -------------------------------------------- | ---------------------------------------------------- |
| `FormRequest`     | `static validate(): Promise<Infer<…>>`       | Validate the active request against the class rules. |
| `FormRequest`     | `authorize(): boolean \| Promise<boolean>`   | Allow/deny the request before validation.            |
| `FormRequest`     | `rules(r: RuleBuilder)`                      | Return the field-to-rule schema (no return type).    |
| `validate`        | `validate(ctx, factory): Promise<Infer<…>>`  | One-off HTTP validation; throws on failure.          |
| `Validator.check` | `check(data, factory): ValidationOutcome<…>` | Non-HTTP validation; returns a result, never throws. |

## Types

| Type                        | What it is                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ValidationErrors`          | The error bag — field name to messages, which is what `withErrors()` and the `errors` shared prop carry. |
| `FieldRuleDefinition`       | One field's rules as declared.                                                                           |
| `InferFieldType<R>`         | The type a rule set produces, so validated data is typed rather than `unknown`.                          |
| `PrecognitionResponseError` | What a precognition request returns when a field fails ahead of submission.                              |

## Next steps

- [Requests Context](/docs/context#reading-input) — read the input that `FormRequest` validates.
- [Errors](/docs/errors) — how `ExceptionHandler` renders validation failures.
- [Authorization](/docs/authorization) — back `authorize()` with policies.
- [Database](/docs/database) — register `DatabaseProvider` for `unique()` and `exists()`.
- [Inertia](/docs/inertia) — where the `errors` shared prop comes from.
