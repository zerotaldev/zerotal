/**
 * The source lines around where an error was thrown, for the dev error overlay.
 *
 * Flow's overlay showed the message and the stack, and nothing of the code: a developer read
 * `at render (…/tasks/index.tsx:25:6)` and opened the file to see line 25. The server reads the
 * first frame in the app's own code (not a dependency, not Flow itself) and sends those lines
 * with the error, under the dev worker only, as the server's own error page does.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function _fromFileUrl(url: string): string {
  try {
    return fileURLToPath(url);
  } catch {
    return url;
  }
}

/** One line of a {@link DevCodeFrame}. */
export interface DevCodeLine {
  num: number;
  code: string;
  /** The line the error was thrown from. */
  active: boolean;
}

/** The file, the position and the lines around it. */
export interface DevCodeFrame {
  file: string;
  line: number;
  column: number;
  lines: DevCodeLine[];
}

/** A frame in a dependency, the runtime, or Flow itself: not where the app's bug is. */
const NOT_APP = /node_modules|^node:|^bun:|^internal:|[\\/]flow[\\/](src|dist)[\\/]|^native$/;

/**
 * The first frame of `stack` in the app's own code, with `radius` lines either side of it, or
 * `undefined` when no frame names a file that can be read.
 *
 * @internal Exported for tests.
 */
export function _codeFrame(stack: string | undefined, radius = 4): DevCodeFrame | undefined {
  if (!stack) return undefined;
  for (const raw of stack.split("\n").slice(1)) {
    const line = raw.trim();
    // "at fn (file:line:col)", or "at file:line:col" for a frame with no function name.
    const m = /^at .+? \((.+):(\d+):(\d+)\)$/.exec(line) ?? /^at (.+):(\d+):(\d+)$/.exec(line);
    if (!m) continue;
    const file = m[1]!.startsWith("file:") ? _fromFileUrl(m[1]!) : m[1]!;
    if (NOT_APP.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const at = Number(m[2]);
    const source = text.split(/\r?\n/);
    if (at < 1 || at > source.length) continue;
    const start = Math.max(1, at - radius);
    const end = Math.min(source.length, at + radius);
    const lines: DevCodeLine[] = [];
    for (let num = start; num <= end; num++) {
      lines.push({ num, code: source[num - 1]!, active: num === at });
    }
    return { file, line: at, column: Number(m[3]), lines };
  }
  return undefined;
}
