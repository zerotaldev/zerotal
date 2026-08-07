/**
 * Abstraction over where command output goes.
 * Injected into Command instances before run() is called.
 *
 * - TerminalWriter: default for CLI — writes to process.stdout/stderr
 * - BufferWriter:   used by Artisan.call() — captures output as a string
 *
 * See: plans/boot-modes.md §6
 */
export interface OutputWriter {
  write(message: string): void;
  writeLine(message: string): void;
  writeError(message: string): void;
}

/** Default writer — output goes to the terminal */
export class TerminalWriter implements OutputWriter {
  // Explicit constructor so JSC's function-coverage counter attributes
  // the new TerminalWriter() call to this entry.
  constructor() {}
  write(message: string): void {
    process.stdout.write(message);
  }
  writeLine(message: string): void {
    console.log(message);
  }
  writeError(message: string): void {
    console.error(message);
  }
}

/**
 * Capturing writer — output is stored in memory.
 * Used by Artisan.call() so the caller receives the command's output
 * as a string rather than it being written to the server terminal.
 */
export class BufferWriter implements OutputWriter {
  // `declare` is a TypeScript-only annotation that emits no runtime code,
  // avoiding a JSC function-coverage entry for the bare field declaration.
  declare private _buf: string[];
  constructor() {
    this._buf = [];
  }

  write(message: string): void {
    this._buf.push(message);
  }
  writeLine(message: string): void {
    this._buf.push(message + "\n");
  }
  writeError(message: string): void {
    this._buf.push(message + "\n");
  }

  /** Return all captured output as a single string and clear the buffer. */
  flush(): string {
    const out = this._buf.join("");
    this._buf = [];
    return out;
  }
}
