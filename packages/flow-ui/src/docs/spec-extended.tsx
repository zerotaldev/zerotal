/** @jsxImportSource @zerotal/flow */
// Doc specs for the components added beyond the original set.
//
// Split from `spec.tsx` purely for file size — the two arrays are concatenated
// into one `SPECS` there, and the docs site treats them identically.

import {
  Popover,
  HoverCard,
  AlertDialog,
  Command,
  ContextMenu,
  Menubar,
  NavigationMenu,
  Sidebar,
  Breadcrumb,
  Pagination,
  Field,
  InputGroup,
  InputOTP,
  Combobox,
  Slider,
  Toggle,
  ToggleGroup,
  ButtonGroup,
  Calendar,
  DatePicker,
  Progress,
  Spinner,
  Empty,
  Kbd,
  KbdMod,
  Accordion,
  Collapsible,
  ScrollArea,
  Resizable,
  Carousel,
  AspectRatio,
  Item,
  Chart,
  Prose,
  Button,
  Input,
  Badge,
} from "../index.ts";
import type { DocSpec } from "./spec.tsx";

const row = "flex flex-wrap items-center gap-3";

/** The `class` prop every component takes, so each spec need not repeat it. */
const classProp = {
  name: "class",
  type: "string",
  description: "Extra classes, merged last (wins over defaults).",
};

