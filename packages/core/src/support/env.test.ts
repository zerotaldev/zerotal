import { describe, it, expect, afterEach } from "bun:test";
import {
  isProdLike,
  isDevSurfaceAllowed,
  devSurfacesEnabled,
  deployEnv,
  DEV_WORKER_ENV_VAR,
  DEPLOY_ENV_VAR,
  RUNTIME_MODE_VAR,
} from "./env.ts";
import { setAppEnv } from "../helpers/index.ts";

const env = Bun.env as Record<string, string | undefined>;
const saved = {
  appEnv: env["APP_ENV"],
  devWorker: env[DEV_WORKER_ENV_VAR],
  deployEnv: env[DEPLOY_ENV_VAR],
  runtimeMode: env[RUNTIME_MODE_VAR],
};

/**
 * Pin the whole env surface these predicates read — including {@link DEPLOY_ENV_VAR},
 * which `setAppEnv()` writes. Leaving it out let a value set by another test file
 * leak in and decide the answer, because `devSurfacesEnabled()` prefers it.
 *
 * {@link RUNTIME_MODE_VAR} is cleared for the same reason, one layer up: `setAppEnv()`
 * treats an existing value as an explicit choice and leaves it alone, so a stray one
 * makes the calls below no-ops. `createTestApp()` sets it to `"test"` for the lifetime
 * of the process — correct for a real suite, and enough to make these assertions read
 * whatever ran before them in a whole-repo sweep.
 */
function setEnv(
  appEnv: string | undefined,
  devWorker: string | undefined,
  deploy?: string | undefined,
): void {
  if (appEnv === undefined) delete env["APP_ENV"];
  else env["APP_ENV"] = appEnv;
  if (devWorker === undefined) delete env[DEV_WORKER_ENV_VAR];
  else env[DEV_WORKER_ENV_VAR] = devWorker;
  if (deploy === undefined) delete env[DEPLOY_ENV_VAR];
  else env[DEPLOY_ENV_VAR] = deploy;
  delete env[RUNTIME_MODE_VAR];
}

afterEach(() => {
  setEnv(saved.appEnv, saved.devWorker, saved.deployEnv);
  if (saved.runtimeMode === undefined) delete env[RUNTIME_MODE_VAR];
  else env[RUNTIME_MODE_VAR] = saved.runtimeMode;
});

describe("isProdLike()", () => {
  it("accepts the production-like names, case-insensitively", () => {
    for (const name of ["production", "PROD", "Staging"]) expect(isProdLike(name)).toBe(true);
  });

  it("rejects dev names and an unset value", () => {
    for (const name of ["development", "local", "web", ""]) expect(isProdLike(name)).toBe(false);
  });
});

describe("isDevSurfaceAllowed()", () => {
  it("accepts only explicitly non-production names", () => {
    for (const name of ["development", "dev", "local", "test", "testing"]) {
      expect(isDevSurfaceAllowed(name)).toBe(true);
    }
  });

  it("fails closed on an unset, unknown, or runtime-mode value", () => {
    // `web` matters: setAppEnv() overwrites APP_ENV with the runtime mode for
    // every `serve`, so this is what the variable actually holds in a server.
    for (const name of ["", "web", "worker", "console", "staging"]) {
      expect(isDevSurfaceAllowed(name)).toBe(false);
    }
  });
});

describe("devSurfacesEnabled()", () => {
  it("is true in the serve --dev worker, whose APP_ENV is the runtime mode", () => {
    // The failure this guards: `serve --dev` renders bare 500s with no stack,
    // because APP_ENV says "web" and carries no trace of the deployment name.
    setEnv("web", "1");
    expect(devSurfacesEnabled()).toBe(true);
  });

  it("is true for an explicitly non-production APP_ENV with no dev worker", () => {
    setEnv("development", undefined);
    expect(devSurfacesEnabled()).toBe(true);
  });

  it("is false for a plain production serve", () => {
    setEnv("web", undefined);
    expect(devSurfacesEnabled()).toBe(false);
  });

  it("fails closed when nothing is set", () => {
    setEnv(undefined, undefined);
    expect(devSurfacesEnabled()).toBe(false);
  });

  it('ignores a dev-worker flag that is not exactly "1"', () => {
    setEnv("production", "true");
    expect(devSurfacesEnabled()).toBe(false);
  });

  it("leaves APP_ENV alone across setAppEnv(), so the deployment name is readable", () => {
    // The bug this exists for, in two parts. First: a scaffolded app with
    // APP_ENV=development ran `zt serve`, setAppEnv() rewrote APP_ENV to "web",
    // and every dev surface read that and switched itself off. That was patched
    // by preserving a copy. Second, and why the variable is now split: the copy
    // was only reachable through deployEnv(), so `env("APP_ENV")` in a seeder
    // still returned the mode.
    setEnv("development", undefined);
    setAppEnv("serve");
    expect(env["APP_ENV"]).toBe("development");
    expect(env["APP_TYPE"]).toBe("web");
    expect(deployEnv()).toBe("development");
    expect(devSurfacesEnabled()).toBe(true);
  });

  it("still fails closed once setAppEnv() has run on a production deploy", () => {
    setEnv("production", undefined);
    setAppEnv("serve");
    expect(deployEnv()).toBe("production");
    expect(devSurfacesEnabled()).toBe(false);
  });
});
