// Flow finds a page by its class name, and refuses two different classes of one name. Each admin
// panel builds its own page classes under the same names (`DashboardPage`, `<Model>ListPage`),
// so an app with two panels stopped at boot.
import { describe, expect, it } from "bun:test";
import { PanelInstance } from "../PanelInstance.ts";
import { makeDashboardPage } from "../pages/DashboardPage.tsx";
import { ResourceFormPage } from "../pages/ResourceFormPage.tsx";
import { _panelScopedName, _panelScopedPage } from "./AdminProvider.ts";

describe("two panels' pages", () => {
  it("register side by side, the second panel's named for it", () => {
    const main = new PanelInstance("admin-names-main");
    const billing = new PanelInstance("billing-desk");
    const first = _panelScopedPage(makeDashboardPage(main), main.id) as { name: string };
    const second = _panelScopedPage(makeDashboardPage(billing), billing.id) as { name: string };

    expect(first.name).toBe("DashboardPage");
    expect(second.name).toBe("BillingDeskDashboardPage");
  });

  it("keeps a name when its own panel registers the page again, and for a shared class", () => {
    const billing = new PanelInstance("billing-desk");
    const again = _panelScopedPage(makeDashboardPage(billing), billing.id) as { name: string };
    expect(again.name).toBe("BillingDeskDashboardPage");

    expect(_panelScopedPage(ResourceFormPage, "one")).toBe(ResourceFormPage);
    expect(_panelScopedPage(ResourceFormPage, "two")).toBe(ResourceFormPage);
    expect(ResourceFormPage.name).toBe("ResourceFormPage");
  });
});

describe("two panels' resource forms", () => {
  // Flow finds a form class by its name, so panel B's TaskCreateForm replaced panel A's, and
  // panel A's form validated with panel B's rules.
  it("get names of their own", () => {
    expect(_panelScopedName("TaskCreateForm", "forms-main")).toBe("TaskCreateForm");
    expect(_panelScopedName("TaskCreateForm", "ops")).toBe("OpsTaskCreateForm");
    expect(_panelScopedName("TaskCreateForm", "forms-main")).toBe("TaskCreateForm");
  });
});
