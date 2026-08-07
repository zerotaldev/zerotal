import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Panel } from "./Panel.ts";
import { AdminPage } from "./pages/AdminPage.ts";
import { hostedPage } from "./support/hostPage.ts";
import { AdminLayout } from "./ui/AdminLayout.tsx";
import { AdminAbilityMiddleware } from "./provider/AdminAbilityMiddleware.ts";
import type { HttpContext } from "@zerotal/core";

/** A minimal page class — enough to be registered and mounted, no rendering involved. */
class ReportsPage extends AdminPage {
  static override slug = "reports";
  static override title = "Reports";
  static override navigationIcon = "chart";
  static override navigationGroup = "Insights";
  static override ability = "reports.view";
}

/** Stands in for a page contributed by a package: a plain class, no admin base. */
class ContributedJobsPage {}

const ORIGINAL_ENV = Bun.env["APP_ENV"];

beforeEach(() => {
  Panel.reset();
  Bun.env["APP_ENV"] = "test";
});

afterEach(() => {
  Panel.reset();
  if (ORIGINAL_ENV === undefined) delete Bun.env["APP_ENV"];
  else Bun.env["APP_ENV"] = ORIGINAL_ENV;
});

// ── app-authored pages ────────────────────────────────────────────────────────

describe("Panel.pages", () => {
  it("registers a page and derives its navigation entry", () => {
    Panel.pages(ReportsPage);

    const page = Panel.findPage("reports");
    expect(page?.title).toBe("Reports");
    expect(page?.ability).toBe("reports.view");

    const insights = Panel.navigation().find((g) => g.group === "Insights");
    expect(insights?.items.map((i) => i.href)).toEqual(["/admin/reports"]);
  });

  it("is idempotent by slug", () => {
    Panel.pages(ReportsPage, ReportsPage);
    expect(Panel.registeredPages()).toHaveLength(1);
  });

  it("keeps a page out of the sidebar when it opts out, but still registers it", () => {
    class HiddenPage extends AdminPage {
      static override slug = "hidden";
      static override title = "Hidden";
      static override showInNavigation = false;
    }
    Panel.pages(HiddenPage);

    expect(Panel.findPage("hidden")).toBeDefined();
    expect(Panel.navigation().flatMap((g) => g.items.map((i) => i.href))).not.toContain(
      "/admin/hidden",
    );
  });
});

// ── package contributions ─────────────────────────────────────────────────────

describe("Panel.host", () => {
  it("accepts a page from a package that never imports the panel", () => {
    Panel.host().page({
      slug: "jobs",
      page: ContributedJobsPage,
      title: "Jobs",
      ability: "queue.view",
      navigationGroup: "Ops",
    });

    expect(Panel.findPage("jobs")?.page).toBe(ContributedJobsPage);
    expect(Panel.navigation().find((g) => g.group === "Ops")?.items[0]?.label).toBe("Jobs");
  });

  it("reports a contributor as disabled when config switches it off", () => {
    Panel.configure({ plugins: { monitor: false } });

    expect(Panel.host().enabled("monitor")).toBe(false);
    expect(Panel.host().enabled("queue")).toBe(true);
  });

  it("installs an app-authored plugin, and skips a disabled one", async () => {
    Panel.configure({ plugins: { billing: false } });

    await Panel.plugin(
      {
        id: "billing",
        install: (panel) =>
          panel.navItem({ label: "Billing", href: "/billing", ability: "billing.view" }),
      },
      {
        id: "docs",
        install: (panel) =>
          panel.navItem({ label: "Docs", href: "https://example.test", ability: "docs.view" }),
      },
    );

    const hrefs = Panel.navigation().flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("https://example.test");
    expect(hrefs).not.toContain("/billing");
  });

  it("deduplicates repeat contributions of the same thing", () => {
    const panel = Panel.host();
    const provider = {
      id: "logs",
      label: "Logs",
      ability: "logs.view",
      search: () => [],
    };
    panel.searchProvider(provider);
    panel.searchProvider(provider);
    panel.page({ slug: "jobs", page: ContributedJobsPage, title: "Jobs", ability: "queue.view" });
    panel.page({ slug: "jobs", page: ContributedJobsPage, title: "Jobs", ability: "queue.view" });

    expect(Panel.registeredPages()).toHaveLength(1);
  });
});

