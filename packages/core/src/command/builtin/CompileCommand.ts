/**
 * The `compile` command, which builds the app into a self-contained binary.
 */
import { Command } from "../Command.ts";

/**
 * `bun zt compile` — compiles the application's CLI entry point into a
 * self-contained Bun binary (default output `zerotal-app`). Aliased as `build`.
 *
 * @category Build & assets
 */
export class CompileCommand extends Command {
  static commandName = "compile";
  static description = "Compile to a self-contained binary";
  static needsApp = false;

  static override flags = [
    {
      name: "outfile",
      type: "string" as const,
      description: "Output binary filename",
      default: "zerotal-app",
    },
    {
      name: "entry",
      type: "string" as const,
      description: "Entrypoint to compile",
      default: "zerotal.ts",
    },
  ];

  async run(): Promise<void> {
    const outfile = (this.flags["outfile"] as string | undefined) ?? "zerotal-app";
    const entry = (this.flags["entry"] as string | undefined) ?? "zerotal.ts";
    this.info(`Compiling ${entry} → ${outfile} ...`);
    const subprocess = Bun.spawn(
      ["bun", "build", "--compile", "--target=bun", entry, `--outfile=${outfile}`],
      { stdout: "inherit", stderr: "inherit" },
    );
    const code = await subprocess.exited;
    if (code !== 0) {
      throw new Error(`Compile failed (exit code ${code})`);
    }
    this.info(`Binary written to ./${outfile}`);
  }
}
