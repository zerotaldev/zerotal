import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyRotateCommand, rotateEnvContent } from "./KeyRotateCommand.ts";
import { readEnvValue, setEnvValue } from "./envFile.ts";

describe("reading and setting .env values", () => {
  it("reads a value, and nothing for an absent or empty line", () => {
    expect(readEnvValue("A=1\nB=two words\n", "B")).toBe("two words");
    expect(readEnvValue("A=1\nB=\n", "B")).toBeUndefined();
    expect(readEnvValue("A=1\n", "C")).toBeUndefined();
  });

  it("does not mistake a name that merely ends with the one asked for", () => {
    expect(readEnvValue("MY_APP_KEY=x\n", "APP_KEY")).toBeUndefined();
  });

  it("replaces an existing line and leaves the rest alone", () => {
    expect(setEnvValue("A=1\nB=2\nC=3\n", "B", "9")).toBe("A=1\nB=9\nC=3\n");
  });

  it("appends a missing one on a line of its own", () => {
    expect(setEnvValue("A=1", "B", "2")).toBe("A=1\nB=2\n");
    expect(setEnvValue("A=1\n\n", "B", "2")).toBe("A=1\nB=2\n");
  });
});

describe("rotateEnvContent", () => {
  it("makes the current key the newest previous key and mints a new one", () => {
    const rotated = rotateEnvContent("APP_NAME=x\nAPP_KEY=oldkey\n")!;

    expect(rotated.retired).toBe("oldkey");
    expect(rotated.created).not.toBe("oldkey");
    expect(readEnvValue(rotated.content, "APP_KEY")).toBe(rotated.created);
    expect(readEnvValue(rotated.content, "APP_PREVIOUS_KEYS")).toBe("oldkey");
    expect(rotated.content).toContain("APP_NAME=x");
  });

  it("keeps earlier previous keys, newest first, once each", () => {
    const rotated = rotateEnvContent("APP_KEY=second\nAPP_PREVIOUS_KEYS=first,second\n")!;

    expect(readEnvValue(rotated.content, "APP_PREVIOUS_KEYS")).toBe("second,first");
  });

  it("has nothing to rotate without an APP_KEY", () => {
    expect(rotateEnvContent("APP_NAME=x\n")).toBeNull();
    expect(rotateEnvContent("APP_KEY=\n")).toBeNull();
  });

  it("mints a different key each time", () => {
    const a = rotateEnvContent("APP_KEY=k\n")!.created;
    const b = rotateEnvContent("APP_KEY=k\n")!.created;

    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64").length).toBe(32);
  });
});

describe("zt key:rotate", () => {
  let dir: string;
  let originalCwd: string;
  let originalExit: typeof process.exitCode;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalExit = process.exitCode;
    dir = await mkdtemp(join(tmpdir(), "zt-key-rotate-"));
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exitCode = originalExit;
    await rm(dir, { recursive: true, force: true });
  });

  async function run(flags: Record<string, boolean> = {}) {
    const lines: string[] = [];
    const errors: string[] = [];
    const command = new KeyRotateCommand();
    command.flags = flags;
    command._writer = {
      write: () => {},
      writeLine: (line: string) => lines.push(line),
      writeError: (line: string) => errors.push(line),
    };
    await command.run();
    return { lines, errors };
  }

  const env = () => readFile(join(dir, ".env"), "utf8");

  it("rotates the key in .env and says what to do next", async () => {
    await writeFile(join(dir, ".env"), "APP_KEY=oldkey\nAPP_NAME=x\n");

    const { lines } = await run();

    expect(readEnvValue(await env(), "APP_PREVIOUS_KEYS")).toBe("oldkey");
    expect(readEnvValue(await env(), "APP_KEY")).not.toBe("oldkey");
    expect(lines.join("\n")).toContain("Crypt.reencrypt()");
    expect(lines.join("\n")).toContain("key:rotate --forget");
  });

  it("--forget drops the previous keys and leaves APP_KEY alone", async () => {
    await writeFile(join(dir, ".env"), "APP_KEY=current\nAPP_PREVIOUS_KEYS=old1,old2\n");

    await run({ forget: true });

    const content = await env();
    expect(readEnvValue(content, "APP_PREVIOUS_KEYS")).toBeUndefined();
    expect(readEnvValue(content, "APP_KEY")).toBe("current");
  });

  it("fails, and leaves .env alone, when there is no APP_KEY to rotate", async () => {
    await writeFile(join(dir, ".env"), "APP_NAME=x\n");

    const { errors } = await run();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("key:generate");
    expect(await env()).toBe("APP_NAME=x\n");
  });

  it("fails when there is no .env at all", async () => {
    const { errors } = await run();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("No .env file");
  });
});