// ── consoles ──────────────────────────────────────────────────────────────────

describe("Panel.host().console", () => {
  const jobsConsole = {
    slug: "jobs",
    title: "Jobs",
    ability: "queue.view",
    navigationGroup: "Operations",
    tabs: [
      {
        key: "failed",
        label: "Failed",
        columns: [{ key: "id", label: "ID" }],
        rows: () => [{ id: 1 }],
      },
    ],
  };

  it("registers a console and gives it a navigation entry", () => {
    Panel.host().console(jobsConsole);

    expect(Panel.findConsole("jobs")?.title).toBe("Jobs");
    const ops = Panel.navigation().find((g) => g.group === "Operations");
    expect(ops?.items[0]?.href).toBe("/admin/jobs");
  });

  it("is idempotent by slug", () => {
    Panel.host().console(jobsConsole);
    Panel.host().console(jobsConsole);
    expect(Panel.consoles()).toHaveLength(1);
  });

  it("normalizes a slug given with slashes", () => {
    Panel.host().console({ ...jobsConsole, slug: "/jobs/" });
    expect(Panel.findConsole("jobs")).toBeDefined();
  });

  it("hides a console that opts out of navigation but keeps it registered", () => {
    Panel.host().console({ ...jobsConsole, showInNavigation: false });
    expect(Panel.findConsole("jobs")).toBeDefined();
    expect(Panel.navigation().flatMap((g) => g.items.map((i) => i.href))).not.toContain(
      "/admin/jobs",
    );
  });

  it("drops the console from the sidebar when its ability is denied", async () => {
    Panel.configure({ authorize: () => false });
    Panel.host().console(jobsConsole);

    expect(await Panel.visibleNavigation()).toEqual([]);
  });
});

describe("navigation badges", () => {
  it("resolves badges for resources, pages and consoles alike", async () => {
    class BadgedPage extends AdminPage {
      static override slug = "badged";
      static override title = "Badged";
      static override navigationBadge = () => 7;
    }
    Panel.pages(BadgedPage);
    Panel.host().console({
      slug: "jobs",
      title: "Jobs",
      ability: "queue.view",
      navigationBadge: () => 3,
      navigationBadgeColor: "destructive",
      tabs: [],
    });

    const badges = await Panel.navigationBadges();
    expect(badges["badged"]).toEqual({ text: "7", color: "primary" });
    expect(badges["jobs"]).toEqual({ text: "3", color: "destructive" });
  });

  it("swallows a badge that throws rather than losing the sidebar", async () => {
    Panel.host().console({
      slug: "jobs",
      title: "Jobs",
      ability: "queue.view",
      navigationBadge: () => {
        throw new Error("db down");
      },
      tabs: [],
    });

    expect(await Panel.navigationBadges()).toEqual({});
  });

  it("omits a badge that resolves to nothing", async () => {
    Panel.host().console({
      slug: "jobs",
      title: "Jobs",
      ability: "queue.view",
      navigationBadge: () => null,
      tabs: [],
    });

    expect(await Panel.navigationBadges()).toEqual({});
  });
});

// ── authorization ─────────────────────────────────────────────────────────────

