---
title: "Guide: Build go/ — A Team Link Shortener in One Sitting"
description: "A shortener is two apps in one: a redirect that has to be instant, and a UI a human uses all day. Here is the whole thing — model, redirect, dashboard, live click counts, tests — with the three traps that decide whether it survives contact with a team."
date: 2026-08-10
category: Guides
order: 7
---

# Guide: Build go/ — A Team Link Shortener in One Sitting

Every team eventually invents `go/` links. Somebody pastes a 180-character Google Sheets URL into chat for the fourth time, someone else says "can we just have go/payroll", and a week later it exists — badly, on a spare box, with no click counts and no way to change where a link points.

It is a good app to build properly because it is really **two** apps wearing one hat:

- A machine path — `GET /go/payroll` — that has to answer in a millisecond, count the click, and get out of the way.
- A human path — a dashboard where you create links, copy them, see which ones people actually use, and delete the dead ones.

Most stacks make you feel that split: a controller and an API and a frontend and a fetch layer between them. Here it is one model, one route file, and one component. This guide builds the whole thing end to end, then calls out the three traps that separate a shortener that works from one that quietly rots.

## What you are building

```text
/links              the dashboard — create, copy, count, delete
/go/payroll         the redirect — 302 to the destination, click counted
```

Custom codes when you want them (`go/payroll`), generated ones when you don't (`go/k7m2xq`), live click counts, and a CSV export. Roughly 150 lines all in.

## Start from the Flow template

```bash
bun create zerotal go-links   # pick the `flow` template
cd go-links
bun zt migrate
bun zt serve --dev
```

That gives you a working app with file-based routing, a layout, Tailwind, sign-in screens, a `.env` with a real `APP_KEY` already in it, and the database wired up. Everything below drops into it.

## The model

```ts
// app/models/ShortLink.ts
import { Model, column, table } from "zerotal/orm";
import { Carbon } from "zerotal/carbon";

// Lower-case only, and no l/1/o/0 — these codes get read aloud across a desk and
// typed from memory. 32 characters divides 256 evenly, so a random byte maps to a
// character with no modulo bias.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ALPHABET.charAt(byte % ALPHABET.length)).join("");
}

@(table("short_links").withTimestamps())
export class ShortLink extends Model {
  static override fillable = ["slug", "destination", "label"] as const;

  @column({ unique: true }) slug!: string;
  @column("text") destination!: string;
  @column() label!: string;
  @column("integer") clicks!: number;
  @column({ type: "datetime", cast: "datetime", nullable: true }) lastUsedAt?: Carbon | null;

  /** `/go/:shortLink` addresses a link by its code, not by its primary key. */
  static async resolveRouteBinding(value: string): Promise<ShortLink> {
    return ShortLink.query().where("slug", value).firstOrFail() as Promise<ShortLink>;
  }

  /** A code no row holds yet. Each collision draws again, one character longer. */
  static async freeSlug(): Promise<string> {
    for (let length = 6; ; length++) {
      const candidate = randomCode(length);
      if (!(await ShortLink.query().where("slug", candidate).first())) return candidate;
    }
  }

  /** One click. */
  async recordClick(): Promise<void> {
    // `clicks = clicks + 1`, in SQL. See trap two.
    await this.increment("clicks");

    this.lastUsedAt = Carbon.now();
    await this.save(); // writes only what changed — the counter is untouched
  }
}
```

Three things in there are worth a sentence each.

**It is `ShortLink`, not `Link`.** Flow exports a `<Link>` component, and a page that imports both would have to rename one at every call site. Naming the model out of the way once is cheaper than fighting it forever.

**`fillable` is declared `as const`.** Models guard every attribute by default, so the list is what makes `create()` work at all — and the literal tuple narrows the payload type to exactly those three columns. `clicks` and `lastUsedAt` are server-owned; a form body can never reach them, and TypeScript will not even let you try.

