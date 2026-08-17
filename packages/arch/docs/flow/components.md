---
title: Flow Built-in Components
description: The component library that ships with Flow — forms, overlays, tables, and feedback.
---

# Built-in Components

Flow ships a library of ready-made native components and unstyled headless primitives. All are imported from `@zerotal/flow`.

> **Tip** — See them live: the example app's component gallery at `/pulse/components` (`apps/example/app/flow/ComponentsPage.tsx`) shows every component, and `/pulse/users` (`UsersPage.tsx`) is a realistic admin screen composing them together.

## Navigation

### Link

SPA navigation — prevents a full reload, swaps the page over the WebSocket, and updates the URL. The bridge automatically adds `data-current` to the link matching the current URL, so you style the active state with Tailwind's `data-[current]:` variant or a CSS attribute selector:

```tsx
import { Link } from "@zerotal/flow";

<Link href="/posts" class="data-[current]:font-bold">
  Posts
</Link>;

{
  /* Prefetch the target page after ~60ms hover */
}
<Link href="/posts" hover>
  Posts
</Link>;

{
  /* Prefetch on pointer-down instead — for a row in a long list */
}
<Link href="/posts/42" down>
  One post
</Link>;

{
  /* Disable automatic data-current (e.g. always-active home links) */
}
<Link href="/" current={false}>
  Home
</Link>;
```

Choose between `hover` and `down` by how many of the link there are. `hover` prefetches after a
short dwell, which is free speed on a handful of stable links — a navigation rail, a breadcrumb.
On a dense list it inverts: the pointer crosses every row between where it is and where it is
going, so scrolling a hundred-row table asks the server for a hundred pages nobody chose. `down`
fires on `pointerdown` instead — once, on the link the reader has committed to, and still ahead
of the click by however long the button is held. Both may be set; the target is fetched once and
cached either way.

`data-current` matches by **prefix** — a link to `/posts` stays active on `/posts/42` — which is what you want for a section parent. For an index link that should be active only on its own exact URL (an "Overview" tab that shouldn't light up on the section's sub-pages), add `exact`:

```tsx
<Link href="/dashboard" exact class="data-[current]:font-bold">
  Overview
</Link>
```

Any extra props (`class`, `target`, `rel`, …) pass through to the rendered `<a>`.

#### Scroll position

Following a link lands at the top of the new page, exactly as a full navigation
would — or at the fragment, if the href names one (`/docs#install`). Going Back
returns you to where you were on the page you left, and Forward does the same.

Some links aren't really going anywhere, though: a sort header, a filter chip, a
tab strip partway down a long page. Jumping to the top for those loses the
control the user was just looking at. `preserveScroll` leaves the viewport alone:

```tsx
<Link href={this.currentUrl({ query: { sort: "title" } })} preserveScroll>
  Title
</Link>
```

The same applies to `this.navigateCurrent()`, which takes `preserveScroll` as an
option — see [Routing](/docs/flow/routing).

## Head management

### Head

Injects content into the document `<head>`. Author it anywhere in `render()`; the client hoists it into `<head>` on load and replaces it on every `navigate` visit:

```tsx
import { Head } from "@zerotal/flow";

<Head>
  <title>Dashboard — My App</title>
  <meta name="description" content="Your personal dashboard." />
  <link rel="canonical" href="https://example.com/dashboard" />
</Head>;
```

### Title

Shorthand for `<Head><title>…</title></Head>`. Supports interpolation:

```tsx
import { Title } from "@zerotal/flow";

<Title>{`${this.unreadCount} unread — Inbox`}</Title>;
```

## Persistence

### Persist

Preserve an element — and its live state (a playing `<audio>`, an embedded widget) — across `navigate` page visits. Give it a stable `name`; on navigation the bridge re-uses the existing DOM node instead of replacing it. Best placed in your layout:

```tsx
import { Persist } from "@zerotal/flow";

{
  /* In AppLayout: */
}
<Persist name="audio-player">
  <audio src={this.currentTrack} controls autoPlay />
</Persist>;
```