export const EXTENDED_SPECS: DocSpec[] = [
  // ── Overlays & navigation ──────────────────────────────────────────────────
  {
    name: "popover",
    code: `<Popover trigger={<Button variant="outline">Options</Button>}>
  <p class="text-sm">Anything at all.</p>
</Popover>`,
    preview: (
      <Popover trigger={<Button variant="outline">Options</Button>}>
        <p class="text-sm">Anything at all.</p>
      </Popover>
    ),
    props: [
      { name: "trigger", type: "node", description: "The element that opens the panel." },
      {
        name: "side",
        type: `"top" | "right" | "bottom" | "left"`,
        default: `"bottom"`,
        description: "Which edge the panel sits on.",
      },
      {
        name: "align",
        type: `"start" | "center" | "end"`,
        default: `"start"`,
        description: "How the panel lines up along that edge.",
      },
      classProp,
    ],
  },
  {
    name: "hover-card",
    code: `<HoverCard trigger={<a href="/users/1">@ada</a>}>
  <p class="text-sm font-medium">Ada Mokoena</p>
</HoverCard>`,
    preview: (
      <HoverCard trigger={<span class="underline">@ada</span>}>
        <p class="text-sm font-medium">Ada Mokoena</p>
        <p class="text-xs text-muted-foreground">Joined in 2024</p>
      </HoverCard>
    ),
    props: [
      { name: "trigger", type: "node", description: "What is hovered." },
      {
        name: "openDelay",
        type: "number",
        default: "300",
        description: "Milliseconds before it opens.",
      },
      {
        name: "closeDelay",
        type: "number",
        default: "150",
        description: "Grace period so the pointer can reach the panel.",
      },
      classProp,
    ],
  },
  {
    name: "alert-dialog",
    code: `<AlertDialog
  show={this.confirming}
  title="Delete this product?"
  description="It will be removed from every order. This cannot be undone."
  confirmLabel="Delete"
  onConfirm={this.destroy}
/>`,
    preview: (
      <AlertDialog
        show={true}
        title="Delete this product?"
        description="It will be removed from every order. This cannot be undone."
        confirmLabel="Delete"
      />
    ),
    props: [
      {
        name: "show",
        type: "boolean",
        description: "Bound @expose boolean controlling visibility.",
      },
      { name: "title", type: "node", description: "The question." },
      {
        name: "description",
        type: "node",
        description: "What will happen. Worth a full sentence.",
      },
      {
        name: "onConfirm",
        type: "handler",
        description: "Server action for the confirming choice.",
      },
      {
        name: "destructive",
        type: "boolean",
        default: "true",
        description: "Style the confirm button as destructive.",
      },
    ],
  },
  {
    name: "command",
    code: `<Command items={[
  { label: "Products", href: "/admin/products", group: "Go to" },
  { label: "New order", href: "/admin/orders/create", group: "Create" },
]} />`,
    preview: (
      <>
        <p class="text-sm text-muted-foreground">
          Mounted hidden; press <KbdMod /> <Kbd>K</Kbd> to open it.
        </p>
        <Command
          items={[
            { label: "Products", href: "#", group: "Go to" },
            { label: "Orders", href: "#", group: "Go to" },
            { label: "New order", href: "#", group: "Create" },
          ]}
        />
      </>
    ),
    props: [
      {
        name: "items",
        type: "CommandItem[]",
        description: "Destinations and actions, each with an optional group.",
      },
      {
        name: "hotkey",
        type: "string | null",
        default: `"k"`,
        description: "Key that opens it with the platform modifier.",
      },
      {
        name: "placeholder",
        type: "string",
        default: `"Search…"`,
        description: "Placeholder in the search box.",
      },
      {
        name: "emptyMessage",
        type: "string",
        default: `"Nothing found."`,
        description: "Shown when nothing matches.",
      },
    ],
  },
  {
    name: "context-menu",
    code: `<ContextMenu items={[
  { label: "Open", action: "$flow.open(id)" },
  { separator: true },
  { label: "Delete", action: "$flow.remove(id)", danger: true },
]}>
  <div>Right-click me</div>
</ContextMenu>`,
    preview: (
      <ContextMenu
        items={[
          { label: "Open", shortcut: "↵" },
          { separator: true },
          { label: "Delete", danger: true },
        ]}
      >
        <div class="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Right-click me
        </div>
      </ContextMenu>
    ),
    props: [
      {
        name: "items",
        type: "ContextMenuItem[]",
        description: "Entries, dividers and destructive actions.",
      },
      classProp,
    ],
  },
  {
    name: "menubar",
    code: `<Menubar menus={[
  { label: "File", items: [{ label: "New", shortcut: "⌘N" }] },
  { label: "Edit", items: [{ label: "Undo", shortcut: "⌘Z" }] },
]} />`,
    preview: (
      <Menubar
        menus={[
          {
            label: "File",
            items: [{ label: "New", shortcut: "⌘N" }, { separator: true }, { label: "Export" }],
          },
          {
            label: "Edit",
            items: [
              { label: "Undo", shortcut: "⌘Z" },
              { label: "Redo", shortcut: "⇧⌘Z" },
            ],
          },
          { label: "View", items: [{ label: "Zoom in" }, { label: "Zoom out" }] },
        ]}
      />
    ),
    props: [
      {
        name: "menus",
        type: "MenubarMenu[]",
        description: "Top-level menus, each with its own items.",
      },
      classProp,
    ],
  },
  {
    name: "navigation-menu",
    code: `<NavigationMenu items={[
  { label: "Docs", href: "/docs" },
  { label: "Products", panel: [{ label: "Admin", href: "/admin", description: "Back office" }] },
]} />`,
    preview: (
      <NavigationMenu
        items={[
          { label: "Docs", href: "#" },
          {
            label: "Products",
            panel: [
              { label: "Admin", href: "#", description: "Declarative back office" },
              { label: "Flow", href: "#", description: "Server-driven reactivity" },
            ],
          },
        ]}
      />
    ),
    props: [
      {
        name: "items",
        type: "NavigationMenuItem[]",
        description: "Links, some of which open a panel.",
      },
      classProp,
    ],
  },
  {
    name: "sidebar",
    code: `<Sidebar brand="Zerotal" tagline="Back office" current={path} groups={[
  { label: "Shop", items: [{ label: "Products", href: "/admin/products", badge: 12 }] },
]} />`,
    preview: (
      <div class="h-64 overflow-hidden rounded-lg border border-border">
        <Sidebar
          collapsible={false}
          brand="Zerotal"
          tagline="Back office"
          current="/admin/products"
          groups={[
            {
              label: "Shop",
              items: [
                { label: "Products", href: "/admin/products", badge: 12 },
                { label: "Orders", href: "/admin/orders" },
              ],
            },
            { label: "System", items: [{ label: "Settings", href: "/admin/settings" }] },
          ]}
        />
      </div>
    ),
    props: [
      {
        name: "groups",
        type: "SidebarGroup[]",
        description: "Nav tree, optionally nested one level.",
      },
      {
        name: "current",
        type: "string",
        description: "Current path, for marking the active item.",
      },
      {
        name: "collapsible",
        type: "boolean",
        default: "true",
        description: "Render the mobile drawer toggle.",
      },
      {
        name: "footer",
        type: "node",
        description: "Pinned to the bottom — a user menu, a version.",
      },
    ],
  },
  {
    name: "breadcrumb",
    code: `<Breadcrumb items={[
  { label: "Dashboard", href: "/admin" },
  { label: "Products", href: "/admin/products" },
  { label: "Desk Lamp" },
]} />`,
    preview: (
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "#" },
          { label: "Products", href: "#" },
          { label: "Desk Lamp" },
        ]}
      />
    ),
    props: [
      {
        name: "items",
        type: "BreadcrumbItem[]",
        description: "The trail. The last item renders as the current page.",
      },
      {
        name: "maxItems",
        type: "number",
        description: "Collapse a longer trail to first + last few.",
      },
      { name: "separator", type: "node", description: "What sits between items." },
    ],
  },
  {
    name: "pagination",
    code: `<Pagination page={p.page} lastPage={p.lastPage} total={p.total} perPage={p.perPage}
  href={(n) => \`?page=\${n}\`} />`,
    preview: <Pagination page={4} lastPage={12} total={231} perPage={20} href={() => "#"} />,
    props: [
      { name: "page", type: "number", description: "Current page, 1-based." },
      { name: "lastPage", type: "number", description: "How many pages there are." },
      {
        name: "href",
        type: "(page: number) => string",
        description: "Builds each page's URL, keeping your other params.",
      },
      { name: "total", type: "number", description: "Row count, shown as “1–20 of 231”." },
      {
        name: "siblings",
        type: "number",
        default: "5",
        description: "Numbered links around the current page.",
      },
    ],
  },

  // ── Forms ──────────────────────────────────────────────────────────────────
  {
    name: "field",
    code: `<Field label="Email" description="We never share it." error={errors.email} required>
  <Input type="email" flow:model="form.email" />
</Field>`,
    preview: (
      <div class="w-full max-w-sm space-y-4">
        <Field label="Email" description="We never share it." required>
          <Input type="email" placeholder="ada@example.com" />
        </Field>
        <Field label="Password" error="Must be at least 8 characters.">
          <Input type="password" />
        </Field>
      </div>
    ),
    props: [
      {
        name: "label",
        type: "node",
        description: "Associated with the control by a generated id.",
      },
      {
        name: "description",
        type: "node",
        description: "Helper text, linked by aria-describedby.",
      },
      {
        name: "error",
        type: "node",
        description: "Its presence marks the field invalid and announces it.",
      },
      {
        name: "required",
        type: "boolean",
        description: "Shows the marker and sets aria-required.",
      },
      {
        name: "orientation",
        type: `"vertical" | "horizontal"`,
        default: `"vertical"`,
        description: "Label above or beside.",
      },
    ],
  },
  {
    name: "input-group",
    code: `<InputGroup prefix="R"><Input flow:model="form.price" /></InputGroup>
<InputGroup addonAfter={<Button>Copy</Button>}><Input value={key} /></InputGroup>`,
    preview: (
      <div class="w-full max-w-sm space-y-3">
        <InputGroup prefix="R">
          <Input placeholder="0.00" aria-label="Price in rands" />
        </InputGroup>
        <InputGroup addonAfter={<Button variant="outline">Copy</Button>}>
          <Input value="kln_live_8f3a" aria-label="API key" />
        </InputGroup>
      </div>
    ),
    props: [
      { name: "prefix", type: "node", description: "Inside the border, before the text." },
      { name: "suffix", type: "node", description: "Inside the border, after the text." },
      { name: "addonBefore", type: "node", description: "Outside the border, in its own cell." },
      { name: "addonAfter", type: "node", description: "Outside the border — often a button." },
    ],
  },
  {
    name: "input-otp",
    code: `<InputOTP length={6} groupAfter={3} flow:model="form.code" />`,
    preview: <InputOTP length={6} groupAfter={3} aria-label="One-time code" />,
    props: [
      {
        name: "length",
        type: "number",
        default: "6",
        description: "How many characters the code has.",
      },
      { name: "numeric", type: "boolean", default: "true", description: "Restrict to digits." },
      {
        name: "groupAfter",
        type: "number",
        description: "Insert a wider gap after this many boxes.",
      },
    ],
  },
  {
    name: "combobox",
    code: `<Combobox bind={this.brandId} options={brands} placeholder="Search brands…" />`,
    preview: (
      <div class="w-full max-w-sm">
        <Combobox
          options={[
            { value: "1", label: "Acme" },
            { value: "2", label: "Globex" },
            { value: "3", label: "Initech" },
          ]}
          placeholder="Search brands…"
        />
      </div>
    ),
    props: [
      { name: "bind", type: "@expose value", description: "The chosen value." },
      { name: "options", type: "ComboboxOption[]", description: "Choices, filtered as you type." },
      {
        name: "query",
        type: "@expose value",
        description: "Bind to filter on the server instead of the client.",
      },
    ],
  },
  {
    name: "slider",
    code: `<Slider value={this.volume} max={100} showValue />`,
    preview: (
      <div class="w-full max-w-sm">
        <Slider value={64} max={100} showValue aria-label="Volume" />
      </div>
    ),
    props: [
      { name: "value", type: "number", description: "Current value." },
      { name: "min", type: "number", default: "0", description: "Lower bound." },
      { name: "max", type: "number", default: "100", description: "Upper bound." },
      { name: "showValue", type: "boolean", description: "Show the value beside the track." },
    ],
  },
  {
    name: "toggle",
    code: `<Toggle pressed={this.bold}>B</Toggle>
<ToggleGroup value={this.view} options={[
  { value: "list", label: "List" }, { value: "grid", label: "Grid" },
]} />`,
    preview: (
      <div class={row}>
        <Toggle pressed>B</Toggle>
        <Toggle variant="outline">I</Toggle>
        <ToggleGroup
          value="grid"
          options={[
            { value: "list", label: "List" },
            { value: "grid", label: "Grid" },
          ]}
        />
      </div>
    ),
    props: [
      {
        name: "pressed",
        type: "boolean",
        description: "Whether the toggle is on (sets aria-pressed).",
      },
      {
        name: "variant",
        type: `"default" | "outline"`,
        default: `"default"`,
        description: "Visual style.",
      },
      { name: "options", type: "ToggleOption[]", description: "ToggleGroup only — the members." },
      {
        name: "type",
        type: `"single" | "multiple"`,
        default: `"single"`,
        description: "ToggleGroup only — how many may be on.",
      },
    ],
  },
  {
    name: "button-group",
    code: `<ButtonGroup>
  <Button variant="outline">Day</Button>
  <Button variant="outline">Week</Button>
</ButtonGroup>`,
    preview: (
      <ButtonGroup>
        <Button variant="outline">Day</Button>
        <Button variant="outline">Week</Button>
        <Button variant="outline">Month</Button>
      </ButtonGroup>
    ),
    props: [
      {
        name: "orientation",
        type: `"horizontal" | "vertical"`,
        default: `"horizontal"`,
        description: "Direction the members join in.",
      },
      classProp,
    ],
  },
  {
    name: "calendar",
    code: `<Calendar value={this.due} onSelect={this.pick} />
<Calendar month="2026-07" events={[{ date: "2026-07-14", label: "Launch" }]} />`,
    preview: <Calendar value="2026-07-14" month="2026-07" />,
    props: [
      { name: "month", type: "string", description: "`YYYY-MM` to display." },
      { name: "value", type: "string", description: "Selected `YYYY-MM-DD`." },
      { name: "onSelect", type: "handler", description: "Receives the clicked `YYYY-MM-DD`." },
      {
        name: "events",
        type: "CalendarEvent[]",
        description: "Records to lay out across the month.",
      },
      { name: "min / max", type: "string", description: "Selectable range." },
    ],
  },
  {
    name: "date-picker",
    code: `<DatePicker value={this.due} onSelect={this.setDue} />`,
    preview: (
      <div class="w-56">
        <DatePicker value="2026-07-14" />
      </div>
    ),
    props: [
      { name: "value", type: "string", description: "Selected `YYYY-MM-DD`." },
      { name: "onSelect", type: "handler", description: "Receives the clicked `YYYY-MM-DD`." },
      {
        name: "placeholder",
        type: "string",
        default: `"Pick a date"`,
        description: "Shown when nothing is chosen.",
      },
      { name: "min / max", type: "string", description: "Selectable range." },
    ],
  },

  // ── Feedback & status ──────────────────────────────────────────────────────
  {
    name: "toast",
    code: `<Toaster position="bottom-right" />
// then anywhere on the server:
page.flash("Saved.", "success");`,
    preview: (
      <p class="text-sm text-muted-foreground">
        Mounted once per layout; every <code class="font-mono text-xs">page.flash()</code> lands in
        it.
      </p>
    ),
    props: [
      {
        name: "position",
        type: `"top-right" | "bottom-right" | …`,
        default: `"bottom-right"`,
        description: "Corner it stacks in.",
      },
      {
        name: "duration",
        type: "number",
        default: "4000",
        description: "How long a toast stays, in ms.",
      },
      { name: "max", type: "number", default: "4", description: "Most on screen at once." },
    ],
  },
  {
    name: "progress",
    code: `<Progress value={imported} max={total} showValue />
<Progress />  {/* indeterminate */}`,
    preview: (
      <div class="w-full max-w-sm space-y-3">
        <Progress value={62} showValue />
        <Progress />
      </div>
    ),
    props: [
      {
        name: "value",
        type: "number",
        description: "Completed amount. Omit for the indeterminate bar.",
      },
      { name: "max", type: "number", default: "100", description: "The total." },
      { name: "showValue", type: "boolean", description: "Show the percentage beside the bar." },
      {
        name: "label",
        type: "string",
        description: "Describes what is progressing, for screen readers.",
      },
    ],
  },
  {
    name: "spinner",
    code: `<Spinner />
<Button disabled><Spinner size="sm" /> Saving…</Button>`,
    preview: (
      <div class={row}>
        <Spinner size="sm" />
        <Spinner />
        <Spinner size="lg" />
      </div>
    ),
    props: [
      {
        name: "size",
        type: `"sm" | "default" | "lg"`,
        default: `"default"`,
        description: "Sizing.",
      },
      {
        name: "label",
        type: "string | null",
        default: `"Loading"`,
        description: "Announced to screen readers.",
      },
    ],
  },
  {
    name: "empty",
    code: `<Empty icon={icon} title="No orders yet"
  description="Orders appear here as customers place them."
  action={<Button>New order</Button>} />`,
    preview: (
      <Empty
        title="No orders yet"
        description="Orders appear here as customers place them."
        action={<Button size="sm">New order</Button>}
      />
    ),
    props: [
      { name: "title", type: "node", description: "What is missing." },
      { name: "description", type: "node", description: "Why, or what to do about it." },
      { name: "action", type: "node", description: "The next step — usually a button." },
      {
        name: "bare",
        type: "boolean",
        description: "Drop the dashed border, inside a card that draws its own.",
      },
    ],
  },
  {
    name: "kbd",
    code: `<KbdMod /> <Kbd>K</Kbd>`,
    preview: (
      <div class={row}>
        <span class="inline-flex items-center gap-1">
          <KbdMod />
          <Kbd>K</Kbd>
        </span>
        <span class="inline-flex items-center gap-1">
          <Kbd>⇧</Kbd>
          <Kbd>↵</Kbd>
        </span>
      </div>
    ),
    props: [
      {
        name: "children",
        type: "node",
        description: "The key. `<KbdMod />` renders ⌘ or Ctrl per platform.",
      },
      classProp,
    ],
  },

  // ── Layout & content ───────────────────────────────────────────────────────
  {
    name: "accordion",
    code: `<Accordion items={[
  { label: "Shipping", content: <p>Ships in 2–3 days.</p> },
  { label: "Returns", content: <p>30 days, no questions.</p> },
]} />`,
    preview: (
      <div class="w-full max-w-md">
        <Accordion
          defaultIndex={0}
          items={[
            { label: "Shipping", content: <p>Ships in 2–3 days.</p> },
            { label: "Returns", content: <p>30 days, no questions.</p> },
          ]}
        />
      </div>
    ),
    props: [
      { name: "items", type: "AccordionItem[]", description: "Each with a label and its content." },
      { name: "multiple", type: "boolean", description: "Allow several open at once." },
      { name: "defaultIndex", type: "number", default: "-1", description: "Which starts open." },
    ],
  },
  {
    name: "collapsible",
    code: `<Collapsible label="Advanced">
  <Field label="Timeout"><Input /></Field>
</Collapsible>`,
    preview: (
      <div class="w-full max-w-md">
        <Collapsible label="Advanced">
          <p class="text-sm text-muted-foreground">Rarely-changed settings live here.</p>
        </Collapsible>
      </div>
    ),
    props: [
      { name: "label", type: "node", description: "Text for the default trigger." },
      { name: "trigger", type: "node", description: "A custom trigger instead." },
      { name: "defaultOpen", type: "boolean", description: "Start open." },
    ],
  },
  {
    name: "scroll-area",
    code: `<ScrollArea class="h-72">…long list…</ScrollArea>`,
    preview: (
      <ScrollArea class="h-32 w-full max-w-sm rounded-md border border-border p-3">
        <div class="space-y-2 text-sm">
          {Array.from({ length: 12 }, (_, i) => (
            <p>Row {String(i + 1)}</p>
          ))}
        </div>
      </ScrollArea>
    ),
    props: [
      {
        name: "orientation",
        type: `"vertical" | "horizontal" | "both"`,
        default: `"vertical"`,
        description: "Which way it scrolls.",
      },
      { name: "fade", type: "boolean", description: "Fade the content at the scrollable edges." },
      classProp,
    ],
  },
  {
    name: "resizable",
    code: `<Resizable start={<Tree />} end={<Editor />} defaultSize={30} />`,
    preview: (
      <Resizable
        class="h-32 rounded-md border border-border"
        defaultSize={35}
        start={<div class="h-full bg-muted/40 p-3 text-sm">Sidebar</div>}
        end={<div class="h-full p-3 text-sm">Content</div>}
      />
    ),
    props: [
      { name: "start / end", type: "node", description: "The two panes." },
      {
        name: "defaultSize",
        type: "number",
        default: "50",
        description: "First pane's starting size, as a percentage.",
      },
      {
        name: "min",
        type: "number",
        default: "10",
        description: "Smallest either pane may become.",
      },
      {
        name: "orientation",
        type: `"horizontal" | "vertical"`,
        default: `"horizontal"`,
        description: "Split direction.",
      },
    ],
  },
  {
    name: "carousel",
    code: `<Carousel items={products.map((p) => <ProductCard product={p} />)} />`,
    preview: (
      <Carousel
        itemClass="w-40"
        items={[1, 2, 3, 4, 5, 6].map((n) => (
          <div class="flex h-24 items-center justify-center rounded-lg border border-border bg-muted/40 text-sm">
            Slide {String(n)}
          </div>
        ))}
      />
    ),
    props: [
      { name: "items", type: "node[]", description: "The slides." },
      {
        name: "itemClass",
        type: "string",
        default: `"w-64 sm:w-72"`,
        description: "Width of each slide.",
      },
      { name: "hideControls", type: "boolean", description: "Swipe and scroll only." },
    ],
  },
  {
    name: "aspect-ratio",
    code: `<AspectRatio ratio={16 / 9}>
  <img src={cover} class="h-full w-full object-cover" />
</AspectRatio>`,
    preview: (
      <div class="w-64">
        <AspectRatio ratio={16 / 9} class="rounded-lg border border-border bg-muted/40">
          <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
            16 / 9
          </div>
        </AspectRatio>
      </div>
    ),
    props: [
      { name: "ratio", type: "number", default: "1", description: "Width ÷ height." },
      classProp,
    ],
  },
  {
    name: "item",
    code: `<Item title="Team" description="4 members" action={<Button size="sm">Manage</Button>} />`,
    preview: (
      <div class="w-full max-w-md rounded-lg border border-border p-1">
        <Item
          title="Team"
          description="4 members"
          action={<Badge variant="secondary">Owner</Badge>}
        />
        <Item title="Billing" description="Visa ending 4242" interactive />
      </div>
    ),
    props: [
      { name: "title", type: "node", description: "The primary line." },
      { name: "description", type: "node", description: "The supporting line." },
      { name: "action", type: "node", description: "Trailing content." },
      { name: "href", type: "string", description: "Makes the whole row a link." },
    ],
  },
  {
    name: "chart",
    code: `<Chart type="line" labels={days} datasets={[{ label: "Orders", data: counts }]} />
<Chart type="donut" labels={["Paid","Pending"]} datasets={[{ data: [82, 18] }]} />`,
    preview: (
      <div class="w-full space-y-6">
        <Chart
          type="area"
          height={160}
          labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
          datasets={[{ label: "Orders", data: [12, 19, 14, 27, 22, 31, 25] }]}
        />
        <Chart
          type="donut"
          height={140}
          labels={["Paid", "Pending", "Refunded"]}
          datasets={[{ data: [82, 24, 6] }]}
        />
      </div>
    ),
    props: [
      {
        name: "type",
        type: `"line" | "area" | "bar" | "donut"`,
        default: `"line"`,
        description: "Chart kind.",
      },
      { name: "labels", type: "string[]", description: "Axis or legend labels." },
      { name: "datasets", type: "ChartDataset[]", description: "One or more series." },
      {
        name: "height",
        type: "number",
        default: "220",
        description: "Drawing height; width is fluid.",
      },
      {
        name: "format",
        type: "(n: number) => string",
        description: "Formats axis values and the accessible summary.",
      },
    ],
  },
  {
    name: "typography",
    code: `<Prose dangerouslySetInnerHTML={{ __html: rendered }} />
<H1>Page title</H1>
<Muted>Last updated yesterday</Muted>`,
    preview: (
      <Prose class="max-w-md">
        <h2>A rendered document</h2>
        <p>
          Prose styles its descendants, for content that arrives as a blob — Markdown, a CMS field,
          a rich-text column.
        </p>
        <ul>
          <li>Headings, lists and quotes</li>
          <li>
            Inline <code>code</code> and code blocks
          </li>
        </ul>
      </Prose>
    ),
    props: [
      {
        name: "children",
        type: "node",
        description: "Markup you did not author — Prose styles its descendants.",
      },
      classProp,
    ],
  },
];
