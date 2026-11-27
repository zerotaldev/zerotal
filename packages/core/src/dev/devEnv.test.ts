/**
 * An edit to `.env` reaches the server `zt dev` restarts.
 *
 * The server is spawned with the parent's environment, and Bun does not let `.env` override a
 * variable that is already set, so the restarted server kept the value read when `zt dev` began.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _DevEnv, _envFileNames, _overlayEnvFiles, _parseEnvFile } from "./devEnv.ts";

describe("_parseEnvFile()", () => {
  it("reads the forms a .env file uses", () => {
    const parsed = _parseEnvFile(
      [
        "# comment",
        "PLAIN=value",
        "export EXPORTED=yes",
        'DOUBLE="two\\nlines"',
        "SINGLE='$NOT_EXPANDED'",
        "TRAILING=value # a comment",
        "URL=http://${HOST}:${PORT}/x",
        "EMPTY=",
      ].join("\n"),
      { HOST: "localhost", PORT: "3000" },
    );

    expect(parsed).toEqual({
      PLAIN: "value",
      EXPORTED: "yes",
      DOUBLE: "two\nlines",
      SINGLE: "$NOT_EXPANDED",
      TRAILING: "value",
      URL: "http://localhost:3000/x",
      EMPTY: "",
    });
  });
});

describe("_envFileNames()", () => {
  it("follows Bun's order, lowest precedence first", () => {
    expect(_envFileNames(undefined)).toEqual([".env", ".env.development", ".env.local"]);
    expect(_envFileNames("production")).toEqual([".env", ".env.production", ".env.local"]);
    expect(_envFileNames("test")).toEqual([".env", ".env.test"]);
  });
});

describe("_overlayEnvFiles()", () => {
  const atStart = { MAIL_HOST: "old", REMOVED: "x" };

  it("takes a changed value for a key the files own", () => {
    const env = _overlayEnvFiles({ MAIL_HOST: "old", REMOVED: "x" }, atStart, {
      MAIL_HOST: "new",
    });
    expect(env["MAIL_HOST"]).toBe("new");
  });

  it("drops a key removed from the files, and adds a new one", () => {
    const env = _overlayEnvFiles({ MAIL_HOST: "old", REMOVED: "x" }, atStart, {
      MAIL_HOST: "old",
      ADDED: "y",
    });
    expect("REMOVED" in env).toBe(false);
    expect(env["ADDED"]).toBe("y");
  });

  it("keeps a value set in the shell, as Bun does", () => {
    const env = _overlayEnvFiles({ MAIL_HOST: "from-shell", PATH: "/bin" }, atStart, {
      MAIL_HOST: "new",
    });
    expect(env["MAIL_HOST"]).toBe("from-shell");
    expect(env["PATH"]).toBe("/bin");
  });
});

describe("_DevEnv", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("reads the files again on every call", async () => {
    dir = await mkdtemp(join(tmpdir(), "zt-dev-env-"));
    await Bun.write(join(dir, ".env"), "GREETING=hello\n");
    const env = new _DevEnv(dir, { GREETING: "hello", NODE_ENV: "development" });
    expect(env.current()["GREETING"]).toBe("hello");

    await Bun.write(join(dir, ".env"), "GREETING=bonjour\n");
    await Bun.write(join(dir, ".env.local"), "LOCAL=1\n");
    const next = env.current();
    expect(next["GREETING"]).toBe("bonjour");
    expect(next["LOCAL"]).toBe("1");
  });
});
