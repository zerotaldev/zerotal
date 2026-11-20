/**
 * The `compile` command, which builds the app into a self-contained binary.
 */
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "../Command.ts";
import type { FlagDef } from "../Command.ts";
import { _appFilesEmbedded, _scanAppFiles } from "../../support/appFiles.ts";

/**
 * Entry points tried in order when `--entry` is not given: `zt.ts`, which every starter
 * ships, then `zerotal.ts`, the name apps scaffolded before it used.
 */
const DEFAULT_ENTRIES = ["zt.ts", "zerotal.ts"] as const;

/** The files in a carried directory that the framework may import. */
const MODULES = "**/*.{ts,tsx,js,jsx,mjs}";

/** Files carried as text: their contents are the module's default export. */
const TEXT_FILE = /\.html$/;

/**
 * What a binary carries, relative to the project root: the directories the framework scans and
 * imports from at runtime (config, providers, models, pages, route files, migrations, seeders,
 * Inertia's page components for server rendering, translation catalogs), and the templates it
 * reads as text.
 */
const EMBEDDED: ReadonlyArray<{ directory: string; pattern: string }> = [
  ...[
    "app",
    "bootstrap",
    "config",
    "database",
    "routes",
    "resources/js/pages",
    "resources/js/Pages",
  ].map((directory) => ({ directory, pattern: MODULES })),
  { directory: "resources/lang", pattern: "**/*.json" },
  { directory: "lang", pattern: "**/*.json" },
  { directory: "resources", pattern: "*.html" },
];

/**
 * Packages that take part in a build when the app installs them. Each exports
 * `_compileContribution(context)`, which returns more files to carry and code for the generated
 * entry to run before the app starts. Flow compiles its pages here.
 */
const CONTRIBUTORS = ["@zerotal/flow/compile"] as const;

/** One package's part in a build: files to carry, and code that registers them. */
interface CompileContribution {
  files: string[];
  setup: string;
}

/** Where the generated entry is written, relative to the project root. */
const GENERATED_ENTRY = ".zerotal/compile/entry.ts";

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
    {
      name: "include",
      type: "string",
      description:
        "More directories to carry in the binary, comma-separated (app, bootstrap, config, " +
        "database, routes and resources/js/pages always are)",
    },
  ];

  async run(): Promise<void> {
    if (_appFilesEmbedded()) {
      throw new Error(
        "This is a compiled binary, which cannot build another. Run `bun zt compile` in the project.",
      );
    }
    const outfile = (this.flags["outfile"] as string | undefined) ?? "zerotal-app";
    const entry = (this.flags["entry"] as string | undefined) ?? (await defaultEntry());
    const extra = ((this.flags["include"] as string | undefined) ?? "")
      .split(",")
      .map((directory) => directory.trim())
      .filter((directory) => directory !== "");
    const appFiles = await _appModules([
      ...EMBEDDED,
      ...extra.map((directory) => ({ directory, pattern: MODULES })),
    ]);
    const contributions = await _contributions(appFiles);
    const files = [
      ...new Set([...appFiles, ...contributions.flatMap((part) => part.files)]),
    ].sort();
    const generated = resolve(GENERATED_ENTRY);
    // Bun.write creates `.zerotal/compile/` when it is missing.
    await Bun.write(
      generated,
      _generatedEntry(
        generated,
        resolve(entry),
        files,
        contributions.map((part) => part.setup),
      ),
    );
    this.info(`Compiling ${entry} → ${outfile} (${files.length} app files) ...`);
    const subprocess = Bun.spawn(
      [process.execPath, "build", "--compile", "--target=bun", generated, `--outfile=${outfile}`],
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

/** Whether a file is one the framework never imports at runtime: a test, or a declaration file. */
function _isExcluded(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /\.d\.[cm]?ts$/.test(file);
}

/**
 * The app files matching each source's pattern under its directory, as root-relative paths with
 * forward slashes.
 *
 * @internal
 */
export async function _appModules(
  sources: ReadonlyArray<{ directory: string; pattern: string }>,
): Promise<string[]> {
  // On macOS and Windows `resources/js/pages` and `resources/js/Pages` are one directory, and
  // carrying its files under both spellings would bundle each page twice.
  const caseInsensitive = process.platform === "darwin" || process.platform === "win32";
  const found = new Map<string, string>();
  for (const { directory, pattern } of sources) {
    const base = directory.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    for (const file of await _scanAppFiles(resolve(base), pattern)) {
      if (_isExcluded(file)) continue;
      const path = `${base}/${file}`;
      const identity = caseInsensitive ? path.toLowerCase() : path;
      if (!found.has(identity)) found.set(identity, path);
    }
  }
  return [...found.values()].sort();
}

/** A path for an `import()` in the generated entry, relative to it and with forward slashes. */
function _specifierFrom(entryDirectory: string, target: string): string {
  const path = relative(entryDirectory, target).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

/**
 * The entry `bun zt compile` builds: it registers a literal `import()` for every app file, which
 * is what makes the bundler carry the file, then runs the app's own entry.
 *
 * The registry is imported by its absolute path, so the bundle holds the same module instance
 * the framework reads it through, whichever name the app imports the framework by.
 *
 * @param generatedPath - Absolute path the entry is written to.
 * @param appEntry - Absolute path of the app's own entry, such as `zt.ts`.
 * @param files - Root-relative app files to carry.
 * @param setup - Code from the packages that take part in the build, run before the app starts.
 * @internal
 */
export function _generatedEntry(
  generatedPath: string,
  appEntry: string,
  files: string[],
  setup: string[] = [],
): string {
  const directory = dirname(generatedPath);
  const registry = fileURLToPath(new URL("../../support/appFiles.ts", import.meta.url));
  const lines = files.map((file) => {
    const specifier = JSON.stringify(_specifierFrom(directory, resolve(file)));
    const attributes = TEXT_FILE.test(file) ? `, { with: { type: "text" } }` : "";
    return `  ${JSON.stringify(file)}: () => import(${specifier}${attributes}),`;
  });
  return (
    `// Generated by \`bun zt compile\`. It is rewritten on every compile.\n` +
    `import { _embedAppFiles, _preloadAppFiles } from ${JSON.stringify(registry.split(sep).join("/"))};\n\n` +
    `_embedAppFiles({\n${lines.join("\n")}\n});\n` +
    setup.join("") +
    `// The config loader reads config/ synchronously, so it is loaded before the app starts.\n` +
    `await _preloadAppFiles(["config"]);\n\n` +
    `await import(${JSON.stringify(_specifierFrom(directory, appEntry))});\n`
  );
}

/**
 * The parts the installed {@link CONTRIBUTORS} play in this build. A package the app does not
 * install takes no part; one that is installed and fails, fails the build.
 */
async function _contributions(files: string[]): Promise<CompileContribution[]> {
  const root = process.cwd();
  const parts: CompileContribution[] = [];
  for (const specifier of CONTRIBUTORS) {
    let path: string;
    try {
      path = Bun.resolveSync(specifier, root);
    } catch {
      continue;
    }
    const module = (await import(path)) as {
      _compileContribution?: (context: {
        root: string;
        files: readonly string[];
      }) => Promise<CompileContribution>;
    };
    if (typeof module._compileContribution !== "function") continue;
    parts.push(await module._compileContribution({ root, files }));
  }
  return parts;
}
