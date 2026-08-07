import { describe, it, expect } from "bun:test";
import { Application } from "@zerotal/core";
import { CommandRunner } from "@zerotal/core";
import { DatabaseProvider } from "../provider/DatabaseProvider.ts";

describe("DatabaseProvider — command registration", () => {
  it("registers ORM commands when CommandRunner is in container", async () => {
    Application._resetInstance();
    const app = Application.create({ env: "console" });

    app.register([DatabaseProvider]);

    const runner = new CommandRunner(app);
    app.container.value("commands", runner);
    app._env = "console";
    await app.boot();

    const result = await runner.callInProcess(["migrate:status"]);
    expect(result.output).not.toContain("Unknown command");
  });

  it("does NOT register commands when env=web (no CommandRunner in container)", async () => {
    Application._resetInstance();
    const app = Application.create({ env: "web" });
    app.register([DatabaseProvider]);
    await app.boot();

    const runner = app.container.tryMake("commands");
    expect(runner).toBeUndefined();
  });
});
