/**
 * `bun zt repl` with its input piped in, as a script.
 *
 * From the 1.18.0 starter walk: `printf '1+1\n' | bun zt repl` failed with
 * `✖ readline was closed` and exit code 1. At the end of input readline closes at once, while the
 * line read just before it may still be evaluating; the REPL finished there, dropping that line's
 * result, and the prompt it asked for afterwards threw on the closed interface.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPL = join(import.meta.dir, "ReplCommand.ts");

async function pipe(input: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = mkdtempSync(join(tmpdir(), "zt-repl-"));
  try {
    const script = join(dir, "run.ts");
    // The command alone, with an app that contributes nothing: what is under test is the loop.
    writeFileSync(
      script,
      `import { ReplCommand } from ${JSON.stringify(REPL)};
const cmd = new ReplCommand();
(cmd as unknown as { app: unknown }).app = { _activeProviders: [] };
await cmd.run();
process.exit(0);
`,
    );
    const proc = Bun.spawn([process.execPath, script], {
      cwd: dir,
      stdin: new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: dir, NO_COLOR: "1" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("repl with piped input", () => {
  it("evaluates each line, prints only the results, and exits 0 at the end of input", async () => {
    const { code, stdout, stderr } = await pipe("1+1\nconst x = 40\nx + 2\n");

    expect(stderr).toBe("");
    expect(stdout.trim().split("\n")).toEqual(["2", "42"]);
    expect(code).toBe(0);
  });

  it("finishes the line still running when input ends", async () => {
    const { code, stdout, stderr } = await pipe("await $`sleep 0.3; echo late`.text()\n");

    expect(stderr).not.toContain("readline was closed");
    expect(stdout).toContain('"late\\n"');
    expect(code).toBe(0);
  });

  it("reports a line that throws, and goes on to the next", async () => {
    const { code, stdout, stderr } = await pipe("missing.value\n'after'\n");

    expect(stderr).toContain("✖ ReferenceError");
    expect(stdout.trim()).toBe('"after"');
    expect(code).toBe(0);
  });
});
