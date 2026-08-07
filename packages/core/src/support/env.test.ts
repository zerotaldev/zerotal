import { describe, it, expect, afterEach } from "bun:test";
import { isProdLike, isDevSurfaceAllowed, devSurfacesEnabled, DEV_WORKER_ENV_VAR } from "./env.ts";

const env = Bun.env as Record<string, string | undefined>;
const saved = { appEnv: env["APP_ENV"], devWorker: env[DEV_WORKER_ENV_VAR] };

function setEnv(appEnv: string | undefined, devWorker: string | undefined): void {
  if (appEnv === undefined) delete env["APP_ENV"];
  else env["APP_ENV"] = appEnv;
  if (devWorker === undefined) delete env[DEV_WORKER_ENV_VAR];
  else env[DEV_WORKER_ENV_VAR] = devWorker;
}

afterEach(() => setEnv(saved.appEnv, saved.devWorker));

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
});
