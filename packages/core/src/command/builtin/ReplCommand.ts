/**
 * The `repl` command: an interactive REPL that boots the application and exposes
 * it (plus provider-contributed bindings) in the evaluation scope.
 */
import { join } from "node:path";
import { Command } from "../Command.ts";

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

    const { createContext, runInContext } = await import("node:vm");
    const vmContext = createContext(sandbox);

    const userFacing = ["app", "$", "DB", "Mail", "Cache", "Broadcast"].filter(
      (key) => key in sandbox,
    );
    const contextKeys = userFacing.length
      ? userFacing
      : Object.keys(sandbox).filter((key) => !["console", "process"].includes(key));
    console.log("Zerotal REPL  –  type '.exit' or Ctrl+D to quit");
    console.log(`  Context: ${contextKeys.join(", ")}\n`);

    // ── Readline ──────────────────────────────────────────────────────────────
    const { createInterface } = await import("node:readline");
    const completer = (line: string): [string[], string] => {
      const matches = contextKeys.filter((key) => key.startsWith(line));
      return [matches.length ? matches : contextKeys, line];
    };
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 1000,
      prompt: "zerotal> ",
      completer,
    });

    // ── Persistent history ────────────────────────────────────────────────────
    const homeDir = process.env["USERPROFILE"] ?? process.env["HOME"] ?? process.cwd();
    const historyFile = join(homeDir, ".zerotal_repl_history");
    try {
      const rawHistory = await Bun.file(historyFile).text();
      const lines = rawHistory.split("\n").filter(Boolean).reverse(); // Newest-first for readline.
      (readline as unknown as { history: string[] }).history = lines.slice(0, 1000);
    } catch {
      /* no history file yet */
    }

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
        result = runInContext(line, vmContext);
        if (result instanceof Promise) result = await result;
        if (result !== undefined)
          process.stdout.write(Bun.inspect(result, { colors: true }) + "\n");
        return;
      } catch (error) {
        if (!isSyntaxError(error)) throw error;
        firstError = error as Error;
      }

      // ② Async expression — strip declaration keyword → global assignment persists
      const asyncLine = line.replace(/^(?:const|let|var)\s+/, "");
      try {
        const promise = runInContext(
          `(async () => { return (${asyncLine}); })()`,
          vmContext,
        ) as Promise<unknown>;
        result = await promise;
        if (result !== undefined)
          process.stdout.write(Bun.inspect(result, { colors: true }) + "\n");
        return;
      } catch (error) {
        if (!isSyntaxError(error)) throw error;
      }

      // ③ Async statement fallback
      try {
        const promise = runInContext(
          `(async () => { ${asyncLine}; })()`,
          vmContext,
        ) as Promise<unknown>;
        await promise;
        return;
      } catch (error) {
        if (!isSyntaxError(error)) throw error;
      }

      throw firstError;
    };

    // ── REPL loop ─────────────────────────────────────────────────────────────
    await new Promise<void>((resolve) => {
      readline.on("close", () => {
        const history = (readline as unknown as { history: string[] }).history;
        if (history?.length) {
          Bun.write(historyFile, [...history].reverse().join("\n") + "\n").catch(() => {});
        }
        console.log("");
        resolve();
      });

      readline.on("SIGINT", () => {
        if (!(readline as unknown as { line: string }).line) {
          readline.close();
        } else {
          process.stdout.write("\n");
          readline.prompt();
        }
      });

      readline.on("line", async (rawLine: string) => {
        const line = rawLine.trim();
        if (!line) {
          readline.prompt();
          return;
        }
        if (line === ".exit" || line === ".quit") {
          readline.close();
          return;
        }

        try {
          await evaluate(line);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write("\x1b[31m✖ " + message + "\x1b[0m\n");
        }

        readline.prompt();
      });

      readline.prompt();
    });
  }
}