**`resolveRouteBinding` is where the lookup lives.** Declare it once on the model and every route that binds a `ShortLink` — controllers, Flow pages, file routes — resolves by code instead of by ID, and a missing row raises a 404 before your handler runs. The redirect below has no lookup code in it because of this five-line method.

## The migration

```ts
// database/migrations/0003_create_short_links_table.ts
import { Migration, Schema } from "zerotal/orm";

export default class CreateShortLinksTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("short_links", (table) => {
      table.increments("id");
      // The uniqueness that actually holds. See trap one.
      table.string("slug").unique();
      table.text("destination");
      table.string("label").default("");
      table.integer("clicks").default(0);
      table.dateTime("last_used_at").nullable();
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("short_links");
  }
}
```

`bun zt migrate` and the table exists.

## The redirect

This is the entire machine half of the app:

```ts
// app/flow/pages/go/[shortLink].ts
import type { HttpContext } from "zerotal";
import type { ShortLink } from "@app/models/ShortLink.ts";

// A type-only import: the model registry is filled by auto-discovery at boot, not
// by this file. Nothing here has to know how `:shortLink` becomes a record.
export async function GET(ctx: HttpContext<{ shortLink: ShortLink }>): Promise<void> {
  const link = ctx.params.shortLink;

  // 302, deliberately — see trap three.
  ctx.redirect(link.destination, 302);

  // Counting is not the visitor's problem. This runs after the response is gone.
  ctx.afterResponse(() => link.recordClick());
}
```

Four statements, and more comment than code. Worth unpacking:

**File-based routing put it there.** `app/flow/pages/go/[shortLink].ts` becomes `GET /go/:shortLink`. The scanner picks up plain verb handlers in the same tree as your Flow pages, so the redirect lives next to the dashboard it belongs to instead of in a routes file three directories away.

**There is no lookup and no null check.** `:shortLink` names the `ShortLink` model, so the router resolved it — through `resolveRouteBinding`, by code — before this function ran. A code nobody issued raises `ModelNotFoundError`, which the HTTP layer renders as a 404. The happy path is the only path you write.

**`/go/` is a reserved namespace, on purpose.** Serving codes from the root would be shorter, but the day someone claims `go/about` your About page disappears. One prefix segment means a short code can never shadow a real route, and you never have to maintain a blocklist of your own URLs.

**`afterResponse` is why this stays fast.** The redirect is already flushed when the write runs. A slow database makes your dashboard slow; it does not make the link slow, and it cannot fail the redirect — after-response errors are logged and swallowed.

## The dashboard

One class. Create, copy, count, delete, export.

