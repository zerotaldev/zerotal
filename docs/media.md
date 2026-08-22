---
title: Media Library
description: Attach files to models with collections, image conversions, responsive images and ordering, on any storage disk.
---

# Media Library

Attach files to a model and let the framework handle the rest — where the bytes
live, the database row that points at them, the thumbnails, the URLs, the
ordering, and the cleanup when the model goes away.

```ts fragment
const media = await product.addMedia(await ctx.file("photo")).toCollection("images");

media.getUrl(); // the original
media.getUrl("thumb"); // a generated conversion
```

## Getting started

Install the package and register its provider:

```bash
bun add @zerotal/media
```

```ts fragment
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

```ts fragment
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

```ts fragment
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

```ts fragment
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

```tsx fragment
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

```ts fragment
media.getCustomProperty("alt");
media.setCustomProperty("alt", "A steel kettle");
await media.save();
```

## Ordering

Items carry an `orderColumn`, assigned in insertion order:

```ts fragment
await product.setMediaOrder([third.id, first.id], "images");
```

Ids you leave out keep their relative order after the ones you list, so handing
in only the items a drag-and-drop UI moved does what it looks like.

## Deleting

```ts fragment
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

```ts fragment
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

```ts fragment
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

## API reference

Signatures below are the ones `packages/media/api-surface.md` records, which CI diffs on every change. Anything importable and not listed here is `@internal`: it exists because a module inside the package needed it, and it is not covered by the stability guarantee.

### The mixin, and one stored file

`Media` is the mixin — it reads as `Model.using(Media)`, and it declares the static `mediaCollections` field. `MediaItem` is one stored file: a row in the `media` table, and an ordinary model, so every query-builder method is available on it too.

```ts fragment
function Media<TBase extends Constructor>(
  Base: TBase,
): TBase & { mediaCollections: MediaCollections };
```

`MediaItem`'s own members, on top of what a model already gives you:

