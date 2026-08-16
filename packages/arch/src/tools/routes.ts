/**
 * `routes` — the routes the app actually registered, not the ones its files
 * suggest.
 *
 * Read from the router after boot, so a route a provider added programmatically
 * appears beside the ones in `routes/`. The `name` column is the load-bearing
 * one: `route()` is type-checked against generated names, so an agent that
 * guesses a name writes code that will not compile, and this is where it stops
 * guessing.
 */
import type { ArchTool, ToolOutcome } from "../mcp/types.ts";
import type { RouteEntry, RouteReport } from "../probe/topics.ts";
import type { ToolContext } from "./context.ts";

export function routesTool(ctx: ToolContext): ArchTool {
  return {
    name: "routes",
    title: "Routes",
    description:
      "List the HTTP routes this app has registered, with the controller, action, route name " +
      "and middleware for each. Includes routes registered programmatically by providers, which " +
      "reading the routes/ directory would miss. Use it to get a route name right before calling " +
      "route(), and to check a route you added is actually reachable.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Only routes whose path contains this substring.",
        },
        method: {
          type: "string",
          description: "Only routes with this HTTP method. Case-insensitive.",
        },
        named: {
          type: "boolean",
          description: "Only routes that have a name.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        total: { type: "number", description: "Routes matching the filters." },
        registered: { type: "number", description: "Routes in the app, before filtering." },
        routes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              method: { type: "string" },
              path: { type: "string" },
              controller: { type: "string" },
              action: { type: "string" },
              name: { type: "string" },
              middleware: { type: "array", items: { type: "string" } },
              domain: { type: "string" },
            },
            required: ["method", "path", "controller", "action", "middleware"],
          },
        },
      },
      required: ["total", "registered", "routes"],
    },

    async run(args, signal): Promise<ToolOutcome> {
      const result = await ctx.probe.run("routes", signal);
      if (!result.ok) return { text: result.message, failed: true };

      const report = result.data as RouteReport;
      const routes = filter(report.routes, args);
      const data = { total: routes.length, registered: report.total, routes };

      if (routes.length === 0) {
        return {
          text:
            report.total === 0
              ? "This app has registered no routes."
              : `No route matches those filters. The app has ${report.total} route(s).`,
          data,
        };
      }

      return { text: render(routes, report.total), data };
    },
  };
}

function filter(routes: RouteEntry[], args: Record<string, unknown>): RouteEntry[] {
  const path = typeof args["path"] === "string" ? args["path"] : undefined;
  const method = typeof args["method"] === "string" ? args["method"].toUpperCase() : undefined;
  const named = args["named"] === true;

  return routes.filter((route) => {
    if (path !== undefined && !route.path.includes(path)) return false;
    if (method !== undefined && route.method !== method) return false;
    if (named && route.name === undefined) return false;
    return true;
  });
}

/**
 * A fixed-width table.
 *
 * Aligned columns rather than prose because a model reads this the way a
 * developer does — scanning one column for the row it needs.
 */
function render(routes: RouteEntry[], registered: number): string {
  const rows = routes.map((route) => [
    route.method,
    route.path,
    `${route.controller}.${route.action}`,
    route.name ?? "",
  ]);
  const headers = ["METHOD", "PATH", "HANDLER", "NAME"];
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]!.length)),
  );

  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]!))
      .join("  ")
      .trimEnd();

  const header =
    routes.length === registered
      ? `${registered} route${registered === 1 ? "" : "s"}`
      : `${routes.length} of ${registered} routes`;

  return [header, "", line(headers), ...rows.map(line)].join("\n");
}
