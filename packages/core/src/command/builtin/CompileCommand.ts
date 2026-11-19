/**
 * The `compile` command, which builds the app into a self-contained binary.
 */
import { Command } from "../Command.ts";
import type { FlagDef } from "../Command.ts";

/**
 * Entry points tried in order when `--entry` is not given: `zt.ts`, which every starter
 * ships, then `zerotal.ts`, the name apps scaffolded before it used.
 */
const DEFAULT_ENTRIES = ["zt.ts", "zerotal.ts"] as const;

/**
 * `bun zt compile` — compiles the application's CLI entry point into a
 * self-contained Bun binary (default output `zerotal-app`). Aliased as `build`.
 *
 * Without `--entry` it compiles `zt.ts`, or `zerotal.ts` when the project has no
 * `zt.ts`.
 *
 * @category Build & assets
 */
export class CompileCommand extends Command {
  static commandName = "compile";
  static description = "Compile to a self-contained binary";
  static needsApp = false;

  static override flags: FlagDef[] = [
    {
      name: "outfile",
      type: "string",
      description: "Output binary filename",
      default: "zerotal-app",
    },
    {
      name: "entry",
      type: "string",
      description: "Entrypoint to compile (default: zt.ts, or zerotal.ts when there is no zt.ts)",
    },
  ];

  async run(): Promise<void> {
    const outfile = (this.flags["outfile"] as string | undefined) ?? "zerotal-app";
    const entry = (this.flags["entry"] as string | undefined) ?? (await defaultEntry());
    this.info(`Compiling ${entry} → ${outfile} ...`);
    const subprocess = Bun.spawn(
      ["bun", "build", "--compile", "--target=bun", entry, `--outfile=${outfile}`],
      { stdout: "inherit", stderr: "inherit" },
    );
    const code = await subprocess.exited;
    if (code !== 0) {
      throw new Error(`Compile failed (exit code ${code})`);
    }
    // On Windows Bun adds `.exe` to any name that does not already end in it.
    const written =
      process.platform === "win32" && !outfile.toLowerCase().endsWith(".exe")
        ? `${outfile}.exe`
        : outfile;
    this.info(`Binary written to ./${written}`);
  }
}

/** The first of {@link DEFAULT_ENTRIES} that exists, or `zt.ts` so the error names it. */
async function defaultEntry(): Promise<string> {
  for (const entry of DEFAULT_ENTRIES) {
    if (await Bun.file(entry).exists()) return entry;
  }
  return DEFAULT_ENTRIES[0];
}