Elements inside `<Persist>` also survive server-patch morphs (they carry `flow:ignore`) so their live state isn't disrupted by unrelated updates.

## Overlays

### Modal

A dialog that bundles reactive visibility, a backdrop, a panel, a transition, a close button, and Escape-to-close — all wired to one boolean prop. Clicking the backdrop, the × button, or pressing Escape sets that prop back to `false`:

```tsx
import { Modal } from "@zerotal/flow";

export class ContactsPage extends Component {
  @expose open = false;
  @expose editingId: number | null = null;

  @expose async openEdit(id: number): Promise<void> {
    this.editingId = id;
    this.open = true;
  }

  override async render() {
    return (
      <div>
        <button onClick={() => this.openEdit(contact.id)}>Edit</button>

        <Modal show={this.open} title="Edit contact">
          <Field label="Name" error={this.errors.name}>
            <input value={this.form.name} class="input" />
          </Field>
          <button onClick={this.saveContact} loadingAttr="disabled">
            Save
          </button>
        </Modal>
      </div>
    );
  }
}
```

| Prop       | Type                | Description                                    |
| ---------- | ------------------- | ---------------------------------------------- |
| `show`     | `boolean @expose`   | Bound boolean that controls visibility         |
| `title`    | `string`            | Dialog title                                   |
| `onClose`  | method ref or arrow | Override the default close (sets `show=false`) |
| `closable` | `boolean`           | Hide the × button when `false`                 |
| `class`    | `string`            | Extra classes on the panel element             |

### Drawer

A slide-over panel — the edge-anchored sibling of `<Modal>`. Same binding and close model (backdrop, × and Escape all close it client-side with no round-trip; focus-trapped), but slides in from an edge:

```tsx
import { Drawer } from "@zerotal/flow";

<button onClick={() => (this.cartOpen = true)}>Cart ({this.cartCount})</button>

<Drawer show={this.cartOpen} side="right" title="Your cart" class="w-96">
  {this.cartItems.map((item) => (
    <div key={String(item.id)} class="flex justify-between py-2">
      <span>{item.name}</span>
      <span>${item.price}</span>
    </div>
  ))}
  <button onClick={this.checkout} class="btn-primary w-full mt-4">Checkout</button>
</Drawer>
```

`side`: `"right"` (default) | `"left"` | `"top"` | `"bottom"`.

## Feedback

### Flash

A self-contained toast container. Server-side `this.flash(message, level)` dispatches a `flow:flash` event; `<Flash>` listens and renders an auto-dismissing toast. Drop **one** in your layout so toasts work app-wide:

```tsx
import { Flash } from "@zerotal/flow";

{
  /* In AppLayout: */
}
<Flash position="bottom-right" duration={4000} />;
```

| Prop       | Type     | Description                                                                                  |
| ---------- | -------- | -------------------------------------------------------------------------------------------- |
| `position` | string   | `"top-left"` `"top-center"` `"top-right"` `"bottom-left"` `"bottom-center"` `"bottom-right"` |
| `duration` | `number` | Auto-dismiss delay in ms (default: `4000`)                                                   |

Levels `success` / `error` / `warning` / `info` map to distinct colors. Click a toast to dismiss it early.

### Alert

A dismissible inline alert. `variant` sets the palette and ARIA role (error/warning announce assertively). Dismissal is client-only — no round-trip:

```tsx
import { Alert } from "@zerotal/flow";

<Alert variant="success" dismissible>
  Your changes have been saved.
</Alert>

<Alert variant="error">
  Failed to connect to the database.
</Alert>
```

`variant`: `"info"` | `"success"` | `"warning"` | `"error"`.

### Loading

Shows its children only while a server action is in flight — and, so a fast action never flashes a spinner, loading **indicators wait out a short delay** (~200ms) by default: an action that finishes inside that window shows nothing at all. This applies to the whole loading family — `<Loading>`, `showOnLoading`, `hideOnLoading`, and `loadingClass`. Only `loadingAttr` (e.g. `loadingAttr="disabled"`) is applied immediately, so a submit button still guards against a double-click even on a sub-100ms action. The `delay` prop is now the default behaviour and kept only for clarity/back-compat:

