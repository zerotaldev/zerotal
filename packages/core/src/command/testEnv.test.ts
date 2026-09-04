import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDotenv, testEnvOverrides, TEST_SAFE_DRIVERS } from "./testEnv.ts";

describe("parseDotenv", () => {
  it("reads plain assignments", () => {
    expect(parseDotenv("MAIL_DRIVER=smtp").get("MAIL_DRIVER")).toBe("smtp");
  });

  it("strips surrounding quotes", () => {
    expect(parseDotenv(`A="one two"\nB='three'`).get("A")).toBe("one two");
    expect(parseDotenv(`A="one two"\nB='three'`).get("B")).toBe("three");
  });

  it("keeps a # inside a quoted value but drops a trailing comment", () => {
    expect(parseDotenv('KEY="a#b"').get("KEY")).toBe("a#b");
    expect(parseDotenv("KEY=value # why").get("KEY")).toBe("value");
  });

  it("ignores comments, blanks and malformed lines", () => {
    const parsed = parseDotenv("# comment\n\nNOEQUALS\n=novalue\nOK=yes");
    expect([...parsed.keys()]).toEqual(["OK"]);
  });

  it("accepts the `export` prefix", () => {
    expect(parseDotenv("export MAIL_DRIVER=smtp").get("MAIL_DRIVER")).toBe("smtp");
  });
});

describe("testEnvOverrides", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zerotal-testenv-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resets a driver the app's .env set", async () => {
    // The reported case: a developer with a local Postfix has every mail-sending
    // path in the suite open a real SMTP connection, and the one test that
    // confirms a payment goes from milliseconds to a five-second timeout.
    await Bun.write(join(dir, ".env"), "MAIL_DRIVER=smtp\n");

    const { overrides, neutralised } = await testEnvOverrides(dir, { MAIL_DRIVER: "smtp" });

    expect(overrides["MAIL_DRIVER"]).toBe("log");
    expect(neutralised).toEqual(["MAIL_DRIVER=log"]);
  });

  it("leaves a value the shell set, not .env", async () => {
    // `MAIL_DRIVER=smtp bun zt test` is someone testing that path on purpose.
    await Bun.write(join(dir, ".env"), "MAIL_DRIVER=log\n");

    const { overrides } = await testEnvOverrides(dir, { MAIL_DRIVER: "smtp" });

    expect(overrides["MAIL_DRIVER"]).toBeUndefined();
  });

  it("also reads .env.local", async () => {
    await Bun.write(join(dir, ".env.local"), "QUEUE_DRIVER=redis\n");

    const { overrides } = await testEnvOverrides(dir, { QUEUE_DRIVER: "redis" });

    expect(overrides["QUEUE_DRIVER"]).toBe("sync");
  });

  it("lets .env.test win over both the inherited value and the safe default", async () => {
    // Bun only loads .env.test when NODE_ENV=test, so the docs recommended a file
    // nothing read. It is the app writing down what a test run should use, which
    // outranks the default chosen here.
    await Bun.write(join(dir, ".env"), "MAIL_DRIVER=smtp\n");
    await Bun.write(join(dir, ".env.test"), "MAIL_DRIVER=resend\nMOODLE_URL=https://stub.test\n");

    const { overrides, neutralised } = await testEnvOverrides(dir, { MAIL_DRIVER: "smtp" });

    expect(overrides["MAIL_DRIVER"]).toBe("resend");
    expect(overrides["MOODLE_URL"]).toBe("https://stub.test");
    expect(neutralised).toEqual([]);
  });

  it("says nothing about a key that is unset or already safe", async () => {
    await Bun.write(join(dir, ".env"), "MAIL_DRIVER=log\n");

    const { overrides, neutralised } = await testEnvOverrides(dir, { MAIL_DRIVER: "log" });

    expect(overrides).toEqual({});
    expect(neutralised).toEqual([]);
  });

  it("covers every driver that would otherwise open a connection", async () => {
    const inherited = Object.fromEntries(
      Object.keys(TEST_SAFE_DRIVERS).map((key) => [key, "something-real"]),
    );
    await Bun.write(
      join(dir, ".env"),
      Object.keys(TEST_SAFE_DRIVERS)
        .map((key) => `${key}=something-real`)
        .join("\n"),
    );

    const { overrides } = await testEnvOverrides(dir, inherited);

    expect(overrides).toEqual({ ...TEST_SAFE_DRIVERS });
  });

  it("works in a project with no dotenv files at all", async () => {
    const { overrides, neutralised } = await testEnvOverrides(dir, { MAIL_DRIVER: "smtp" });

    // Nothing declared it, so it came from the shell — left alone.
    expect(overrides).toEqual({});
    expect(neutralised).toEqual([]);
  });
});
