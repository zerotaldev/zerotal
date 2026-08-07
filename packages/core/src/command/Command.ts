/**
 * The base class every console command extends, providing argument/flag metadata,
 * coloured terminal output helpers, and interactive prompts. Subclasses implement
 * `run()` to do the work.
 */
import { TerminalWriter } from "./OutputWriter.ts";
import type { OutputWriter } from "./OutputWriter.ts";

/** Definition of a positional argument a command accepts. */
export type ArgDef = {
  name: string;
  required?: boolean;
  default?: string;
};

/** Definition of a named flag a command accepts. */
export type FlagDef = {
  name: string;
  short?: string;
  type: "string" | "boolean" | "number";
  description?: string;
  default?: unknown;
};

/**
 * Base class for console commands; subclasses declare their name/args/flags via
 * static properties and implement `run()`.
 *
 * A command's identity and CLI surface are described with the static fields
 * ({@link Command.commandName | commandName}, {@link Command.description | description},
 * {@link Command.args | args}, {@link Command.flags | flags}, and
 * {@link Command.needsApp | needsApp}); the work happens in `run()`, where parsed
 * {@link Command.args | this.args} and {@link Command.flags | this.flags} are
 * available along with output helpers (`info`, `error`, `line`, `table`, …) and
 * interactive prompts (`ask`, `confirm`, `choice`, `secret`). Register the class
 * with {@link CommandRunner.register} to expose it as `bun zt <commandName>`.
 *
 * @example
 * ```ts
 * import { Command } from "@zerotal/core";
 * import type { ArgDef, FlagDef } from "@zerotal/core";
 *
 * export class GreetCommand extends Command {
 *   static commandName = "greet";
 *   static description = "Print a greeting";
 *   static needsApp = false;
 *   static args: ArgDef[] = [{ name: "name", required: true }];
 *   static flags: FlagDef[] = [
 *     { name: "loud", short: "l", type: "boolean", default: false },
 *   ];
 *
 *   async run(): Promise<void> {
 *     const greeting = `Hello, ${this.args["name"]}!`;
 *     this.info(this.flags["loud"] ? greeting.toUpperCase() : greeting);
 *   }
 * }
 * ```
 * Invoke it once registered:
 * ```bash
 * bun zt greet Ada --loud
 * ```
 */
export abstract class Command {
  static commandName: string;
  static description: string;
  static needsApp: boolean;
  static args: ArgDef[] = [];
  static flags: FlagDef[] = [];

  /** Output destination. Replaced with BufferWriter by Artisan.call(). */
  _writer: OutputWriter = new TerminalWriter();

  /** Parsed positional arguments — set by CommandRunner before run(). */
  args: Record<string, string> = {};
  /** Parsed flags — set by CommandRunner before run(). */
  flags: Record<string, string | boolean | number> = {};
  /** Application instance — set by CommandRunner when needsApp is true. */
  app: unknown = undefined;

  abstract run(): Promise<void>;

  info(msg: string): void {
    this._writer.writeLine(`\x1b[32m${msg}\x1b[0m`);
  }
  error(msg: string): void {
    this._writer.writeError(`\x1b[31m${msg}\x1b[0m`);
  }
  warn(msg: string): void {
    this._writer.writeLine(`\x1b[33m${msg}\x1b[0m`);
  }
  line(msg: string): void {
    this._writer.writeLine(`\x1b[36m${msg}\x1b[0m`);
  }
  dim(msg: string): void {
    this._writer.writeLine(`\x1b[2m${msg}\x1b[0m`);
  }
  write(msg: string): void {
    this._writer.write(msg);
  }
  newLine(): void {
    this._writer.writeLine("");
  }
  section(title: string): void {
    this._writer.writeLine(`\n\x1b[1m${title}\x1b[0m`);
  }
  table(rows: [string, string][], indent = 2): void {
    const columnWidth = Math.max(...rows.map(([key]) => key.length)) + 4;
    for (const [key, value] of rows) {
      this._writer.writeLine(
        " ".repeat(indent) + key.padEnd(columnWidth) + `\x1b[2m${value}\x1b[0m`,
      );
    }
  }

  // ── Interactive prompts ───────────────────────────────────────────────
  // These read from stdin. They only work when the process has a real TTY
  // (i.e. interactive console mode). Do not call them in tests — mock
  // _readLine() instead.

