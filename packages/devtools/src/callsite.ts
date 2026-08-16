/**
 * Where in *your* code this happened.
 *
 * A `QuerySpan` was `{ sql, bindings, startMs, durationMs, rowCount }` and a
 * `LogEntry` was `{ level, args, offsetMs }`. Neither knew which line produced
 * it, so "which of my forty queries is the slow one" was answerable and "where do
 * I go to fix it" was not.
 *
 * The whole trick is throwing away frames. A stack captured where devtools
 * buffers an event begins inside devtools, passes through the emitting package,
 * and only then reaches the application — so the first frame that is *not*
 * framework code is the answer, and every frame above it is noise.
 *
 * **Cost.** Measured under Bun at roughly two microseconds per capture, flat
 * across stack depths from 5 to 80 — the engine builds the trace lazily, so
 * depth barely registers. A request running forty queries pays about 0.08ms.
 * That is why {@link DevtoolsConfigShape.captureSource} defaults to on: it was
 * expected to be the expensive part of this and it is not.
 */
import type { SourceLocation } from "./editor.ts";

/**
 * Path fragments that mean "not the application".
 *
 * Matched against the normalised path, so the separator is always `/`. The
 * framework's own packages are here twice over — as a workspace checkout
 * (`packages/orm/src`) and as an installed dependency (`node_modules`) — because
 * a contributor debugging the framework and an app developer using it see
 * different paths for the same file.
 */
const FRAMEWORK_FRAGMENTS = [
  "node_modules/",
  "/packages/core/",
  "/packages/orm/",
  "/packages/devtools/",
  "/packages/cache/",
  "/packages/queue/",
  "/packages/auth/",
  "/packages/session/",
  "/packages/notifications/",
  "/packages/inertia/",
  "/packages/flow/",
  "bun:",
  "node:",
];

/** Frames the runtime adds that name no file at all. */
const NATIVE = ["[native code]", "<anonymous>", "unknown"];

/**
 * One line of a stack, as the runtimes spell it.
 *
 * Two shapes: `at fn (file:line:col)` and a bare `at file:line:col`. The `async`
 * prefix rides along on continuation frames and is stripped from the name rather
 * than being allowed to become part of it.
 */
const FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;

/** How far down a stack to look before giving up. */
const MAX_FRAMES = 40;

function isFrameworkFrame(file: string): boolean {
  const normalised = file.replace(/\\/g, "/");
  if (NATIVE.some((n) => normalised.includes(n))) return true;
  return FRAMEWORK_FRAGMENTS.some((f) => normalised.includes(f));
}

/** Parse one stack line into a location, or null when it is not one. */
export function parseFrame(line: string): SourceLocation | null {
  const match = FRAME.exec(line);
  if (!match) return null;
  const [, rawName, file, lineNo, column] = match;
  if (!file || !lineNo) return null;
  const name = rawName?.replace(/^async\s+/, "").trim();
  return {
    file,
    line: Number(lineNo),
    column: Number(column ?? 1),
    ...(name ? { function: name } : {}),
  };
}

/**
 * Every frame of a stack, framework noise included.
 *
 * Used for an exception, where the full trace is the point — you are reading it
 * to find out how you got somewhere, and a trace with the framework removed does
 * not tell you that.
 *
 * @param stack - An `Error.stack` string.
 * @param limit - How many frames to keep.
 */
export function parseStack(stack: string | undefined, limit = MAX_FRAMES): SourceLocation[] {
  if (!stack) return [];
  const out: SourceLocation[] = [];
  for (const line of stack.split("\n")) {
    const frame = parseFrame(line);
    if (frame) out.push(frame);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The first application frame in a stack.
 *
 * Null when every frame is framework — a query run from a seeder, a log line
 * from inside a package — which is a truthful answer and better than pointing at
 * a file the reader did not write.
 *
 * Pure, and separate from {@link captureCallSite}, because this is the part with
 * a decision in it: which frames count as yours. Taking the stack as an argument
 * is also the only way to test it from inside this package, whose own files the
 * filter is supposed to reject.
 *
 * @param stack - An `Error.stack` string.
 * @param skip - Frames to drop before looking, for a caller that knows its own
 *   wrappers are on the stack.
 */
export function firstAppFrame(stack: string | undefined, skip = 0): SourceLocation | null {
  if (!stack) return null;

  // The first line is the "Error" header on V8 and absent on JSC; `parseFrame`
  // returns null for it either way, so this does not need to know which runtime
  // it is on.
  let seen = 0;
  const lines = stack.split("\n");
  for (let i = 0; i < lines.length && i < MAX_FRAMES; i++) {
    const frame = parseFrame(lines[i]!);
    if (!frame) continue;
    if (seen++ < skip) continue;
    if (isFrameworkFrame(frame.file)) continue;
    return frame;
  }
  return null;
}

/**
 * Where in the application this was called from.
 *
 * @param skip - Frames to drop before looking. The console patch passes 1,
 *   because it stands between the caller and the stack.
 */
export function captureCallSite(skip = 0): SourceLocation | null {
  return firstAppFrame(new Error().stack, skip);
}
