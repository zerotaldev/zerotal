/** @jsxImportSource @zerotal/flow */
import { describe, it, expect } from "bun:test";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { Pagination, paginationRange } from "./Pagination.tsx";
import { Calendar, monthGrid, isoDay, shiftMonth } from "./Calendar.tsx";
import { Sidebar, isActive } from "./Sidebar.tsx";
import { Progress } from "./Progress.tsx";
import { Spinner } from "./Spinner.tsx";
import { Empty } from "./Empty.tsx";
import { Field } from "./Field.tsx";
import { Chart } from "./Chart.tsx";
import { Item } from "./Item.tsx";
import { Toggle, ToggleGroup } from "./Toggle.tsx";
import { Kbd } from "./Kbd.tsx";
import { AspectRatio } from "./AspectRatio.tsx";
import { formatDay } from "./DatePicker.tsx";

describe("paginationRange", () => {
  it("lists every page when they all fit", () => {
    expect(paginationRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the first and last page reachable from the middle", () => {
    const range = paginationRange(50, 100);
    expect(range[0]).toBe(1);
    expect(range.at(-1)).toBe(100);
    expect(range).toContain(50);
  });

  it("centres the window on the current page rather than the start", () => {
    // The failure this guards: showing 1–5 while sitting on page 97.
    const range = paginationRange(97, 100).filter((n): n is number => n !== null);
    expect(range).toContain(96);
    expect(range).toContain(98);
    expect(range).not.toContain(3);
  });

  it("marks elisions with null so the caller can render a gap", () => {
    expect(paginationRange(50, 100)).toContain(null);
  });

  it("keeps the window full width near the ends", () => {
    const start = paginationRange(1, 100, 5).filter((n) => n !== null);
    const end = paginationRange(100, 100, 5).filter((n) => n !== null);
    expect(start.length).toBeGreaterThanOrEqual(6);
    expect(end.length).toBeGreaterThanOrEqual(6);
  });
});

describe("<Pagination>", () => {
  it("marks the current page for assistive technology", () => {
    const { html } = Pagination({ page: 2, lastPage: 5, href: (n) => `?page=${n}` });
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Pagination"');
  });

  it("renders nothing for a single page with no total to report", () => {
    expect(Pagination({ page: 1, lastPage: 1, href: () => "#" }).html).toBe("");
  });

  it("reports the row range when given a total", () => {
    const { html } = Pagination({ page: 2, lastPage: 5, perPage: 20, total: 93, href: () => "#" });
    expect(html).toContain("21–40 of 93");
  });

  it("says so plainly when there are no rows at all", () => {
    const { html } = Pagination({ page: 1, lastPage: 1, perPage: 20, total: 0, href: () => "#" });
    expect(html).toContain("No results");
  });
});

describe("<Breadcrumb>", () => {
  const items = [
    { label: "Dashboard", href: "/admin" },
    { label: "Products", href: "/admin/products" },
    { label: "Desk Lamp" },
  ];

  it("links every item but the last, which is the current page", () => {
    const { html } = Breadcrumb({ items });
    expect(html).toContain('href="/admin/products"');
    expect(html).toContain('aria-current="page"');
    // The leaf is text, not a link.
    expect(html).not.toContain('href="Desk Lamp"');
  });

  it("collapses a long trail but keeps the root and the tail", () => {
    const deep = Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, href: `/${i}` }));
    const { html } = Breadcrumb({ items: deep, maxItems: 4 });
    expect(html).toContain("L0");
    expect(html).toContain("L7");
    expect(html).toContain("…");
    expect(html).not.toContain(">L3<");
  });
});

