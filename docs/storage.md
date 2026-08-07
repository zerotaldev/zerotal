---
title: Storage
description: Read and write files through one API that works the same on local disk or any S3-compatible service.
---

# Storage

Unified file storage across the local filesystem and S3-compatible services (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces). Every operation goes through the same driver API regardless of backend — swap the disk in config and your code stays the same.

## Getting Started

Storage ships inside `@zerotal/core` — there is nothing to install. Import it
from the `core/storage` subpath:

```ts
import { Storage, StorageProvider } from "zerotal/storage";
```

It lives in core because file writes are not an optional concern: the logger's
own trail, uploads, and the media library all need one way to put bytes
somewhere. Keeping the abstraction next to them means every file operation in
the framework goes through the same driver API.

## Register the provider

Add `StorageProvider` to the providers array in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { StorageProvider } from "zerotal/storage";

export default [
  // …your other providers
  StorageProvider,
];
```

Registering the provider switches on the following hooks, in lifecycle order:

- `onRegister` — binds the `storage` container key as a lazy singleton (a `StorageManager` built from `config/storage.ts`).
- `onBooting` — eagerly resolves the `storage` binding so the manager is ready before the first request.

## Private by default, one public directory

Two rules, both enforced rather than documented:

1. **Every local disk lives under `storage/`.** A disk rooted anywhere else
   throws when it is constructed.
2. **Everything under `storage/` is private except `storage/public/`.** A disk
   outside that directory cannot be served openly — only behind a signature.

```text
storage/
  app/          private uploads      → no URL
  logs/         the log trail        → no URL
  public/       the only public dir  → /storage/public/**
```

The filesystem and the URL are the same shape on purpose:
`storage/public/a.png` is `/storage/public/a.png`. "Is this file public?" is
answered by where it lives, which is checkable, instead of by which config block
someone edited last.

A disk outside `storage/public` can still be exposed — with `signed: true`, so
every request carries a signature you issued. Serving one openly throws
`UnsafePublicMountError` **at boot**, before the server accepts a request:

```ts
// config/storage.ts — refused
invoices: { driver: "local", root: "./storage/invoices", serve: { path: "/invoices" } }
//                                                              ^ no `signed`

// config/storage.ts — fine
invoices: { driver: "local", root: "./storage/invoices",
            serve: { path: "/invoices", signed: true } }
```

S3 disks are exempt: a bucket is outside the filesystem entirely, and its
exposure is the bucket policy's business.

### Why two boundaries

Each disk already rejects paths that climb out of _its own_ root, which stops
`../../etc/passwd` reaching past a disk. The storage root stops the disk itself
from being pointed at the filesystem in the first place — a stray
`root: "/etc"` throws `StorageRootEscapeError` at construction, so it fails on
boot rather than on the first upload. Nothing the framework writes — uploads,
the media library, the [log trail](/docs/logger) — lands outside it.

Set `ZT_STORAGE_ROOT` if your data volume is mounted elsewhere. The built-in
disks derive their roots from it, so they move with it:

```ini
ZT_STORAGE_ROOT=/var/lib/myapp/storage
```

## Serving files over HTTP

A disk is reachable over the network only if it declares `serve`. The default
`public` disk does; the default `local` disk does not, which is what makes it a
sensible place for private uploads.

```ts
// config/storage.ts
export default StorageConfig({
  disks: {
    // Inside storage/public, so it may be served openly.
    public: { driver: "local", root: "./storage/public", serve: { path: "/storage/public" } },

    // Outside it, so it may only be served signed — reachable through a link
    // you issued, and only until it expires.
    invoices: {
      driver: "local",
      root: "./storage/invoices",
      serve: { path: "/invoices", signed: true },
    },

    // No `serve` block: no URL at all.
    scratch: { driver: "local", root: "./storage/app/scratch" },
  },
});
```

| Field     | Required | Description                                                           |
| --------- | -------- | --------------------------------------------------------------------- |
| `path`    | yes      | URL prefix the disk is mounted at, e.g. `/storage`.                   |
| `signed`  | no       | Require a valid `?expires=&signature=`, as `temporaryUrl()` produces. |
| `headers` | no       | Extra response headers, e.g. `Cache-Control`.                         |

`StorageProvider` registers the serving middleware only when at least one disk
declares `serve`, and mounts the longest prefix first so `/files/private` is
matched before `/files`.

> **Note** — This is not [`Router.static()`](/docs/routing#static-file-serving). A static mount
> registers the files it finds when the server boots, so anything uploaded
> afterwards is invisible until a restart — which looks exactly like a broken
> upload. Serving resolves per request, through the driver, so an S3-backed disk
> can be proxied the same way a local one is served.

### Signed disks

With `signed: true`, a request without a valid signature gets a `404` — not a
`403`. A rejection that says "forbidden" confirms the file exists to someone
guessing paths; a `404` tells them nothing.

```ts
// in a controller
const url = await Storage.disk("invoices").temporaryUrl("2026-q1.pdf", 900);
// → /invoices/2026-q1.pdf?expires=1769990400&signature=…
```

The signature covers the path as well as the expiry, so a link signed for one
file cannot be replayed against another.

## Configuration

Create `config/storage.ts` with the `StorageConfig()` helper. It supplies the built-in `local` and `public` disks by default and deep-merges your disks on top, so you only declare what you add:

```ts
// config/storage.ts
import { StorageConfig } from "zerotal/storage";
import { env } from "zerotal";

export default StorageConfig({
  default: "local",
  disks: {
    s3: {
      driver: "s3",
      key: env("AWS_ACCESS_KEY_ID", ""),
      secret: env("AWS_SECRET_ACCESS_KEY", ""),
      region: env("AWS_DEFAULT_REGION", "us-east-1"),
      bucket: env("AWS_BUCKET", ""),
      url: env("AWS_URL", ""), // optional CDN or public domain
    },
  },
});
```

| Field     | Required | Default             | Description                                                                                    |
| --------- | -------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `default` | no       | `"local"`           | Name of the disk used when you call `Storage.disk()` with no argument.                         |
| `disks`   | no       | `{ local, public }` | Name-keyed map of disk configs. Your disks merge with the built-in `local` and `public` disks. |

> **Note** — The defaults always include a private `local` disk (root
> `storage/app`, no URL) and a `public` disk (root `storage/public`, served at
> `/storage/public`). Both roots derive from the storage root, so they follow
> `ZT_STORAGE_ROOT`. You don't need to redeclare them.

Each disk is either a local or an S3 disk:

```ts
// config/storage.ts — disk shapes
local: { driver: "local", root: "./storage/app", url: "/storage" /* optional */ }
s3:    { driver: "s3", key, secret, region, bucket, endpoint?, url? }
```

| Disk field | Driver | Required | Description                                            |
| ---------- | ------ | -------- | ------------------------------------------------------ |
| `root`     | local  | yes      | Directory files are read from and written to.          |
| `url`      | local  | no       | Base path/URL prepended by `.url()` (e.g. `/storage`). |
| `key`      | s3     | yes      | Access key ID.                                         |
| `secret`   | s3     | yes      | Secret access key.                                     |
| `region`   | s3     | yes      | Bucket region (`auto` for Cloudflare R2).              |
| `bucket`   | s3     | yes      | Bucket name.                                           |
| `endpoint` | s3     | no       | Custom endpoint for R2, MinIO, etc.                    |
| `url`      | s3     | no       | Custom public URL base (CDN or R2 public domain).      |

The `public` disk is already served at `/storage/public` — there is no static
route to register. See [Serving files over HTTP](#serving-files-over-http); a
static mount would be the wrong tool anyway, because it only registers the files
that existed when the server booted.

## Selecting a disk

`Storage.disk(name?)` returns the driver for a configured disk, or the default disk when called with no name:

```ts
// in a controller or service
import { Storage } from "zerotal/storage";