```tsx
import { Loading } from "@zerotal/flow";

<button onClick={this.save}>Save</button>
<Loading target="save" delay>Saving…</Loading>

{/* Inverted — show when NOT loading */}
<Loading hide>Ready</Loading>

{/* Scope to multiple actions */}
<Loading target={["save", "publish"]}>Working…</Loading>
```

| Prop     | Description                                                       |
| -------- | ----------------------------------------------------------------- |
| `target` | Action name(s) to scope to; omit to react to any in-flight action |
| `delay`  | Wait briefly before showing (prevents flicker)                    |
| `hide`   | Inverts the logic — shown when NOT loading                        |

## Errors

### The Errors component

Renders the component's entire validation error bag as a list. Hidden when there are none:

```tsx
import { Errors } from "@zerotal/flow";

<Errors />                              {/* every current error */}
<Errors only={["email", "password"]} /> {/* just these fields */}
```

### ErrorMessage

A single field's first error message as a self-hiding `<span>`. Equivalent to `<span error={this.errors.field} />`:

```tsx
import { ErrorMessage } from "@zerotal/flow";

<input value={this.form.email} />
<ErrorMessage for={this.errors.email} class="text-sm text-red-500" />
```

### ErrorBoundary

Contains a failure in a nested component so it costs that component rather than the page. Without
one, a child that throws while mounting or rendering takes the whole response with it — one broken
widget blanks the dashboard.

```tsx
import { ErrorBoundary } from "@zerotal/flow";

<ErrorBoundary fallback={<p class="text-sm text-red-600">Sales data unavailable.</p>}>
  <SalesReport />
</ErrorBoundary>;
```

`fallback` may be a function, which receives the thrown error. `onError` reports it (for logging or
an error tracker) without changing what renders:

```tsx
<ErrorBoundary fallback={(e) => <p>{(e as Error).message}</p>} onError={(e) => Log.error(e)}>
  <RiskyWidget />
</ErrorBoundary>
```

Boundaries nest, and the innermost one wins. Siblings are independent: one failing widget does not
affect the other.

> **What it covers is child components.** Inline JSX in the same `render()` is evaluated before the
> boundary is called, so a throw there cannot be intercepted — move the risky work into a child
> component. Containment is also opt-in: a child _outside_ any boundary still fails the page, so
> real bugs surface instead of rendering as blank space forever.

## Data display

### Table

A data table with URL-driven sortable headers. Clicking a sortable header navigates to `?sortBy=key&sortDir=asc|desc`. Pair with `@url sortBy`/`@url sortDir` and sort the rows server-side in `render()`:

```tsx
import { Table, Pager } from "@zerotal/flow";

export class UsersPage extends Component.using(Pagination) {
  @url sortBy: string = "name";
  @url sortDir: string = "asc";
  @locked users: User[] = [];

  override async onMount() {
    this.users = await User.query().orderBy(this.sortBy, this.sortDir).get();
  }

  override async render() {
    const users = await User.paginate(20);

    return (
      <div>
        <Table
          columns={[
            { key: "name", label: "Name", sortable: true },
            { key: "email", label: "Email", sortable: true },
            { key: "role", label: "Role" },
            {
              key: "actions",
              label: "",
              render: (row) => <button onClick={() => this.edit(row.id)}>Edit</button>,
            },
          ]}
          rows={p.data}
          sortBy={this.sortBy}
          sortDir={this.sortDir}
          params={{ q: this.search }} // preserve query state in sort links
          hover
        />
        <Pager paginator={p} params={{ sortBy: this.sortBy, sortDir: this.sortDir }} />
      </div>
    );
  }
}
```

### Pager

