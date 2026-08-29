/**
 * The deploy pipeline's contract is an ORDER, so that is what these test: that
 * nothing mutating runs until everything that can refuse has passed, and that a
 * failure stops the release rather than reporting it and carrying on.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { makeDeployCommand, DeployCommand } from "./DeployCommand.ts";
import { BufferWriter } from "../OutputWriter.ts";
import { DEPLOY_ENV_VAR } from "../../support/env.ts";

/** A command instance wired to a buffer, with the app and flags a run needs. */
function build(target: string, flags: Record<string, unknown> = {}, app?: unknown) {
  const Cmd = makeDeployCommand(target);
  const command = new Cmd();
  const writer = new BufferWriter();
  (command as unknown as { _writer: BufferWriter })._writer = writer;
  (command as unknown as { flags: Record<string, unknown> }).flags = {
    "dry-run": false,
    "skip-migrations": false,
    ...flags,
  };
  (command as unknown as { app: unknown }).app = app;
  return { command, writer };
}

const originalDeployEnv = Bun.env[DEPLOY_ENV_VAR];
const originalAppEnv = Bun.env["APP_ENV"];

afterEach(() => {
  const environment = Bun.env as Record<string, string | undefined>;
  environment[DEPLOY_ENV_VAR] = originalDeployEnv;
  environment["APP_ENV"] = originalAppEnv;
});

describe("makeDeployCommand", () => {
  it("names the command after the target", () => {
    expect(makeDeployCommand("production").commandName).toBe("deploy:production");
    expect(makeDeployCommand("staging").commandName).toBe("deploy:staging");
  });

  it("carries the target, and needs a booted app", () => {
    const Cmd = makeDeployCommand("staging");
    expect(Cmd.target).toBe("staging");
    // The pipeline reads config, the doctor and the WebSocket paths off the app —
    // registering it as `needsApp: false` would be a lie the runner acts on.
    expect(Cmd.needsApp).toBe(true);
  });

  it("produces a concrete class, unlike its abstract base", () => {
    const Cmd = makeDeployCommand("production");
    expect(() => new Cmd()).not.toThrow();
    expect(new Cmd()).toBeInstanceOf(DeployCommand);
  });
});

/**
 * What a real `zt deploy:<env>` run looks like to the process: `setAppEnv()` has put
 * the runtime mode in `APP_ENV`, and the deployment name survives only in the
 * preserved copy. Both have to be pinned — `deployEnv()` prefers `APP_ENV` while it
 * still holds a deployment name, so leaving it to whatever the test runner set makes
 * the result depend on which file ran first.
 */
function asDeployment(name: string): void {
  const environment = Bun.env as Record<string, string>;
  environment["APP_ENV"] = "console";
  environment[DEPLOY_ENV_VAR] = name;
}

describe("deploy preflight", () => {
  beforeEach(() => asDeployment("staging"));

  it("refuses when the process is not the environment being deployed", async () => {
    // The failure this exists for: running the production pipeline on a staging box
    // and migrating the wrong database.
    const { command } = build("production", {}, { container: { makeSync: () => undefined } });
    await expect(command.run()).rejects.toThrow(/started as staging, not production/);
  });

  it("names the fix in the refusal", async () => {
    const { command } = build("production", {}, { container: { makeSync: () => undefined } });
    await expect(command.run()).rejects.toThrow(/APP_ENV=production/);
  });

  it("reads the deployment name, not the runtime mode APP_ENV was overwritten with", async () => {
    // `setAppEnv()` leaves APP_ENV as "console" for any CLI command. A pipeline that
    // trusted it would compare "console" against "staging" and refuse every deploy.
    // `asDeployment` in beforeEach already put it there; this asserts the consequence.
    expect(Bun.env["APP_ENV"]).toBe("console");
    const { command } = build(
      "staging",
      { "dry-run": true },
      { container: { makeSync: () => undefined } },
    );
    await expect(command.run()).resolves.toBeUndefined();
  });
});

