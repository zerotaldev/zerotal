import { describe, expect, it } from "bun:test";
import { _bareTestRunProblem } from "./guard.ts";

describe("_bareTestRunProblem", () => {
  it("refuses a bare run that would use DATABASE_URL, and names the command to run", () => {
    const problem = _bareTestRunProblem({ DATABASE_URL: "./database/db.sqlite" });
    expect(problem).toContain("DATABASE_URL=./database/db.sqlite");
    expect(problem).toContain("bun zt test");
    expect(problem).toContain("ZT_DB_URL=:memory: bun test");
  });

  it("stays out of the way of a run zt test prepared", () => {
    expect(
      _bareTestRunProblem({ ZT_TEST_RUNNER: "1", DATABASE_URL: "./database/db.sqlite" }),
    ).toBeUndefined();
  });

  it("lets a direct run that names its own database through", () => {
    expect(
      _bareTestRunProblem({ ZT_DB_URL: ":memory:", DATABASE_URL: "./database/db.sqlite" }),
    ).toBeUndefined();
  });

  it("has nothing to say when there is no database to hit", () => {
    expect(_bareTestRunProblem({})).toBeUndefined();
    expect(_bareTestRunProblem({ DATABASE_URL: ":memory:" })).toBeUndefined();
  });
});

describe("the guard as a preload", () => {
  async function bunTest(env: Record<string, string>): Promise<{ code: number; output: string }> {
    const proc = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        `${import.meta.dir}/guard.ts`,
        "./guard-target.fixture.ts",
      ],
      {
        cwd: `${import.meta.dir}/__fixtures__`,
        env: {
          ...Bun.env,
          ZT_TEST_RUNNER: "",
          ZT_DB_URL: "",
          DATABASE_URL: "./dev.sqlite",
          ...env,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output =
      (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    return { code: await proc.exited, output };
  }

  it("stops a bare bun test before any test file runs", async () => {
    const { code, output } = await bunTest({});
    expect(code).not.toBe(0);
    expect(output).toContain("bun zt test");
    expect(output).not.toContain("guard target ran");
  });

  it("lets the same run through once it names its database", async () => {
    const { code, output } = await bunTest({ ZT_DB_URL: ":memory:" });
    expect(code).toBe(0);
    expect(output).toContain("guard target ran");
  });
});