Renders a Prev / numbered / Next pager from either paginator — `Model.paginate()` or the in-memory `paginate()` helper. Links are `navigate` anchors to `?page=N`, so they pair with `@url page` automatically. (The `Pagination` export is the page-state mixin; `<Pager>` is the links UI.)

```tsx
import { Pager } from "@zerotal/flow";

const users = await User.paginate(this.perPage);
<Pager paginator={p} params={{ q: this.query, perPage: this.perPage }} hover />;
```

`hover` prefetches the next page on hover. `params` keeps other query state in the pager links.

### InfiniteScroll

A sentinel element that calls a server action when it scrolls into view. Pass `show` to stop loading when there are no more items:

```tsx
import { InfiniteScroll } from "@zerotal/flow";

@expose async loadMore(): Promise<void> {
  const nextBatch = await Post.query().offset(this.posts.length).limit(20).get();
  this.posts = [...this.posts, ...nextBatch];
}

// In render():
<ul>{this.posts.map((p) => <li key={String(p.id)}>{p.title}</li>)}</ul>
<InfiniteScroll show={this.posts.length < this.total} onMore={this.loadMore} />
```

### Virtualize

A scrolling window over a collection too large to put in the DOM. Only the visible rows exist as
elements; spacers above and below hold the scrollbar at the size the full collection implies.

As the viewport moves, `onWindow` is called with `(start, count)` and your action loads that slice.
The collection never has to reach the client in full.

```tsx
import { Virtualize } from "@zerotal/flow";

@expose rows: Row[] = [];
@expose windowStart = 0;
@expose total = 0;

override async onMount(): Promise<void> {
  this.total = await Row.query().count();
  await this.loadWindow(0, 30);
}

@expose async loadWindow(start: number, count: number): Promise<void> {
  this.rows = await Row.query().offset(start).limit(count).get();
  this.windowStart = start;
}

// In render():
<Virtualize
  items={this.rows}
  start={this.windowStart}
  total={this.total}
  itemHeight={36}
  height={480}
  onWindow={this.loadWindow}
>
  {(row) => <div class="h-9 px-3 leading-9">{row.name}</div>}
</Virtualize>
```

Rows must all be `itemHeight` pixels tall — that is what lets a scroll offset become an index
without measuring anything. `overscan` (default 6) renders extra rows beyond the viewport to hide
fetch latency.

> **Virtualize or InfiniteScroll?** `InfiniteScroll` appends and grows the DOM without bound, which
> is right for a feed someone scrolls a few screens of. Reach for `Virtualize` when _keeping_ every
> rendered row is the problem.

## Navigation menus

### Dropdown

A click-to-open menu, entirely client-side (no round-trip). Fully keyboard-navigable: Down/Up/Enter opens (focusing first/last item), arrow keys + Home/End move between items, Escape closes and returns focus to the trigger, click-outside dismisses:

```tsx
import { Dropdown } from "@zerotal/flow";

<Dropdown label="Options" align="right">
  <button class="dropdown-item">Profile</button>
  <button class="dropdown-item">Settings</button>
  <hr class="my-1" />
  <button class="dropdown-item text-red-600" onClick={this.logout}>
    Sign out
  </button>
</Dropdown>;
```

### Tabs

Client-side tabbed panels. Pass `items`, each with a `label` and the `content` to show when selected:

```tsx
import { Tabs } from "@zerotal/flow";

<Tabs
  items={[
    { label: "Overview", content: <OverviewPanel /> },
    { label: "Activity", content: <ActivityPanel /> },
    { label: "Settings", content: <SettingsPanel /> },
  ]}
/>;
```

`<Tabs>` emits `role="tablist"` / `"tab"` / `"tabpanel"` with roving arrow-key navigation.

## File upload component

### FileUpload + FileUploads mixin

A dropzone bound to an `@expose` property. Choosing a file POSTs the bytes to `/__flow/upload` over HTTP, shows live upload progress, and resolves to a signed `TemporaryUploadedFile` reference. Compose the `FileUploads` mixin for the `removeUpload` action:

