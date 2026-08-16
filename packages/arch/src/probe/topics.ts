/**
 * The four reads that need a booted application, and the only code in this
 * package that runs inside one.
 *
 * Everything here answers from the framework's own structured sources rather
 * than by parsing a printed table: `runDoctor()` already returns
 * `{status, message, fix}` per check, `Router.routes` is a map of route
 * definitions, and the ORM's `ModelInspector` reads decorator metadata. There is
 * no scraping anywhere in this file, and there should never be — the moment a
 * topic starts parsing human output it will disagree with the framework the
 * first time a column is widened.
 *
 * Each topic's return value is the tool's `structuredContent`, so its shape is a
 * published contract: change one and the matching `outputSchema` in `tools/`
 * changes with it.
 */
import { Router, deployEnv, runDoctor } from "@zerotal/core";
import type { Application } from "@zerotal/core";

/** The topics `zt arch:probe` can be asked for. */
export const PROBE_TOPICS = ["doctor", "routes", "schema", "app-info"] as const;

export type ProbeTopic = (typeof PROBE_TOPICS)[number];

export function isProbeTopic(value: string): value is ProbeTopic {
  return (PROBE_TOPICS as readonly string[]).includes(value);
}

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface DoctorFinding {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  message: string;
  /** The command or edit that resolves it. Absent when the finding is `ok`. */
  fix?: string;
}

export interface DoctorReport {
  findings: DoctorFinding[];
  counts: { ok: number; warn: number; fail: number; total: number };
  /** True when nothing is broken outright. Warnings do not clear this. */
  healthy: boolean;
}

export interface RouteEntry {
  method: string;
  path: string;
  controller: string;
  action: string;
  /** The name `route()` takes, when the route has one. */
  name?: string;
  middleware: string[];
  domain?: string;
}

export interface RouteReport {
  routes: RouteEntry[];
  total: number;
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  unique: boolean;
  indexed: boolean;
}

export interface SchemaModel {
  table: string;
  primaryKey: string;
  timestamps: boolean;
  softDeletes: boolean;
  columns: SchemaColumn[];
}

export interface SchemaReport {
  models: SchemaModel[];
  total: number;
  /** Why the list is empty, when it is — an app with no ORM is not an error. */
  note?: string;
}

export interface InstalledPackage {
  name: string;
  version: string;
  /** The package's compatibility promise: `stable`, `beta` or `experimental`. */
  maturity?: string;
}

