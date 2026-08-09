---
title: "The Last Upload Helper You Delete"
description: "@zerotal/media attaches files to models — collections, thumbnails, responsive images, ordering, cleanup — with no migration to write and no native image dependency. One mixin, and the five jobs every uploads feature repeats are done."
date: 2026-08-09
category: Announcements
order: 1
---

# The Last Upload Helper You Delete

Somewhere in your codebase there is a file called `upload-helper.ts`, or `attachments.ts`, or — if it has been through a few hands — `media-utils-v2.ts`. You did not want to write it. Nobody wants to write it. But "users can add a photo" turns out to be five jobs wearing one trench coat:

1. Put the bytes somewhere and remember where.
2. Write a database row that points at them.
3. Make the thumbnail. And the hero crop. And now the webp variants.
4. Serve URLs — public ones, and signed ones for the private stuff.
5. Clean all of it up when the parent record goes away. (This one is on the roadmap.)

Each job is small. Together they are a package — which is why **`@zerotal/media`** ships as one, new in Zerotal 1.3.0.

## The whole feature

A model declares what it accepts. That is the entire configuration surface:

```ts
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

Then you use it:

```ts
await product
  .addMedia(await ctx.file("photo"))
  .withCustomProperties({ alt: "A steel kettle" })
  .toCollection("images");

product.getFirstMediaUrl("images", "thumb"); // ready for src=
```

There is no migration in that story. `MediaProvider` provisions the `media` table at boot, once, only if it is missing — the same pattern the framework already uses for sessions and jobs. `bun add @zerotal/media`, register the provider, and the first `addMedia()` works.

If `Model.using(...)` looks new, it is — 1.3.0 replaced the old `BaseModelWith(...)` helper with a `using` static on the base class itself, so behaviour like this composes as a property of the model: `Model.using(Media, SoftDeletes)`, stacking left to right.

## The bytes decide, not the filename

`accepts` is not checked against the filename, and not against the `Content-Type` header either. Both of those are supplied by whoever is uploading, which makes them exactly as trustworthy as the person uploading. The type is sniffed from the file's own bytes — so `payload.html` renamed to `photo.jpg` and sent as `image/jpeg` is rejected, and the stored extension and `Content-Type` are derived from what the file actually is.

An undeclared collection name throws, listing the collections that do exist. The alternative is a typo that silently creates a collection nobody ever reads from, and that is not a feature.

## Thumbnails without a native dependency — and one honest limitation

Conversions run on `Bun.Image`, which is built into the runtime. No `sharp`, no `node-gyp`, no Dockerfile line that installs libvips. JPEG, PNG and WebP work identically on every machine that runs Bun.

Now the honest part. `Bun.Image` cannot crop. It can scale to fit inside a box, and it can stretch to fill one, but it exposes no crop primitive — so a square thumbnail from a 3:2 photograph, `fit: "cover"`, the single most common conversion in any media library, is not something the default driver can produce. We had two options: quietly return a stretched image, or throw an error that names the fix. We throw:

```ts
// fit: "cover" on the default driver:
// UnsupportedManipulationError: install sharp and set driver: "sharp"
```

```ts
// config/media.ts — with sharp installed, everything works, including cover
export default MediaConfig({ driver: "sharp" });
```

A framework that silently degrades your images is worse than one that tells you the trade it is making. Zero-dependency covers most apps; one opt-in dependency covers the rest.

## Responsive images that carry their own placeholder

`responsive: true` generates a width ladder — skipping widths wider than the source rather than upscaling — plus a ThumbHash placeholder: a blurred preview rendered into a data URI of a few hundred bytes, no client-side decoder required.

```tsx
<img
  src={media.getUrl()}
  srcset={media.srcset()}
  sizes="(max-width: 768px) 100vw, 50vw"
  style={{ backgroundImage: `url(${media.placeholder})` }}
/>
```

Heavy conversions can be marked `queued: true` and run on a worker via `@zerotal/queue`. No queue registered? They run inline instead — late is better than a thumbnail that never appears. And `getUrl("hero")` on a conversion a worker has not finished yet falls back to the original rather than to a broken image.

## Cleanup that understands soft deletes

Files follow their model. Hard-delete a product and its originals, conversions and responsive variants go too. But a model composed with `SoftDeletes` keeps its files through `delete()` — `restore()` is supposed to give back the model you had, and it cannot do that if the images went with it. They go on `forceDelete()`, when you mean it.

The rest of the lifecycle is one call each: `single: true` collections replace on add, `onlyKeepLatest: n` prunes automatically, `setMediaOrder([...])` reorders for drag-and-drop UIs, and `getTemporaryUrl(300)` signs a five-minute link for anything on a private disk.

## It tests like everything else

`Storage.fake()` asserts the bytes landed; `MediaFake` asserts a row points at them. A media row with no file and a file with no row are different bugs, and the assertions keep them distinguishable:

```ts
const disk = Storage.fake();

await product.addMedia(file).toCollection("images");

await MediaFake.assertHas(product, "images");
await MediaFake.assertConversion(product, "images", "thumb");
disk.assertExistsMatching(/^media\/[0-9a-f-]+\/original\.png$/);
```

## The lineage, acknowledged

If you are arriving from Laravel and thinking "this is `spatie/laravel-medialibrary`" — yes. That package spent a decade proving what the right API for model media looks like, and `@zerotal/media` follows its shape deliberately: collections declared on the model, a fluent adder, conversions, responsive images, fallbacks. What Zerotal adds is the ground it stands on: a boot-provisioned schema instead of published migrations, byte-sniffed acceptance by default, and an image pipeline that needs no native extension to start.

## Try it

```bash
bun add @zerotal/media
```

`@zerotal/media` is part of Zerotal 1.3.0, out now. The [Media Library docs](/docs/media) cover everything above plus configuration, path generation, and the `media:clean` / `media:regenerate` commands — and if you are starting fresh, `bun create zerotal` gives you an app to attach things to.