```tsx
import { Component, expose, FileUpload, FileUploads, TemporaryUploadedFile } from "@zerotal/flow";

export class AvatarPage extends Component.using(FileUploads) {
  @expose photo: TemporaryUploadedFile | null = null;
  @locked photoUrl: string = "";

  override async onMount() {
    const user = await User.find(this.userId);
    this.photoUrl = user?.avatarUrl ?? "";
  }

  @expose async save(): Promise<void> {
    if (!this.photo) return;
    const path = await this.photo.store("avatars"); // moves to permanent storage
    await User.query().where("id", this.userId).update({ avatarUrl: path });
    this.flash("Avatar updated.", "success");
  }

  override async render() {
    return (
      <div class="space-y-4">
        {this.photoUrl && <img src={this.photoUrl} class="h-24 w-24 rounded-full" />}

        <FileUpload bind={this.photo} accept="image/*" maxSize="5mb" />

        {this.photo && (
          <div class="flex items-center gap-2">
            <span>{this.photo.name}</span>
            <button onClick={() => this.removeUpload("photo")}>✕</button>
          </div>
        )}

        <button onClick={this.save} loadingAttr="disabled" class="btn-primary">
          Save avatar
        </button>
      </div>
    );
  }
}
```

For multiple files, use `multiple`:

```tsx
@expose photos: TemporaryUploadedFile[] = [];

<FileUpload bind={this.photos} multiple accept="image/*" />

{/* Remove a specific file from the array: */}
<button onClick={() => this.removeUpload("photos", index)}>Remove</button>
```

## Alpine UI plugins

Common Alpine plugins are bundled and exposed as props:

```tsx
{/* Input masking */}
<input mask="(999) 999-9999" value={this.phone} live />
<input mask="9999 9999 9999 9999" value={this.cardNumber} live />

{/* Focus trapping (modals, dialogs) */}
<div trap="$flow.modalOpen" class="modal">…</div>

{/* Height animation (pair with native x-show) */}
<button onClick={() => this.expanded = !this.expanded}>Toggle</button>
<div x-show="$flow.expanded" x-collapse>…</div>

{/* Floating positioning */}
<button x-ref="trigger">Options</button>
<div anchor="$refs.trigger" anchor.bottom class="dropdown">…</div>
```

| Prop                | Backed by            | Effect                                                 |
| ------------------- | -------------------- | ------------------------------------------------------ |
| `mask="(999) …"`    | `@alpinejs/mask`     | Format an input as the user types                      |
| `trap="$flow.open"` | `@alpinejs/focus`    | Trap focus while truthy; `$focus` magic also available |
| `collapse`          | `@alpinejs/collapse` | Animate height — pair with native `x-show`             |
| `anchor="$refs.x"`  | `@alpinejs/anchor`   | Float relative to another element                      |

**Persisted client state** — `@alpinejs/persist` is bundled, so `$persist` works in any Alpine scope:

```tsx
<div x-data="{ sidebarCollapsed: $persist(false) }">…</div>
```

## Headless primitives

Unstyled, fully accessible interactive primitives that expose state through `data-*` attributes so you style them yourself with Tailwind variants or plain CSS.

### Switch

An accessible on/off toggle (`role="switch"`, keyboard-operable). Style the on-state with `data-[checked]:…`:

```tsx
import { Switch } from "@zerotal/flow";

<Switch
  bind={this.notifications}
  class="relative h-6 w-11 rounded-full bg-gray-700 transition data-[checked]:bg-indigo-600"
>
  <span class="absolute h-4 w-4 rounded-full bg-white top-1 left-1 transition group-data-[checked]:translate-x-5" />
</Switch>;
```

The Switch button is a Tailwind `group`, so the inner knob reacts with `group-data-[checked]:…`.

### Checkbox bind

An accessible checkbox (`role="checkbox"`) bound to a boolean. Style the checked state with `data-[checked]:…`:

