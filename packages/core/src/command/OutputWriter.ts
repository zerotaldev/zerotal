import { writeSync } from "node:fs";

/**
 * Abstraction over where command output goes.
 * Injected into Command instances before run() is called.
 *
 * - TerminalWriter: default for CLI — writes to process.stdout/stderr
 * - BufferWriter:   used by Artisan.call() — captures output as a string
 *
 * See: plans/boot-modes.md §6
 */
import { _forStream } from "../logger/color.ts";

export interface OutputWriter {
  write(message: string): void;
  writeLine(message: string): void;
  writeError(message: string): void;
}

/**
 * Write every byte to `fd` before returning. The descriptor is non-blocking once anything has
 * touched `process.stdout`, so a full pipe answers `EAGAIN` until the reader catches up.
 */
function writeAll(fd: number, bytes: Uint8Array): void {
  for (let offset = 0; offset < bytes.length;) {
    try {
      offset += writeSync(fd, bytes, offset);
    } catch (error) {
      if ((error as { code?: string }).code !== "EAGAIN") throw error;
      Bun.sleepSync(1);
    }
  }
}

/** The real stdout, while {@link _reserveStdoutForJson} has everything else sent to stderr. */
let reservedStdout: ((message: string) => void) | undefined;

/**
 * Keep stdout for the command's own output, and send everything else written there to stderr.
 *
 * For a `--json` run. The boot log, a provider's notice and anything else that calls
 * `console.log` or writes to `process.stdout` would land ahead of the JSON document and break
 * every parser it is piped into; `zt version --json` carried a boot log line for exactly this
 * reason. Once reserved, only a {@link TerminalWriter} (what a command's `write`/`json` reach)
 * writes to stdout. Returns a function that undoes it.
 *
 * @internal
 */
export function _reserveStdoutForJson(): () => void {
  if (reservedStdout) return () => {};
  const stdout = process.stdout;
  const originalWrite = stdout.write.bind(stdout);
  const { log, info, debug } = console;
  // Written to the descriptor directly and synchronously: `process.stdout.write` to a pipe is
  // asynchronous, and the runner's `process.exit()` cut a large document off at 64 KiB.
  reservedStdout = (message) => writeAll(1, Buffer.from(message));
  stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
    (process.stderr.write as (...args: unknown[]) => boolean)(
      chunk,
      ...rest,
    )) as typeof stdout.write;
  console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
  return () => {
    stdout.write = originalWrite as typeof stdout.write;
    Object.assign(console, { log, info, debug });
    reservedStdout = undefined;
  };
}

/**
 * Default writer — output goes to the terminal
 *
 * @internal
 */
export class TerminalWriter implements OutputWriter {
  // Explicit constructor so JSC's function-coverage counter attributes
  // the new TerminalWriter() call to this entry.
  constructor() {}
  // Colour codes only on a terminal, never with NO_COLOR: `zt routes:list > routes.txt`
  // wrote them into the file as text.
  write(message: string): void {
    const text = _forStream(message, process.stdout);
    if (reservedStdout) reservedStdout(text);
    else process.stdout.write(text);
  }
  writeLine(message: string): void {
    const text = _forStream(message, process.stdout);
    if (reservedStdout)
      reservedStdout(`${text}
`);
    else console.log(text);
  }
  writeError(message: string): void {
    console.error(_forStream(message, process.stderr));
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
