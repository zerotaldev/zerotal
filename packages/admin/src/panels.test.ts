import { describe, it, expect, beforeEach } from "bun:test";
import { Panel, DEFAULT_PANEL_ID } from "./Panel.ts";
import { Resource } from "./Resource.ts";
import { text } from "./table/Column.ts";
import { textInput } from "./form/index.ts";
import { statsWidget, stat } from "./widgets/Widget.ts";

class StaffUserResource extends Resource {
  static override model = { name: "User" };
  static override slug = "users";
  static override navigationGroup = "Access";

  static override columns() {
    return [text("id"), text("email")];
  }

  static override form() {
    return [textInput("email").required()];
  }

  static override can(): boolean {
    return true;
  }
}

class CustomerInvoiceResource extends Resource {
  static override model = { name: "Invoice" };
  static override slug = "invoices";

  static override columns() {
    return [text("id"), text("total")];
  }

  static override can(): boolean {
    return true;
  }
}

describe("multiple panels", () => {
  beforeEach(() => {
    Panel.reset();
  });

  it("starts with one panel that the static facade writes to", () => {
    Panel.configure({ brand: "Acme", path: "/admin" });
    Panel.register(StaffUserResource);

    expect(Panel.all()).toHaveLength(1);
    expect(Panel.all()[0]!.id).toBe(DEFAULT_PANEL_ID);
    expect(Panel.default().config().brand).toBe("Acme");
    expect(Panel.default().resources()).toEqual([StaffUserResource]);
  });

  it("keeps each panel's resources, widgets and config to itself", () => {
    Panel.configure({ brand: "Back office", path: "/admin" });
    Panel.register(StaffUserResource);
    Panel.widgets(statsWidget(() => [stat("Users", 1)]));

    const console = Panel.make("console", { brand: "Customer console", path: "/app" });
    console.register(CustomerInvoiceResource);

    expect(Panel.all().map((p) => p.id)).toEqual([DEFAULT_PANEL_ID, "console"]);
    expect(Panel.default().resources()).toEqual([StaffUserResource]);
    expect(console.resources()).toEqual([CustomerInvoiceResource]);
    expect(console.dashboardWidgets()).toHaveLength(0);
    expect(console.config().brand).toBe("Customer console");
  });

  it("builds navigation under each panel's own base path", () => {
    Panel.configure({ path: "/admin" });
    Panel.register(StaffUserResource);
    const console = Panel.make("console", { path: "/app" });
    console.register(CustomerInvoiceResource);

    const staffHrefs = Panel.default()
      .navigation()
      .flatMap((g) => g.items.map((i) => i.href));
    const consoleHrefs = console.navigation().flatMap((g) => g.items.map((i) => i.href));

    expect(staffHrefs).toEqual(["/admin/users"]);
    expect(consoleHrefs).toEqual(["/app/invoices"]);
  });

  it("resolves the owning panel from a request path", () => {
    Panel.configure({ path: "/admin" });
    const console = Panel.make("console", { path: "/app" });

    expect(Panel.forPath("/admin").id).toBe(DEFAULT_PANEL_ID);
    expect(Panel.forPath("/admin/users/3/edit").id).toBe(DEFAULT_PANEL_ID);
    expect(Panel.forPath("/app").id).toBe(console.id);
    expect(Panel.forPath("/app/invoices").id).toBe(console.id);
    // A path no panel claims falls back rather than throwing.
    expect(Panel.forPath("/marketing").id).toBe(DEFAULT_PANEL_ID);
  });

  it("prefers the longest matching prefix when one panel nests inside another", () => {
    Panel.configure({ path: "/admin" });
    const billing = Panel.make("billing", { path: "/admin/billing" });

    expect(Panel.forPath("/admin/users").id).toBe(DEFAULT_PANEL_ID);
    expect(Panel.forPath("/admin/billing/invoices").id).toBe(billing.id);
  });

  it("lets two panels register the same slug without colliding", () => {
    Panel.configure({ path: "/admin" });
    Panel.register(StaffUserResource);
    const console = Panel.make("console", { path: "/app" });
    console.register(CustomerInvoiceResource);

    expect(Panel.default().find("users")).toBe(StaffUserResource);
    expect(Panel.default().find("invoices")).toBeUndefined();
    expect(console.find("invoices")).toBe(CustomerInvoiceResource);
    expect(console.find("users")).toBeUndefined();
  });

  it("reconfigures rather than duplicating when made twice", () => {
    const first = Panel.make("console", { path: "/app", brand: "One" });
    const second = Panel.make("console", { brand: "Two" });

    expect(second).toBe(first);
    expect(Panel.all()).toHaveLength(2);
    expect(first.config().brand).toBe("Two");
    expect(first.config().path).toBe("/app");
  });
});
