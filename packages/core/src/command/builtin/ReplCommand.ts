/**
 * The `repl` command: an interactive REPL that boots the application and exposes
 * it (plus provider-contributed bindings) in the evaluation scope.
 */
import { join } from "node:path";
import { Command } from "../Command.ts";
import { _replExports, _replFacades, _replImporter, _replModels } from "./replScope.ts";

const isSyntaxError = (error: unknown): boolean =>
  error != null && typeof error === "object" && (error as { name?: string }).name === "SyntaxError";

/** The names that are always there, and that nothing the app contributes replaces. */
const BUILTINS = ["app", "$", "use", "console", "process"] as const;

/**
 * `bun zt repl` — starts an interactive REPL with the bootstrapped app (and
 * provider-contributed bindings) in the evaluation scope.
 *
 * In scope: `app`, `$`, `use()`, the common facades of the packages the app has installed, the
 * app's models by class name, and whatever providers add. `import()` resolves from the project
 * root, through the app's `tsconfig.json` paths and `@app/*`. Input piped in is read as a script:
 * each line is evaluated, its result printed, and the REPL exits at the end of input.
 *
 * @category Diagnostics
 */
export class ReplCommand extends Command {
  static commandName = "repl";
  static description = "Start an interactive REPL with the bootstrapped app in scope";
  static needsApp = true;

