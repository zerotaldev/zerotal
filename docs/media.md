---
title: Media Library
description: Attach files to models with collections, image conversions, responsive images and ordering, on any storage disk.
---

# Media Library

Attach files to a model and let the framework handle the rest — where the bytes
live, the database row that points at them, the thumbnails, the URLs, the
ordering, and the cleanup when the model goes away.

```ts
const media = await product.addMedia(await ctx.file("photo")).toCollection("images");

media.getUrl(); // the original
media.getUrl("thumb"); // a generated conversion
```

## Getting started

Install the package and register its provider:

```bash
bun add @zerotal/media
```

```ts
// bootstrap/providers.ts
import { StorageProvider } from "zerotal/storage";
import { MediaProvider } from "zerotal/media";

export default [
  DatabaseProvider,
  StorageProvider, // media writes through disks — register it too
  MediaProvider,
];
```

There is no migration to write. `MediaProvider` provisions the `media` table on
boot, once, only when it is missing. Set `autoCreateTable: false` in config if
you would rather own the schema yourself.

## Declaring collections

A model gains media by composing the `Media` mixin and declaring the
collections it owns:

```ts
// app/models/Product.ts
import { Model, column } from "zerotal/orm";
import { Media, type MediaCollections } from "zerotal/media";

export class Product extends Model.using(Media) {
  @column() name!: string;

  static override mediaCollections: MediaCollections = {
    images: {
      accepts: ["image/jpeg", "image/png", "image/webp"],
      conversions: {
        thumb: { width: 200, height: 200, format: "webp" },
        hero: { width: 1600, format: "webp", queued: true },
      },
      responsive: true,
    },
    manual: {
      single: true,
      accepts: ["application/pdf"],
      fallbackUrl: "/img/no-manual.svg",
    },
  };
}
```

A collection has to be declared before anything can go into it. An undeclared
name throws, listing the ones that do exist — because the alternative is a typo
that silently creates a collection nobody ever reads from.

> **`Media` and `MediaItem`.** `Media` is the mixin — the thing a model _uses_,
> which is why it reads as `Model.using(Media)`. `MediaItem` is one stored file:
> a row in the `media` table, with its own URL, conversions and custom
> properties. `getMedia()` returns `MediaItem[]`.

### Collection options

| Option                         | What it does                                             |
| ------------------------------ | -------------------------------------------------------- |
| `disk` / `conversionsDisk`     | Where originals and derivatives are written              |
| `accepts`                      | Allowed MIME types, checked against the file's own bytes |
| `maxSize`                      | Largest accepted file, in bytes                          |
| `single`                       | A second file replaces the first                         |
| `onlyKeepLatest`               | Keep the _n_ newest, deleting older ones                 |
| `fallbackUrl` / `fallbackPath` | Returned when the collection is empty                    |
| `conversions`                  | Derived images to generate                               |
| `responsive`                   | `true`, or an explicit array of widths                   |

## Adding files

```ts
// From an upload
await product.addMedia(await ctx.file("photo")).toCollection("images");

// From elsewhere
await product.addMediaFromUrl("https://example.com/a.jpg").toCollection("images");
await product.addMediaFromDisk("tmp/a.jpg", "local").toCollection("images");
await product.addMediaFromPath("/var/import/a.jpg").toCollection("images");

// Copy one item onto another model — independent bytes, fresh uuid
await draft.copyMedia(original).toCollection("images");

// With metadata
await product
  .addMedia(file)
  .usingName("Front view")
  .withCustomProperties({ alt: "Front view", credit: "Studio B" })
  .toCollection("images");
```

Nothing is read, validated or written until `toCollection()` is awaited.

### The type comes from the bytes

`accepts` is checked against the type sniffed from the file's own contents, not
the filename or the upload's `Content-Type` header. Both of those are supplied
by whoever is uploading, so a `payload.html` renamed to `photo.jpg` and sent as
`image/jpeg` is still rejected. The stored extension and `Content-Type` are
derived the same way.

## Reading

```ts
await product.getMedia("images"); // MediaItem[], in order
await product.getFirstMedia("images"); // MediaItem | null
await product.getFirstMediaUrl("images"); // or the collection's fallbackUrl
await product.getFirstMediaUrl("images", "thumb");
await product.hasMedia("images");
await product.mediaCount("images");
```

`getFirstMediaUrl()` returns `""` when there is nothing and no fallback, so it
goes straight into `src` without a null check. Asking for a conversion that has
not been generated yet — a queued one still waiting on a worker — falls back to
the original rather than to nothing.

## Conversions

Conversions are declared per collection and generated when a file is added:

```ts
conversions: {
  thumb: { width: 200, height: 200, format: "webp", quality: 80 },
  hero:  { width: 1600, queued: true },
}
```

| Field              | Meaning                                            |
| ------------------ | -------------------------------------------------- |
| `width` / `height` | Target box                                         |
| `fit`              | `inside` (default), `fill`, or `cover`             |
| `format`           | `jpeg`, `png`, `webp`                              |
| `quality`          | 1–100                                              |
| `rotate`           | Degrees, applied before resizing                   |
| `allowEnlargement` | Scale small sources up to the box. Default `false` |
| `queued`           | Generate on a worker instead of in the request     |

Read them back with `media.getUrl("thumb")`, or `""` when that conversion does
not exist. `media.hasConversion("thumb")` when you need to branch.