export interface AppInfo {
  bun: string;
  environment: string;
  appEnv: string;
  url?: string;
  providers: string[];
  packages: InstalledPackage[];
  webSocketPaths: string[];
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/** Run one topic against a booted app and return its report. */
export async function probe(topic: ProbeTopic, app: Application): Promise<unknown> {
  switch (topic) {
    case "doctor":
      return doctorReport(app);
    case "routes":
      return routeReport();
    case "schema":
      return schemaReport();
    case "app-info":
      return appInfo(app);
  }
}

// ── Topics ────────────────────────────────────────────────────────────────────

/**
 * Every check the app and its providers contribute, with the fix beside each.
 *
 * This is the tool an agent is meant to end a task with, which is why `healthy`
 * is computed here rather than left to the caller: "3 warnings, 0 failures" is a
 * judgement, and it should be the same judgement every time.
 */
export async function doctorReport(app: Application): Promise<DoctorReport> {
  const entries = await runDoctor(app);
  const findings: DoctorFinding[] = entries.map(({ check, result }) => ({
    id: check.id,
    label: check.label,
    status: result.status,
    message: result.message,
    ...(result.fix !== undefined ? { fix: result.fix } : {}),
  }));

  const counts = {
    ok: findings.filter((f) => f.status === "ok").length,
    warn: findings.filter((f) => f.status === "warn").length,
    fail: findings.filter((f) => f.status === "fail").length,
    total: findings.length,
  };

  return { findings, counts, healthy: counts.fail === 0 };
}

/**
 * The routes the app actually registered.
 *
 * Read after boot, so routes a provider added programmatically are here
 * alongside the ones in `routes/` — which is the difference between this and
 * reading the route files.
 */
export function routeReport(): RouteReport {
  const nameByPath = new Map<string, string>();
  for (const [name, path] of Router.namedRoutes) nameByPath.set(path, name);

  const routes: RouteEntry[] = [...Router.routes.values()]
    .map((route) => {
      const name = route.name ?? nameByPath.get(route.path);
      return {
        method: route.method,
        path: route.path,
        controller: controllerLabel(route.controller.name),
        action: route.action,
        ...(name !== undefined ? { name } : {}),
        middleware: route.middleware.map((m) => m.name).filter((n) => n.length > 0),
        ...(route.domain !== undefined ? { domain: route.domain } : {}),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  return { routes, total: routes.length };
}

/**
 * Model schemas as the ORM understands them.
 *
 * `@zerotal/orm` is imported dynamically because an app is not required to have
 * one. A missing ORM is a report with a note, not a failure — the alternative is
 * a hard dependency that every API-only app pays for.
 */
export async function schemaReport(): Promise<SchemaReport> {
  let inspector: typeof import("@zerotal/orm").ModelInspector;
  try {
    ({ ModelInspector: inspector } = await import("@zerotal/orm"));
  } catch {
    return { models: [], total: 0, note: "@zerotal/orm is not installed in this app." };
  }

  const models: SchemaModel[] = inspector
    .all()
    .map((schema) => ({
      table: schema.table,
      primaryKey: schema.primaryKey,
      timestamps: schema.timestamps,
      softDeletes: schema.softDeletes,
      columns: schema.columns.map((column) => ({
        name: column.name,
        // `@column()` with no `type` means `string` — that is the documented
        // default and what `autoMigrate` generates. Reporting the raw absence
        // would tell a reader the column has no type when it has the commonest
        // one, and this is read by something about to write a migration.
        type: column.type ?? "string",
        nullable: column.nullable,
        primary: column.primary,
        unique: column.unique === true,
        indexed: column.index === true,
      })),
    }))
    .sort((a, b) => a.table.localeCompare(b.table));

  if (models.length === 0) {
    return {
      models: [],
      total: 0,
      note:
        "No models are registered. Models self-register when their file is imported, which the " +
        "`models` convention does at boot — check app/models/ exists and conventions are enabled.",
    };
  }
  return { models, total: models.length };
}

/** What this app is: runtime, environment, providers, and the packages behind them. */
export async function appInfo(app: Application): Promise<AppInfo> {
  const url = readConfig(app, "app.url");
  return {
    bun: Bun.version,
    // Two different things that both get called "environment", reported apart:
    // `_env` is the runtime mode this process booted as (console, here, since a
    // probe runs under the CLI), while `deployEnv()` is the deployment name —
    // local, staging, production. `Bun.env.APP_ENV` is not the second one: the
    // CLI overwrites it with the runtime mode before the app is imported.
    environment: String(app._env),
    appEnv: String(readConfig(app, "app.env") ?? deployEnv()),
    ...(typeof url === "string" ? { url } : {}),
    providers: (app._activeProviders ?? []).map((provider) => provider.constructor.name).sort(),
    packages: await installedPackages(),
    webSocketPaths: app.webSocketPaths(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readConfig(app: Application, key: string): unknown {
  try {
    const config = app.container.makeSync("config") as { get(k: string): unknown };
    return config.get(key);
  } catch {
    return undefined;
  }
}

/**
 * The installed `@zerotal/*` packages and their maturity.
 *
 * Read from disk rather than from a hard-coded list: the point is to report the
 * versions this app is actually running, including ones this package has never
 * heard of.
 */
export async function installedPackages(root = process.cwd()): Promise<InstalledPackage[]> {
  const { readdir } = await import("node:fs/promises");

  // Listed with `readdir`, not matched with a glob. In a workspace — this
  // monorepo, `bun link`, any app developed against a checkout — every
  // `node_modules/@zerotal/*` is a symlink to the package directory, and glob
  // traversal does not descend into one even with `followSymlinks`. It returned
  // zero packages for `apps/docs`, which has seventeen. `readdir` lists the link
  // itself and `Bun.file` follows it, so both layouts read the same.
  const candidates = [`${root}/node_modules/zerotal`];
  try {
    for (const name of await readdir(`${root}/node_modules/@zerotal`)) {
      candidates.push(`${root}/node_modules/@zerotal/${name}`);
    }
  } catch {
    /* no scoped packages installed here */
  }

  const found: InstalledPackage[] = [];
  for (const dir of candidates) {
    try {
      const manifest = (await Bun.file(`${dir}/package.json`).json()) as Record<string, unknown>;
      const name = manifest["name"];
      const version = manifest["version"];
      if (typeof name !== "string" || typeof version !== "string") continue;
      const maturity = manifest["maturity"];
      found.push({
        name,
        version,
        ...(typeof maturity === "string" ? { maturity } : {}),
      });
    } catch {
      /* an unreadable manifest is one package missing from a report, not a failure */
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** File-based route controllers are named `FileRoute<METHOD /path>` — say "file" instead. */
function controllerLabel(rawName: string): string {
  return rawName.startsWith("FileRoute<") ? "file" : rawName;
}
