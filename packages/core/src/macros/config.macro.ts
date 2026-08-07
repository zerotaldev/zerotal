/**
 * A Bun build-time macro that bakes a config directory into a static object,
 * for embedding configuration into a compiled binary (`bun build --compile`).
 */
import { join } from "node:path";

/**
 * Bun macro — scan a config directory and return all configs as a static object.
 *
 * ⚠️  USE ONLY WITH `bun build --compile`.
 * This macro is evaluated at bundle time and is primarily intended for baking
 * config values into a self-contained binary. Do NOT use it in zt.ts for
 * development or test workflows — it fails on Windows when the argument
 * contains a runtime expression like `${process.cwd()}`.
 *
 * For development (and for all apps not compiled to a binary), import configs
 * directly instead:
 *
 * ```ts
 * // zt.ts — preferred approach (works everywhere)
 * import appConfig      from './config/app.ts';
 * import databaseConfig from './config/database.ts';
 * app.useConfig({ app: appConfig, database: databaseConfig, ... });
 * ```
 *
 * For compiled binaries only:
 *
 * ```ts
 * import { loadConfigsSync } from '@zerotal/core/macros/config' with { type: 'macro' };
 * const configs = loadConfigsSync('/absolute/path/to/config');
 * app.useConfig(configs);
 * ```
 *
 * Note: config files that read `Bun.env` capture their values from the
 * environment at macro-evaluation time. For bun build --compile this is the
 * CI/CD environment — the same intended behaviour as any immutable artifact.
 */
export function loadConfigsSync(configDir: string): Record<string, Record<string, unknown>> {
  const glob = new Bun.Glob("*.ts");
  const result: Record<string, Record<string, unknown>> = {};

  for (const file of glob.scanSync({ cwd: configDir })) {
    if (file === "index.ts") continue;
    const key = file.replace(/\.ts$/, "");
    const loadedModule = require(join(configDir, file)) as Record<string, unknown>;
    result[key] = (loadedModule["default"] ?? loadedModule) as Record<string, unknown>;
  }

  return result;
}