describe("deploy --dry-run", () => {
  beforeEach(() => asDeployment("production"));

  it("runs no steps and says so", async () => {
    const { command, writer } = build(
      "production",
      { "dry-run": true },
      { container: { makeSync: () => undefined } },
    );
    await command.run();
    const output = writer.flush();
    expect(output).toContain("Dry run");
    // The honest caveat: getting this far booted the app.
    expect(output).toContain("booted");
  });

  it("marks migrate as skipped when --skip-migrations is set", async () => {
    const runner = {
      has: (n: string) => n === "migrate",
      callInProcess: async () => ({ code: 0, output: "" }),
    };
    const app = {
      container: { makeSync: (k: string) => (k === "commands" ? runner : undefined) },
    };
    const { command, writer } = build(
      "production",
      { "dry-run": true, "skip-migrations": true },
      app,
    );
    await command.run();
    expect(writer.flush()).toContain("--skip-migrations");
  });
});

/**
 * The app's own gate. The framework can tell you the APP_KEY is the one from
 * `.env.example`; it cannot tell you this workspace has no banking details. That
 * refusal is the app's, and before there was a slot for it, it lived in a command
 * nobody was obliged to run — which is a comment, not a gate.
 */
describe("deploy preflight — the app's own commands", () => {
  // These run the framework's real preflight before reaching the app's, so APP_KEY has to
  // be strong here or the doctor refuses first — and whether it is depends on which test
  // file ran before this one.
  const originalKey = Bun.env["APP_KEY"];

  beforeEach(() => {
    asDeployment("production");
    Bun.env["APP_KEY"] = "base64:" + Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    if (originalKey === undefined)
      delete (Bun.env as Record<string, string | undefined>)["APP_KEY"];
    else Bun.env["APP_KEY"] = originalKey;
  });

  /** A container whose command registry knows `names` and records what it ran. */
  function appWith(names: string[], target: Record<string, unknown> = {}, failing?: string) {
    const ran: string[] = [];
    const runner = {
      has: (n: string) => names.includes(n),
      callInProcess: async (argv: string[]) => {
        ran.push(argv[0]!);
        return argv[0] === failing
          ? { code: 1, output: "no cancellation policy on this workspace" }
          : { code: 0, output: "" };
      },
    };
    // Enough config to get past the framework's own preflight, which runs first and
    // is not what these tests are about.
    const config = {
      get: (key: string, fallback?: unknown) => {
        if (key === "deploy.targets.production") return target;
        if (key === "app.allowedOrigins") return ["https://example.test"];
        return fallback;
      },
    };
    return {
      ran,
      app: {
        // The pipeline runs the real preflight before it reaches any of this, so the
        // stub has to carry what the config validators and the doctor read.
        _configValidators: [],
        _activeProviders: [],
        doctorChecks: [],
        webSocketPaths: () => [],
        container: {
          makeSync: (k: string) =>
            k === "commands" ? runner : k === "config" ? config : undefined,
        },
      },
    };
  }

  it("runs a conventionally-named release:check without being asked to", async () => {
    const { app, ran } = appWith(["release:check"]);
    const { command, writer } = build("production", { "dry-run": true }, app);
    await command.run();
    expect(writer.flush()).toContain("release:check");
    expect(ran).toEqual([]); // --dry-run plans, it does not run
  });

  it("has nothing to run when the app defines no gate", async () => {
    const { app } = appWith(["migrate"]);
    const { command, writer } = build("production", { "dry-run": true }, app);
    await command.run();
    expect(writer.flush()).not.toContain("release:check");
  });

  it("runs declared preflight commands in order, before any step", async () => {
    const { app, ran } = appWith(["release:check", "assets:verify", "migrate"], {
      preflight: ["release:check", "assets:verify"],
      steps: ["migrate"],
    });
    const { command } = build("production", {}, app);
    await command.run();
    expect(ran).toEqual(["release:check", "assets:verify", "migrate"]);
  });

  it("stops the release when a preflight command refuses, before anything mutates", async () => {
    const { app, ran } = appWith(
      ["release:check", "migrate"],
      { preflight: ["release:check"], steps: ["migrate"] },
      "release:check",
    );
    const { command } = build("production", {}, app);
    await expect(command.run()).rejects.toThrow(/release:check refused this release/);
    // The whole point of the ordering: `migrate` never ran.
    expect(ran).toEqual(["release:check"]);
  });

  it("reports what the refusing command printed", async () => {
    const { app } = appWith(["release:check"], { preflight: ["release:check"] }, "release:check");
    const { command, writer } = build("production", {}, app);
    await expect(command.run()).rejects.toThrow();
    expect(writer.flush()).toContain("no cancellation policy");
  });

  it("refuses a declared preflight command that is not registered", async () => {
    // The opposite of how `steps` treats an absent command, and deliberately so —
    // a missing gate means the gate is not running, which is the state this exists
    // to make impossible.
    const { app } = appWith(["migrate"], { preflight: ["release:check"] });
    const { command } = build("production", {}, app);
    await expect(command.run()).rejects.toThrow(/not registered: release:check/);
  });

  it("takes an explicit empty list as 'this target has no gate'", async () => {
    const { app, ran } = appWith(["release:check", "migrate"], {
      preflight: [],
      steps: ["migrate"],
    });
    const { command } = build("production", {}, app);
    await command.run();
    expect(ran).toEqual(["migrate"]);
  });
});

