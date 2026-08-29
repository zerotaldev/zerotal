---
title: Admin Forms & Infolists
description: Build create and edit forms, and lay out the read-only view screen.
---

# Forms

`form()` returns fields (and layout components). An empty `form()` disables
Create/Edit for the resource.

```ts fragment
import {
  textInput, textarea, select, toggle, datePicker, fileUpload, richEditor,
  formSection, formTabs, formTab, wizard, wizardStep,
} from "@zerotal/admin";

static form() {
  return [
    formSection("Content").columns(2).schema([
      textInput("title").required().maxLength(160).columnSpan(2),
      textInput("slug").required()
        .live().afterStateUpdated((v) => ({ slug: slugify(String(v)) })),
      select("status").options({ draft: "Draft", published: "Published" }).required(),
      datePicker("published_at").visible((d) => d.status === "published"),
    ]),
    formSection("Body").schema([
      richEditor("body"),
      fileUpload("cover").image().disk("covers"),
    ]),
  ];
}
```

## Field catalogue

| Factory                                                     | Renders                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `textInput(k)`                                              | text — plus `.email()/.password()/.numeric()/.url()/.tel()`                     |
| `textarea(k)`                                               | multi-line text (`.rows(n)`)                                                    |
| `select(k)`                                                 | select — `.options()/.optionsUsing()/.multiple()/.searchable()/.createOption()` |
| `checkbox(k)`, `toggle(k)`                                  | boolean                                                                         |
| `radio(k)`, `checkboxList(k)`                               | single / multi choice                                                           |
| `datePicker`, `dateTimePicker`, `timePicker`, `colorPicker` | native pickers                                                                  |
| `tagsInput(k)`                                              | tag/token array                                                                 |
| `keyValue(k)`                                               | key/value object editor                                                         |
| `fileUpload(k)`                                             | upload — `.image()/.disk(dir)/.accept(mime)/.multiple()`                        |
| `slider(k)`                                                 | range → number (`.min()/.max()/.step()`)                                        |
| `toggleButtons(k)`                                          | segmented buttons (`.multiple()`)                                               |
| `codeEditor`, `markdownEditor`, `richEditor`                | code / markdown / WYSIWYG editors                                               |
| `hidden(k)`                                                 | retained-but-hidden value                                                       |
| `repeater(k)`, `builder(k)`                                 | nested object-arrays (see below)                                                |

A control the catalogue lacks is `customField(k).render(fn)` — see
[Extending the UI](/docs/admin/extending-ui#custom-renderers).

## Common modifiers

`.label()`, `.placeholder()`, `.helperText()`, `.default(v)`, `.required()`,
`.minLength()/.maxLength()/.min()/.max()`, `.confirmed()`, `.rule(fn)`,
`.columnSpan(n)`, `.disabled()`, `.visibleOn("create"|"edit")` / `.hiddenOn(...)`,
and the reactive `.visible((data) => bool)` / `.disabledWhen((data) => bool)`.

`.live()` re-evaluates dependent fields on change; `.afterStateUpdated((v, data) =>
patch)` runs server-side and merges a patch into the form (e.g. derive a slug).

## Layout components

| Component                                    | Purpose                                 |
| -------------------------------------------- | --------------------------------------- |
| `formSection(heading).columns(n).schema([])` | Titled, multi-column card.              |
| `formTabs([formTab("X").schema([])])`        | Tabbed groups (client-side switching).  |
| `wizard([wizardStep("X").schema([])])`       | Stepped form with per-step validation.  |
| `fieldset(legend)`                           | Bordered `<fieldset>`/`<legend>` group. |
| `split([sectionA, sectionB])`                | Side-by-side sections.                  |
| `callout(text).tone().icon().heading()`      | A toned notice block.                   |
| `prime / primeHtml / primeImage`             | Static text / HTML / image display.     |

## Repeater & Builder

`repeater` edits an array of objects sharing one sub-schema; `builder` edits an array
of typed blocks. Rows can be added, removed, and reordered.

```ts fragment
import { repeater, builder, builderBlock, textInput, textarea, fileUpload } from "@zerotal/admin";

repeater("contacts").minItems(1).addActionLabel("Add contact").schema([
  textInput("name").required(),
  textInput("email").email(),
]),

builder("content").blocks([
  builderBlock("paragraph").schema([textarea("text")]),
  builderBlock("image").icon("photo").schema([fileUpload("src").image()]),
]),
```

Repeaters serialize to `[{ ...fields }]`; builders to `[{ type, data }]`.

## Infolists (View page)

`infolist()` describes the read-only detail page. Omit it to fall back to a section
derived from `columns()`.

```ts fragment
import { section, textEntry, iconEntry } from "@zerotal/admin";

static infolist() {
  return [
    section("Overview").columns(2).schema([
      textEntry("title").weight("semibold"),
      textEntry("status").badge().color((v) => (v === "published" ? "success" : "muted")),
      textEntry("email").copyable(),
      textEntry("created_at").since(),
      textEntry("price").money("USD"),
      iconEntry("featured").boolean(),
    ]),
  ];
}
```

### Entry kinds

`textEntry` covers most of a view page. The rest exist because some values are not
usefully read as text:

| Factory                | Renders                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `textEntry(key)`       | A value, with `.badge()`, `.date()`, `.money()`, `.copyable()`, `.url()`. |
| `iconEntry(key)`       | A check or a cross for a boolean.                                         |
| `imageEntry(key)`      | An image from a URL — `.circular()`, `.height(px)`.                       |
| `colorEntry(key)`      | A swatch beside the value.                                                |
| `codeEntry(key)`       | A monospace block — `.language("json")`.                                  |
| `keyValueEntry(key)`   | An object as a two-column table of its pairs.                             |
| `repeatableEntry(key)` | A nested `.schema([…])` rendered once per array item.                     |

`repeatableEntry` is the read side of `repeater`: whatever the form wrote into a
JSON column, this reads back in the same shape.

```ts fragment
section("Line items").schema([
  repeatableEntry("lines")
    .placeholder("This order has no line items.")
    .schema([
      textEntry("sku").label("SKU"),
      textEntry("description"),
      textEntry("quantity").label("Qty"),
      textEntry("unitPrice").label("Unit price").money("USD"),
    ]),
]),
```

## Types

| Type               | What it is                                                                        |
| ------------------ | --------------------------------------------------------------------------------- |
| `FormComponent`    | Anything that can appear in a form — a field, a layout block, a custom component. |
| `FormBlock`        | A grouping: a section, a tab, a fieldset.                                         |
| `FieldMode`        | Whether a field is editable, read-only or hidden in this context.                 |
| `FieldPredicate`   | The condition behind a conditional field.                                         |
| `FormModeConfig`   | How the form differs between create and edit.                                     |
| `UploadedFileLike` | What a file field hands your handler.                                             |

Infolists — the read-only counterpart — use `InfolistComponent`, with `EntryKind`,
`EntryDisplay`, `EntrySize` and `EntryWeight` describing one entry's type and presentation.
`PrimeKind` is the leading entry a record view opens with.

## Next steps

- [Admin overview](/docs/admin) — the guide's front page and the rest of the sections.
- [Reference](/docs/admin/references) — the full API surface in one table.
