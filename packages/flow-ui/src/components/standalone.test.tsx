/** @jsxImportSource @zerotal/flow */
import { describe, it, expect } from "bun:test";
import { Sheet } from "./Sheet.tsx";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./DropdownMenu.tsx";
import { Tabs } from "./Tabs.tsx";
import { Alert, AlertTitle, AlertDescription } from "./Alert.tsx";
import { Tooltip } from "./Tooltip.tsx";
import { Table } from "./Table.tsx";

const noOldPalette = (html: string) => {
  // None of the standalone builds should leak the old Modal/Drawer gray palette.
  expect(html).not.toContain("bg-gray-900");
  expect(html).not.toContain("text-white");
};

describe("<Sheet>", () => {
  it("renders a token-themed slide-over with the side panel + backdrop", () => {
    const { html } = Sheet({ show: false, side: "right", title: "Cart", children: "x" });
    expect(html).toContain('role="dialog"');
    expect(html).toContain("bg-background");
    expect(html).toContain("text-foreground");
    expect(html).toContain("translate-x-full"); // right-side closed transform
    expect(html).toContain("bg-black/50"); // backdrop
    noOldPalette(html);
  });

  it("uses the slide axis for the chosen side", () => {
    expect(Sheet({ show: false, side: "bottom", children: "x" }).html).toContain(
      "translate-y-full",
    );
  });
});

describe("<DropdownMenu>", () => {
  it("renders the flowMenu trigger + token-themed popover panel", () => {
    const { html } = DropdownMenu({ label: "Options", children: "items" });
    expect(html).toContain('x-data="flowMenu()"');
    expect(html).toContain('role="menu"');
    expect(html).toContain("bg-popover");
    expect(html).toContain("text-popover-foreground");
    noOldPalette(html);
  });

  it("item/label/separator sub-parts render their roles + tokens", () => {
    expect(DropdownMenuItem({ children: "Profile" }).html).toContain('role="menuitem"');
    expect(DropdownMenuItem({ variant: "destructive", children: "Out" }).html).toContain(
      "text-destructive",
    );
    expect(DropdownMenuLabel({ children: "Account" }).html).toContain("font-medium");
    expect(DropdownMenuSeparator().html).toContain("bg-border");
  });
});

describe("<Tabs>", () => {
  it("renders flowTabs with a token pill tablist and panels", () => {
    const { html } = Tabs({
      items: [
        { label: "Account", content: "a" },
        { label: "Password", content: "p" },
      ],
    });
    expect(html).toContain("flowTabs(");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("bg-muted");
    noOldPalette(html);
  });
});

describe("<Alert>", () => {
  it("renders default variant with status role and tokens", () => {
    const { html } = Alert({ title: "Heads up", children: "body" });
    expect(html).toContain('role="status"');
    expect(html).toContain("bg-background");
    expect(html).toContain(">Heads up</div>");
  });

  it("destructive variant uses alert role + destructive token", () => {
    const { html } = Alert({ variant: "destructive", children: "bad" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("text-destructive");
  });

  it("dismissible adds a client-only dismiss button", () => {
    const { html } = Alert({ dismissible: true, children: "x" });
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).toContain('x-on:click="shown = false"');
  });

  it("AlertTitle/AlertDescription render", () => {
    expect(AlertTitle({ children: "T" }).html).toContain("font-medium");
    expect(AlertDescription({ children: "D" }).html).toContain("text-sm");
  });
});

describe("<Tooltip>", () => {
  it("renders the token bubble with aria-describedby wiring", () => {
    const { html } = Tooltip({ content: "Hi", children: "btn" });
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("bg-primary");
    expect(html).toContain("text-primary-foreground");
    expect(html).toContain("aria-describedby");
    noOldPalette(html);
  });
});

describe("<Table>", () => {
  const columns = [
    { key: "name", label: "Name", sortable: true },
    { key: "role", label: "Role" },
  ];
  const rows = [
    { name: "Ada", role: "Engineer" },
    { name: "Alan", role: "Researcher" },
  ];

  it("renders a token-themed table with sortable header links", () => {
    const { html } = Table({ columns, rows, sortBy: "name", sortDir: "asc", hover: true });
    expect(html).toStartWith("<table");
    expect(html).toContain("text-muted-foreground"); // header
    expect(html).toContain("hover:bg-muted/50"); // hover rows
    // `&` is HTML-escaped in the href attribute; clicking name (asc) toggles to desc.
    expect(html).toContain("?sortBy=name&amp;sortDir=desc");
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain(">Ada</td>");
    noOldPalette(html);
  });

  it("supports custom cell renderers", () => {
    const { html } = Table({
      columns: [{ key: "name", label: "Name", render: (r) => `Mx. ${r.name}` }],
      rows: [{ name: "Ada" }],
    });
    expect(html).toContain(">Mx. Ada</td>");
  });
});
