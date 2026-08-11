/**
 * `zt doctor` — static sanity checks against a booted app.
 *
 * Most of the expensive failures in a Zerotal app are silent: a provider that
 * isn't registered fails by doing nothing, `synchronize` and migrations collide
 * on the first command a new user types, a routes file 404s because nothing
 * loads it. Each is statically detectable, and the individual warnings already
 * exist at various points of the boot sequence — this runs them all in one
 * place, on demand, with the fix next to each finding.
 *
 * Packages contribute their own checks via `app.registerDoctorCheck()` (the
 * scheduler's static-config check is the model); the built-ins cover core.
 */
import { readdirSync } from "node:fs";
import type { Application } from "../application/Application.ts";
import { appKeyStrengthWarning } from "../support/appKey.ts";
import { unroutedRoutesWarning } from "../support/unroutedRoutes.ts";

/** One finding: ok is silent health, warn is worth reading, fail is broken now. */
export interface DoctorCheckResult {
  status: "ok" | "warn" | "fail";
  message: string;
  /** The command or edit that resolves it, shown under the finding. */
  fix?: string;
}

/** A named check. Contribute app-specific ones via `app.registerDoctorCheck()`. */
export interface DoctorCheck {
  /** Stable kebab-case id (e.g. `"app-key"`). */
  id: string;
  /** Human label printed next to the finding. */
  label: string;
  run(app: Application): DoctorCheckResult | Promise<DoctorCheckResult>;
}

/** A check paired with what it found. */
export interface DoctorReportEntry {
  check: DoctorCheck;
  result: DoctorCheckResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _config(app: Application, key: string): unknown {
  try {
    const config = app.container.makeSync("config") as { get(k: string): unknown };
    return config.get(key);
  } catch {
    return undefined;
  }
}

/** Non-test source files directly inside `<root>/<dir>`, or [] when absent. */
function _sourceFiles(root: string, dir: string): string[] {
  try {
    return readdirSync(`${root}/${dir}`).filter(
      (f) => /\.(ts|js)$/.test(f) && !/\.test\.(ts|js)$/.test(f),
    );
  } catch {
    return [];
  }
}

const ok = (message: string): DoctorCheckResult => ({ status: "ok", message });
const warn = (message: string, fix?: string): DoctorCheckResult => ({
  status: "warn",
  message,
  ...(fix !== undefined ? { fix } : {}),
});
const fail = (message: string, fix?: string): DoctorCheckResult => ({
  status: "fail",
  message,
  ...(fix !== undefined ? { fix } : {}),
});

// ── Built-in checks ───────────────────────────────────────────────────────────

const appKeyCheck: DoctorCheck = {
  id: "app-key",
  label: "APP_KEY",
  run() {
    const key = Bun.env["APP_KEY"];
    if (!key) {
      return warn(
        "APP_KEY is not set. Sessions, signed URLs and encrypted columns all derive from it; " +
          "a production-like APP_ENV refuses to boot without a strong one.",
        "bun zt key:generate",
      );
    }
    const weakness = appKeyStrengthWarning(key);
    return weakness ? fail(weakness, "bun zt key:generate") : ok("set and strong");
  },
};

const syncVsMigrationsCheck: DoctorCheck = {
  id: "synchronize-vs-migrations",
  label: "Schema source of truth",
  run(app) {
    const synchronize = _config(app, "database.synchronize") === true;
    const migrations = _sourceFiles(process.cwd(), "database/migrations");
    if (synchronize && migrations.length > 0) {
      return fail(
        `database.synchronize is on and ${migrations.length} migration(s) exist. Boot-time ` +
          `sync creates tables from the models first, so the first \`migrate\` fails with ` +
          `"table already exists". The schema needs exactly one source of truth.`,
        "Set synchronize: false in config/database.ts (migrations become the source of truth).",
      );
    }
    if (synchronize) return ok("synchronize (no migrations present)");
    return ok(migrations.length > 0 ? "migrations" : "no schema management configured");
  },
};

const unroutedRoutesCheck: DoctorCheck = {
  id: "unrouted-routes",
  label: "routes/ directory",
  run(app) {
    const warning = unroutedRoutesWarning(process.cwd(), app.routedFiles);
    return warning ? warn(warning) : ok("absent or routed");
  },
};

/** A directory-full-of-classes whose consuming provider isn't registered does nothing. */
function _providerDirCheck(options: {
  id: string;
  label: string;
  dir: (app: Application) => string;
  binding: string;
  provider: string;
}): DoctorCheck {
  return {
    id: options.id,
    label: options.label,
    run(app) {
      const dir = options.dir(app);
      const files = _sourceFiles(process.cwd(), dir);
      if (files.length === 0) return ok(`no ${dir}/`);
      if (app.container.bound(options.binding as never)) {
        return ok(`${files.length} file(s), provider registered`);
      }
      return warn(
        `${dir}/ holds ${files.join(", ")} but ${options.provider} is not registered — ` +
          `nothing in it will run, and nothing will say so.`,
        `Add ${options.provider} to bootstrap/providers.ts.`,
      );
    },
  };
}

function _conventionPath(app: Application, key: string, fallback: string): string {
  const paths = _config(app, "app.conventions.paths") as Record<string, string> | undefined;
  return paths?.[key] ?? fallback;
}

const schedulesProviderCheck = _providerDirCheck({
  id: "schedules-provider",
  label: "app/schedules",
  dir: (app) => _conventionPath(app, "schedules", "app/schedules"),
  binding: "scheduler",
  provider: "SchedulerProvider",
});

const jobsProviderCheck = _providerDirCheck({
  id: "jobs-provider",
  label: "app/jobs",
  dir: (app) => _conventionPath(app, "jobs", "app/jobs"),
  binding: "queue",
  provider: "QueueProvider",
});

const storageProviderCheck: DoctorCheck = {
  id: "storage-provider",
  label: "Storage",
  async run(app) {
    const hasConfig = await Bun.file(`${process.cwd()}/config/storage.ts`).exists();
    if (!hasConfig) return ok("no config/storage.ts");
    if (app.container.bound("storage" as never)) return ok("configured and registered");
    return warn(
      "config/storage.ts exists but StorageProvider is not registered — the first " +
        "Storage.disk(...) call will throw, typically behind auth checks on an upload path.",
      "Add StorageProvider to bootstrap/providers.ts.",
    );
  },
};

/** The core checks every app gets. */
export const builtinDoctorChecks: DoctorCheck[] = [
  appKeyCheck,
  syncVsMigrationsCheck,
  unroutedRoutesCheck,
  schedulesProviderCheck,
  jobsProviderCheck,
  storageProviderCheck,
];

/**
 * Run the built-in checks plus everything providers contributed. A check that
 * throws is reported as a failure of that check, never of the doctor.
 */
export async function runDoctor(
  app: Application,
  extraChecks: DoctorCheck[] = [],
): Promise<DoctorReportEntry[]> {
  const checks = [...builtinDoctorChecks, ...app.doctorChecks, ...extraChecks];
  const report: DoctorReportEntry[] = [];
  for (const check of checks) {
    let result: DoctorCheckResult;
    try {
      result = await check.run(app);
    } catch (err) {
      result = fail(`check threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    report.push({ check, result });
  }
  return report;
}
