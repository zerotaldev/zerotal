/**
 * The single entry point an app's `zt.ts` calls. Encapsulates the full CLI
 * boot sequence — config load + validate, runtime-env resolution, app import,
 * and command dispatch — so app entry files stay a one-liner and the
 * orchestration lives in one place.
 */
import { CommandRunner } from "./CommandRunner.ts";
import { configLoader } from "../config/ConfigLoader.ts";
import { setAppEnv } from "../helpers/index.ts";
import {
  runtimeBelowFloor,
  runtimeBelowFloorMessage,
  runtimeMismatch,
  runtimeMismatchAllowed,
  runtimeMismatchMessage,
} from "../support/runtime.ts";
import type { RuntimeMismatch } from "../support/runtime.ts";
import { RuntimeMismatchError } from "../errors/RuntimeMismatchError.ts";
import type { Application } from "../application/Application.ts";
import { _formatVersion, _versionInfo } from "./versionInfo.ts";

/** Options for {@link startZerotal}. */
export interface StartZerotalOptions {
  /** Directory to load config from, resolved against the cwd. Default: `./config`. */
  configDir?: string | undefined;
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
  // Answer `--version` before anything else can fail to.
  //
  // Ahead of the runtime assertion, the config load and the app import, because
  // those are exactly the things someone is asking the version *about*: a config
  // that no longer validates and an app that will not boot are the two moments
  // when "which version am I on" stops being idle curiosity. A version flag that
  // only works when everything else already works answers a question nobody has.
  //
  // It reports a second runtime as a line of output rather than throwing about
  // one, which is strictly more informative than the refusal it skips.
  // `--json` is honoured here and not only on the command, because this is the
  // path that produces clean output: the app's boot log goes to stdout, so
  // `zt version --json` — which dispatches normally, and therefore boots — cannot
  // be piped into a parser. This form never boots, so it can.
  const first = process.argv[2] ?? "";
  if (first === "--version" || first === "-v") {
    const info = _versionInfo();
    console.log(
      process.argv.includes("--json") ? JSON.stringify(info, null, 2) : _formatVersion(info),
    );
    return;
  }

  // Before anything else, because everything after this is an assertion about a
  // runtime — and if there are two of them, which one made the assertion is the
  // first thing worth knowing.
  assertOneRuntime();

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

/**
 * Refuse to run on a Bun the project does not agree with.
 *
 * Two disagreements, both about the same thing — which binary the assertions
 * downstream of here are assertions *about*:
 *
 * - The runtime is below the `engines.bun` the project declares. Every generated
 *   app writes that floor and nothing had ever enforced it.
 * - The project installs a different Bun in `node_modules` than the one running.
 *   Most projects do not install Bun as a package, so most never see this one.
 *
 * At the top of the entry point rather than in a check somebody remembers to run,
 * because the value is in it being unmissable: the failure both prevent is a suite
 * that passes about the wrong binary, and nothing downstream of here can notice that.
 *
 * @throws When either check fails, unless `ZT_ALLOW_RUNTIME_MISMATCH` is set, which
 *   downgrades it to a warning on stderr.
 * @internal
 */
function assertOneRuntime(): void {
  const floor = runtimeBelowFloor();
  if (floor) {
    _refuse(runtimeBelowFloorMessage(floor), {
      running: floor.running,
      installed: floor.required,
      manifest: floor.manifest,
    });
  }

  const mismatch = runtimeMismatch();
  if (!mismatch) return;

  // A runtime the project never asked for is a warning, not a refusal. It arrives
  // as a transitive peer — `bun-plugin-tailwind` declares `bun` as a required peer
  // and Bun auto-installs it — and nothing executes the stray copy, so "two
  // runtimes in play" is not what is happening. Refusing over it crash-looped an
  // app behind a 502 twice, and the remedies the refusal prints are the wrong ones
  // for this cause. Loud, because the version skew is still real if anything ever
  // *does* run it.
  if (mismatch.chosen === false) {
    console.warn(`
⚠  ${runtimeMismatchMessage(mismatch)}
`);
    return;
  }

  _refuse(runtimeMismatchMessage(mismatch), mismatch);
}

/**
 * Stop, or warn and continue when the escape hatch is set.
 *
 * @param message - The full explanation, already formatted.
 * @param mismatch - The two versions, carried on the error for a harness to read.
 */
function _refuse(message: string, mismatch: RuntimeMismatch): void {
  if (runtimeMismatchAllowed()) {
    console.warn(`\n⚠  ${message}\n`);
    return;
  }
  throw new RuntimeMismatchError(message, mismatch);
}
