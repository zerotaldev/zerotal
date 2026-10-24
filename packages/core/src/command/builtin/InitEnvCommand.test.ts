import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InitEnvCommand, envFromExample } from "./InitEnvCommand.ts";
import { readEnvValue } from "./envFile.ts";

/**
 * On a server, after cloning, `.env` is rightly not there. Making it was three steps by hand:
 * copy the example, run `key:generate`, then do the same again for every other secret the
 * example leaves as an instruction.
 */
const EXAMPLE = [
  "APP_ENV=development",
  "APP_KEY=run-`bun zt.ts key:generate`-to-fill-this",
  "APP_URL=http://localhost:3000",
  "SESSION_SECRET=run-`bun zt.ts key:generate`-to-fill-this",
  "",
].join("\n");

describe("envFromExample", () => {
  it("fills each secret the example leaves as an instruction, and nothing else", () => {
    const { content, generated } = envFromExample(EXAMPLE);

    expect(generated).toEqual(["APP_KEY", "SESSION_SECRET"]);
    expect(readEnvValue(content, "APP_KEY")).not.toContain("key:generate");
    expect(Buffer.from(readEnvValue(content, "APP_KEY")!, "base64").length).toBe(32);
    expect(readEnvValue(content, "APP_URL")).toBe("http://localhost:3000");
    expect(readEnvValue(content, "APP_ENV")).toBe("development");
  });

  it("gives each secret its own key", () => {
    const { content } = envFromExample(EXAMPLE);

    expect(readEnvValue(content, "APP_KEY")).not.toBe(readEnvValue(content, "SESSION_SECRET"));
  });

  it("keeps a value the example really sets", () => {
    const { content, generated } = envFromExample("APP_KEY=already-a-real-key\n");

    expect(generated).toEqual([]);
    expect(readEnvValue(content, "APP_KEY")).toBe("already-a-real-key");
  });

  it("fills a secret that is present but empty, and skips one that is not in the file", () => {
    const { content, generated } = envFromExample("APP_KEY=\nAPP_URL=x\n");

    expect(generated).toEqual(["APP_KEY"]);
    expect(content).not.toContain("SESSION_SECRET");
  });
});

describe("zt init:env", () => {
  let dir: string;
  let originalCwd: string;
  let originalExit: typeof process.exitCode;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalExit = process.exitCode;
    dir = await mkdtemp(join(tmpdir(), "zt-init-env-"));
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exitCode = originalExit;
    await rm(dir, { recursive: true, force: true });
  });

  async function run() {
    const lines: string[] = [];
    const errors: string[] = [];
    const command = new InitEnvCommand();
    command.flags = {};
    command._writer = {
      write: () => {},
      writeLine: (line: string) => lines.push(line),
      writeError: (line: string) => errors.push(line),
    };
    await command.run();
    return { lines, errors };
  }

  it("creates .env from .env.example, with generated secrets", async () => {
    await writeFile(join(dir, ".env.example"), EXAMPLE);

    const { lines } = await run();

    const env = await readFile(join(dir, ".env"), "utf8");
    expect(readEnvValue(env, "APP_KEY")).not.toContain("key:generate");
    expect(readEnvValue(env, "APP_URL")).toBe("http://localhost:3000");
    expect(lines.join("\n")).toContain("Generated: APP_KEY, SESSION_SECRET");
    expect(await readFile(join(dir, ".env.example"), "utf8")).toBe(EXAMPLE);
  });

  it("never touches a .env that is already there", async () => {
    await writeFile(join(dir, ".env.example"), EXAMPLE);
    await writeFile(join(dir, ".env"), "APP_KEY=mine\n");

    const { lines } = await run();

    expect(await readFile(join(dir, ".env"), "utf8")).toBe("APP_KEY=mine\n");
    expect(lines.join("\n")).toContain("left alone");
    expect(process.exitCode).not.toBe(1);
  });

  it("fails clearly when there is no .env.example to start from", async () => {
    const { errors } = await run();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("no .env.example");
  });
});
