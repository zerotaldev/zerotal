# @zerotal/validator

> Class-based request validation with a fully-typed, fluent rule builder.

`@zerotal/validator` validates incoming request data and returns it strongly typed — no manual casts. Use the `FormRequest` class for reusable, authorizable validation, or the standalone `validate()` function for one-off checks. Rules are composed through a fluent `RuleBuilder` covering strings, numbers, dates, files, passwords, arrays, and nested objects.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/validator
```

## Usage

### FormRequest (recommended)

```ts
import { FormRequest, RuleBuilder } from "@zerotal/validator";

export class StorePostRequest extends FormRequest {
  // Runs before validation; returning false throws a 403 ForbiddenError.
  authorize(): boolean {
    return !!this.context.user;
  }

  // Do NOT annotate the return type — inference produces the typed result.
  rules(r: RuleBuilder) {
    return {
      title: r.string().min(3).max(255),
      body: r.string().min(10),
      tags: r.array(r.string()).optional(),
    };
  }
}
```

Call `validate()` as a static method — it reads the `HttpContext` automatically:

```ts
const data = await StorePostRequest.validate();

data.title; // string  — fully typed
data.body; // string
data.tags; // string[] | undefined
```

### Standalone validate()

```ts
import { validate } from "@zerotal/validator";

const data = await validate(ctx, (r) => ({
  title: r.string().min(3),
  count: r.number().integer().min(1),
}));

data.title; // string
data.count; // number
```

### Rules and modifiers

```ts
r.string().email().unique("users", "email"); // DB rule (needs DatabaseProvider)
r.string().min(8).confirmed(); // must match `{field}_confirmation`
r.number().between(1, 10).integer();
r.password().min(8).mixedCase().numbers().symbols();
r.file().mimes(["jpg", "png"]).max(2048); // KB
r.array(r.object({ name: r.string(), age: r.number() }));

// Modifiers available on every rule:
r.string().optional(); // T | undefined
r.string().nullable();
r.string().default("draft");
r.string().requiredIf("type", "post");
r.string().custom(async (v) => ((await User.findBy("name", v)) ? "Taken" : true));
```

On failure `validate()` throws `ValidationJsonError` (422 JSON for API/XHR) or `ValidationRedirectError` (redirect back for HTML/Inertia). The framework's exception handler renders both automatically — you never catch them yourself.

## Exports

- **Entry points** — `validate`, `FormRequest`, `Validator` (the `ValidatorFacade`), `RuleBuilder`
- **Rule classes** — `StringRule`, `NumberRule`, `BooleanRule`, `ArrayRule`, `ObjectRule`, `DateRule`, `FileRule`, `PasswordRule`
- **Lower-level runners** — `runValidation`, `runValidationAsync`, `runStringRules`, `runStringRulesAsync`
- **DB rules** — `registerDbRuleRunner` (with `UniqueOptions`)
- **Errors** — `ValidationRedirectError`, `ValidationJsonError`, `PrecognitionResponseError`
- **Config** — `ValidatorConfig`
- **Types** — `FieldRule`, `Schema`, `FieldRuleDefinition`, `ValidationErrors`, `Infer`, `ValidationOutcome`, `InferFieldType`

## Documentation

- [Validation](../../docs/validator.md)
