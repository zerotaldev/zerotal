---
title: Flow Forms, Validation & Uploads
description: Two-way bound inputs, real-time validation, and server-handled file uploads.
---

# Forms & Validation

Validate input, bind form fields to component state with two-way binding, encapsulate complex forms in form objects, and paginate result sets.

## Validation rules

Attach rules with `@validate` on individual fields, or pass them explicitly to `this.validate()`:

```typescript fragment
import { expose, validate } from "@zerotal/flow";

@expose @validate((rule) => rule.required().email())              email:    string = "";
@expose @validate((rule) => rule.required().min(8))               password: string = "";
@expose @validate((rule) => rule.required().min(2).max(50))       name:     string = "";
@expose @validate((rule) => rule.required().in(["admin", "user", "guest"])) role: string = "user";
@expose @validate((rule) => rule.number().min(0))                 age?:     number;
```

Rules use the framework validator's fluent chain (`@zerotal/validator`'s `RuleBuilder`), not
strings. `rule.required()` is shorthand for a required string; for other types start from the typed
builder (`rule.number()`, …). The same `@validate` rule also powers
[real-time validation](/docs/flow/decorators#real-time-validation) when a field is bound with
`flow:model.live`.

Call `this.validate()` at the start of your action. It reads the `@validate` rules and throws a `ValidationError` if any fail — Flow catches it, populates `this.errors`, and re-renders:

```typescript fragment
@expose async register(): Promise<void> {
  await this.validate(); // uses @validate rules declared on the class

  // Only reached if all fields are valid:
  const user = await User.create({
    name:     this.name,
    email:    this.email,
    password: this.password,
    role:     this.role,
  });
  this.redirect("/dashboard");
}
```

Pass explicit rules to override or extend `@validate`:

```typescript fragment
@expose async update(): Promise<void> {
  await this.validate({
    email:    (rule) => rule.required().email(),
    password: (rule) => rule.string().optional().min(8),
    role:     (rule) => rule.required().in(["admin", "user"]),
  });

  await this.user.fill({ email: this.email, role: this.role }).save();
  this.flash("Profile updated.");
}
```

### Available validation rules

| Rule                  | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `required`            | Field must be present and non-empty                    |
| `nullable`            | Field can be null/undefined — skip further rules if so |
| `string`              | Must be a string                                       |
| `numeric`             | Must be numeric                                        |
| `integer`             | Must be an integer                                     |
| `boolean`             | Must be true/false                                     |
| `array`               | Must be an array                                       |
| `email`               | Must be a valid email address                          |
| `min:N`               | String: min length N; Number: min value N              |
| `max:N`               | String: max length N; Number: max value N              |
| `between:N,M`         | Value must be between N and M                          |
| `in:a,b,c`            | Must be one of the listed values                       |
| `confirmed`           | Must match `{fieldName}_confirmation`                  |
| `unique:table,column` | Must not exist in the database table                   |
| `exists:table,column` | Must exist in the database table                       |

## Showing validation errors in the template

Pass a field off `this.errors` to the `error` prop. It renders the first message for that field and hides itself when the field is valid — no manual show/hide logic:

```tsx fragment
<input value={this.email} />
<span error={this.errors.email} class="text-sm text-red-500" />

<input value={this.name} />
<span error={this.errors.name} class="text-sm text-red-500" />
```

Use the `<Field>` component for accessible label + error wiring:

```tsx fragment
import { Field } from "@zerotal/flow";

<Field label="Email" error={this.errors.email}>
  <input value={this.email} class="input" />
</Field>

<Field label="Password" description="At least 8 characters." error={this.errors.password}>
  <input type="password" value={this.password} class="input" />
</Field>
```

Show all errors at once with `<Errors>`:

```tsx fragment
import { Errors } from "@zerotal/flow";

<Errors />                          {/* all current errors */}
<Errors only={["email", "name"]} /> {/* just these fields */}
```

### Checking errors in server code

```typescript
// Check if any errors exist
if (this.errors.any()) {
  return;
}

// Check a specific field
if (this.errors.has("email")) {
  this.flash("Please fix the email field.", "error");
  return;
}
```

### Manual errors

```typescript
this.addError("email", "That email address is already taken.");
this.addError("username", "Username must be unique.");

this.resetValidation(); // clear all errors
this.resetValidation("email"); // clear one field
```

## Two-way model binding

Pass state to `value` (or `checked`). Flow makes it two-way for `@expose` properties and read-only for `@locked` ones — no helper needed:

```tsx fragment
{/* Text inputs */}
<input value={this.name} />
<input value={this.email} />
<textarea value={this.bio} />

{/* Live sync on each keystroke (triggers a server round-trip per keystroke) */}
<input value={this.search} live placeholder="Search…" />

{/* Sync on blur (round-trip when the input loses focus) */}
<input value={this.title} blur />

{/* Checkboxes */}
<input type="checkbox" checked={this.agree} />

{/* Select — the <option> matching the bound value is marked `selected` automatically,
   so the control shows (and submits) the right choice on first render */}
<select value={this.role}>
  <option value="admin">Admin</option>
  <option value="user">User</option>
  <option value="guest">Guest</option>
</select>
```

The bound `<select>` resolves its `flow:model` from `value={this.role}` and marks the matching `<option selected>` for you — including when the options are mapped inside a wrapper component (`<MySelect value={this.role} options={…} />`). You never write `selected` by hand.

## Form objects

Bundle related fields, their validation rules, and reset/fill helpers into a reusable `Form` subclass, then mount it on a component as a single `@expose` property. This keeps your component class lean and makes the form reusable.

```typescript
import { Form } from "@zerotal/flow";
import type { RuleBuilder } from "@zerotal/validator";

export class LoginForm extends Form {
  email = "";
  password = "";
  remember = false;

  rules(v: RuleBuilder) {
    return {
      email: v.string().email(),
      password: v.string().min(8),
      remember: v.boolean().optional(),
    };
  }
}
```

Mount the form on a component:

```typescript fragment
export class LoginPage extends Component {
  @expose form = new LoginForm();

  @expose async login(): Promise<void> {
    this.validate(this.form); // runs the form's rules

    const ok = await Auth.attempt({
      email: this.form.email,
      password: this.form.password,
      remember: this.form.remember,
    });

    if (!ok) {
      this.addError("email", "These credentials do not match.");
      return;
    }

    this.redirect("/dashboard");
  }
}
```

Bind fields with nested `value={this.form.email}`:

```tsx
<form onSubmit={this.login} class="space-y-4">
  <Field label="Email" error={this.errors.email}>
    <input value={this.form.email} type="email" live class="input" />
  </Field>

  <Field label="Password" error={this.errors.password}>
    <input value={this.form.password} type="password" class="input" />
  </Field>

  <label class="flex items-center gap-2">
    <input type="checkbox" checked={this.form.remember} />
    Remember me
  </label>

  <button type="submit" loadingAttr="disabled">
    Sign in
  </button>
</form>
```

### Form helpers

```typescript
// Get all field values as a plain object
const data = this.form.data();
// { email: "alice@example.com", password: "…", remember: true }

// Fill the form from an existing record
await this.form.fill(post);

// Reset to defaults
this.form.reset();

// Reset specific fields only
this.form.reset("email", "password");

// Run the form's validation manually
this.form.validate();
```

### Why form objects?

- **Reuse**: the same `LoginForm` can be mounted on a `LoginModal` and a `LoginPage`.
- **Reset**: `this.form.reset()` restores all fields to defaults in one call.
- **Isolation**: errors land on the component's error bag, not on the form itself, so `<span error={this.errors.email} />` works unchanged.
- **Survival**: form class instances are re-created from the snapshot on each round-trip — the synthesizer handles it, so methods and defaults are always available.

## Paginated results

See [Pagination](/docs/flow/pagination) for the full guide — `paginate()`, `Pagination` mixin, database pagination, infinite scroll, and cursor pagination.

Quick reference for in-memory pagination:

```typescript fragment
import { paginate } from "@zerotal/flow";

export class PostsPage extends Component {
  @url page = 1;
  @locked all: Post[] = [];

  override async onMount() {
    this.all = await Post.query().orderBy("created_at", "desc").get();
  }

  @expose goTo(n: number): void {
    this.page = n;
  }

  override async render() {
    const p = paginate(this.all, this.page, 10); // (items, page, perPage)

    return (
      <div>
        <ul>
          {p.data.map((post) => (
            <li key={String(post.id)}>{post.title}</li>
          ))}
        </ul>

        <p>
          Showing {p.from}–{p.to} of {p.total}
        </p>

        <nav class="flex gap-1">
          {p.elements().map((el) =>
            el === "..." ? (
              <span class="px-2">…</span>
            ) : (
              <button
                onClick={() => this.goTo(el as number)}
                class={el === p.page ? "font-bold underline" : ""}
              >
                {el}
              </button>
            ),
          )}
        </nav>
      </div>
    );
  }
}
```

**Paginator properties:**

| Property          | Type                  | Description                          |
| ----------------- | --------------------- | ------------------------------------ |
| `data`            | `T[]`                 | Items on the current page            |
| `total`           | `number`              | Total item count across all pages    |
| `page`            | `number`              | Current page number                  |
| `perPage`         | `number`              | Items per page                       |
| `lastPage`        | `number`              | Last page number                     |
| `from`            | `number`              | Index of the first item on this page |
| `to`              | `number`              | Index of the last item on this page  |
| `onFirstPage`     | `boolean`             | True if on page 1                    |
| `hasMorePages`    | `boolean`             | True if there are more pages         |
| `elements(each?)` | `(number \| "...")[]` | Windowed page list with ellipsis     |

### Pagination mixin

Compose `Pagination` to get the page state and navigation methods automatically — no boilerplate:

```tsx fragment
import { Component, Pagination } from "@zerotal/flow";

export class PostsPage extends Component.using(Pagination) {
  @locked all: Post[] = [];

  override async onMount() {
    this.all = await Post.query().orderBy("created_at", "desc").get();
  }

  override async render() {
    const posts = await Post.paginate(10); // uses this.page automatically

    return (
      <div>
        <ul>
          {p.data.map((post) => (
            <li key={String(post.id)}>{post.title}</li>
          ))}
        </ul>

        <nav class="flex items-center gap-1">
          <button onClick={this.previousPage} disabled={p.onFirstPage}>
            ‹
          </button>

          {p.elements().map((el) =>
            el === "..." ? (
              <span class="px-2">…</span>
            ) : (
              <a href={`?page=${el}`} navigate class={el === p.page ? "font-bold" : ""}>
                {el}
              </a>
            ),
          )}

          <button onClick={this.nextPage} disabled={!p.hasMorePages}>
            ›
          </button>
        </nav>

        <p class="text-sm text-gray-500">
          Showing {p.from}–{p.to} of {p.total}
        </p>
      </div>
    );
  }
}
```

**`Pagination` adds:**

| Member           | Type             | Description                                |
| ---------------- | ---------------- | ------------------------------------------ |
| `page`           | `@url number`    | Current page, synced to `?page=`           |
| `gotoPage(n)`    | `@expose method` | Jump to a specific page                    |
| `resetPage()`    | method           | Reset to page 1 (call when filters change) |
| `nextPage()`     | `@expose method` | Go to next page                            |
| `previousPage()` | `@expose method` | Go to previous page                        |

Reset the page when a filter changes to avoid showing an empty page:

```typescript fragment
@expose async applyFilter(status: string): Promise<void> {
  this.filter = status;
  this.resetPage(); // go back to page 1
}
```

Compose with other mixins:

```typescript fragment
// `Sorting` here is a mixin you author yourself (see Layouts & Composition);
// `Pagination` is the one shipped by Flow.
export class PostsPage extends Component.using(Sorting, Pagination) {
  // gets both pagination AND sorting for free
}
```

### Database-backed pagination

For database queries, skip the in-memory `paginate()` and use the ORM query builder directly. Combine with `@url page`:

```typescript fragment
export class PostsPage extends Component {
  @url page = 1;
  @locked posts: Post[] = [];
  @locked total = 0;
  @locked lastPage = 1;

  override async onMount() {
    await this.load();
  }

  @expose async load(): Promise<void> {
    const result = await Post.query()
      .where("status", "published")
      .orderBy("created_at", "desc")
      .paginate(15);

    this.posts    = result.data;
    this.total    = result.total;
    this.lastPage = result.lastPage;
  }

  override async render() {
    return (
      <div>
        <ul>
          {this.posts.map((post) => (
            <li key={String(post.id)}>{post.title}</li>
          ))}
        </ul>
        <p>Page {this.page} of {this.lastPage} — {this.total} total</p>
      </div>
    );
  }
}
```

## File uploads

Flow supports server-handled file uploads. Bind a file input with `flow:model`; the bytes are
uploaded over HTTP to `/__flow/upload`, stored on a temporary disk, and the bound property
becomes a `TemporaryUploadedFile`. In an action you call `.store()` to move it to permanent
storage.

> **Note** — Requires `zerotal/storage` configured (a default disk) and `APP_KEY` set (used to sign the
> temp-file reference). The upload endpoint requires an authenticated user (`ctx.user`).

### Component

```tsx
// app/flow/AvatarUploader.tsx
import { Component, expose } from "@zerotal/flow";
import type { TemporaryUploadedFile } from "@zerotal/flow";
import { Storage } from "zerotal/storage";

export class AvatarUploader extends Component {
  @expose avatar: TemporaryUploadedFile | null = null; // single file
  // @expose files: TemporaryUploadedFile[] = [];             // for <input multiple>

  @expose async save(): Promise<void> {
    if (!this.avatar) {
      this.flash("Choose a file first.", "warning");
      return;
    }
    const path = await this.avatar.store("avatars", "public"); // → permanent disk, returns path
    const url = Storage.disk("public").url(path);
    // …persist `url` on your model…
    this.avatar = null; // clear the temp ref
    this.flash("Uploaded.", "success");
  }

  override async render() {
    return (
      <div>
        <input type="file" flow:model="avatar" accept="image/*" />
        <div id="bar" style="height:3px;width:0" />
        <button onClick={this.save} disabled={!this.avatar}>
          Save
        </button>
        <script
          dangerouslySetInnerHTML={{
            __html: `
          addEventListener('flow:upload-progress', e => { document.getElementById('bar').style.width = e.detail.percent + '%'; });
          addEventListener('flow:upload-finish',   () => { document.getElementById('bar').style.width = '100%'; });
        `,
          }}
        />
      </div>
    );
  }
}
```

### The TemporaryUploadedFile object

- `name`, `mime`, `size`, `extension()`, `isImage()`
- `await store(directory, disk?, filename?)` → stored path (moves temp → permanent)
- `await bytes()` → `Uint8Array`
- `await temporaryUrl(ttlSeconds?)` → preview URL (signed/expiring where the driver supports it)

### Client events

`flow:upload-start` · `flow:upload-progress` (`{key, name, percent}`) · `flow:upload-finish` ·
`flow:upload-error` (`{key, error}`).

### Security

- The temp reference is HMAC-signed with `APP_KEY`; the server verifies it on `$set` and refuses
  forged paths. Once in the snapshot it's covered by the snapshot HMAC.
- The endpoint enforces a 25 MB ceiling (apps should validate stricter — size/mime — in the
  `save` action via the file's `size`/`mime`).
- Temp files (`flow-tmp/…`, random UUID names) are garbage-collected after 6h; `.store()`
  removes the temp copy immediately.

### Notes / future

- v1 proxies bytes through the server to the default disk. Direct-to-S3 presigned uploads and a
  dedicated `temp` disk are natural follow-ups; the `TemporaryUploadedFile` API is designed to
  absorb them without changing component code.

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