Storage.disk(); // default disk (config.default)
Storage.disk("local"); // local disk
Storage.disk("public"); // local/public disk (served at /storage/*)
Storage.disk("s3"); // S3 disk
```

> **Note** — Naming a disk that isn't in your config throws `DiskNotConfiguredError`.

## Writing files

`put()` accepts a string, `Uint8Array`, or `Blob`:

```ts
function put(
  path: string,
  content: string | Uint8Array | Blob,
  options?: PutOptions,
): Promise<void>;
```

```ts
// in a controller
import { Storage } from "zerotal/storage";

// String content
await Storage.disk().put("docs/readme.txt", "Hello world", { contentType: "text/plain" });

// Uint8Array / ArrayBuffer (e.g. from a file upload)
await Storage.disk("s3").put("avatars/alice.jpg", buffer, { contentType: "image/jpeg" });

// Blob (from fetch / file upload)
const blob = await response.blob();
await Storage.disk("s3").put("reports/2026-q1.pdf", blob, { contentType: "application/pdf" });
```

`PutOptions` has two fields:

| Field         | Type                    | Description                                                        |
| ------------- | ----------------------- | ------------------------------------------------------------------ |
| `contentType` | `string`                | MIME type. S3 defaults to `application/octet-stream` when omitted. |
| `visibility`  | `"public" \| "private"` | Reserved for ACL handling. See the warning below.                  |

> **Warning** — `visibility` is accepted by `PutOptions`, but the current `local` and `s3` drivers do not act on it. On S3, set bucket policies/ACLs out of band; on `local`, control access with `Router.static()` and signed `temporaryUrl()`s.

## Reading files

```ts
// in a service
import { Storage } from "zerotal/storage";

