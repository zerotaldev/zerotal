import { RequestContext } from "zerotal";
import { statsWidget, stat, chartWidget } from "@zerotal/admin";
import type { DashboardWidget } from "@zerotal/admin";
import { Product } from "@app/models/Product";
import { User } from "@app/models/User";
import { money } from "@app/admin/shared";

/**
 * Products per status, from one grouped query:
 * `SELECT status, COUNT(*) AS total FROM products ... GROUP BY status`.
 *
 * Both the stats row and the chart need these numbers. A count per status
 * would run the same query shape once per status per widget, which trips the
 * development N+1 warning on every dashboard load. `RequestContext.remember`
 * runs this once per request and hands both widgets the same answer. A status
 * with no products is absent from the result, so read it with `?? 0`.
 */
function productsByStatus(): Promise<Record<string, number>> {
  return RequestContext.remember("dashboard:products-by-status", async () => {
    const rows = await Product.query().groupBy("status").pluck<number>("COUNT(*) as total", "status");
    return rows as Record<string, number>;
  });
}

/**
 * The dashboard. A widget is a data provider — the panel owns the markup — so
 * these stay easy to read and easy to test.
 *
 * `.poll()` re-renders on an interval, which is worth it for numbers someone
 * actually watches and wasteful for the rest.
 */
export function dashboardWidgets(): DashboardWidget[] {
  return [
    statsWidget(async () => {
      const [products, byStatus, users, value] = await Promise.all([
        Product.count(),
        productsByStatus(),
        User.count(),
        Product.query()
          .get()
          .then((rows) => rows.reduce((sum, r) => sum + r.price * (r.stock ?? 0), 0)),
      ]);

      return [
        stat("Products", products).icon("collection").tone("primary"),
        stat("Active", byStatus.active ?? 0).icon("check-circle").tone("success"),
        stat("Stock value", money(value)).icon("database"),
        stat("Users", users).icon("users").tone("muted"),
      ];
    }).poll("30s"),

    chartWidget("Catalogue by status", async () => {
      const byStatus = await productsByStatus();
      return {
        type: "doughnut",
        labels: ["Draft", "Active", "Discontinued"],
        datasets: [{ data: ["draft", "active", "discontinued"].map((s) => byStatus[s] ?? 0) }],
      };
    }),
  ];
}
