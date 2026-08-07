import { Command } from "../Command.ts";
import { Router } from "../../router/Router.ts";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

const METHOD_COLOR: Record<string, string> = {
  GET: "\x1b[32m", // green
  POST: "\x1b[34m", // blue
  PUT: "\x1b[33m", // yellow
  PATCH: "\x1b[36m", // cyan
  DELETE: "\x1b[31m", // red
};

/**
 * `bun zt route:list` — lists all registered routes.
 *
 * Prints a table of every route registered with the Router, with columns for
 * HTTP method (colour-coded), path, controller, action, and named route key.
 *
 * Requires the app to boot so that providers (e.g. AdminProvider) can register
 * their routes via Router.group() inside onBooting().
 *
 * Flags:
 *   --method / -m   filter by HTTP verb (case-insensitive)
 *   --path   / -p   filter by path prefix substring
 *   --name          only show named routes
 *   --verbose / -v  add a middleware column
 *
 * @category Diagnostics
 */
export class RouteListCommand extends Command {
  static commandName = "route:list";
  static description = "List all registered routes";
  static needsApp = true;
  static args = [];
  static flags = [
    {
      name: "method",
      short: "m",
      type: "string" as const,
      description: "Filter by HTTP method (GET, POST, PUT, PATCH, DELETE)",
    },
    {
      name: "path",
      short: "p",
      type: "string" as const,
      description: "Filter routes whose path contains this string",
    },
    {
      name: "name",
      short: "n",
      type: "boolean" as const,
      description: "Only show named routes",
      default: false,
    },
    {
      name: "verbose",
      short: "v",
      type: "boolean" as const,
      description: "Show per-route middleware classes",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const methodFilter = (this.flags["method"] as string | undefined)?.toUpperCase();
    const pathFilter = this.flags["path"] as string | undefined;
    const nameOnly = this.flags["name"] as boolean;
    const verbose = this.flags["verbose"] as boolean;

    // Build path → name lookup from the named-routes map (name → path)
    const pathToName = new Map<string, string>();
    for (const [name, path] of Router.namedRoutes) {
      pathToName.set(path, name);
    }

    let rows = Array.from(Router.routes.values());

    if (methodFilter) {
      rows = rows.filter((route) => route.method === methodFilter);
    }
    if (pathFilter) {
      rows = rows.filter((route) => route.path.includes(pathFilter));
    }
    if (nameOnly) {
      rows = rows.filter((route) => pathToName.has(route.path));
    }

    if (rows.length === 0) {
      this.warn("No routes match the given filters.");
      return;
    }

    // Sort: path asc, then method asc.
    rows.sort((first, second) => {
      const pathComparison = first.path.localeCompare(second.path);
      return pathComparison !== 0 ? pathComparison : first.method.localeCompare(second.method);
    });

    // Derive display strings
    type Row = {
      method: string;
      path: string;
      controller: string;
      action: string;
      name: string;
      middleware: string;
    };
    const display: Row[] = rows.map((route) => ({
      method: route.method,
      path: route.path,
      controller: _controllerName(route.controller.name),
      action: route.action,
      name: pathToName.get(route.path) ?? "",
      middleware: route.middleware
        .map((middleware) => middleware.name)
        .filter(Boolean)
        .join(", "),
    }));

    // Column widths.
    const columnWidths = {
      method: Math.max(6, ...display.map((row) => row.method.length)),
      path: Math.max(4, ...display.map((row) => row.path.length)),
      controller: Math.max(10, ...display.map((row) => row.controller.length)),
      action: Math.max(6, ...display.map((row) => row.action.length)),
      name: Math.max(4, ...display.map((row) => row.name.length)),
    };

    const total = rows.length;
    const label = total === 1 ? "1 route" : `${total} routes`;
    this._writer.writeLine(`\n${BOLD}Routes${RESET}  ${DIM}${label}${RESET}\n`);

    // Header.
    const header = [
      "  ",
      "METHOD".padEnd(columnWidths.method + 2),
      "PATH".padEnd(columnWidths.path + 4),
      "CONTROLLER".padEnd(columnWidths.controller + 4),
      "ACTION".padEnd(columnWidths.action + 4),
      "NAME".padEnd(columnWidths.name + 2),
      ...(verbose ? ["MIDDLEWARE"] : []),
    ].join("");
    this._writer.writeLine(`${DIM}${header}${RESET}`);

    const separator =
      "  " +
      "─".repeat(
        columnWidths.method +
          columnWidths.path +
          columnWidths.controller +
          columnWidths.action +
          columnWidths.name +
          (verbose ? 30 : 0) +
          18,
      );
    this._writer.writeLine(`${DIM}${separator}${RESET}`);

    // Rows.
    for (const row of display) {
      const color = METHOD_COLOR[row.method] ?? "";
      const line = [
        "  ",
        `${color}${row.method.padEnd(columnWidths.method)}${RESET}`,
        "  ",
        row.path.padEnd(columnWidths.path + 2),
        "  ",
        `${DIM}${row.controller.padEnd(columnWidths.controller + 2)}${RESET}`,
        "  ",
        row.action.padEnd(columnWidths.action + 2),
        "  ",
        row.name ? `${DIM}${row.name}${RESET}` : "",
        ...(verbose && row.middleware ? [`  ${DIM}${row.middleware}${RESET}`] : []),
      ].join("");
      this._writer.writeLine(line);
    }

    this._writer.writeLine("");
  }
}

function _controllerName(rawName: string): string {
  // File-based route controllers are named "FileRoute<METHOD /path>" — shorten to "file".
  if (rawName.startsWith("FileRoute<")) return "file";
  return rawName;
}
