import { describe, it, expect, afterEach } from "bun:test";
import type { Application } from "@zerotal/core";
import { AiTestCommand } from "./AiTestCommand.ts";
import { registerModelPrice } from "../pricing.ts";

/**
 * `zt ai:test` is what a deploy script or a CI step runs to check a key. It printed a red line
 * for a driver that failed and exited 0, so the step passed on a dead provider; and with no
 * argument it tested every declared driver, so an app that keeps a local fallback next to its
 * real provider got a red line on every run of a correct setup.
 */
type Status = { ok: boolean; model: string; detail: string };

/** Just enough of an AiManager for the command: drivers, default, limits and verify(). */
function fakeApp(
  results: Record<string, Status>,
  defaultDriver = "anthropic",
): { app: Application; verified: string[] } {
  const verified: string[] = [];
  const ai = {
    config: { default: defaultDriver, limits: { perRequestUsd: 0, perDayUsd: 0 } },
    drivers: () => Object.keys(results),
    verify: async (name: string): Promise<Status> => {
      verified.push(name);
      return results[name] ?? { ok: false, model: "?", detail: "not configured" };
    },
  };
  return { app: { container: { makeSync: () => ai } } as unknown as Application, verified };
}

const OK: Status = { ok: true, model: "claude-opus-5-5", detail: "16 in / 4 out" };
const DOWN: Status = { ok: false, model: "llama3.2", detail: "Could not reach Ollama" };

async function runTest(
  app: Application,
  args: Record<string, string> = {},
  flags: Record<string, string | boolean | number> = {},
): Promise<{ lines: string[]; errors: string[]; exitCode: number | string | undefined }> {
  const lines: string[] = [];
  const errors: string[] = [];
  const before = process.exitCode;
  process.exitCode = 0;
  try {
    const cmd = new AiTestCommand();
    cmd.app = app;
    cmd.args = { driver: "", ...args };
    cmd.flags = flags;
    cmd._writer = {
      write: () => {},
      writeLine: (line: string) => lines.push(line),
      writeError: (line: string) => errors.push(line),
    };
    await cmd.run();
    return { lines, errors, exitCode: process.exitCode };
  } finally {
    process.exitCode = before;
  }
}

afterEach(() => {
  process.exitCode = 0;
});

describe("ai:test exit code", () => {
  it("is 0 when the driver it tested works", async () => {
    const { app } = fakeApp({ anthropic: OK });

    expect((await runTest(app)).exitCode).toBe(0);
  });

  it("is 1 when the driver it tested failed", async () => {
    const { app } = fakeApp({ anthropic: DOWN });

    const result = await runTest(app);

    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toContain("Could not reach Ollama");
  });

  it("is 1 when a driver named on the command line failed", async () => {
    const { app } = fakeApp({ anthropic: OK, ollama: DOWN });

    expect((await runTest(app, { driver: "ollama" })).exitCode).toBe(1);
  });

  it("is 1 when there is no driver to test", async () => {
    const { app } = fakeApp({});

    const result = await runTest(app);

    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toContain("No AI drivers are configured");
  });
});

describe("which drivers ai:test tests", () => {
  it("tests the default driver and not the optional fallback", async () => {
    const { app, verified } = fakeApp({ anthropic: OK, ollama: DOWN });

    const result = await runTest(app);

    expect(verified).toEqual(["anthropic"]);
    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("says what it left out, and how to include it", async () => {
    const { app } = fakeApp({ anthropic: OK, ollama: DOWN });

    expect((await runTest(app)).lines.join("\n")).toContain("Not tested: ollama. Pass --all");
  });

  it("tests every driver with --all, and fails if any of them does", async () => {
    const { app, verified } = fakeApp({ anthropic: OK, ollama: DOWN });

    const result = await runTest(app, {}, { all: true });

    expect(verified).toEqual(["anthropic", "ollama"]);
    expect(result.exitCode).toBe(1);
  });
});

describe("ai:test and the model's price", () => {
  it("shows the price of the model it reached", async () => {
    const { app } = fakeApp({ anthropic: OK });

    expect((await runTest(app)).lines.join("\n")).toContain(
      "claude-opus-5-5: priced at $4/$20 per million tokens",
    );
  });

  it("warns that a model with no price is not covered by the spend ceilings", async () => {
    const { app } = fakeApp({ anthropic: { ...OK, model: "claude-future-9" } });

    const result = await runTest(app);

    expect(result.errors.concat(result.lines).join("\n")).toContain(
      "claude-future-9: no price, so the spend ceilings do not apply",
    );
  });

  it("does not warn about a model the app registered a price for", async () => {
    registerModelPrice("claude-registered-1", { input: 1, output: 2 });
    const { app } = fakeApp({ anthropic: { ...OK, model: "claude-registered-1" } });

    const text = (await runTest(app)).lines.join("\n");

    expect(text).toContain("claude-registered-1: priced at $1/$2");
    expect(text).not.toContain("no price");
  });
});