```tsx
import { Checkbox } from "@zerotal/flow";

<Checkbox bind={this.agree} class="h-5 w-5 rounded border border-gray-700 data-[checked]:bg-indigo-600 data-[checked]:border-indigo-600">
  <svg class="hidden data-[checked]:block w-3 h-3 text-white" viewBox="0 0 12 12">
    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" />
  </svg>
</Checkbox>
<label>I agree to the terms</label>
```

### Select bind options

A styled native `<select>`. Fully accessible out of the box. Use `<Listbox>` only when you need custom option markup:

```tsx
import { Select } from "@zerotal/flow";

<Select
  bind={this.country}
  placeholder="Select a country"
  options={[
    { label: "Canada", value: "ca" },
    { label: "United States", value: "us" },
    { label: "United Kingdom", value: "uk" },
  ]}
  class="select"
/>;
```

### RadioGroup bind options

`role="radiogroup"` with arrow-key roving. Style the selected option with `data-[checked]:…`:

```tsx
import { RadioGroup } from "@zerotal/flow";

<RadioGroup
  bind={this.plan}
  options={[
    { label: "Starter — $9/mo", value: "starter" },
    { label: "Pro — $29/mo", value: "pro" },
    { label: "Team — $99/mo", value: "team" },
  ]}
  optionClass="flex items-center gap-2 px-4 py-3 rounded-lg border cursor-pointer data-[checked]:border-indigo-500 data-[checked]:bg-indigo-50"
/>;
```

### Listbox bind options

A fully keyboard-navigable custom select. Arrow keys, Home/End, Enter/Escape, `aria-activedescendant`. `multiple` makes the value an array:

```tsx
import { Listbox } from "@zerotal/flow";

<Listbox
  bind={this.assignee}
  placeholder="Unassigned"
  options={users.map((u) => ({ label: u.name, value: u.id }))}
  optionClass="flex items-center gap-2 px-3 py-2 data-[active]:bg-gray-800 data-[selected]:text-indigo-400"
/>;
```

States: `data-[selected]`, `data-[active]`, `data-[open]`.

### Combobox bind options

An autocomplete input + filtered dropdown list. Two modes:

```tsx
import { Combobox } from "@zerotal/flow";

{
  /* Client filter — options rendered once, filtered locally as you type */
}
<Combobox bind={this.assigneeId} options={people} placeholder="Search teammates…" />;

{
  /* Server filter — query syncs to an @expose prop and re-renders on each keystroke */
}
<Combobox
  name="cityId"
  queryName="citySearch"
  bind={this.cityId}
  query={this.citySearch}
  options={this.citySuggestions}
  placeholder="Search cities…"
/>;
```

States: `data-[active]`, `data-[selected]`.

### Disclosure

A single collapsible section with proper `aria-expanded` / `aria-controls`. `data-open` is exposed on trigger and panel:

```tsx
import { Disclosure } from "@zerotal/flow";

<Disclosure
  label="Refund policy"
  defaultOpen={false}
  buttonClass="flex w-full justify-between px-4 py-3 font-medium"
  panelClass="px-4 pb-4 text-gray-600"
>
  Full refund within 30 days. No questions asked.
</Disclosure>;
```

### Accordion

A group of disclosures — single-open by default, or `multiple` to allow several expanded at once:

```tsx
import { Accordion } from "@zerotal/flow";

<Accordion
  items={[
    { label: "Shipping", content: "Ships in 1–2 business days." },
    { label: "Returns", content: "Free returns within 30 days." },
    { label: "Warranty", content: "2-year manufacturer warranty." },
  ]}
  multiple
/>;
```

### Popover

An anchored panel that opens on click and closes on click-outside or Escape. `data-open` is exposed for styling:

```tsx
import { Popover } from "@zerotal/flow";

<Popover
  label="Solutions ▾"
  class="relative inline-block"
  panelClass="absolute z-10 mt-2 w-48 bg-white shadow-lg rounded-lg"
>
  <a href="/analytics" class="block px-4 py-2">
    Analytics
  </a>
  <a href="/reports" class="block px-4 py-2">
    Reports
  </a>
</Popover>;
```