```tsx
// app/flow/pages/links.tsx
import { Component, expose, locked, renderless, validate, Field } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import type { RuleBuilder } from "zerotal/validator";
import { config } from "zerotal";
import { ShortLink } from "@app/models/ShortLink.ts";
import { AppLayout } from "../layouts/app";
import { CARD, FIELD, PRIMARY, SECONDARY } from "../ui";

/**
 * `new URL()` answers "is this a URL?" — and `javascript:alert(1)` is a URL. A
 * redirector needs the narrower question, so ask it. See trap three.
 */
function httpOnly(value: unknown): true | string {
  try {
    const { protocol } = new URL(String(value));
    return protocol === "http:" || protocol === "https:"
      ? true
      : "Only http:// and https:// links can be shortened.";
  } catch {
    return "That is not a full URL — include the https:// part.";
  }
}

// Rules are values. The same one guards the field as you type and the action when
// you submit, so the two can never drift apart.
const destinationRule = (rule: RuleBuilder) =>
  rule.required("Paste a link to shorten.").custom(httpOnly);
const labelRule = (rule: RuleBuilder) => rule.string().max(60);
const slugRule = (rule: RuleBuilder) =>
  rule.string().min(3).max(40).alphaDash().unique("short_links", "slug");

export class LinksPage extends Component {
  static layout = AppLayout;
  static title = "Links";

  @expose @validate(destinationRule) destination = "";
  @expose @validate(labelRule) label = "";
  @expose slug = "";

  @locked links: ShortLink[] = [];
  @locked totalClicks = 0;

  override async onMount(): Promise<void> {
    this.links = await ShortLink.query().orderBy("created_at", "desc").limit(50).get<ShortLink>();
    this.totalClicks = await ShortLink.query().sum("clicks");
  }

  // A code is typed by a human and read by a URL. Normalise at the edge and the
  // rest of the app never has to wonder about "Payroll " with a trailing space.
  override async onUpdated(prop: string): Promise<void> {
    if (prop === "slug") this.slug = this.slug.trim().toLowerCase();
  }

  @expose async shorten(): Promise<void> {
    await this.validate({
      destination: destinationRule,
      label: labelRule,
      // Rules are a plain object, so "only when they typed one" is a spread —
      // not a framework feature you have to go looking for.
      ...(this.slug ? { slug: slugRule } : {}),
    });

    const link = await ShortLink.create({
      slug: this.slug || (await ShortLink.freeSlug()),
      destination: this.destination.trim(),
      label: this.label.trim(),
    });

    this.destination = "";
    this.slug = "";
    this.label = "";
    await this.refresh(); // re-runs onMount — the list reloads
    this.flash(`go/${link.slug} is live.`);
  }

  @expose async remove(id: number): Promise<void> {
    const link = await ShortLink.findOrFail(id);
    await link.delete();
    await this.refresh();
    this.flash(`go/${link.slug} deleted.`);
  }

  @expose @renderless async exportCsv(): Promise<void> {
    const rows = await ShortLink.query().orderBy("clicks", "desc").get<ShortLink>();
    const csv = [
      "code,clicks,label,destination",
      ...rows.map((r) => `${r.slug},${r.clicks},"${r.label}","${r.destination}"`),
    ].join("\n");

    this.download("links.csv", csv, "text/csv;charset=utf-8");
  }

  override async render(): Promise<HtmlNode> {
    const origin = config("app.url"); // typed `string` — app config paths are checked

    return (
      <section class="space-y-8">
        <header class="flex items-end justify-between gap-4">
          <div>
            <h1 class="text-3xl font-bold tracking-tight">Links</h1>
            <p class="mt-1 text-sm text-gray-600">
              {this.links.length} links · {this.totalClicks} clicks
            </p>
          </div>
          <button onClick={this.exportCsv} class={SECONDARY}>
            Export CSV
          </button>
        </header>

        <form onSubmit={this.shorten} class={`${CARD} max-w-none space-y-4`}>
          <Field label="Destination" error={this.errors.destination}>
            <input
              value={this.destination}
              blur
              autoFocus
              focusOnError
              placeholder="https://docs.example.com/handbook/expenses"
              class={FIELD}
            />
          </Field>

          <div class="grid gap-4 sm:grid-cols-2">
            <Field
              label="Short code"
              description="Leave it empty and we'll pick one."
              error={this.errors.slug}
            >
              <input value={this.slug} blur placeholder="payroll" class={FIELD} />
            </Field>

            <Field label="Label" description="What it points at, for this list." error={this.errors.label}>
              <input value={this.label} placeholder="Payroll spreadsheet" class={FIELD} />
            </Field>
          </div>

          <button type="submit" loadingAttr="disabled" class={PRIMARY}>
            Shorten
          </button>
        </form>

        <div
          poll={{ every: "10s", action: this.refresh }}
          class="overflow-hidden rounded-xl border border-gray-200 bg-white"
        >
          <table class="w-full text-sm">
            <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th class="px-4 py-3">Short link</th>
                <th class="px-4 py-3">Points at</th>
                <th class="px-4 py-3 text-right">Clicks</th>
                <th class="px-4 py-3 text-right">Last used</th>
                <th class="px-4 py-3" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {this.links.map((link) => (
                <tr key={String(link.id)} class="hover:bg-gray-50">
                  <td class="px-4 py-3 font-mono">
                    <a href={`/go/${link.slug}`} class="text-indigo-600 hover:underline">
                      go/{link.slug}
                    </a>
                    <button
                      type="button"
                      title="Copy"
                      onclick={`navigator.clipboard.writeText(${JSON.stringify(`${origin}/go/${link.slug}`)})`}
                      class="ml-2 text-gray-400 transition hover:text-gray-900"
                    >
                      ⧉
                    </button>
                  </td>
                  <td class="max-w-xs truncate px-4 py-3 text-gray-600">
                    {link.label || link.destination}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">{link.clicks}</td>
                  <td class="px-4 py-3 text-right text-gray-500">
                    {link.lastUsedAt ? link.lastUsedAt.diffForHumans() : "—"}
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button
                      onClick={() => this.remove(link.id)}
                      confirm={`Delete go/${link.slug}? Anyone who saved it gets a 404.`}
                      class="text-gray-400 transition hover:text-red-600"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {this.links.length === 0 && (
            <p class="px-4 py-10 text-center text-sm text-gray-500">
              No links yet. Shorten something above.
            </p>
          )}
        </div>
      </section>
    );
  }
}
```

