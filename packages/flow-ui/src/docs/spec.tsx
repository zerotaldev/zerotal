/** @jsxImportSource @zerotal/flow */
// ── Component doc specs ─────────────────────────────────────────────────────
//
// One spec per component: the usage `code` shown in the Code block, an inline-safe
// `preview` node rendered into the docs, and a `props` table. Overlay components
// (Dialog/Sheet/DropdownMenu/Tooltip) preview their trigger — their full usage is
// in the code block — since a live fixed-position overlay can't render inline.
//
// Consumed by ./render.ts (markdown generation) and exercised by docs.test.ts.

import type { HtmlNode } from "@zerotal/flow";
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Input,
  Textarea,
  Label,
  Separator,
  Skeleton,
  Avatar,
  Switch,
  Checkbox,
  Select,
  RadioGroup,
  Alert,
  Tabs,
  Table,
} from "../index.ts";

import { EXTENDED_SPECS } from "./spec-extended.tsx";

export interface PropDoc {
  name: string;
  type: string;
  default?: string;
  description: string;
}

export interface DocSpec {
  /** Matches the registry kebab id. */
  name: string;
  code: string;
  preview: HtmlNode;
  props: PropDoc[];
}

const row = "flex flex-wrap items-center gap-3";

export const SPECS: DocSpec[] = [
  {
    name: "button",
    code: `<Button onClick={this.save}>Save</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>`,
    preview: (
      <div class={row}>
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
      </div>
    ),
    props: [
      {
        name: "variant",
        type: `"default" | "secondary" | "destructive" | "outline" | "ghost" | "link"`,
        default: `"default"`,
        description: "Visual style.",
      },
      {
        name: "size",
        type: `"default" | "sm" | "lg" | "icon"`,
        default: `"default"`,
        description: "Sizing.",
      },
      {
        name: "onClick",
        type: "handler",
        description: "Server action or client expression (standard Flow).",
      },
      {
        name: "class",
        type: "string",
        description: "Extra classes, merged last (wins over defaults).",
      },
    ],
  },
  {
    name: "badge",
    code: `<Badge>New</Badge>
<Badge variant="secondary">Beta</Badge>
<Badge variant="destructive">Overdue</Badge>
<Badge variant="outline">Draft</Badge>`,
    preview: (
      <div class={row}>
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
      </div>
    ),
    props: [
      {
        name: "variant",
        type: `"default" | "secondary" | "destructive" | "outline"`,
        default: `"default"`,
        description: "Visual style.",
      },
      { name: "class", type: "string", description: "Extra classes." },
    ],
  },
  {
    name: "card",
    code: `<Card>
  <CardHeader>
    <CardTitle>Create project</CardTitle>
    <CardDescription>Deploy your new project in one click.</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
  <CardFooter><Button>Deploy</Button></CardFooter>
</Card>`,
    preview: (
      <Card class="w-80">
        <CardHeader>
          <CardTitle>Create project</CardTitle>
          <CardDescription>Deploy your new project in one click.</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-sm text-muted-foreground">Project settings go here.</p>
        </CardContent>
        <CardFooter>
          <Button>Deploy</Button>
        </CardFooter>
      </Card>
    ),
    props: [
      { name: "class", type: "string", description: "Extra classes on the surface." },
      {
        name: "children",
        type: "node",
        description:
          "Compose with CardHeader / CardTitle / CardDescription / CardContent / CardFooter.",
      },
    ],
  },
  {
    name: "input",
    code: `<Field label="Email">
  <Input value={this.form.email} placeholder="you@example.com" />
</Field>`,
    preview: (
      <div class="flex w-72 flex-col gap-1.5">
        <Label>Email</Label>
        <Input placeholder="you@example.com" />
      </div>
    ),
    props: [
      {
        name: "value",
        type: "bound state",
        description: "Two-way bind to an @expose / form field (emits flow:model).",
      },
      { name: "type", type: "string", default: `"text"`, description: "Native input type." },
      { name: "class", type: "string", description: "Extra classes." },
    ],
  },
  {
    name: "textarea",
    code: `<Textarea value={this.form.bio} placeholder="Tell us about yourself" rows={4} />`,
    preview: (
      <div class="w-72">
        <Textarea placeholder="Tell us about yourself" rows={4} />
      </div>
    ),
    props: [
      {
        name: "value",
        type: "bound state",
        description: "Two-way bind to an @expose / form field.",
      },
      { name: "class", type: "string", description: "Extra classes." },
    ],
  },
  {
    name: "label",
    code: `<Label for="email">Email</Label>`,
    preview: (
      <div class="flex flex-col gap-1.5">
        <Label for="email">Email address</Label>
        <Input id="email" placeholder="you@example.com" class="w-64" />
      </div>
    ),
    props: [
      { name: "for", type: "string", description: "Associated control id." },
      { name: "class", type: "string", description: "Extra classes." },
    ],
  },
  {
    name: "separator",
    code: `<Separator />
<Separator orientation="vertical" class="h-6" />`,
    preview: (
      <div class="w-72">
        <p class="text-sm font-medium text-foreground">Radix Primitives</p>
        <p class="text-sm text-muted-foreground">An open-source UI component library.</p>
        <Separator class="my-3" />
        <div class="flex h-5 items-center gap-3 text-sm">
          <span>Blog</span>
          <Separator orientation="vertical" />
          <span>Docs</span>
          <Separator orientation="vertical" />
          <span>Source</span>
        </div>
      </div>
    ),
    props: [
      {
        name: "orientation",
        type: `"horizontal" | "vertical"`,
        default: `"horizontal"`,
        description: "Divider direction.",
      },
      {
        name: "decorative",
        type: "boolean",
        default: "true",
        description: "ARIA-hidden when decorative; semantic separator otherwise.",
      },
    ],
  },
  {
    name: "skeleton",
    code: `<Skeleton class="h-12 w-12 rounded-full" />
<Skeleton class="h-4 w-48" />`,
    preview: (
      <div class="flex items-center gap-3">
        <Skeleton class="h-12 w-12 rounded-full" />
        <div class="flex flex-col gap-2">
          <Skeleton class="h-4 w-40" />
          <Skeleton class="h-4 w-28" />
        </div>
      </div>
    ),
    props: [{ name: "class", type: "string", description: "Size + shape via utilities." }],
  },
  {
    name: "avatar",
    code: `<Avatar src={user.avatarUrl} alt={user.name} fallback="AL" />
<Avatar fallback="GH" />`,
    preview: (
      <div class={row}>
        <Avatar src="https://i.pravatar.cc/64?img=11" alt="Ada Mokoena" />
        <Avatar fallback="AL" />
        <Avatar fallback="GH" class="bg-primary text-primary-foreground" />
      </div>
    ),
    props: [
      {
        name: "src",
        type: "string | null",
        description: "Image URL; falls back to `fallback` when absent.",
      },
      {
        name: "fallback",
        type: "node",
        description: "Shown when there's no image (e.g. initials).",
      },
      { name: "alt", type: "string", description: "Image alt text." },
    ],
  },
  {
    name: "switch",
    code: `<Switch bind={this.notifications} />`,
    preview: (
      <label class="flex items-center gap-2 text-sm">
        <Switch bind={true} />
        Airplane mode
      </label>
    ),
    props: [
      {
        name: "bind",
        type: "@expose boolean",
        description: "Two-way bound boolean (server-synced).",
      },
      { name: "class", type: "string", description: "Extra classes on the track." },
    ],
  },
  {
    name: "checkbox",
    code: `<Checkbox bind={this.agree} />`,
    preview: (
      <label class="flex items-center gap-2 text-sm">
        <Checkbox bind={true} />
        Accept terms and conditions
      </label>
    ),
    props: [
      { name: "bind", type: "@expose boolean", description: "Two-way bound boolean." },
      { name: "class", type: "string", description: "Extra classes." },
    ],
  },
  {
    name: "select",
    code: `<Select bind={this.country} options={[{ label: "Canada", value: "ca" }]} />`,
    preview: (
      <div class="w-56">
        <Select
          bind={"ca"}
          aria-label="Country"
          options={[
            { label: "Canada", value: "ca" },
            { label: "Brazil", value: "br" },
            { label: "Japan", value: "jp" },
          ]}
        />
      </div>
    ),
    props: [
      { name: "bind", type: "@expose value", description: "Two-way bound value (flow:model)." },
      { name: "options", type: "{ label, value }[]", description: "Option list." },
      { name: "placeholder", type: "string", description: "Optional empty first option." },
    ],
  },
  {
    name: "radio-group",
    code: `<RadioGroup bind={this.plan} options={[{ label: "Pro", value: "pro" }]} />`,
    preview: (
      <RadioGroup
        bind={"pro"}
        class="w-56"
        options={[
          { label: "Free", value: "free" },
          { label: "Pro", value: "pro" },
          { label: "Enterprise", value: "enterprise" },
        ]}
      />
    ),
    props: [
      { name: "bind", type: "@expose value", description: "Two-way bound value." },
      { name: "options", type: "{ label, value }[]", description: "Option list." },
      { name: "optionClass", type: "string", description: "Per-option classes." },
    ],
  },
  {
    name: "dialog",
    code: `<Button onClick={() => (this.open = true)}>Edit profile</Button>

<Dialog show={this.open} title="Edit profile" description="Make changes here.">
  <form onSubmit={this.save} class="flex flex-col gap-3">
    <Field label="Name"><Input value={this.form.name} /></Field>
    <Button type="submit">Save</Button>
  </form>
</Dialog>`,
    preview: <Button variant="outline">Edit profile</Button>,
    props: [
      {
        name: "show",
        type: "@expose boolean",
        description: "Visibility (focus-trapped while open).",
      },
      { name: "title", type: "node", description: "Dialog title (wires aria-labelledby)." },
      { name: "description", type: "node", description: "Supporting text (aria-describedby)." },
      {
        name: "closable",
        type: "boolean",
        default: "true",
        description: "Show the × + allow backdrop/Escape close.",
      },
    ],
  },
  {
    name: "sheet",
    code: `<Button onClick={() => (this.open = true)}>Open</Button>

<Sheet show={this.open} side="right" title="Edit profile">…</Sheet>`,
    preview: <Button variant="outline">Open sheet</Button>,
    props: [
      {
        name: "show",
        type: "@expose boolean",
        description: "Visibility (focus-trapped while open).",
      },
      {
        name: "side",
        type: `"left" | "right" | "top" | "bottom"`,
        default: `"right"`,
        description: "Edge to slide from.",
      },
      { name: "title", type: "node", description: "Header title." },
    ],
  },
  {
    name: "dropdown-menu",
    code: `<DropdownMenu label="Options">
  <DropdownMenuLabel>My account</DropdownMenuLabel>
  <DropdownMenuItem onClick={this.profile}>Profile</DropdownMenuItem>
  <DropdownMenuSeparator />
  <DropdownMenuItem variant="destructive" onClick={this.signOut}>Sign out</DropdownMenuItem>
</DropdownMenu>`,
    preview: <Button variant="outline">Options ▾</Button>,
    props: [
      { name: "label", type: "node", description: "Default trigger label (or pass `trigger`)." },
      {
        name: "align",
        type: `"left" | "right"`,
        default: `"left"`,
        description: "Panel alignment.",
      },
    ],
  },
  {
    name: "tabs",
    code: `<Tabs items={[
  { label: "Account", content: <AccountForm /> },
  { label: "Password", content: <PasswordForm /> },
]} />`,
    preview: (
      <div class="w-80">
        <Tabs
          items={[
            {
              label: "Account",
              content: <p class="text-sm text-muted-foreground">Account settings.</p>,
            },
            {
              label: "Password",
              content: <p class="text-sm text-muted-foreground">Change your password.</p>,
            },
          ]}
        />
      </div>
    ),
    props: [
      { name: "items", type: "{ label, content, name? }[]", description: "Tabs + their panels." },
      { name: "class", type: "string", description: "Extra classes." },
    ],
  },
  {
    name: "alert",
    code: `<Alert title="Heads up!">You can add components to your app.</Alert>
<Alert variant="destructive" title="Error">Something went wrong.</Alert>`,
    preview: (
      <div class="flex w-96 flex-col gap-3">
        <Alert title="Heads up!">You can add components to your app using the CLI.</Alert>
        <Alert variant="destructive" title="Error">
          Your session has expired.
        </Alert>
      </div>
    ),
    props: [
      {
        name: "variant",
        type: `"default" | "destructive"`,
        default: `"default"`,
        description: "Visual style + ARIA role.",
      },
      { name: "title", type: "node", description: "Bold title line." },
      {
        name: "dismissible",
        type: "boolean",
        default: "false",
        description: "Show a client-only dismiss button.",
      },
    ],
  },
  {
    name: "tooltip",
    code: `<Tooltip content="Add to library">
  <Button size="icon">+</Button>
</Tooltip>`,
    preview: (
      <Button variant="outline" size="icon">
        +
      </Button>
    ),
    props: [
      { name: "content", type: "node", description: "Tooltip text." },
      {
        name: "placement",
        type: `"top" | "bottom"`,
        default: `"top"`,
        description: "Bubble position.",
      },
    ],
  },
  {
    name: "table",
    code: `<Table
  columns={[
    { key: "name", label: "Name", sortable: true },
    { key: "role", label: "Role" },
  ]}
  rows={people}
  sortBy={this.sortBy}
  sortDir={this.sortDir}
  hover
/>`,
    preview: (
      <div class="w-96">
        <Table
          columns={[
            { key: "name", label: "Name" },
            { key: "role", label: "Role" },
          ]}
          rows={[
            { name: "Ada Lovelace", role: "Engineer" },
            { name: "Alan Turing", role: "Researcher" },
          ]}
          hover
        />
      </div>
    ),
    props: [
      {
        name: "columns",
        type: "TableColumn[]",
        description: "Column defs (key, label, sortable?, render?).",
      },
      { name: "rows", type: "T[]", description: "Row data." },
      {
        name: "sortBy / sortDir",
        type: "@url state",
        description: "Bind to URL sort state for sortable headers.",
      },
    ],
  },
];

// The components added beyond the original set live in their own file, purely
// for size — the docs site treats both halves identically.
SPECS.push(...EXTENDED_SPECS);

export function findSpec(name: string): DocSpec | undefined {
  return SPECS.find((s) => s.name === name);
}
