---
title: Icons
description: 2,060 icons bundled with Flow's component library — typed by name, rendered on the server, nothing to install.
---

# Icons

`<Icon>` draws an icon by name. The set ships inside `@zerotal/flow-ui`, so this
works in a new app with nothing installed and nothing configured:

```tsx fragment
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

```tsx fragment
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

```tsx fragment
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

## Drawn for the gaps

Four names are drawn here rather than coming from the set, because the flows they
label are ones Zerotal ships and the set has no icon for as a concept:

| Name         | For                                                            |
| ------------ | -------------------------------------------------------------- |
| `passkey`    | WebAuthn sign-in — a fingerprint that ends in a key            |
| `two-factor` | TOTP — a second device that has to agree                       |
| `otp`        | An emailed one-time code — the separate slots it is typed into |
| `magic-link` | Passwordless sign-in by link                                   |

The set has `key-round`, `fingerprint` and `shield-check` — the parts — and a login
page needs the whole. They are drawn on the same 24×24 stroke grid, so they sit
beside the other 2,060 without announcing themselves.

Nearly everything else that looked missing was there under a name that reads
differently: `git-branch` not `branch`, `file-json` not `json`, `paperclip` not
`attachment`, `venetian-mask` for impersonation. Search before you draw.

## Brand marks

Three sign-in providers ship as brand marks, because `@zerotal/auth` has a code
path for each and a sign-in button wants the provider's actual logo:

```tsx fragment
<button><Icon name="brand-google" /> Continue with Google</button>
<button><Icon name="brand-github" /> Continue with GitHub</button>
<button><Icon name="brand-apple" /> Continue with Apple</button>
```

They come from [Simple Icons](https://simpleicons.org) (**CC0-1.0**, public
domain), so the paths are the real ones rather than approximations — an
approximated logo reads as a forgery, not as an icon.

The `brand-` prefix is deliberate: the bundled set has its own stroke-style
`github` and `apple`, and prefixing means neither silently shadows the other, so a
page picks a style rather than inheriting one. There is no plain `google` — the
set never had one, which is what made this worth doing.

Unlike the rest, brand marks are **solid**: each body carries its own
`fill="currentColor"`, so it still takes its colour from the text around it.

> **CC0 covers copyright, not trademark.** The marks belong to their owners.
> Labelling a sign-in button with one is nominative use and what brand guidelines
> contemplate; using one as your own logo is not. For a provider not listed here,
> `registerIcons()` keeps that decision — and its licence — yours.

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