describe("calendar dates", () => {
  it("formats a local day without the timezone shift toISOString applies", () => {
    // 23:30 local on the 14th is the 14th, whatever UTC thinks.
    expect(isoDay(new Date(2026, 6, 14, 23, 30))).toBe("2026-07-14");
  });

  it("steps months and wraps the year", () => {
    expect(shiftMonth("2026-07", 1)).toBe("2026-08");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("always fills six weeks, so the grid does not change height", () => {
    expect(monthGrid("2026-02")).toHaveLength(42);
    expect(monthGrid("2026-08")).toHaveLength(42);
  });

  it("starts the week on Monday by default", () => {
    // 1 July 2026 is a Wednesday, so a Monday-first grid opens on 29 June.
    expect(monthGrid("2026-07")[0]!.day).toBe("2026-06-29");
    expect(monthGrid("2026-07", true)[0]!.day).toBe("2026-06-28");
  });

  it("marks which cells belong to the month being shown", () => {
    const cells = monthGrid("2026-07");
    expect(cells[0]!.inMonth).toBe(false);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
  });

  it("renders events on their day", () => {
    const { html } = Calendar({
      month: "2026-07",
      events: [{ date: "2026-07-14", label: "Launch" }],
    });
    expect(html).toContain("Launch");
  });

  it("caps how many events one day shows, so a row cannot stretch", () => {
    const events = Array.from({ length: 6 }, (_, i) => ({ date: "2026-07-14", label: `E${i}` }));
    const { html } = Calendar({ month: "2026-07", events });
    expect(html).toContain("+3 more");
  });
});

describe("sidebar active state", () => {
  it("matches a path inside the item", () => {
    expect(isActive("/admin/products", "/admin/products/1/edit")).toBe(true);
  });

  it("does not match a different resource with a shared prefix", () => {
    // The bug this guards: /admin/order lighting up for /admin/orders.
    expect(isActive("/admin/order", "/admin/orders")).toBe(false);
  });

  it("marks the longest match, not every ancestor", () => {
    const { html } = Sidebar({
      collapsible: false,
      current: "/admin/products/1",
      groups: [
        {
          items: [
            { label: "Dashboard", href: "/admin" },
            { label: "Products", href: "/admin/products" },
          ],
        },
      ],
    });
    // Exactly one item carries the current marker.
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('href="/admin/products"');
  });

  it("opens a group holding the current page", () => {
    const { html } = Sidebar({
      collapsible: false,
      current: "/admin/shop/products",
      groups: [
        {
          items: [
            {
              label: "Shop",
              children: [{ label: "Products", href: "/admin/shop/products" }],
            },
          ],
        },
      ],
    });
    expect(html).toContain("{ open: true }");
  });
});

describe("<Progress>", () => {
  it("reports its value to assistive technology", () => {
    const { html } = Progress({ value: 30, max: 60 });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="30"');
    expect(html).toContain("width:50%");
  });

  it("clamps a value past the maximum instead of overflowing the track", () => {
    expect(Progress({ value: 90, max: 60 }).html).toContain("width:100%");
  });

  it("animates rather than claiming a position when the total is unknown", () => {
    const { html } = Progress({});
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain("animate-");
  });
});

describe("<Spinner> and <Empty>", () => {
  it("names the spinner for screen readers without showing the text", () => {
    const { html } = Spinner({});
    expect(html).toContain('role="status"');
    expect(html).toContain("sr-only");
  });

  it("lets a container that already announces itself silence the spinner", () => {
    expect(Spinner({ label: null }).html).not.toContain("sr-only");
  });

  it("renders the empty state's action alongside its explanation", () => {
    const { html } = Empty({ title: "No orders", description: "They appear here.", action: "x" });
    expect(html).toContain("No orders");
    expect(html).toContain("They appear here.");
    expect(html).toContain("border-dashed");
  });
});

describe("<Field>", () => {
  it("links the label to the control it wraps", () => {
    const { html } = Field({ label: "Email", children: <input /> });
    const id = /for="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });

  it("announces the error and marks the control invalid", () => {
    const { html } = Field({ label: "Email", error: "Required.", children: <input /> });
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("aria-describedby");
  });

  it("describes the control with its helper text", () => {
    const { html } = Field({
      label: "Email",
      description: "We never share it.",
      children: <input />,
    });
    expect(html).toContain("aria-describedby");
    expect(html).toContain("We never share it.");
  });

  it("leaves an explicit id the caller set alone", () => {
    const { html } = Field({ label: "Email", children: <input id="mine" /> });
    expect(html).toContain('id="mine"');
    expect(html).toContain('for="mine"');
  });
});

describe("<Chart>", () => {
  const labels = ["Mon", "Tue", "Wed"];
  const datasets = [{ label: "Orders", data: [4, 8, 6] }];

  it("renders as an image with the numbers available as text", () => {
    const { html } = Chart({ labels, datasets });
    expect(html).toContain('role="img"');
    expect(html).toContain("Orders: 4, 8, 6");
  });

  it("draws bars for a bar chart and a path for a line", () => {
    expect(Chart({ type: "bar", labels, datasets }).html).toContain("<rect");
    expect(Chart({ type: "line", labels, datasets }).html).toContain("<path");
  });

  it("uses theme variables rather than baked-in colours", () => {
    expect(Chart({ labels, datasets }).html).toContain("var(--primary)");
  });

  it("survives a dataset that is all zeroes", () => {
    const { html } = Chart({ labels, datasets: [{ data: [0, 0, 0] }] });
    expect(html).toContain("<svg");
    expect(html).not.toContain("NaN");
  });

  it("renders a donut without a division by zero when the total is nothing", () => {
    const { html } = Chart({ type: "donut", labels: ["A"], datasets: [{ data: [0] }] });
    expect(html).toContain("<svg");
    expect(html).not.toContain("NaN");
  });
});

describe("<Item>, <Toggle> and friends", () => {
  it("renders an item as a link when given an href", () => {
    expect(Item({ title: "Team", href: "/team" }).html).toStartWith("<a");
    expect(Item({ title: "Team" }).html).toStartWith("<div");
  });

  it("says pressed rather than checked, which is what a toggle means", () => {
    expect(Toggle({ pressed: true, children: "B" }).html).toContain('aria-pressed="true"');
    expect(Toggle({ children: "B" }).html).toContain('aria-pressed="false"');
  });

  it("marks a single-choice toggle group as a radiogroup", () => {
    const options = [{ value: "a", label: "A" }];
    expect(ToggleGroup({ options, bind: "a" }).html).toContain('role="radiogroup"');
    expect(ToggleGroup({ options, multiple: true }).html).toContain('role="group"');
  });

  it("presses on the client, and renders the pressed state for the first paint", () => {
    const { html } = ToggleGroup({ options: [{ value: "a", label: "A" }], bind: "a" });
    // Server-rendered so it is right before Alpine boots …
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("data-pressed");
    // … and re-bound so a click flips it without a round-trip.
    expect(html).toContain("flowToggleGroup");
    expect(html).toContain("x-on:click");
  });

  it("renders a key as a <kbd>", () => {
    expect(Kbd({ children: "K" }).html).toStartWith("<kbd");
  });

  it("reserves space with a CSS aspect ratio", () => {
    expect(AspectRatio({ ratio: 16 / 9 }).html).toContain("aspect-ratio:1.777");
  });
});

describe("formatDay", () => {
  it("formats unambiguously, avoiding the day/month ordering trap", () => {
    expect(formatDay("2026-07-04")).toBe("4 Jul 2026");
  });

  it("returns an unparseable value unchanged rather than inventing a date", () => {
    expect(formatDay("not-a-date")).toBe("not-a-date");
  });
});