The page is file-routed, so it is already live at `/links`. One thing to add if you want the toasts: drop a single `<Flash />` into `AppLayout` — `this.flash()` dispatches, `<Flash>` renders, and every page in the app gets toasts from that one line.

### The walkthrough

**A rule is a value.** `destinationRule` is an ordinary arrow function used in two places: on the `@validate` decorator, and in the rule map the action passes to `this.validate()`. That matters because the decorator is what powers *real-time* validation — the destination field is bound with `blur`, so leaving it with a bad URL in it shows the error immediately, with no submit and no round-trip you had to write. When the form is finally submitted, the same function runs again server-side. There is no way for the live check and the real check to disagree.

**Conditional rules need no API.** Passing rules explicitly to `validate()` replaces the decorator set, so the map has to be complete — and because it is a plain object, the "only validate the code when they typed one" case is a spread. No `sometimes`, no branching, no second code path.

**`unique()` writes the good error message.** A code that is already taken comes back as an error on the `slug` field, in the right place, in the user's flow. What it does *not* do is guarantee anything — see trap one.

**Copying is free.** The short URL is known at render time, so the copy button is a plain `onclick` attribute with a server-baked string in it. No round-trip, no client state, no clipboard library.

**`poll` keeps the counts honest.** `poll={{ every: "10s", action: this.refresh }}` re-runs `onMount()` on a timer, so the numbers move while the page sits open. If you want them to move the *instant* someone clicks a link rather than within ten seconds, swap the poll for an `@on("echo:links,LinkClicked")` listener and broadcast from `recordClick()` — same component, three lines different.

**`confirm` and `loadingAttr` are props, not plumbing.** `confirm="…"` gates the action behind a browser confirm; `loadingAttr="disabled"` disables the submit button while the action is in flight, immediately, so a double-click cannot create two links.

**The CSV export has no endpoint.** `@renderless` skips the re-render (nothing on screen changes), `this.download()` streams the file to the browser. There is no `/export` route, no `Content-Disposition` header to remember, and no blob juggling in JavaScript.

## Trap one: the unique check is not the guarantee

`unique("short_links", "slug")` runs a `SELECT`. Between that `SELECT` and your `INSERT` there is a window, and in that window somebody else can take the code. Two people claiming `go/payroll` at the same moment both pass validation and both proceed.

This is why the migration says `table.string("slug").unique()`. The **index** is the guarantee; the validation rule is the good error message. You want both, and they are doing genuinely different jobs:

- The rule gives a human a sentence they can act on, attached to the field they typed it into.
- The index makes it impossible for the database to end up with two rows claiming one code, no matter how the race falls out.

Ship a shortener with the rule and no index and it will look fine for months. Then two links will point at the same code, one of them will win every lookup, and there will be no way to tell which was which.

