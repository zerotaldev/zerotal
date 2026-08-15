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

describe("deploy preflight", () => {
  beforeEach(() => {
    (Bun.env as Record<string, string>)[DEPLOY_ENV_VAR] = "staging";
  });

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
    (Bun.env as Record<string, string>)["APP_ENV"] = "console";
    const { command } = build(
      "staging",
      { "dry-run": true },
      { container: { makeSync: () => undefined } },
    );
    await expect(command.run()).resolves.toBeUndefined();
  });
});

describe("deploy --dry-run", () => {
  beforeEach(() => {
    (Bun.env as Record<string, string>)[DEPLOY_ENV_VAR] = "production";
  });

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
