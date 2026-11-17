/**
 * The error raised when a feature needs a package the app has not installed.
 */
import { ZerotalError } from "./ZerotalError.ts";

/** The missing package, what needed it, and the two ways forward. */
export interface OptionalPeerMissing {
  /** The package to install, e.g. `sharp` or `@anthropic-ai/sdk`. */
  peer: string;
  /** What the app asked for that needs it. */
  feature: string;
  /** The command that installs it. */
  install: string;
  /** What to do instead, when there is a built-in alternative. */
  alternative?: string | undefined;
}

/**
 * Raised by `optionalPeer()` when an optional peer dependency is not installed.
 *
 * Coded `E_OPTIONAL_PEER_MISSING`. The resolver's own error is kept as `cause`, and
 * the missing package, the feature and the install command are on `missing` and in
 * `context`, so a doctor check or a log line can report them without parsing the
 * message.
 */
export class OptionalPeerMissingError extends ZerotalError {
  constructor(
    public readonly missing: OptionalPeerMissing,
    cause?: unknown,
  ) {
    super(
      `${missing.feature} needs the optional package "${missing.peer}", which is not installed.\n` +
        `  Install it: ${missing.install}` +
        (missing.alternative ? `\n  Or instead: ${missing.alternative}` : ""),
      "E_OPTIONAL_PEER_MISSING",
      500,
      { ...missing },
    );
    if (cause !== undefined) this.cause = cause;
  }
}
