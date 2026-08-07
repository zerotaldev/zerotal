/**
 * The single entry point an app's `zt.ts` calls. Encapsulates the full CLI
 * boot sequence — config load + validate, runtime-env resolution, app import,
 * and command dispatch — so app entry files stay a one-liner and the
 * orchestration lives in one place.
 */
import { CommandRunner } from "./CommandRunner.ts";
import { configLoader } from "../config/ConfigLoader.ts";
import { setAppEnv } from "../helpers/index.ts";
import type { Application } from "../application/Application.ts";

/** Options for {@link startZerotal}. */
export interface StartZerotalOptions {
  /** Directory to load config from, resolved against the cwd. Default: `./config`. */
  configDir?: string;
}

/**
 * Boot and run the Zerotal CLI for an app.
 *
 * `loadApp` must **dynamically import** the app's bootstrap module
 * (e.g. `() => import("./bootstrap/app")`). Passing a thunk rather than the app
 * itself is deliberate and load-bearing:
 *  - it guarantees `APP_ENV` is set (from the command) *before* the app module
 *    evaluates, since ES imports are hoisted; and
 *  - the literal `import("./bootstrap/app")` stays statically analysable, so
 *    `bun build --compile` bundles the app into the production binary.
 *
 * @example
 * // zt.ts
 * import { startZerotal } from "@zerotal/core";
 * await startZerotal(() => import("./bootstrap/app"));
 */
export async function startZerotal(
  loadApp: () => Promise<{ default: Application }>,
  options: StartZerotalOptions = {},
): Promise<void> {
  // Load + validate config synchronously — safe before the app boots.
  const config = configLoader(options.configDir ?? "./config");
  config.validate();

  // Resolve the runtime boot mode (web / worker / console) from the command
  // BEFORE importing the app module, which reads APP_ENV at evaluation time.
  const command = process.argv[2] ?? "";
  setAppEnv(command);

  // Import the app now that APP_ENV is locked in, then inject the loaded config.
  // (Job classes self-register during boot via the `jobs` convention concern.)
  const { default: app } = await loadApp();
  app.useConfig(config.all());

  const runner = new CommandRunner(app);
  await runner.boot();
  await runner.run(process.argv.slice(2));
}
