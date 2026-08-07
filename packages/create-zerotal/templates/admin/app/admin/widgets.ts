import { statsWidget, stat, chartWidget } from "@zerotal/admin";
import type { DashboardWidget } from "@zerotal/admin";
import { Product } from "@app/models/Product";
import { User } from "@app/models/User";
import { money } from "@app/admin/shared";

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
      const [products, active, users, value] = await Promise.all([
        Product.count(),
        Product.query().where("status", "active").count(),
        User.count(),
        Product.query()
          .get()
          .then((rows) =>
            (rows as unknown as { price?: number; stock?: number }[]).reduce(
              (sum, r) => sum + Number(r.price ?? 0) * Number(r.stock ?? 0),
              0,
            ),
          ),
      ]);

      return [
        stat("Products", products).icon("collection").tone("primary"),
        stat("Active", active).icon("check-circle").tone("success"),
        stat("Stock value", money(value)).icon("database"),
        stat("Users", users).icon("users").tone("muted"),
      ];
    }).poll("30s"),

    chartWidget("Catalogue by status", async () => {
      const statuses = ["draft", "active", "discontinued"];
      const counts = await Promise.all(
        statuses.map((s) => Product.query().where("status", s).count()),
      );
      return {
        type: "doughnut",
        labels: ["Draft", "Active", "Discontinued"],
        datasets: [{ data: counts }],
      };
    }),
  ];
}