| Member                                            | What it answers                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `getUrl(conversion?)`                             | Public URL of the original, or of a named conversion                         |
| `getPath(conversion?)`                            | Path on the disk, for server-side reads                                      |
| `getTemporaryUrl(expiresInSeconds?, conversion?)` | Signed, expiring URL — see [Private files](#private-files)                   |
| `getResponsivePath(width)`                        | Path of one rung of the responsive ladder                                    |
| `srcset()`                                        | A ready `srcset` string built from `responsiveImages`                        |
| `responsiveSet()`                                 | The `ResponsiveImageSet` behind it, placeholder included                     |
| `bytes()`                                         | The original's bytes                                                         |
| `fileExists()`                                    | Whether the file is actually on the disk — the check `media:clean` automates |
| `deleteFiles()`                                   | Remove originals, conversions and responsive images, leaving the row         |
| `conversion(name)` / `hasConversion(name)`        | One `GeneratedConversion`, or whether it exists                              |
| `conversionNames()`                               | Every conversion generated for this item                                     |
| `getCustomProperty(key, fallback?)`               | A value from `customProperties`, typed by the fallback                       |
| `setCustomProperty(key, value)`                   | Set one — chainable; call `save()` to persist                                |
| `forgetCustomProperty(key)`                       | Drop one — chainable                                                         |
| `originalDisk()` / `derivedDisk()`                | The resolved `StorageDriver` for each                                        |

Columns: `uuid`, `name`, `fileName`, `mimeType`, `size`, `disk`, `conversionsDisk`, `collectionName`, `modelType`, `modelId`, `orderColumn`, `customProperties`, `manipulations`, `generatedConversions`, `responsiveImages`, `placeholder`.

### The adder

`addMedia(source)` returns a `MediaAdder`. Every method chains; `toCollection()` is what actually stores the file, and it returns the `MediaItem`.

```ts fragment
class MediaAdder {
  usingName(name: string): MediaAdder;
  usingFileName(fileName: string): MediaAdder;
  withCustomProperties(properties: Record<string, unknown>): MediaAdder;
  withOrder(order: number): MediaAdder;
  toDisk(disk: string): MediaAdder;
  toCollection(collection?: string): Promise<MediaItem>;
}
```

`MediaSource` is what a source may be:

```ts fragment
type MediaSource = ArrayBuffer | Blob | UploadedFile | File | Uint8Array;
```

`PendingMediaMeta` is the same metadata as an object, for callers that build it up rather than chaining: `{ name?, customProperties?, order?, disk? }`.

`MediaOwner` is the minimum a model must expose to own media — an `id`, and a constructor name, which is what lands in `model_type`.

### Application-level operations

`MediaLibrary` is the facade; `MediaManager` is the class behind it. They are named differently because `Media` is already the mixin, and an app importing both would otherwise have to rename one at every call site.

```ts fragment
class MediaManager {
  readonly config: MediaConfigShape;
  readonly driver: ImageDriver;
  clean(options?: { dryRun?: boolean }): Promise<CleanReport>;
  regenerate(media: MediaItem, ownerClass: CollectionHost, only?: string[]): Promise<string[]>;
}
```

`CleanReport` is what a sweep found, and is worth reading rather than counting:

```ts
interface CleanReport {
  /** Rows whose original file is gone from the disk. */
  orphanedRows: number[];
  /** Conversions recorded on a row but missing on the disk. */
  danglingConversions: { mediaId: number; conversion: string }[];
  /** Rows actually removed — empty on a dry run. */
  deletedRows: number[];
}
```

### Collections and conversions

```ts fragment
type MediaCollections = Record<string, CollectionDefinition | (() => CollectionDefinition)>;
type ConversionMap = Record<string, ConversionDefinition>;
```

`CollectionDefinition` is the option set documented under [Collection options](#collection-options). `ConversionDefinition` is one derived image: `width`, `height`, `fit`, `format`, `quality`, `rotate`, `allowEnlargement`, `queued`.

```ts
type ConversionFit = "inside" | "fill" | "cover";
type SafeConversionFormat = "jpeg" | "png" | "webp";
type ConversionFormat = SafeConversionFormat | "avif" | "heic";
```

`SafeConversionFormat` is the set that encodes on every host. `ConversionFormat` adds the two that go through OS codecs — see [AVIF and HEIC are host-dependent](#avif-and-heic-are-host-dependent).

What generation records:

```ts
interface GeneratedConversion {
  fileName: string;
  size: number;
  mimeType: string;
  width: number;
  height: number;
  /** ISO-8601. */
  generatedAt: string;
}

interface ResponsiveImage {
  fileName: string;
  width: number;
  height: number;
}

interface ResponsiveImageSet {
  /** Generated widths, ascending. */
  images: ResponsiveImage[];
  /** A `data:` low-quality placeholder, when one was produced. */
  placeholder?: string;
}
```

### Image drivers

`ImageDriver` is the seam between this package and whatever actually manipulates pixels. Two implementations ship — `BunImageDriver` (the default, no dependencies) and `SharpImageDriver` (opt-in, a native module) — and a shared parity suite holds them to the same output dimensions.

```ts fragment
interface ImageDriver {
  readonly name: string;
  /** Whether `fit: "cover"` is available. Both shipped drivers report `true`. */
  readonly supportsCrop: boolean;
  metadata(bytes: Uint8Array): Promise<ImageMetadata | null>;
  convert(bytes: Uint8Array, manipulation: ImageManipulation): Promise<ImageResult>;
  placeholder(bytes: Uint8Array): Promise<string | null>;
  canEncode(format: ConversionFormat): Promise<boolean>;
}

interface ImageManipulation {
  width?: number;
  height?: number;
  fit?: ConversionFit;
  /** Always resolved by the caller — drivers never guess. */
  format: ConversionFormat;
  quality?: number;
  rotate?: number;
  /** Never scale a source up to meet the box. Default `true`. */
  withoutEnlargement?: boolean;
}

interface ImageResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  format: ConversionFormat;
  mimeType: string;
}

interface ImageMetadata {
  width: number;
  height: number;
  format: string;
}
```

Writing your own driver is supported, and the interface may grow only in ways that leave yours compiling: **new members arrive optional**, with the package supplying the fallback. `ImageManipulation` may gain optional fields; `ImageResult` and `ImageMetadata` may not gain required ones, because drivers produce them.

`BunImageDriver` takes pixel ceilings, so a decompression bomb fails as a refusal rather than as memory exhaustion. `SharpImageDriver` takes no arguments — libvips streams tiles rather than materialising the full bitmap, so the ceiling has nothing to protect.

```ts fragment
new BunImageDriver(maxPixels?, maxCropPixels?);
new SharpImageDriver();
```

`SharpImageDriver` also loads `sharp` lazily, through a variable specifier, so `tsc` does not try to resolve it in the apps that never installed it — which is most of them. Selecting the driver without the package installed fails at first use with a message naming the install command.

Three lookup tables are exported for reading — to label a download, or to check a type before offering an upload. They are frozen, because they are shared module state: an app that mutated one would change how conversions behave for every other caller in the process, including ones it does not own.

```ts fragment
const FORMAT_MIME: Readonly<Record<ConversionFormat, string>>;
const FORMAT_EXTENSION: Readonly<Record<ConversionFormat, string>>;
const CONVERTIBLE_MIME_TYPES: ReadonlySet<string>;
function isConvertible(mimeType: string | null | undefined): boolean;
```

`isConvertible` answers whether a stored file is worth handing to a driver at all — the check to run before offering a "regenerate thumbnails" button.

### Paths

Supply a `PathGenerator` to change the on-disk layout described under [Where files live](#where-files-live). `DefaultPathGenerator` is the shipped one, and `setPathGenerator` installs yours. It is process-global, so a provider's `register()` is the place for it.

```ts fragment
interface PathGenerator {
  forOriginal(media: MediaItem): string;
  forConversions(media: MediaItem): string;
  forResponsiveImages(media: MediaItem): string;
}

class DefaultPathGenerator implements PathGenerator {
  constructor(prefix?: string);
}

function setPathGenerator(generator: PathGenerator): void;
```

```ts fragment
// A provider's register()
setPathGenerator(new DefaultPathGenerator("uploads"));
```

### Command classes

`MediaCleanCommand` and `MediaRegenerateCommand` back `media:clean` and `media:regenerate`. `MediaProvider` registers both; they are exported from `@zerotal/media/commands` so an app can subclass one to change its defaults.

### Errors

Every failure is a `MediaError` subclass carrying a stable `code`, an HTTP `status` and a `context` object — so a handler can branch on the code rather than matching a message.

| Class                          | Code                               | Status | Raised when                                                     |
| ------------------------------ | ---------------------------------- | ------ | --------------------------------------------------------------- |
| `UnknownCollectionError`       | `E_MEDIA_UNKNOWN_COLLECTION`       | 500    | A collection name matches nothing the model declares            |
| `DisallowedMimeTypeError`      | `E_MEDIA_DISALLOWED_MIME_TYPE`     | 422    | The sniffed type is not in the collection's `accepts`           |
| `FileTooLargeError`            | `E_MEDIA_FILE_TOO_LARGE`           | 422    | The file exceeds the collection's `maxSize`                     |
| `UnsavedOwnerError`            | `E_MEDIA_UNSAVED_OWNER`            | 500    | `addMedia` on a model with no primary key yet                   |
| `UnsupportedFormatError`       | `E_MEDIA_UNSUPPORTED_FORMAT`       | 500    | This host cannot encode the requested format                    |
| `UnsupportedManipulationError` | `E_MEDIA_UNSUPPORTED_MANIPULATION` | 500    | The driver cannot do what the conversion asks (a crop, usually) |
| `RasterFormatError`            | `E_MEDIA_RASTER_FORMAT`            | 500    | A decoded image could not be re-encoded                         |
| `MediaFileMissingError`        | `E_MEDIA_FILE_MISSING`             | 404    | A row points at a file the disk does not have                   |

`UnknownCollectionError` lists the collections the model _does_ declare, because the mistake is nearly always a typo.
