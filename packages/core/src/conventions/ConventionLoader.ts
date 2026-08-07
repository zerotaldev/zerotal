/**
 * Convention-based auto-registration: at boot it scans well-known `app/*`
 * directories, imports each file, and lets a "concern descriptor" register the
 * relevant exports (models, observers, listeners, …). Packages contribute
 * descriptors via `app.registerConcern(...)`, so core depends on neither orm nor auth.
 */

// Dev/test glob the filesystem; production can ship a generated manifest (see
// `manifest` in config) to avoid runtime scanning — same idea as the jobs barrel.

import type { Application } from "../application/Application.ts";
import type { AppEnvironment } from "../provider/ServiceProvider.ts";
import { frameworkLog } from "../logger/frameworkLog.ts";

/** The context a concern receives while registering discovered modules. */
export interface ConcernContext {
  app: Application;
  env: AppEnvironment;
  /** Resolve a container binding synchronously, or undefined if not bound. */
  resolve<T = unknown>(token: string): T | undefined;
}

/** Describes one auto-registration concern: where to scan and how to register what it finds. */
export interface ConcernDescriptor {
  /** Identifier, e.g. "models". Used as the config key for path overrides. */
  name: string;
  /** Lower runs first (models=10, observers=20, policies=30, listeners=40, …). */
  order: number;
  /** App-relative directory to scan, e.g. "app/models". Omit for one-shot concerns. */
  dir?: string;
  /** Environments this concern runs in. Default: all. */
  envs?: AppEnvironment[];
  /** Register the relevant exports from one discovered module. */
  register?(exports: Record<string, unknown>, ctx: ConcernContext): void | Promise<void>;
  /** One-shot hook run once after this concern's files (or instead of scanning). */
  run?(ctx: ConcernContext): void | Promise<void>;
}

/** Options controlling a single {@link runConventions} pass. */
export interface RunConventionsOptions {
  root: string;
  env: AppEnvironment;
  /** Per-concern directory overrides (config `discovery.paths`). */
  paths?: Record<string, string>;
  ctx: ConcernContext;
}

function _shouldSkip(relativePath: string): boolean {
  const file = relativePath.split("/").at(-1) ?? "";
  return (
    file.startsWith("_") ||
    file.endsWith(".test.ts") ||
    file.endsWith(".test.tsx") ||
    file.endsWith(".spec.ts") ||
    file.endsWith(".d.ts")
  );
}

async function _scanDir(absoluteDirectory: string): Promise<string[]> {
  // glob.scan yields nothing for a missing directory; the try/catch is belt-and-suspenders.
  try {
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    return await Array.fromAsync(glob.scan({ cwd: absoluteDirectory, onlyFiles: true }));
  } catch {
    return [];
  }
}

/**
 * Scan a directory, import each non-skipped file, and hand the module to `onModule`. Shared by the
 * concern loop and by the early provider/middleware discovery in Application. Import/handler
 * errors are logged and skipped so one bad file can't abort boot.
 */
export async function importConventionModules(
  absoluteDirectory: string,
  label: string,
  onModule: (module: Record<string, unknown>, file: string) => void | Promise<void>,
): Promise<void> {
  for (const file of await _scanDir(absoluteDirectory)) {
    if (_shouldSkip(file)) continue;
    try {
      const loadedModule = (await import(`${absoluteDirectory}/${file}`)) as Record<
        string,
        unknown
      >;
      await onModule(loadedModule, file);
    } catch (error) {
      frameworkLog("app").error(`${label} discovery failed for ${file}`, { file }, error);
    }
  }
}

/**
 * Run all concern descriptors in `order`. For each concern with a `dir`, scan + import each
 * file and call `register(module)`. For each concern with `run`, call it once afterward.
 * Import/registration errors are logged and skipped so one bad file can't abort boot.
 */
export async function runConventions(
  concerns: ConcernDescriptor[],
  options: RunConventionsOptions,
): Promise<void> {
  const orderedConcerns = [...concerns].sort((first, second) => first.order - second.order);
  for (const concern of orderedConcerns) {
    if (concern.envs && !concern.envs.includes(options.env)) continue;

    if (concern.dir && concern.register) {
      const relativeDirectory = options.paths?.[concern.name] ?? concern.dir;
      const register = concern.register;
      await importConventionModules(
        `${options.root}/${relativeDirectory}`,
        `convention "${concern.name}"`,
        (loadedModule) => register(loadedModule, options.ctx),
      );
    }

    if (concern.run) {
      try {
        await concern.run(options.ctx);
      } catch (error) {
        frameworkLog("app").error(
          `Convention "${concern.name}" run hook failed`,
          { convention: concern.name },
          error,
        );
      }
    }
  }
}
