# @zerotal/media

> Attach files to models — collections, image conversions, responsive images, and ordering.

Associate uploads with any model, store them on any disk, and generate derived
images without installing a native module.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

**Maturity: `stable`** — anything importable without an `@internal` marker keeps
its shape for the rest of the 1.x line.

## Installation

```bash
bun add @zerotal/media
```

## Setup

Register the provider in `bootstrap/providers.ts` — alongside `StorageProvider`,
which media writes through:

```ts
import { StorageProvider } from "@zerotal/core/storage";
import { MediaProvider } from "@zerotal/media";

export default [DatabaseProvider, StorageProvider, MediaProvider];
```

No migration is needed: the `media` table is provisioned at boot, once, only
when missing.

## Usage

Compose `Media` and declare the collections a model owns:

```ts
import { Model, column } from "@zerotal/orm";
import { Media, type MediaCollections } from "@zerotal/media";

export class Product extends Model.using(Media) {
  @column() name!: string;

  static override mediaCollections: MediaCollections = {
    images: {
      accepts: ["image/jpeg", "image/png"],
      conversions: { thumb: { width: 200, height: 200, format: "webp" } },
      responsive: true,
    },
  };
}
```

Then add and read files:

```ts
await product.addMedia(await ctx.file("photo")).toCollection("images");

await product.getFirstMediaUrl("images", "thumb");
await product.getMedia("images");
await product.clearMediaCollection("images");
```

## Notable behaviour

- **Types come from bytes.** `accepts` is checked against the type sniffed from
  the file's own contents, never the filename or the upload's `Content-Type`.
- **No native dependency.** Conversions run on `Bun.Image`, built into the
  runtime. JPEG, PNG and WebP work on every host — including `fit: "cover"`,
  the centre-crop behind square thumbnails. `sharp` is optional, and a shared
  parity suite holds both drivers to the same output dimensions.
- **Nothing is upscaled by default.** A source too small to fill the box comes
  back at the largest size it can supply, rather than blurred up to fit. Set
  `allowEnlargement: true` on a conversion to opt in.
- **Deleting a model deletes its files** — unless it soft-deletes, in which case
  they wait for `forceDelete()`.
- **Paths are keyed on uuid,** not the numeric id, so a public URL discloses
  nothing about row counts.

## Commands

```bash
bun zt media:clean [--force]
bun zt media:regenerate [--model=Product] [--only=thumb,hero]
```

## Documentation

Full guide: [Media Library](https://zerotal.dev/docs/media).

## License

MIT