### Field / Label / Description

Accessibility glue around a single control. `<Field>` wires `for` / `id` / `aria-describedby` between the label, the control, the description, and the error — keeping screen-reader semantics correct without hand-wiring IDs:

```tsx
import { Field } from "@zerotal/flow";

<Field label="Email" description="We'll never share it." error={this.errors.email}>
  <input value={this.form.email} type="email" class="input" />
</Field>;
```

All three props (`label`, `description`, `error`) are optional. You can also compose `<Label>` and `<Description>` as children for more control over layout.

### Fieldset / Legend

Group related fields. A native `<fieldset disabled>` cascades the disabled state to every control inside:

```tsx
import { Fieldset } from "@zerotal/flow";

<Fieldset legend="Billing address" disabled={this.saving}>
  <Field label="Street">
    <input value={this.form.street} class="input" />
  </Field>
  <Field label="City">
    <input value={this.form.city} class="input" />
  </Field>
</Fieldset>;
```

### Tooltip

Shows `content` on hover/focus of its children, wired with `aria-describedby` and `role="tooltip"`. Client-only:

```tsx
import { Tooltip } from "@zerotal/flow";

<Tooltip content="Copy link to clipboard" placement="top">
  <button onClick={this.copyLink}>🔗</button>
</Tooltip>;
```

## Why a page renders through the runtime

Most pages compile ahead of time to string concatenation. A page the compiler can't
handle renders through the runtime instead — slower, but identical output, and the
usual outcome for anything built from components. The boot line counts them:

```text
[Flow] Compiled 4 page(s), 2 from cache, 3 bind-injected, 8 using runtime (76ms)
```

To find out which pages those are and what stopped each one, set an env flag:

```env
# .env
ZT_FLOW_COMPILE_LOG=1
```

Every fallback then names itself, with the exact spot to look at:

```text
[Flow] ListsPage renders through the runtime.
  What stops it compiling:
  app/showcase/flow/lists.tsx:83:10  `<Demo>` is a component, not an HTML element
      → inline its markup here, or let this page render through the runtime
```

It stays off by default because falling back is normal, not a defect. Turn it on
when you're chasing compilation for a hot page, or when a page reads `$flow` in a
value position — that combination is an error rather than a fallback, since the
runtime renderer evaluates JSX on the server where `$flow` doesn't exist.

## CSP-safe mode

For environments with a strict `Content-Security-Policy` that omits `'unsafe-eval'`, enable CSP-safe mode with an env flag:

```env
# .env
ZT_FLOW_CSP_SAFE=true
```

When on, the client runtime swaps Alpine's evaluator for an eval-free interpreter, the bridge avoids `new Function`, and the AOT compiler emits only CSP-safe expressions:

```tsx
<button onClick={() => this.count++}>+</button>
// standard mode → flow:click="() => $flow.count++"
// CSP mode      → flow:click="$flow.count++"
```

In CSP mode, **every page must AOT-compile** — an unsupported expression fails the build loudly rather than degrading silently.

**Supported in CSP mode:** `onClick={this.save}`, `onClick={() => this.count++}`, `value={this.x}`, `show={this.flag}`, member access (`$flow.user.name`), method calls with args, comparisons, arithmetic, ternaries, `&&`/`||`, string concat, array/object literals.

**Compile-time error (move to a server action):** arrow handlers that use the event (`(e) => …`), block-body arrows, template literals (`` `${x}` `` — use `a + b`), `.filter(i => …)`, computed access (`obj[key]`), spread.

### Recommended CSP header

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'nonce-<random>' 'strict-dynamic';
  style-src 'self' 'unsafe-inline';
```

### View Transitions

`navigate` links automatically wrap the page swap in the browser's [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API) when supported, giving smooth cross-page animations for free. Style them with the standard `::view-transition-*` CSS:

```css
::view-transition-old(root) {
  animation: fade-out 150ms ease;
}
::view-transition-new(root) {
  animation: fade-in 150ms ease;
}
```

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