  async run(): Promise<void> {
    const { $ } = await import("bun");
    const app = this.app as import("../../application/Application.ts").Application;
    const root = process.cwd();
    const importer = _replImporter(root);

    // Collect all globals BEFORE createContext — properties added after may not be
    // visible inside the vm in Bun's implementation.
    //
    // Lowest first: the facades, then what providers contribute, then the app's own models, so
    // a model named like a facade is the model. The built-ins are set last and always win.
    const facades = await _replFacades(root);
    const contributed: Record<string, unknown> = {};
    // Ask every active provider what it wants available in the REPL.
    // DatabaseProvider returns { DB }, AiProvider returns { Ai, … }, etc.
    for (const provider of app._activeProviders) {
      Object.assign(contributed, provider.replContext());
    }
    const models = await _replModels(root, this._modelsDirectory(app));

    const sandbox: Record<string, unknown> = { ...facades, ...contributed, ...models };
    // Where `use()` writes: the sandbox until the context exists, then the context's own global.
    const target = { scope: sandbox };
    // `use("@app/models/User")` imports a module and puts its exports in scope.
    const use = async (specifier: string): Promise<Record<string, unknown>> => {
      if (typeof specifier !== "string") throw new TypeError("use() takes a module specifier");
      const namespace = await importer(specifier);
      Object.assign(target.scope, _replExports(namespace));
      return namespace;
    };
    Object.assign(sandbox, { app, $, use, console, process });

    const { createContext, runInContext } = await import("node:vm");
    const vmContext = createContext(sandbox);
    target.scope = runInContext("globalThis", vmContext) as Record<string, unknown>;
    // Every evaluation gets the loader, so `import()` on a line reaches the app's own code.
    const runOptions = {
      importModuleDynamically: (specifier: string) => importer(specifier),
    } as unknown as import("node:vm").RunningScriptOptions;
    const run = (source: string): unknown => runInContext(source, vmContext, runOptions);

    const inScope = [
      "app",
      "$",
      "use",
      ...[...Object.keys(facades), ...Object.keys(contributed), ...Object.keys(models)].filter(
        (key, index, keys) =>
          !(BUILTINS as readonly string[]).includes(key) && keys.indexOf(key) === index,
      ),
    ];
    // A script piped in reads only its own results, without the banner.
    if (process.stdin.isTTY === true) {
      console.log("Zerotal REPL  –  type '.exit' or Ctrl+D to quit");
      console.log(`  In scope: ${inScope.join(", ")}\n`);
    }

    // ── Persistent history ────────────────────────────────────────────────────
    // Read before the interface exists. Piped input is already waiting, and readline emits its
    // lines and its close as soon as it is created: an await between creating it and listening
    // to it lost every line, and the prompt asked for afterwards threw "readline was closed".
    const homeDir = process.env["USERPROFILE"] ?? process.env["HOME"] ?? process.cwd();
    const historyFile = join(homeDir, ".zerotal_repl_history");
    let savedHistory: string[] = [];
    try {
      const rawHistory = await Bun.file(historyFile).text();
      savedHistory = rawHistory.split("\n").filter(Boolean).reverse(); // Newest-first for readline.
    } catch {
      /* no history file yet */
    }

    // ── Readline ──────────────────────────────────────────────────────────────
    // Piped input (`printf '1+1\n' | bun zt repl`) is read as a script: no prompt, no echo, no
    // colour codes in what is printed, and every line is evaluated before the REPL exits.
    const interactive = process.stdin.isTTY === true;
    const colors = process.stdout.isTTY === true;
    const { createInterface } = await import("node:readline");
    const completer = (line: string): [string[], string] => {
      const matches = inScope.filter((key) => key.startsWith(line));
      return [matches.length ? matches : inScope, line];
    };
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: interactive,
      historySize: 1000,
      prompt: "zerotal> ",
      completer,
    });
    // readline's history and current line, which its types leave out.
    const internals = readline as unknown as { history: string[]; line: string };
    internals.history = savedHistory.slice(0, 1000);

    // ── Evaluator ─────────────────────────────────────────────────────────────
    // Three-stage fallback:
    //   ① Sync  — handles plain expressions and sync declarations
    //             (Bun vm keeps const/let in lexical env across calls)
    //   ② Async expression — strips leading const/let/var so the assignment
    //             becomes a global-scope write (persists to next line)
    //   ③ Async statement — same strip, no return value (complex cases)
    //
    // NOTE: Bun's vm throws an internal error class whose .name is 'SyntaxError'
    // but which is NOT instanceof the global SyntaxError. Use isSyntaxError().
    const evaluate = async (line: string): Promise<void> => {
      let result: unknown;
      let firstError: Error | undefined;

      // ① Sync
      try {
        result = run(line);
        if (result instanceof Promise) result = await result;
        if (result !== undefined) process.stdout.write(Bun.inspect(result, { colors }) + "\n");
        return;
      } catch (error) {
        if (!isSyntaxError(error)) throw error;
        firstError = error as Error;
      }

      // ② Async expression — strip declaration keyword → global assignment persists
      const asyncLine = line.replace(/^(?:const|let|var)\s+/, "");
      try {
        const promise = run(`(async () => { return (${asyncLine}); })()`) as Promise<unknown>;
        result = await promise;
        if (result !== undefined) process.stdout.write(Bun.inspect(result, { colors }) + "\n");
        return;
      } catch (error) {
        if (!isSyntaxError(error)) throw error;
      }

      // ③ Async statement fallback
      try {
        const promise = run(`(async () => { ${asyncLine}; })()`) as Promise<unknown>;
        await promise;
        return;
      } catch (error) {
        if (!isSyntaxError(error)) throw error;
      }

      throw firstError;
    };

    // ── REPL loop ─────────────────────────────────────────────────────────────
    // Lines are evaluated one at a time, in order, through one queue. At the end of input,
    // readline closes at once, while a line read just before it may still be running: the REPL
    // used to finish there, dropping that line's result, and the prompt it then asked for threw
    // "readline was closed" (exit code 1). It now waits for the queue to drain, and asks for no
    // prompt once input has ended.
    await new Promise<void>((resolve) => {
      let closed = false;
      let queue: Promise<void> = Promise.resolve();
      const prompt = (): void => {
        if (interactive && !closed) readline.prompt();
      };

      readline.on("close", () => {
        closed = true;
        void queue.then(() => {
          const history = internals.history;
          if (interactive && history?.length) {
            Bun.write(historyFile, [...history].reverse().join("\n") + "\n").catch(() => {});
          }
          if (interactive) console.log("");
          resolve();
        });
      });

      readline.on("SIGINT", () => {
        if (!internals.line) {
          readline.close();
        } else {
          process.stdout.write("\n");
          readline.prompt();
        }
      });

      const handle = async (rawLine: string): Promise<void> => {
        const line = rawLine.trim();
        if (!line) return prompt();
        if (line === ".exit" || line === ".quit") {
          readline.close();
          return;
        }
        try {
          await evaluate(line);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(
            colors ? "\x1b[31m✖ " + message + "\x1b[0m\n" : "✖ " + message + "\n",
          );
        }
        prompt();
      };

      readline.on("line", (rawLine: string) => {
        queue = queue.then(() => handle(rawLine));
      });

      prompt();
    });
  }

  /** `app.conventions.paths.models`, or the default when the app's config does not say. */
  private _modelsDirectory(app: import("../../application/Application.ts").Application): string {
    try {
      // `container` is optional here only for the tests, which run the command with no app.
      const container = app.container as typeof app.container | undefined;
      const config = container?.makeSync("config") as { get(key: string): unknown } | undefined;
      const conventions = config?.get("app.conventions") as
        { paths?: Record<string, string> } | undefined;
      return conventions?.paths?.["models"] ?? "app/models";
    } catch {
      return "app/models";
    }
  }
}
