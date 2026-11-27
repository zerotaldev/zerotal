/**
 * The base every `make:*` generator extends: the name check, `--dry-run`, `--force`, the
 * refusal that sets a failing exit code, and the "next step" line after `Created:`.
 */
import { Command } from "./Command.ts";
import type { FlagDef } from "./Command.ts";
import { _formatAppSource } from "./appSource.ts";

/**
 * What a generator's name argument may be.
 *
 * - `"class"`: one class name, `PostController`. It is also the file name.
 * - `"nested-class"`: class names separated by `/`, `Admin/Users`. The last one is the class.
 * - `"file"`: one file name in kebab or snake case as well as PascalCase, `post-test`.
 * - `"path"`: file names separated by `/`, `tasks/index`.
 */
export type GeneratorNameKind = "class" | "nested-class" | "file" | "path";

const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

/**
 * Why `name` cannot be used as a generator's name of this kind, or `undefined` when it can.
 *
 * A name becomes a path under `app/`, so anything that is not a plain name is refused here rather
 * than written: `make:controller ../x` used to write `x.ts` beside `app/`, and a name with a space
 * or a dot wrote a file whose class did not compile.
 *
 * @internal Exported for tests.
 */
export function _nameProblem(name: string, kind: GeneratorNameKind): string | undefined {
  if (name.trim() === "") return "Name is required.";
  const nested = kind === "nested-class" || kind === "path";
  const segments = nested ? name.split("/") : [name];
  const pattern = kind === "class" || kind === "nested-class" ? CLASS_NAME : FILE_NAME;
  const bad = segments.find((segment) => !pattern.test(segment));
  if (bad === undefined) return undefined;
  const what =
    kind === "class"
      ? "a valid class name"
      : kind === "nested-class"
        ? "a valid class name, or class names separated by /"
        : kind === "file"
          ? "a valid file name"
          : "a valid file name, or file names separated by /";
  const rule =
    pattern === CLASS_NAME
      ? "letters, digits and _, not starting with a digit"
      : "letters, digits, - and _";
  return `"${name}" is not ${what}: use ${rule}${nested ? " in each part" : ""}.`;
}

/**
 * Base class for the `make:*` generators.
 *
 * A subclass implements {@link GeneratorCommand.generate} instead of `run()` and writes each file
 * through {@link GeneratorCommand.writeFile}. In return every generator behaves the same way:
 *
 * - Its name argument is checked before anything is read or written ({@link GeneratorCommand.nameKind}).
 * - `--dry-run` prints each file it would write, with its contents, and writes nothing.
 * - `--force` overwrites a file that exists. Without it, an existing file is refused.
 * - Every refusal goes through {@link GeneratorCommand.refuse}, which sets a failing exit code, so
 *   a script can tell "created" from "refused".
 * - {@link GeneratorCommand.next} prints what to do with the file once it is written.
 *
 * @example
 * ```ts
 * import { GeneratorCommand } from "zerotal/commands";
 *
 * export class MakeReportCommand extends GeneratorCommand {
 *   static override commandName = "make:report";
 *   static override description = "Create a new report class";
 *
 *   protected override async generate(): Promise<void> {
 *     const name = this.args["name"]!;
 *     const path = `app/reports/${name}.ts`;
 *     if (!(await this.writeFile(path, `export class ${name} {}\n`))) return;
 *     this.next(`Run it from a command: new ${name}().build()`);
 *   }
 * }
 * ```
 *
 * @category Scaffolding (make:*)
 */
export abstract class GeneratorCommand extends Command {
  static override needsApp = false;
  static override args = [{ name: "name", required: true }];

  /**
   * The flags every generator takes on top of its own: the runner adds these to the ones a
   * subclass declares in `flags`, so a generator never has to repeat them.
   */
  static override sharedFlags: FlagDef[] = [
    {
      name: "dry-run",
      type: "boolean",
      description: "Print the files and their contents instead of writing them",
      default: false,
    },
    {
      name: "force",
      type: "boolean",
      description: "Overwrite a file that already exists",
      default: false,
    },
  ];

  /** What the name argument may be. Checked before {@link GeneratorCommand.generate} runs. */
  static nameKind: GeneratorNameKind = "class";

  /** The argument the name is read from, or `undefined` for a generator without one. */
  static nameArgument: string | undefined = "name";

  /** Set once anything is refused, so a caller can stop. */
  protected refused = false;

  /** `--dry-run`: print what would be written, write nothing. */
  get dryRun(): boolean {
    return this.flags["dry-run"] === true;
  }

  /** `--force`: overwrite files that already exist. */
  get force(): boolean {
    return this.flags["force"] === true;
  }

  /** Checks the name, then runs {@link GeneratorCommand.generate}. */
  override async run(): Promise<void> {
    const type = this.constructor as typeof GeneratorCommand;
    const argument = type.nameArgument;
    if (argument !== undefined) {
      const problem = _nameProblem(this.args[argument] ?? "", type.nameKind);
      if (problem) return this.refuse(problem);
    }
    await this.generate();
  }

  /** Does the generator's work. Called with the name already checked. */
  protected abstract generate(): Promise<void>;

  /**
   * Say why nothing was generated, and fail the command.
   *
   * A generator that refused used to exit 0, so `make:controller X || exit 1` went on as though
   * the file it asked for were the one now on disk.
   */
  refuse(message: string): void {
    this.refused = true;
    this.error(message);
    process.exitCode = 1;
  }

  /**
   * Whether `path` may be written: it is new, or `--force` is given. Refuses (and returns false)
   * otherwise. For a generator that checks every file before it writes any.
   */
  async canWrite(path: string): Promise<boolean> {
    if (!this.force && (await Bun.file(path).exists())) {
      this.refuse(`File already exists: ${path} (pass --force to overwrite it)`);
      return false;
    }
    return true;
  }

  /**
   * Write one generated file, formatted as the app formats its own, and report it.
   *
   * Refuses an existing file unless `--force` is given. Under `--dry-run` it prints the path and
   * the contents instead of writing.
   *
   * @param path - Relative to the app root.
   * @param source - The file's contents.
   * @param options - `format: false` writes `source` as it is, for a file Prettier does not read.
   * @returns Whether the file was written (or, under `--dry-run`, would be).
   */
  async writeFile(
    path: string,
    source: string,
    options: { format?: boolean } = {},
  ): Promise<boolean> {
    if (!(await this.canWrite(path))) return false;
    const existed = await Bun.file(path).exists();
    const contents = options.format === false ? source : await _formatAppSource(path, source);
    if (this.dryRun) {
      this.info(`${existed ? "Would overwrite" : "Would create"}: ${path}`);
      this.write(contents.endsWith("\n") ? contents : `${contents}\n`);
      return true;
    }
    // Bun.write() creates any missing parent directories.
    await Bun.write(path, contents);
    this.info(`${existed ? "Overwrote" : "Created"}: ${path}`);
    return true;
  }

  /**
   * Print what to do with what was just generated: where to register it, how to run it, which
   * test covers it. One line per step, under the `Created:` line.
   */
  next(...steps: string[]): void {
    if (steps.length === 0) return;
    this.line("Next:");
    for (const step of steps) this.dim(`  ${step}`);
  }
}
