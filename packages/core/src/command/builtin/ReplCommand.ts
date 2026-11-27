/**
 * The `repl` command: an interactive REPL that boots the application and exposes
 * it (plus provider-contributed bindings) in the evaluation scope.
 */
import { join } from "node:path";
import { Command } from "../Command.ts";
import { _rewriteImportDeclaration } from "./replImports.ts";

const isSyntaxError = (error: unknown): boolean =>
  error != null && typeof error === "object" && (error as { name?: string }).name === "SyntaxError";

/**
 * `bun zt repl` — starts an interactive REPL with the bootstrapped app (and
 * provider-contributed bindings) in the evaluation scope.
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

    // Collect all globals BEFORE createContext — properties added after may not be
    // visible inside the vm in Bun's implementation.
    const sandbox: Record<string, unknown> = { app, $, console, process };

    // Ask every active provider what it wants available in the REPL.
    // DatabaseProvider returns { DB }, BroadcastProvider could return { Broadcast }, etc.
    for (const provider of app._activeProviders) {
      Object.assign(sandbox, provider.replContext());
    }

    const { createContext, runInContext, constants } = await import("node:vm");
    const vmContext = createContext(sandbox);
    // `import()` resolves as it would in a file at the app root: framework modules from the
    // app's dependencies, the app's own files by a `./` path. Without a loader every
    // `import()` failed with "A dynamic import callback was not specified".
    const scriptOptions = {
      filename: join(process.cwd(), "repl.ts"),
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    };
    const run = (code: string): unknown => runInContext(code, vmContext, scriptOptions);

    const userFacing = ["app", "$", "DB", "Mail", "Cache", "Broadcast"].filter(
      (key) => key in sandbox,
    );
    const contextKeys = userFacing.length
      ? userFacing
      : Object.keys(sandbox).filter((key) => !["console", "process"].includes(key));
    // A script piped in reads only its own results, without the banner.
    if (process.stdin.isTTY === true) {
      console.log("Zerotal REPL  –  type '.exit' or Ctrl+D to quit");
      console.log(`  Context: ${contextKeys.join(", ")}\n`);
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
      const matches = contextKeys.filter((key) => key.startsWith(line));
      return [matches.length ? matches : contextKeys, line];
    };
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: interactive,
      historySize: 1000,
      prompt: "zerotal> ",
      completer,
    });
    (readline as unknown as { history: string[] }).history = savedHistory.slice(0, 1000);

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
    const evaluate = async (input: string): Promise<void> => {
      // `import { X } from "m"` cannot run in a script; it becomes the `await import()` it means.
      const line = _rewriteImportDeclaration(input);
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
          const history = (readline as unknown as { history: string[] }).history;
          if (interactive && history?.length) {
            Bun.write(historyFile, [...history].reverse().join("\n") + "\n").catch(() => {});
          }
          if (interactive) console.log("");
          resolve();
        });
      });

      readline.on("SIGINT", () => {
        if (!(readline as unknown as { line: string }).line) {
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
}
