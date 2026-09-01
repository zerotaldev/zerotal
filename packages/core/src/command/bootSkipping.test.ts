/**
 * A command that says it does not need the application should not boot one.
 *
 * `CommandRunner.boot()` used to boot unconditionally, so `zt version`,
 * `key:generate`, every `make:*` scaffolder and the gate commands all paid for
 * providers, a database connection and a schedule registry they never touch —
 * and could not run at all when booting was the thing that was broken. A CLI you
 * cannot reach when the app is down is missing exactly when it is wanted.
 *
 * Config is bound either way, because `needsApp = false` is a claim about the
 * *application* and not about configuration: every scaffolder reads config for
 * its output paths.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { Application } from "../application/Application.ts";
import { CommandRunner } from "./CommandRunner.ts";

beforeEach(() => Application._resetInstance());

/** An app that records whether anything booted it. */
function trackedApp(): { app: Application; booted: () => boolean } {
  const app = Application.create({ env: "console" });
  let booted = false;
  const original = app.boot.bind(app);
  app.boot = async () => {
    booted = true;
    return original();
  };
  return { app, booted: () => booted };
}

describe("CommandRunner.boot()", () => {
  it("does not boot the app for a command that declares needsApp = false", async () => {
    const { app, booted } = trackedApp();
    await new CommandRunner(app).boot("version");
    expect(booted()).toBe(false);
  });

  it("does not boot for a scaffolder either", async () => {
    // Registered inside the env gate, so this only holds because the decision
    // happens after every pure `register()` call. Deciding earlier would leave
    // `make:*` unrecognised, and an unrecognised name boots.
    const { app, booted } = trackedApp();
    await new CommandRunner(app).boot("make:controller");
    expect(booted()).toBe(false);
  });

  it("binds config even when it skips the boot", async () => {
    // "Does not need the app" and "does not need config" are different claims,
    // and only the first is true of a scaffolder writing to a configured path.
    const { app } = trackedApp();
    app.useConfig({ app: { name: "probe" } } as never);
    await new CommandRunner(app).boot("version");

    const config = app.container.tryMake("config");
    expect(config).toBeDefined();
    expect(config?.get("app.name", "<missing>")).toBe("probe");
  });

  it("boots for a command that needs the app", async () => {
    const { app, booted } = trackedApp();
    await new CommandRunner(app).boot("route:list");
    expect(booted()).toBe(true);
  });

  it("boots for a name it does not recognise", async () => {
    // It may be an app command from `app/commands/`, which is discovered during
    // the boot being decided about. Booting is the safe answer: the cost is the
    // one this change avoids, while not booting when needed is a broken command.
    const { app, booted } = trackedApp();
    await new CommandRunner(app).boot("something:unknown");
    expect(booted()).toBe(true);
  });

  it("boots when given no command at all", async () => {
    // `zt list` and `zt help` arrive this way and want the full registry.
    const { app, booted } = trackedApp();
    await new CommandRunner(app).boot();
    expect(booted()).toBe(true);
  });
});
