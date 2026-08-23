/**
 * What an upgrade codemod is, and what it has to report.
 *
 * The shape is built around one belief: **the interesting output of an upgrade
 * tool is what it could not do.** A codemod that rewrites nine call sites and
 * silently walks past a tenth it did not understand is worse than one that
 * rewrites nothing, because the nine give the impression the job is finished.
 * So a codemod returns two lists, and the runner prints the second one louder.
 */

/** A file the codemod would rewrite, or did. */
export interface Change {
  /** Repo-relative path, forward slashes. */
  file: string;
  /** What changed, in a line a person can scan — "3 × `BaseModel` → `Model`". */
  summary: string;
  /** The rewritten contents. Held rather than written, so `--dry` costs nothing extra. */
  contents: string;
}

/**
 * Something the codemod recognised and deliberately did not touch.
 *
 * Not an error — a handover. Each one is a place the author has to look, with
 * enough detail to find it and a reason that explains why a machine should not
 * decide.
 */
export interface Manual {
  file: string;
  /** 1-based, so it can be clicked. */
  line: number;
  /** The line as it stands. */
  text: string;
  /** Why this one is a person's call. */
  reason: string;
}

export interface CodemodResult {
  changes: Change[];
  manual: Manual[];
}

/** One file handed to a codemod. */
export interface SourceFile {
  file: string;
  contents: string;
}

export interface Codemod {
  /**
   * The release that makes this necessary.
   *
   * Codemods run in version order, and only those between the app's current
   * version and the target. A codemod for 2.0.0 does not run on an app moving
   * from 1.6 to 1.7.
   */
  version: string;
  /** Stable identifier, for `--only` and for reporting. */
  name: string;
  /** One line, shown in the plan before anything is written. */
  description: string;
  /** The ledger entry this pays, if it pays one. */
  ledger?: number;
  /** Files this wants to see. Keeps a codemod from scanning what it cannot use. */
  extensions?: string[];
  run(files: SourceFile[]): CodemodResult;
}

/** Compare two `x.y.z` strings numerically. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