describe("ability filtering", () => {
  it("drops navigation entries whose ability the user lacks", async () => {
    Panel.configure({ authorize: (ability) => ability === "reports.view" });
    Panel.pages(ReportsPage);
    Panel.host().navItem({ label: "Ops", href: "/ops", ability: "ops.view", group: "Insights" });

    const visible = await Panel.visibleNavigation();
    const labels = visible.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("Reports");
    expect(labels).not.toContain("Ops");
  });

  it("drops a group once every entry in it is denied", async () => {
    Panel.configure({ authorize: () => false });
    Panel.pages(ReportsPage);

    expect(await Panel.visibleNavigation()).toEqual([]);
  });

  it("filters contributed widgets, search providers, slots and menu items", async () => {
    Panel.configure({ authorize: (ability) => ability === "keep" });
    const panel = Panel.host();
    const widget = { stats: async () => [] } as never;
    panel.widget({ widget, ability: "keep" });
    panel.widget({ widget, ability: "drop" });
    panel.searchProvider({ id: "a", label: "A", ability: "keep", search: () => [] });
    panel.searchProvider({ id: "b", label: "B", ability: "drop", search: () => [] });
    panel.topbarSlot({ id: "a", ability: "keep", render: () => ({}) as never });
    panel.topbarSlot({ id: "b", ability: "drop", render: () => ({}) as never });
    panel.userMenuItem({ label: "A", href: "/a", ability: "keep" });
    panel.userMenuItem({ label: "B", href: "/b", ability: "drop" });

    expect(await Panel.visibleWidgets()).toHaveLength(1);
    expect((await Panel.visibleSearchProviders()).map((p) => p.id)).toEqual(["a"]);
    expect((await Panel.visibleTopbarSlots()).map((s) => s.id)).toEqual(["a"]);
    expect((await Panel.visibleUserMenuItems()).map((i) => i.label)).toEqual(["A"]);
  });

  it("allows a destination that declares no ability at all", async () => {
    expect(await Panel.can(undefined)).toBe(true);
  });

  it("denies when an authorizer throws, rather than letting the error open the door", async () => {
    Panel.configure({
      authorize: () => {
        throw new Error("policy blew up");
      },
    });
    expect(await Panel.can("anything")).toBe(false);
  });

  it("fails closed in production when nothing is configured to decide", async () => {
    Bun.env["APP_ENV"] = "production";
    expect(await Panel.can("reports.view")).toBe(false);
  });

  it("stays open in development so an unconfigured panel is still explorable", async () => {
    Bun.env["APP_ENV"] = "development";
    expect(await Panel.can("reports.view")).toBe(true);
  });
});

describe("AdminAbilityMiddleware", () => {
  const ctx = {} as HttpContext;

  it("passes the request through when the ability is held", async () => {
    Panel.configure({ authorize: () => true });
    const Guard = AdminAbilityMiddleware.with({ ability: "reports.view" });

    let reached = false;
    await new Guard().handle(ctx, async () => {
      reached = true;
    });
    expect(reached).toBe(true);
  });

  it("answers 403 without running the page when the ability is denied", async () => {
    Panel.configure({ authorize: () => false });
    const Guard = AdminAbilityMiddleware.with({ ability: "reports.view" });

    let reached = false;
    const response = await new Guard().handle(ctx, async () => {
      reached = true;
    });
    expect(reached).toBe(false);
    expect(response?.status).toBe(403);
  });
});

// ── hosting a contributed page ────────────────────────────────────────────────

describe("hostedPage", () => {
  it("wraps a contributed page in the panel layout without touching the original", () => {
    const Hosted = hostedPage(ContributedJobsPage) as unknown as { layout: unknown; name: string };

    expect(Hosted.layout).toBe(AdminLayout);
    expect((ContributedJobsPage as unknown as { layout?: unknown }).layout).toBeUndefined();
  });

  it("keeps the original class name, which Flow's registry is keyed by", () => {
    const Hosted = hostedPage(ContributedJobsPage);
    expect(Hosted.name).toBe("ContributedJobsPage");
  });

  it("leaves a page that already uses the panel layout exactly as it is", () => {
    expect(hostedPage(ReportsPage as never)).toBe(ReportsPage as never);
  });
});
