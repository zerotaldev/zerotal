/**
 * `bun zt repl` reaching the app's own code.
 *
 * From the 1.18 starter walk: `import()` on a REPL line failed with "A dynamic import callback was
 * not specified", so a developer or an agent could use only the few names the REPL put on the
 * global scope. Each test pipes lines into the command, run in a throwaway app with its own
 * `tsconfig.json`, models and `node_modules`.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPL = join(import.meta.dir, "ReplCommand.ts");
const PACKAGES = join(import.meta.dir, "..", "..", "..", "..");

let app: string;

beforeAll(() => {
  app = mkdtempSync(join(tmpdir(), "zt-repl-app-"));
  const write = (path: string, text: string): void => {
    mkdirSync(join(app, path, ".."), { recursive: true });
    writeFileSync(join(app, path), text);
  };
  // `@app/*` is left out on purpose: the REPL reads it as `app/*` all the same. `~support/*` is
  // one only this app declares.
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { paths: { "~support/*": ["./support/*"] } } }),
  );
  write(
    "app/models/User.ts",
    `export class User { static async count(): Promise<number> { return 3; } }
export const ROLES = ["admin", "member"];
`,
  );
  write("app/models/Post.ts", `export class Post {}\n`);
  write(
    "support/greet.ts",
    `export function greet(name: string): string { return "hi " + name; }
export default class Greeter {}
`,
  );
  // Core and cache are installed; the ORM is not, so `DB` stays out of scope.
  mkdirSync(join(app, "node_modules", "@zerotal"), { recursive: true });
  symlinkSync(join(PACKAGES, "core"), join(app, "node_modules", "@zerotal", "core"), "dir");
  symlinkSync(join(PACKAGES, "cache"), join(app, "node_modules", "@zerotal", "cache"), "dir");
  write(
    "run.ts",
    `import { ReplCommand } from ${JSON.stringify(REPL)};
if (process.env["FORCE_TTY"] === "1") (process.stdin as { isTTY?: boolean }).isTTY = true;
const cmd = new ReplCommand();
(cmd as unknown as { app: unknown }).app = {
  _activeProviders: [{ replContext: () => ({ Extra: "from a provider" }) }],
};
await cmd.run();
process.exit(0);
`,
  );
});

afterAll(() => {
  rmSync(app, { recursive: true, force: true });
});

async function pipe(
  input: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, join(app, "run.ts")], {
    cwd: app,
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: app, NO_COLOR: "1", ...env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

const lines = (stdout: string): string[] => stdout.trim().split("\n");

describe("repl in an app", () => {
  it("has the app's models in scope by class name, and only the classes", async () => {
    const { code, stdout, stderr } = await pipe("await User.count()\ntypeof Post\ntypeof ROLES\n");

    expect(stderr).toBe("");
    expect(lines(stdout)).toEqual(["3", '"function"', '"undefined"']);
    expect(code).toBe(0);
  });

  it("has the facades of the installed packages, and none of the others", async () => {
    const { stdout, stderr } = await pipe(
      "[typeof Config, typeof Storage, typeof Cache, typeof DB, typeof Auth, typeof Queue]\n",
    );

    expect(stderr).toBe("");
    expect(stdout.replace(/\s+/g, "")).toBe(
      '["object","object","object","undefined","undefined","undefined"]',
    );
  });

  it("keeps what providers contribute", async () => {
    const { stdout } = await pipe("Extra\n");

    expect(stdout.trim()).toBe('"from a provider"');
  });

  it("resolves import() through @app/*, the tsconfig paths and relative paths", async () => {
    const { code, stdout, stderr } = await pipe(
      [
        '(await import("@app/models/User")).User === User',
        '(await import("~support/greet")).greet("a")',
        '(await import("./support/greet.ts")).greet("b")',
        '(await import("node:path")).sep',
      ].join("\n") + "\n",
    );

    expect(stderr).toBe("");
    expect(lines(stdout)).toEqual(["true", '"hi a"', '"hi b"', '"/"']);
    expect(code).toBe(0);
  });

  it("puts a module's exports in scope with use()", async () => {
    const { stdout, stderr } = await pipe(
      [
        'await use("@app/models/User").then(() => ROLES.length)',
        'await use("~support/greet").then(() => "loaded")',
        'greet("c")',
        "typeof Greeter",
      ].join("\n") + "\n",
    );

    expect(stderr).toBe("");
    expect(lines(stdout)).toEqual(["2", '"loaded"', '"hi c"', '"function"']);
  });

  it("names the specifier it cannot find, and goes on", async () => {
    const { code, stdout, stderr } = await pipe('await use("@app/missing")\n1 + 1\n');

    expect(stderr).toContain("✖ Cannot find module '@app/missing'");
    expect(stdout.trim()).toBe("2");
    expect(code).toBe(0);
  });

  it("lists what is in scope on one line at the start of an interactive session", async () => {
    const { stdout } = await pipe(".exit\n", { FORCE_TTY: "1" });

    const scope = stdout.split("\n").find((line) => line.includes("In scope:"));
    expect(scope?.trim()).toBe("In scope: app, $, use, Config, Storage, Cache, Extra, Post, User");
  });
});