  /**
   * Prompt the user for text input and wait for Enter.
   *
   * @example
   * const name = await this.ask('What is your name?');
   * const env  = await this.ask('Environment?', 'production');
   */
  async ask(question: string, defaultValue?: string): Promise<string> {
    const hint = defaultValue ? ` [${defaultValue}]` : "";
    this._writer.write(`\x1b[36m${question}${hint}: \x1b[0m`);
    const answer = (await this._readLine()).trim();
    return answer || defaultValue || "";
  }

  /**
   * Prompt the user for a yes/no confirmation.
   * Returns true for y/yes, false otherwise.
   *
   * @example
   * const ok = await this.confirm('Run migrations?');
   * const ok = await this.confirm('Overwrite file?', true);
   */
  async confirm(question: string, defaultValue = false): Promise<boolean> {
    const hint = defaultValue ? "[Y/n]" : "[y/N]";
    this._writer.write(`\x1b[33m${question} ${hint}: \x1b[0m`);
    const answer = (await this._readLine()).trim().toLowerCase();
    if (!answer) return defaultValue;
    return answer === "y" || answer === "yes";
  }

  /**
   * Prompt the user to select one option from a numbered list.
   * Returns the selected string. Defaults to the first option on invalid input.
   *
   * @example
   * const env = await this.choice('Environment:', ['local', 'staging', 'production']);
   */
  async choice(question: string, options: string[]): Promise<string> {
    this._writer.writeLine(`\x1b[36m${question}\x1b[0m`);
    options.forEach((option, index) => {
      this._writer.writeLine(`  \x1b[2m[${index + 1}]\x1b[0m ${option}`);
    });
    this._writer.write("Enter number: ");
    const answer = (await this._readLine()).trim();
    const index = parseInt(answer, 10) - 1;
    const first = options[0] ?? "";
    if (isNaN(index) || index < 0 || index >= options.length) return first;
    return options[index] ?? first;
  }

  async secret(question: string): Promise<string> {
    this._writer.write(`\x1b[36m${question} \x1b[0m`);
    const tty = process.stdin as unknown as {
      isTTY?: boolean;
      setRawMode?: (mode: boolean) => void;
    };

    // Windows does not support raw-mode hidden input — fall back to a visible prompt.
    // On Unix TTYs, enable raw mode so characters are not echoed.
    const canHide =
      !!tty.isTTY && typeof tty.setRawMode === "function" && process.platform !== "win32";

    if (!canHide) {
      const answer = (await this._readLine()).trim();
      this._writer.writeLine("");
      return answer;
    }

    try {
      tty.setRawMode!(true);
      const characters: string[] = [];
      const stdinIterator = this._stdinIter();
      const decoder = new TextDecoder();
      outer: while (true) {
        const { value, done } = await stdinIterator.next();
        if (done) break;
        for (const character of decoder.decode(value)) {
          if (character === "\r" || character === "\n") break outer;
          if (character === "\x7f" || character === "\b") {
            characters.pop();
            continue;
          }
          if (character >= " ") characters.push(character);
        }
      }
      return characters.join("");
    } finally {
      tty.setRawMode!(false);
      this._writer.writeLine("");
    }
  }

  /** Read one line from stdin. Override in tests to avoid blocking. */
  async _readLine(): Promise<string> {
    // Return any line already buffered from a previous read.
    const bufferedNewlineIndex = this._lineBuf.indexOf("\n");
    if (bufferedNewlineIndex !== -1) {
      const line = this._lineBuf.slice(0, bufferedNewlineIndex);
      this._lineBuf = this._lineBuf.slice(bufferedNewlineIndex + 1);
      return line.replace(/\r$/, "");
    }

    const stdinIterator = this._stdinIter();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await stdinIterator.next();
      if (done) break;
      this._lineBuf += decoder.decode(value);
      const newlineIndex = this._lineBuf.indexOf("\n");
      if (newlineIndex !== -1) {
        const line = this._lineBuf.slice(0, newlineIndex);
        this._lineBuf = this._lineBuf.slice(newlineIndex + 1);
        return line.replace(/\r$/, "");
      }
    }

    const remaining = this._lineBuf;
    this._lineBuf = "";
    return remaining.replace(/\r$/, "");
  }

  // Shared stdin async iterator — one per Command instance so consecutive prompts
  // don't each open a competing stream on the same stdin fd.
  private _lineBuf = "";
  private _stdinIterator: AsyncIterator<Uint8Array> | undefined;
  private _stdinIter(): AsyncIterator<Uint8Array> {
    if (!this._stdinIterator) {
      this._stdinIterator = (Bun.stdin.stream() as unknown as AsyncIterable<Uint8Array>)[
        Symbol.asyncIterator
      ]();
    }
    return this._stdinIterator;
  }
}
