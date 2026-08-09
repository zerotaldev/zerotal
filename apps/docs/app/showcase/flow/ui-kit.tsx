/** @jsxImportSource @zerotal/flow */
import { Component, expose } from "@zerotal/flow";
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
  Switch,
  Checkbox,
  Select,
  RadioGroup,
  Avatar,
  Separator,
  Skeleton,
  Tabs,
  Alert,
  AlertTitle,
  AlertDescription,
  Tooltip,
  Table,
  Dialog,
  Sheet,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@zerotal/flow-ui";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

interface Member {
  name: string;
  role: string;
  status: string;
  [key: string]: unknown;
}

/**
 * flow-ui — the shadcn-style, own-the-code component kit. Every component here is imported
 * from @zerotal/flow-ui and rendered in its own token-backed theme; in a real app you'd copy
 * the source in with `bun zt flow:add button` and tweak it. Each demo shows the live
 * component with its usage code below.
 */
export class UiKitPage extends Component {
  static title = "flow-ui kit — Flow showcase";

  @expose notifications = true;
  @expose terms = false;
  @expose plan = "pro";
  @expose country = "za";
  @expose dialogOpen = false;
  @expose sheetOpen = false;

  @expose members: Member[] = [
    { name: "Ada Lovelace", role: "Owner", status: "Active" },
    { name: "Alan Turing", role: "Admin", status: "Active" },
    { name: "Grace Hopper", role: "Editor", status: "Invited" },
  ];

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  private section(label: string, code: string, body: HtmlNode): HtmlNode {
    return (
      <div>
        <p class="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <Demo code={code}>{body}</Demo>
      </div>
    );
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">flow-ui component kit</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            Twenty shadcn-style components, imported from{" "}
            <code class="font-mono text-orange-600">@zerotal/flow-ui</code> and themed by
            token-backed CSS variables. They're Flow components underneath — server actions, two-way
            binds and client expressions all pass through. Own the code:{" "}
            <code class="font-mono">bun zt flow:add button</code> copies one into your app.
          </p>
        </div>

        {this.section(
          "Buttons",
          `<Button>Default</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button disabled>Disabled</Button>`,
          <div class="flex flex-wrap items-center gap-3">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
          </div>,
        )}

        {this.section(
          "Badges",
          `<Badge>Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="destructive">Overdue</Badge>
<Badge variant="outline">Draft</Badge>`,
          <div class="flex flex-wrap items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge variant="outline">Outline</Badge>
          </div>,
        )}

        {this.section(
          "Card",
          `<Card>
  <CardHeader>
    <CardTitle>Project Aurora</CardTitle>
    <CardDescription>A surface container…</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
  <CardFooter><Button size="sm">View</Button></CardFooter>
</Card>`,
          <Card>
            <CardHeader>
              <CardTitle>Project Aurora</CardTitle>
              <CardDescription>
                A surface container with header, content and footer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p class="text-sm text-muted-foreground">
                Cards compose from parts, so you lay out exactly what you need.
              </p>
            </CardContent>
            <CardFooter>
              <Button size="sm">View</Button>
            </CardFooter>
          </Card>,
        )}

        {this.section(
          "Form controls",
          `<Label>Email</Label>
<Input value={this.email} placeholder="you@example.com" />
<Textarea placeholder="Say something…" />
<Switch bind={this.notifications} />
<Checkbox bind={this.terms} />`,
          <div class="space-y-4">
            <div class="space-y-1.5">
              <Label>Email</Label>
              <Input
                value={this.country === "" ? "" : "you@example.com"}
                placeholder="you@example.com"
              />
            </div>
            <div class="space-y-1.5">
              <Label>Message</Label>
              <Textarea placeholder="Say something…" />
            </div>
            <div class="flex items-center gap-3">
              <Switch bind={this.notifications} />
              <span
                class="text-sm text-foreground"
                x-text="$flow.notifications ? 'Notifications on' : 'Notifications off'"
              />
            </div>
            <label class="flex items-center gap-2 text-sm text-foreground">
              <Checkbox bind={this.terms} />
              Accept the terms
            </label>
          </div>,
        )}

        {this.section(
          "Select",
          `<Select
  bind={this.country}
  placeholder="Choose a country"
  options={countries}   // { label, value }[]
/>`,
          <Select
            bind={this.country}
            placeholder="Choose a country"
            options={[
              { label: "South Africa", value: "za" },
              { label: "Kenya", value: "ke" },
              { label: "Nigeria", value: "ng" },
              { label: "Ghana", value: "gh" },
            ]}
          />,
        )}

        {this.section(
          "Radio group",
          `<RadioGroup bind={this.plan} options={plans} />`,
          <RadioGroup
            bind={this.plan}
            options={[
              { label: "Starter — $9/mo", value: "starter" },
              { label: "Pro — $29/mo", value: "pro" },
              { label: "Team — $99/mo", value: "team" },
            ]}
          />,
        )}

        {this.section(
          "Avatar, separator & skeleton",
          `<Avatar src={url} alt="Ada" />
<Avatar fallback="AT" />
<Separator />
<Skeleton class="h-4 w-3/4" />`,
          <div class="space-y-4">
            <div class="flex items-center gap-4">
              <Avatar src="https://i.pravatar.cc/80?img=13" alt="Ada" />
              <Avatar fallback="AT" />
              <Avatar fallback="GH" />
            </div>
            <Separator />
            <div class="space-y-2">
              <Skeleton class="h-4 w-3/4" />
              <Skeleton class="h-4 w-1/2" />
            </div>
          </div>,
        )}

        {this.section(
          "Alerts",
          `<Alert>
  <AlertTitle>Heads up</AlertTitle>
  <AlertDescription>Your trial ends in three days.</AlertDescription>
</Alert>
<Alert variant="destructive" dismissible>…</Alert>`,
          <div class="space-y-3">
            <Alert>
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>Your trial ends in three days.</AlertDescription>
            </Alert>
            <Alert variant="destructive" dismissible>
              <AlertTitle>Payment failed</AlertTitle>
              <AlertDescription>We couldn't charge your card.</AlertDescription>
            </Alert>
          </div>,
        )}

        {this.section(
          "Tabs",
          `<Tabs items={[
  { label: "Account",  content: <p>…</p> },
  { label: "Password", content: <p>…</p> },
  { label: "Team",     content: <p>…</p> },
]} />`,
          <Tabs
            items={[
              {
                label: "Account",
                content: (
                  <p class="pt-3 text-sm text-muted-foreground">
                    Manage your account details and preferences.
                  </p>
                ),
              },
              {
                label: "Password",
                content: (
                  <p class="pt-3 text-sm text-muted-foreground">
                    Change your password and security settings.
                  </p>
                ),
              },
              {
                label: "Team",
                content: (
                  <p class="pt-3 text-sm text-muted-foreground">
                    Invite teammates and manage roles.
                  </p>
                ),
              },
            ]}
          />,
        )}

        {this.section(
          "Overlays & menu",
          `<Button onClick={() => this.dialogOpen = true}>Open dialog</Button>
<Button onClick={() => this.sheetOpen = true}>Open sheet</Button>

<DropdownMenu label="Menu">
  <DropdownMenuLabel>My account</DropdownMenuLabel>
  <DropdownMenuItem>Profile</DropdownMenuItem>
  <DropdownMenuSeparator />
  <DropdownMenuItem>Sign out</DropdownMenuItem>
</DropdownMenu>

<Tooltip content="Copy link"><Button size="icon">🔗</Button></Tooltip>

<Dialog show={this.dialogOpen} title="Invite a teammate">…</Dialog>
<Sheet show={this.sheetOpen} side="right" title="Filters">…</Sheet>`,
          <div class="flex flex-wrap items-center gap-3">
            <Button onClick={() => (this.dialogOpen = true)}>Open dialog</Button>
            <Button variant="outline" onClick={() => (this.sheetOpen = true)}>
              Open sheet
            </Button>
            <DropdownMenu label="Menu" align="left">
              <DropdownMenuLabel>My account</DropdownMenuLabel>
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Sign out</DropdownMenuItem>
            </DropdownMenu>
            <Tooltip content="Copy link to clipboard">
              <Button variant="ghost" size="icon">
                🔗
              </Button>
            </Tooltip>
          </div>,
        )}

        {this.section(
          "Table",
          `<Table
  columns={[
    { key: "name", label: "Name" },
    { key: "role", label: "Role" },
    { key: "status", label: "Status",
      render: (row) => <Badge>{row.status}</Badge> },
  ]}
  rows={this.members}
  rowKey="name"
  hover
/>`,
          <Table
            columns={[
              { key: "name", label: "Name" },
              { key: "role", label: "Role" },
              {
                key: "status",
                label: "Status",
                render: (row) => (
                  <Badge variant={row.status === "Active" ? "default" : "secondary"}>
                    {row.status}
                  </Badge>
                ),
              },
            ]}
            rows={this.members}
            rowKey="name"
            hover
          />,
        )}

        <Dialog
          show={this.dialogOpen}
          title="Invite a teammate"
          description="They'll get an email to join."
        >
          <div class="space-y-3">
            <div class="space-y-1.5">
              <Label>Email</Label>
              <Input placeholder="teammate@example.com" />
            </div>
            <div class="flex justify-end gap-2">
              <Button variant="outline" onClick={() => (this.dialogOpen = false)}>
                Cancel
              </Button>
              <Button onClick={() => (this.dialogOpen = false)}>Send invite</Button>
            </div>
          </div>
        </Dialog>

        <Sheet
          show={this.sheetOpen}
          side="right"
          title="Filters"
          description="Refine what you see."
        >
          <div class="space-y-4 pt-2">
            <label class="flex items-center gap-2 text-sm">
              <Checkbox bind={this.terms} /> Only active
            </label>
            <Button class="w-full" onClick={() => (this.sheetOpen = false)}>
              Apply
            </Button>
          </div>
        </Sheet>
      </div>
    );
  }
}
