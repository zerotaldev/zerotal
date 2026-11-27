/**
 * The watch list, as a table.
 *
 * Each row is a path a developer saves and what `bun zt dev` must do about it. The rows that
 * matter most are the Flow ones: a page, component or layout under `app/flow/` is loaded by the
 * server alone, and restarting the scheduler for one cost a full app boot on every save.
 */
import { describe, it, expect } from "bun:test";
import { _classifyChange } from "./devChanges.ts";
import type { _DevChange } from "./devChanges.ts";

const TABLE: [path: string, change: _DevChange][] = [
  // Flow: the server alone loads these.
  ["app/flow/pages/about.tsx", "restart-server"],
  ["app/flow/pages/projects/[project].tsx", "restart-server"],
  ["app/flow/components/Button.tsx", "restart-server"],
  ["app/flow/layouts/AppLayout.tsx", "restart-server"],
  ["app/flow/lib/page.ts", "restart-server"],
  ["app/flow", "restart-server"],
  ["resources/app.html", "restart-server"],

  // Backend: the server and every process that restarts with it.
  ["app/schedules/SendReminders.ts", "restart-all"],
  ["app/jobs/SendWelcomeEmail.ts", "restart-all"],
  ["app/models/User.ts", "restart-all"],
  ["app/providers/AppServiceProvider.ts", "restart-all"],
  ["app/routes/web.ts", "restart-all"],
  ["app/flowchart.ts", "restart-all"],
  ["app/flows/Checkout.ts", "restart-all"],
  ["app", "restart-all"],
  ["routes/web.ts", "restart-all"],
  ["bootstrap/providers.ts", "restart-all"],
  ["config/app.ts", "restart-all"],
  ["packages/billing/src/index.ts", "restart-all"],

  // Frontend: rebuilt into the bundles; no restart at all.
  ["resources/js/pages/Dashboard.tsx", "rebuild"],
  ["resources/js/pages/Dashboard.vue", "rebuild"],
  ["resources/js/Components/Nav.tsx", "rebuild"],
  ["resources/pages/home.tsx", "rebuild"],
  ["resources/css/app.css", "rebuild"],

  // Nothing.
  ["resources/js/pages.generated.ts", "ignore"],
  ["public/build/app.js", "ignore"],
  [".zerotal/cache/flow/about.js", "ignore"],
  ["node_modules/zerotal/package.json", "ignore"],
  [".git/index", "ignore"],
  [".env", "ignore"],
  ["database/database.sqlite", "ignore"],
  ["tests/feature/home.test.ts", "ignore"],
  ["package.json", "ignore"],
  ["resources/app.html.swp", "ignore"],
  ["", "ignore"],
];

describe("_classifyChange()", () => {
  for (const [path, change] of TABLE) {
    it(`${path || "(empty)"} → ${change}`, () => {
      expect(_classifyChange(path)).toBe(change);
    });
  }

  it("reads Windows separators", () => {
    expect(_classifyChange("app\\flow\\pages\\about.tsx")).toBe("restart-server");
    expect(_classifyChange("app\\schedules\\Nightly.ts")).toBe("restart-all");
    expect(_classifyChange("resources\\css\\app.css")).toBe("rebuild");
  });

  it("reads a leading ./", () => {
    expect(_classifyChange("./app/flow/pages/about.tsx")).toBe("restart-server");
  });
});