/**
 * `--check` is the gate on its own — the moment in a release script where the new
 * code is on disk and the service has not restarted yet. Exit 0 and restart; exit 1
 * and keep serving the previous release, so a workspace that has lost its banking
 * details or had its mail driver knocked back to `log` never goes live broken.
 *
 * Everything that can refuse has already run by the end of preflight, and none of it
 * mutates, so stopping there is a complete answer rather than half a deploy.
 */
describe("deploy --check", () => {
  const originalKey = Bun.env["APP_KEY"];

  beforeEach(() => {
    asDeployment("production");
    Bun.env["APP_KEY"] = "base64:" + Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    if (originalKey === undefined)
      delete (Bun.env as Record<string, string | undefined>)["APP_KEY"];
    else Bun.env["APP_KEY"] = originalKey;
  });

  /** A container whose registry knows `names` and records everything it ran. */
  function appWith(names: string[], target: Record<string, unknown> = {}, failing?: string) {
    const ran: string[] = [];
    const runner = {
      has: (n: string) => names.includes(n),
      callInProcess: async (argv: string[]) => {
        ran.push(argv[0]!);
        return argv[0] === failing ? { code: 1, output: "the gate said no" } : { code: 0, output: "" };
      },
    };
    const config = {
      get: (key: string, fallback?: unknown) => {
        if (key === "deploy.targets.production") return target;
        if (key === "app.allowedOrigins") return ["https://example.test"];
        return fallback;
      },
    };
    return {
      ran,
      app: {
        _configValidators: [],
        _activeProviders: [],
        doctorChecks: [],
        webSocketPaths: () => [],
        container: {
          makeSync: (k: string) =>
            k === "commands" ? runner : k === "config" ? config : undefined,
        },
      },
    };
  }

  it("runs the app's gate and nothing that mutates", async () => {
    const { app, ran } = appWith(["release:check", "migrate", "assets:build"], {
      preflight: ["release:check"],
      steps: ["migrate", "assets:build"],
    });
    const { command } = build("production", { check: true }, app);

    await command.run();

    // The gate ran; the steps did not. That distinction is the whole feature.
    expect(ran).toEqual(["release:check"]);
  });

  it("says plainly that nothing was changed", async () => {
    const { app } = appWith(["release:check"], { preflight: ["release:check"] });
    const { command, writer } = build("production", { check: true }, app);

    await command.run();

    expect(writer.flush()).toContain("Nothing was built, migrated or restarted");
  });

  it("fails when the app's gate refuses, so the caller can keep the old release up", async () => {
    const { app, ran } = appWith(
      ["release:check", "migrate"],
      { preflight: ["release:check"], steps: ["migrate"] },
      "release:check",
    );
    const { command } = build("production", { check: true }, app);

    await expect(command.run()).rejects.toThrow(/release:check refused/);
    expect(ran).toEqual(["release:check"]);
  });

  it("refuses on the wrong machine, before it reads anything else", async () => {
    asDeployment("staging");
    const { app } = appWith(["release:check"]);
    const { command } = build("production", { check: true }, app);

    await expect(command.run()).rejects.toThrow(/started as staging, not production/);
  });
});