`freeSlug()` gets the same treatment from the other direction: it checks, and on a collision it draws again a character longer. Six characters from a 32-symbol alphabet is a billion codes, so the first draw effectively always wins — but "effectively always" is not a plan, and the loop costs four lines.

## Trap two: `clicks++` loses clicks

The obvious way to count a click:

```ts
link.clicks = link.clicks + 1;
await link.save();
```

That is a read, a modify, and a write, with time in between. Send a link to a company Slack and forty people click it inside a second: forty requests read `clicks = 0`, forty write `clicks = 1`, and your dashboard reports one click on the most successful link you ever made.

```ts
await this.increment("clicks");
```

That compiles to `UPDATE short_links SET clicks = clicks + 1 WHERE id = ?` — one statement, resolved by the database, atomic by construction. Forty concurrent calls produce forty clicks.

The rule generalises past this app: any counter that more than one request can touch belongs in the database's hands, not in your process's. The moment a value's next state depends on its current state, a read-then-write is a bug waiting for traffic.

Note the ordering in `recordClick()` — increment first, then set `lastUsedAt` and `save()`. `save()` writes only the columns that actually changed, so the counter is never included and never clobbered.

## Trap three: 301 is forever, and `javascript:` is a URL

Two mistakes, both hiding in that tiny route file, both invisible until they are expensive.

**Use 302, not 301.** A 301 tells the browser *this has permanently moved* — and browsers believe it, cache it hard, and stop asking. Your click counter stops counting, because the request never reaches you again. Worse, the whole point of a shortener is that `go/payroll` can be repointed when the spreadsheet moves; a 301 means everyone who has ever clicked it keeps landing at the old destination, and there is nothing you can do from the server to fix them. 302 costs a request per click. That request *is* the product.

**Validate the scheme, not just the shape.** `new URL()` is the right tool for "is this a URL?", and it correctly answers *yes* for `javascript:alert(document.cookie)` — that is a valid URL with a `javascript:` protocol. Correct answer, wrong question. A redirector is a machine that puts arbitrary strings in a `Location` header on your domain's authority, so it needs to ask something narrower:

```ts
const { protocol } = new URL(String(value));
return protocol === "http:" || protocol === "https:" ? true : "Only http:// and https:// links…";
```

Because rules compose with `.custom()`, that check sits in the same chain as everything else and reports through the same error bag. Without it, your internal link tool is a hosted redirect for anything anyone wants to send, with your company's domain vouching for it.

## Testing both halves

The dashboard and the redirect fail in different ways, so test them in different ways — the component in-process, the redirect over real HTTP.

```ts
// tests/links.test.ts
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { createTestApp, migrateDatabase, type TestApp } from "zerotal/testing";
import { FlowTest } from "@zerotal/flow/testing";
import { LinksPage } from "../app/flow/pages/links.tsx";
import { ShortLink } from "../app/models/ShortLink.ts";

let app: TestApp;

beforeAll(async () => {
  Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  Bun.env.ZT_DB_URL ??= ":memory:";
  app = await createTestApp(() => import("../bootstrap/app.ts").then((m) => m.default));
  await migrateDatabase();
});

afterAll(() => app.close());

describe("shortening", () => {
  test("picks a code when none is given", async () => {
    const t = await FlowTest.mount(LinksPage);
    await t.set("destination", "https://example.com/handbook");
    await t.call("shorten");

    t.assertNoErrors();
    expect(t.page().links[0]?.slug).toHaveLength(6);
  });

  test("refuses a javascript: destination", async () => {
    const t = await FlowTest.mount(LinksPage);
    await t.set("destination", "javascript:alert(document.cookie)");
    await t.call("shorten");

    t.assertHasErrors("destination", "http");
  });

  test("refuses a code someone already claimed", async () => {
    await ShortLink.create({ slug: "payroll", destination: "https://example.com/a", label: "" });

    const t = await FlowTest.mount(LinksPage);
    await t.set("destination", "https://example.com/b");
    await t.set("slug", "payroll");
    await t.call("shorten");

    t.assertHasErrors("slug");
  });
});

describe("the redirect", () => {
  test("sends the browser to the destination", async () => {
    await ShortLink.create({
      slug: "handbook",
      destination: "https://example.com/handbook",
      label: "",
    });

    const res = await app.get("/go/handbook");

    // 302, not 301 — a permanent redirect would be cached and never counted.
    expect(res.status).toBe(302);
    res.assertRedirect("https://example.com/handbook");
  });

  test("404s on a code that was never issued", async () => {
    (await app.get("/go/nope")).assertNotFound();
  });
});

describe("click counting", () => {
  test("survives simultaneous clicks", async () => {
    const link = await ShortLink.create({
      slug: "busy",
      destination: "https://example.com",
      label: "",
    });

    await Promise.all(Array.from({ length: 20 }, () => link.recordClick()));

    expect((await ShortLink.findOrFail(link.id)).clicks).toBe(20);
  });
});
```