// Read as string — returns null on miss
const text = await Storage.disk().get("docs/readme.txt");

// Read as Uint8Array — returns null on miss
const bytes = await Storage.disk().getBuffer("uploads/invoice.pdf");
```

> **Note** — `get()` and `getBuffer()` return `null` when the file is absent rather than throwing, so you can branch on the result.

## Checking existence

```ts
// in a service
const exists = await Storage.disk().exists("avatars/alice.jpg"); // boolean
```

## Deleting files

```ts
// in a service
await Storage.disk().delete("avatars/old.jpg");
```

> **Note** — On the `local` driver, `delete()` silently ignores a missing file (it won't throw).

## Copying and moving

Both operate within the same disk:

```ts
// in a service
// Copy
await Storage.disk().copy("avatars/alice.jpg", "backups/alice-2026.jpg");

// Move / rename (copy, then delete the source)
await Storage.disk().move("tmp/upload.jpg", "avatars/alice.jpg");
```

## File metadata

```ts
// in a service
const size = await Storage.disk().size("avatars/alice.jpg"); // bytes | null
const modified = await Storage.disk().lastModified("avatars/alice.jpg"); // ms epoch | null
```

Both return `null` when the file isn't found.

## URLs

### `publicUrl()` — the one to reach for

When you need a URL for a template, ask for one and let the disk's config decide
what kind:

```ts
// in a controller or view
const src = await Storage.publicUrl("avatars/alice.jpg", { disk: "public" });
// → /storage/avatars/alice.jpg          (served, unsigned: permanent)

const invoice = await Storage.publicUrl("q1.pdf", { disk: "invoices" });
// → /invoices/q1.pdf?expires=…&signature=…   (served + signed: expiring)

await Storage.publicUrl("secret.pdf", { disk: "local" });
// → throws DiskNotServedError — that disk has no public URL
```

| Disk                 | `publicUrl()` returns                     |
| -------------------- | ----------------------------------------- |
| Served, unsigned     | A permanent URL under the mount.          |
| Served with `signed` | A signed URL valid for `serve.expiresIn`. |
| `url` set (CDN)      | A URL under that base.                    |
| Neither              | Throws `DiskNotServedError`.              |

Throwing is deliberate. The alternative — handing back the stored path — is the
worst failure available: it produces a **relative** `src`, which the browser
resolves against whatever page embedded it. A media library at `/admin/shop/media`
asking for `media/photo.jpg` fetches `/admin/shop/media/media/photo.jpg` and gets
the panel's own 404, which looks like a broken upload and is not one.

Branch instead of catching when a disk may legitimately have no URL:

```ts
// in a view
const src = Storage.isServed("public") ? await Storage.publicUrl(path, { disk: "public" }) : null;
```

### `url()` and `temporaryUrl()`

The lower-level pair `publicUrl()` is built on. `url()` builds a permanent URL
from the disk's base; `temporaryUrl()` signs one that expires. Reach for them
when you already know which kind you want.

A served disk's URL base **defaults to where it is mounted**, so `url()` and the
serving prefix cannot drift apart. Set `url` explicitly only to put a CDN in
front.

```ts
// in a controller
// Permanent public URL (uses the disk's `url` base)
const url = Storage.disk("public").url("avatars/alice.jpg");
// → "/storage/avatars/alice.jpg"

const s3Url = Storage.disk("s3").url("avatars/alice.jpg");
// → "https://mybucket.s3.us-east-1.amazonaws.com/avatars/alice.jpg"
// Or your CDN, when the disk's `url` is set: "https://cdn.example.com/avatars/alice.jpg"

// Temporary signed URL — expires after N seconds
const signed = await Storage.disk("s3").temporaryUrl("reports/2026-q1.pdf", 3600);

