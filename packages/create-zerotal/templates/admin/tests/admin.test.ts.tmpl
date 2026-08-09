import { beforeAll, describe, test, expect } from "bun:test";
import { createTestApp, type TestApp } from "zerotal/testing";
import { Panel } from "@zerotal/admin";
import { User } from "@app/models/User.ts";
import { Product } from "@app/models/Product.ts";

// Boots the real app: AdminProvider auto-loads app/admin/index.ts and mounts
// the panel, so these tests exercise the wiring the browser gets.
let app: TestApp;
let staff: User;

beforeAll(async () => {
  Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  app = await createTestApp(() => import("../bootstrap/app.ts").then((m) => m.default));

  staff = await User.create({
    name: "Ada Admin",
    email: `staff-${Date.now()}@example.com`,
    password: "password",
    roles: ["admin"],
  });
});

describe("the panel", () => {
  test("registers the resources", () => {
    expect(Panel.default().resources().map((r) => r.getSlug()).sort()).toEqual([
      "products",
      "settings",
      "users",
    ]);
  });

  test("sends guests to the login page", async () => {
    const res = await app.actingAsGuest().get("/admin", { Accept: "text/html" });
    res.assertRedirect("/admin/login");
  });

  test("shows the dashboard to a signed-in user", async () => {
    const res = await app.actingAs(staff).get("/admin", { Accept: "text/html" });
    res.assertOk();
    res.assertSee("Products");
  });

  test("lists products with their filter tabs", async () => {
    await Product.create({ name: "Test Widget", sku: "SKU-T1", price: 4999, status: "active" });

    const res = await app.actingAs(staff).get("/admin/products", { Accept: "text/html" });
    res.assertOk();
    res.assertSee("Test Widget");
    res.assertSee("Drafts"); // a filter tab
  });

  test("opens settings straight onto its form, with no record id", async () => {
    const res = await app.actingAs(staff).get("/admin/settings", { Accept: "text/html" });
    res.assertOk();
    res.assertSee("Site name");
  });
});
