---
title: Icons
description: 2,060 icons bundled with Flow's component library — typed by name, rendered on the server, nothing to install.
---

# Icons

`<Icon>` draws an icon by name. The set ships inside `@zerotal/flow-ui`, so this
works in a new app with nothing installed and nothing configured:

```tsx
import { Icon } from "@zerotal/flow-ui";

<Icon name="inbox" />
<Icon name="chevron-right" />
<Icon name="trash-2" class="size-5 text-red-600" />
```

The name is a union of every bundled icon, so a typo is a compile error rather
than a blank space nobody notices until it is in front of a user:

```text
Type '"inbxo"' is not assignable to type 'IconName'. Did you mean '"inbox"'?
```

That works on install — there is no generator to run first. The icons belong to
the framework, so the names are known before your app exists.

## Props

`IconProps` — anything else you pass lands on the rendered `<svg>`.

| Prop    | Type       | Description                                                                    |
| ------- | ---------- | ------------------------------------------------------------------------------ |
| `name`  | `IconName` | Which icon. Checked at compile time against the bundled and registered names.  |
| `label` | `string`   | Accessible name. Omit for decoration — the icon is hidden from screen readers. |
| `class` | `string`   | Merged with the defaults rather than replacing them.                           |

## Sizing and colour

An icon is `1em` square and painted in `currentColor`, so by default it matches
the text it sits beside — size, weight of colour, and all. Override with classes
rather than attributes:

```tsx
<p class="text-sm text-slate-600">
  <Icon name="info" /> Saved a moment ago
</p>

<Icon name="triangle-alert" class="size-8 text-amber-500" />
```

Sizing through CSS is what lets an icon line up with a label without either being
measured. `class="size-5"` sets both dimensions; `text-red-600` on the icon — or
on anything above it — colours it.

## Labelling

An icon is decoration by default and hidden from screen readers, which is right
when it sits next to text that already says the same thing. Announcing it there
would read the meaning out twice.

An icon that is the **only** content of a control is not decoration. Without a
label, that button has no accessible name at all:

```tsx
<button onClick={this.remove}>
  <Icon name="trash-2" label="Delete order" />
</button>
```

## A name that isn't known until runtime

A name from a database column or a URL segment is not a literal, so it does not
satisfy the union. `isIconName()` narrows it:

```tsx
import { Icon, isIconName } from "@zerotal/flow-ui";

override async render() {
  const glyph = this.status.icon; // string, from a row
  return isIconName(glyph) ? <Icon name={glyph} /> : <Icon name="circle-help" />;
}
```

It is a shape check, not an existence check — it says the string could name an
icon, not that anything answers to it. An icon that resolves to nothing renders
nothing rather than throwing, because taking a page down over a missing glyph is
the worse failure.

## Your own icons

A wordmark, a product glyph, a shape nobody has drawn: register it once, from a
provider's `register()`, and it is available everywhere `<Icon>` is.

```ts
import { registerIcons } from "@zerotal/flow-ui";

registerIcons({
  "acme-wordmark": {
    body: '<path fill="currentColor" d="M4 4h16v16H4z"/>',
  },
});
```

Each entry is an `IconBody` — the markup that goes **inside** the `<svg>`, plus an
optional `width`/`height` when it was drawn against a box other than 24×24. A name
you register shadows a bundled one, which is how you substitute your own drawing
without renaming every call site.

Registering supplies the body; the compiler needs telling separately. Declare the
names on `CustomIconRegistry` and they join the same union as the bundled ones —
`IconName` widens, and `CustomIconName` is the set you added:

```ts
declare module "@zerotal/flow-ui" {
  interface CustomIconRegistry {
    "acme-wordmark": true;
  }
}
```

> **The body is inserted as markup, not text.** Register only SVG you control.
> A body built from user input is the same hole as any other unescaped HTML.

### Matching the set

Icons drawn to a different grid look wrong beside ones that aren't. The bundled
set is 24×24 **stroke**: no fills, `stroke="currentColor"`, `stroke-width="2"`,
round caps and joins. Copy the shape of an existing icon rather than exporting
from a design tool, which will hand you absolute fills on a half-pixel grid.

## What ships, and why it can

The bundled set is [Lucide](https://lucide.dev), which is ISC-licensed — the
reason it can be shipped inside the package at all. Redistributing it carries a
notice (`LICENSE-ICONS.md` in `@zerotal/flow-ui`) and asks nothing of your
application's UI.

Most sets are not so simple. Font Awesome Free is CC BY 4.0 — usable, and only
with attribution _you_ would have to display — and Font Awesome Pro may not be
redistributed at any price. Bundling either would relicense someone else's artwork
on behalf of every app that installed Flow. If you are entitled to a set we cannot
ship, `registerIcons()` is how you bring it: your artwork, your licence.

## Cost

None on the client. Flow renders on the server, so an icon reaches the browser as
markup that is already in the page — no icon font, no sprite sheet, no request per
glyph, and nothing for a strict [Content Security Policy](/docs/flow/performance)
to block. The set is read once per process and never sent.