// Local disk temporary URL — validated for you when the disk is served with
// `signed: true`; otherwise verify it yourself with Storage.verifyTemporaryUrl()
const localSigned = await Storage.disk("invoices").temporaryUrl("2026-q1.pdf", 900);
```

> **Tip** — Use `temporaryUrl()` for private files that should be reachable for a limited window, and `url()` for files you intend to be publicly readable.

> **Note** — The `local` driver signs `temporaryUrl()`s with `APP_KEY` (it **throws** if `APP_KEY` is unset — a signed URL is never emitted with a guessable key). The signature is validated server-side; the framework gives you a verifier so you don't hand-roll the HMAC.

Serving the disk with `signed: true` validates the link for you — no route to
write. Reach for the verifiers only when you are serving the file yourself:

```ts
Router.get("/files/:path*", async ({ params, request, response }) => {
  const path = params.path;
  // Reads ?expires= & ?signature= off the request URL and checks them against `path`.
  if (!Storage.verifyTemporaryUrlFor(path, request.url)) {
    return response.status(404).send("Not found");
  }
  const bytes = await Storage.disk("invoices").getBuffer(path);
  return bytes ? response.send(bytes) : response.status(404).send("Not found");
});
```

`Storage.verifyTemporaryUrl(path, expiresAt, signature)` is the lower-level form when
you already have the two values. S3 presigned URLs are verified by S3 itself and don't
pass through these helpers.

> **Path safety** — The `local` driver confines every path to its configured `root`.
> A path containing `..` that would resolve outside the root is rejected with a
> `PathTraversalError`, so forwarding a user-supplied key to `Storage.disk().get(key)`
> cannot read files elsewhere on disk.

## File uploads from multipart forms

Handle an uploaded file in a controller action:

```ts
// app/controllers/AvatarController.ts
import { Storage } from "zerotal/storage";
import type { HttpContext } from "zerotal";

export class AvatarController {
  async store(ctx: HttpContext): Promise<Response> {
    const formData = await ctx.request.formData();
    const file = formData.get("avatar") as File | null;

    if (!file || typeof file === "string") {
      return Response.json({ error: "No file provided." }, { status: 422 });
    }

    // Generate a unique filename, preserving the original extension
    const ext = file.name.split(".").pop() ?? "bin";
    const filename = `avatars/${crypto.randomUUID()}.${ext}`;

    await Storage.disk("s3").put(filename, await file.arrayBuffer(), {
      contentType: file.type,
    });

    const url = Storage.disk("s3").url(filename);

    await ctx.user?.update({ avatarUrl: url });

    return Response.json({ url });
  }
}
```

> **Note** — The authenticated user is available as `ctx.user` when the auth middleware has run. See [Authentication](/docs/authentication).

Validate the upload first with a `FormRequest`:

```ts
// app/requests/AvatarRequest.ts
import { FormRequest } from "@zerotal/validator";
import type { RuleBuilder } from "@zerotal/validator";

export class AvatarRequest extends FormRequest {
  rules(v: RuleBuilder) {
    return {
      avatar: v.file().mimes(["jpg", "jpeg", "png", "webp"]).max(2048), // max 2 MB
    };
  }
}
```

## Organising files by date

A common pattern is to store uploads under a date-partitioned path to keep directories manageable:

```ts
// in a service
function uploadPath(filename: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `uploads/${year}/${month}/${filename}`;
}

const path = uploadPath(`${crypto.randomUUID()}.jpg`);
await Storage.disk("s3").put(path, buffer, { contentType: "image/jpeg" });
```

## Drivers

### Which driver should I use?

- **`local`** — single-server deployments and local development. Files live on disk under `root` and are served via `Router.static()`.
- **`s3`** — any S3-compatible service (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, Backblaze B2). Use this for multi-server deployments, large objects, or when you want a CDN in front of your files.

### local

Stores files on the local filesystem under the configured `root`, backed by Bun's `Bun.file`/`Bun.write`. Config keys: `root` (required) and `url` (optional — the base prepended by `.url()`).

### s3

Stores files in any S3-compatible service, powered by Bun's native `S3Client` (no extra npm dependencies). Config keys: `key`, `secret`, `region`, `bucket`, plus optional `endpoint` and `url`.

**Cloudflare R2:**

```ts
// config/storage.ts — a disk inside disks: { … }
r2: {
  driver:   "s3",
  key:      env("R2_ACCESS_KEY_ID",     ""),
  secret:   env("R2_SECRET_ACCESS_KEY", ""),
  region:   "auto",
  bucket:   env("R2_BUCKET",            ""),
  endpoint: `https://${env("CF_ACCOUNT_ID", "")}.r2.cloudflarestorage.com`,
  url:      env("R2_PUBLIC_URL",        ""), // your R2 custom domain
}
```

**MinIO (self-hosted):**

```ts
// config/storage.ts — a disk inside disks: { … }
minio: {
  driver:   "s3",
  key:      env("MINIO_ACCESS_KEY", "minioadmin"),
  secret:   env("MINIO_SECRET_KEY", "minioadmin"),
  region:   "us-east-1",
  bucket:   env("MINIO_BUCKET",     "my-bucket"),
  endpoint: env("MINIO_ENDPOINT",   "http://localhost:9000"),
}
```

## Testing

Set your suite up once as described in [Testing](/docs/testing). Storage ships
two assertions, and they take either a disk name or a driver instance:

```typescript
// tests/http/avatars.test.ts
import { test } from "bun:test";
import { assertStoredFile, assertMissingFile } from "@zerotal/testing";
import { createApp } from "../helpers.ts";