### How `fit` behaves

`cover` scales the image so it overflows the target box in at most one axis,
then keeps the centre — the square thumbnail from a 3:2 photograph. It needs
both `width` and `height`; given one, there is nothing to crop away and it
behaves as `inside`.

By default nothing is ever scaled up. If the source is too small to fill the
box, `cover` returns the largest centre window the source can supply, which may
not have the aspect ratio you asked for — a 300×500 source covering a 400×400
box gives 300×400, not 300×300. Set `allowEnlargement: true` on the conversion
when the exact box matters more than fidelity.

All of this works on the default driver, which is `Bun.Image` — built into the
runtime, no native module, nothing to install.

### Choosing an image driver

`Bun.Image` (the default) and `sharp` support the same manipulations and are
held to the same output dimensions by a shared parity suite, so switching is a
performance decision rather than a feature one:

|                             | `bun` (default)         | `sharp`                          |
| --------------------------- | ----------------------- | -------------------------------- |
| Install                     | Nothing                 | `bun add sharp`, a native module |
| `fit: "cover"`              | Yes                     | Yes                              |
| Throughput on large batches | Good                    | Better — libvips                 |
| AVIF / HEIC                 | Host codecs (see below) | Bundled                          |

Switch with:

```ts
// config/media.ts
import { MediaConfig } from "zerotal/media";
export default MediaConfig({ driver: "sharp" });
```

### AVIF and HEIC are host-dependent

`Bun.Image` encodes AVIF and HEIC through OS codecs that are missing on most
Linux hosts. They are off by default; set `allowHostFormats: true` to use them,
and the boot log will warn if this machine cannot. Stick to `jpeg`, `png` and
`webp` and the output is identical everywhere.

### Queued conversions

Mark a conversion `queued: true` and it runs on a worker instead of in the
request. This needs `@zerotal/queue` registered; with no queue bound, every
conversion runs inline — late is better than a thumbnail that never appears.

## Responsive images

Set `responsive: true` on a collection to generate a width ladder plus an inline
blur placeholder:

```tsx
<img
  src={media.getUrl()}
  srcset={media.srcset()}
  sizes="(max-width: 768px) 100vw, 50vw"
  style={{ backgroundImage: `url(${media.placeholder})` }}
/>
```

Widths wider than the source are skipped rather than upscaled. The placeholder
is a ThumbHash-rendered data URI of a few hundred bytes — no client-side decoder
needed.

## Custom properties

Any JSON you attach travels with the row:

```ts
media.getCustomProperty("alt");
media.setCustomProperty("alt", "A steel kettle");
await media.save();
```

## Ordering

Items carry an `orderColumn`, assigned in insertion order:

```ts
await product.setMediaOrder([third.id, first.id], "images");
```

Ids you leave out keep their relative order after the ones you list, so handing
in only the items a drag-and-drop UI moved does what it looks like.

## Deleting

```ts
await media.delete(); // row + original + every derivative
await product.clearMediaCollection("images");
await product.clearAllMedia();
```

Hard-deleting a model deletes its files too. A model using `SoftDeletes` keeps
them — `restore()` is supposed to give back the model you had, and it cannot do
that if the images went with it. Those files go on `forceDelete()`.

## Private files

Media inherits whatever the disk does. Put a collection on a private disk and
hand out signed, expiring links instead of public URLs:

```ts
await media.getTemporaryUrl(300); // the original, for 5 minutes
await media.getTemporaryUrl(300, "thumb"); // a conversion
```

See [Storage](storage.md) for how disks are configured and served.

## Where files live

```text
media/<uuid>/original.jpg
media/<uuid>/conversions/thumb.webp
media/<uuid>/responsive/640.webp
```

Each item gets its own directory keyed on its uuid, not its numeric id: these
paths end up in public URLs, and a sequential id there tells everyone how many
rows the table has. Supply a `PathGenerator` to change the layout.

## Commands

```bash
bun zt media:clean                  # report rows whose files are missing
bun zt media:clean --force          # and delete them
bun zt media:regenerate             # rebuild every conversion
bun zt media:regenerate --model=Product --only=thumb
```

Run `media:regenerate` after changing a conversion's definition — existing files
are not reprocessed automatically.

## Testing

Pair `Storage.fake()` with `MediaFake`. The first asserts bytes landed, the
second asserts a row points at them — a media row with no file and a file with
no row are different bugs.

```ts
import { Storage } from "zerotal/storage";
import { MediaFake } from "zerotal/media";

const disk = Storage.fake();

await product.addMedia(file).toCollection("images");

await MediaFake.assertHas(product, "images");
await MediaFake.assertCount(product, "images", 1);
await MediaFake.assertConversion(product, "images", "thumb");
disk.assertExistsMatching(/^media\/[0-9a-f-]+\/original\.png$/);
```

## Configuration

```ts
// config/media.ts
import { MediaConfig } from "zerotal/media";

export default MediaConfig({
  disk: "s3",
  driver: "bun",
  quality: 82,
  format: "webp",
  responsiveWidths: [320, 640, 960, 1280, 1920],
  maxConversionInputSize: 32 * 1024 * 1024,
});
```

`maxConversionInputSize` is a real limit, not a formality: `Bun.Image` has no
streaming API, so decoding buffers the whole file. Originals above the ceiling
are still stored — they just get no conversions.
