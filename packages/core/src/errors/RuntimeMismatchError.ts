/**
 * The error raised when a project has two Bun runtimes in it — the one this
 * process is executing under, and a different one installed in `node_modules`.
 */
import { ZerotalError } from "./ZerotalError.ts";
import type { RuntimeMismatch } from "../support/runtime.ts";

/**
 * Raised by `startZerotal()` when the running Bun and the installed Bun disagree.
 *
 * Carries both versions in `context` so a harness can report the disagreement
 * rather than re-deriving it from the message.
 */
export class RuntimeMismatchError extends ZerotalError {
  constructor(
    message: string,
    public readonly mismatch: RuntimeMismatch,
  ) {
    super(message, "E_RUNTIME_MISMATCH", 500, { ...mismatch });
  }
}