test("uploading an avatar writes it to the disk", async () => {
  const app = await createApp();

  const res = await app.actingAs(user).post("/avatar", { file: someUpload });

  res.assertOk();
  await assertStoredFile("local", `avatars/${user.id}.jpg`);
  await app.close();
});
```

**Point the test suite at a throwaway disk.** A test that writes to your real
`local` disk leaves files behind and passes on the second run for the wrong
reason. Configure a temp directory in `tests/helpers.ts` and clear it between
runs:

```typescript
// tests/helpers.ts
.useConfig({
  storage: { default: "local", disks: { local: { driver: "local", root: "./storage/tmp-test" } } },
})
```

**Assert the deletion too.** `assertMissingFile` is the other half of any test
that removes a file — a delete endpoint returning `204` proves the route ran, not
that the bytes are gone:

```typescript
// tests/http/avatars.test.ts
(await app.actingAs(user).delete("/avatar")).assertNoContent();

await assertMissingFile("local", `avatars/${user.id}.jpg`);
```

**For a unit test, pass a driver instead of a disk name** — no application, no
config, no container:

```typescript
// tests/services/ReportWriter.test.ts
import { LocalDriver } from "zerotal/storage";

const driver = new LocalDriver("./storage/tmp-test", "/");
await new ReportWriter(driver).write(report);

await assertStoredFile(driver, "reports/q3.pdf");
```

> **Warning** — An S3 or R2 disk in a test hits the network and bills you.
> Override `storage.default` to a local disk in the test config rather than
> trusting that no code path reaches the remote one.

## References

Methods on the disk driver returned by `Storage.disk()`:

| Method         | Signature                                                                                      | Description                                      |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `put`          | `(path: string, content: string \| Uint8Array \| Blob, options?: PutOptions) => Promise<void>` | Write a file.                                    |
| `get`          | `(path: string) => Promise<string \| null>`                                                    | Read a file as text; `null` if absent.           |
| `getBuffer`    | `(path: string) => Promise<Uint8Array \| null>`                                                | Read a file as bytes; `null` if absent.          |
| `exists`       | `(path: string) => Promise<boolean>`                                                           | Whether the file exists.                         |
| `delete`       | `(path: string) => Promise<void>`                                                              | Remove a file.                                   |
| `copy`         | `(source: string, destination: string) => Promise<void>`                                       | Copy within the same disk.                       |
| `move`         | `(source: string, destination: string) => Promise<void>`                                       | Move/rename within the same disk.                |
| `size`         | `(path: string) => Promise<number \| null>`                                                    | File size in bytes; `null` if absent.            |
| `lastModified` | `(path: string) => Promise<number \| null>`                                                    | Last-modified time (ms epoch); `null` if absent. |
| `url`          | `(path: string) => string`                                                                     | Permanent public URL.                            |
| `temporaryUrl` | `(path: string, expiresInSeconds: number) => Promise<string>`                                  | Time-limited signed URL.                         |

Manager and exports from `zerotal/storage`:

| Member                   | Signature                                                       | Description                                      |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------ |
| `Storage.disk`           | `(name?: string) => StorageDriver`                              | Get a disk's driver (default disk when omitted). |
| `StorageConfig`          | `(options?: Partial<StorageConfigShape>) => StorageConfigShape` | Build the storage config with merged defaults.   |
| `StorageProvider`        | `class`                                                         | Registers the `storage` binding.                 |
| `DiskNotConfiguredError` | `class`                                                         | Thrown when a named disk is missing from config. |

## Next steps

- [Validator](/docs/validator) — validate file uploads before storing them.
- [Requests Context](/docs/context#uploaded-files) — read multipart form data in a controller.
- [Authentication](/docs/authentication) — access the current user via `ctx.user`.
- [Deployment](/docs/deployment) — configure S3 credentials per environment.