Three notes on why these tests are shaped this way.

**`FlowTest.mount()` needs no server and no browser.** It runs the real lifecycle — `onBoot`, `onMount`, the action, the render — in process. `t.call("shorten")` is the same code path a click produces in production, so the `javascript:` test is genuinely testing the thing that protects you, not a mock of it.

**The counting test is the one people skip.** Twenty concurrent `recordClick()` calls is the whole argument for `increment()` in three lines, and it is a test that fails loudly on the naive implementation. If you refactor that method later, this is the test that tells you.

The redirect status assertion earns its place too. `assertRedirect` alone would pass on a 301 — and a 301 is exactly the mistake this app is prone to.

## See it work

```bash
bun zt serve --dev
```

Open `/links`, paste a long URL, type `payroll` as the code, hit Shorten. Copy the link with the button next to it, open it in a second tab, and watch it land on the destination. Come back to the dashboard: within ten seconds the counter ticks to 1 without you touching anything. Open the short link a few more times and watch it climb.

Then try the failure modes, because they are the demo:

- Paste `javascript:alert(1)` — refused, with a reason, before it ever reaches the database.
- Type `payroll` a second time — refused, on the field, in the flow.
- Type `hi` as a code — too short, refused as you leave the field.
- Delete a link and open its URL again — 404, immediately, because nothing was ever cached.

## Where to take it next

Each of these is a small, self-contained addition to the same three files:

- **Repointing.** Add an `@expose async retarget(id, url)` action that updates `destination`. Every existing copy of the link starts going to the new place on the next click — which only works because of the 302.
- **Expiry.** A nullable `expiresAt` column, one `.whereNull("expires_at").orWhere("expires_at", ">", Carbon.now())` in `resolveRouteBinding`, and expired links 404 with no cleanup job.
- **Per-person links.** Put the page behind the template's auth by moving it into a `(protected)/` directory, add a `userId` column, and scope the list. Six lines.
- **QR codes.** Every short link eventually ends up on a slide. `qrSvg(encodeQr(shortUrl))` from `zerotal/auth` returns SVG markup you can drop straight into the row — no image service, no request leaving your process.
- **A real chart.** Swap the `clicks` integer for a `link_clicks` table with a timestamp per row, and the dashboard gets clicks-over-time instead of a running total.

## What you did not build

Count what is absent from this app. No API layer — no `/api/links` endpoint, no response types kept in sync by hand, no client-side fetch. No state store. No loading flags. No URL-lookup code in the redirect. No `Content-Disposition` header for the export. No clipboard dependency. No polling library.

What you wrote is a table, a validation rule, and what should happen when someone clicks a button. The wire is the framework's problem.

From here: [Flow](/docs/flow) is the front page for the component model, [Routing](/docs/routing) covers file routes and the model-owned lookup in `resolveRouteBinding`, [Validation](/docs/validator) has the full rule chain behind `@validate` and `.custom()`, and [Testing](/docs/testing) covers the `FlowTest` and `TestApp` harnesses this guide leans on. Start fresh with `bun create zerotal` — the `flow` template is the app these files drop straight into.
