/**
 * The site gate's state, and where it is kept.
 *
 * Two modes that look alike and behave differently, which is why building one
 * and calling it both goes wrong:
 *
 * - **`maintenance`** — the site is *down*. Nobody may use it, staff included,
 *   because the usual reason it is down is that the database is being migrated
 *   underneath it. Minutes, not weeks. A request is answered `503` with
 *   `Retry-After`.
 * - **`preview`** — the site is *up and working perfectly*, for the people
 *   invited to it. Not down, not broken, not public yet. Weeks. An invited
 *   visitor gets the real site at `200` and can transact on it.
 *
 * ## Why a file, and not the database
 *
 * A flag in the database is unreadable exactly when the database is the thing
 * you are working on, so a maintenance mode kept there is one that works only on
 * the days you did not need it. A file is also why the gate survives a restart —
 * an in-memory flag would be lifted by the very deploy that was supposed to run
 * behind it.
 *
 * ## Why the token is stored as a hash
 *
 * The state file sits on disk, readable by anything on the box and copied by
 * every backup. Storing the preview token there would put a live credential in
 * a file whose whole job is to be easy to read — the same mistake as a
 * `.env.example` carrying a working key. Only `sha256Hex(token)` is written, so
 * the file can verify a token and cannot leak one, and rotating means writing a
 * new hash.
 *
 * @module
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256Hex } from "../support/crypto.ts";

/** Which of the two states the site is in. */
export type GateMode = "maintenance" | "preview";

/** What the gate records about itself. */
export interface GateState {
  mode: GateMode;
  /** ISO timestamp the gate was raised. */
  since: string;
  /**
   * ISO date the gate lifts itself on, when one was set.
   *
   * A pre-launch gate outlives its purpose more often than it is taken down on
   * time, so the deadline is worth recording even when nothing enforces it.
   */
  until?: string | undefined;
  /** Who raised it, for a console that can say more than "on". */
  by?: string | undefined;
  /** `sha256Hex` of the preview token. Never the token. `preview` only. */
  tokenHash?: string | undefined;
  /** Seconds for the `Retry-After` header. `maintenance` only. */
  retryAfter?: number | undefined;
}

/** Where the state file lives, relative to the project root. */
export const GATE_FILE = join("storage", "framework", "gate.json");

function _path(root: string): string {
  return join(root, GATE_FILE);
}

/**
 * Read the gate's state, or `null` when the site is open.
 *
 * Never throws. A corrupt or unreadable file reads as **open**, deliberately: a
 * gate that fails closed would take a site down because a JSON file lost a
 * brace, and "the site is up" is the safer error for a mechanism whose whole
 * purpose is to be turned off again.
 *
 * @param root - Project root. Defaults to the working directory.
 */
export function readGate(root: string = process.cwd()): GateState | null {
  try {
    const raw = readFileSync(_path(root), "utf8");
    const state = JSON.parse(raw) as GateState;
    if (state.mode !== "maintenance" && state.mode !== "preview") return null;
    return state;
  } catch {
    return null;
  }
}

/**
 * Write the gate's state, creating `storage/framework/` if it is not there.
 *
 * @param state - The state to record.
 * @param root - Project root. Defaults to the working directory.
 */
export function writeGate(state: GateState, root: string = process.cwd()): void {
  const file = _path(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Remove the state file. Opening an already-open site is not an error. */
export function clearGate(root: string = process.cwd()): void {
  rmSync(_path(root), { force: true });
}

/** Whether a state file exists at all, without parsing it. */
export function gateFileExists(root: string = process.cwd()): boolean {
  return existsSync(_path(root));
}

/**
 * Whether a `until` date has passed.
 *
 * Compared as a date rather than an instant: `until: "2026-09-30"` means "through
 * the 30th", which is what someone typing a date means.
 */
export function gateExpired(state: GateState, now: Date = new Date()): boolean {
  if (!state.until) return false;
  const end = new Date(`${state.until.slice(0, 10)}T23:59:59.999Z`);
  if (Number.isNaN(end.getTime())) return false;
  return now.getTime() > end.getTime();
}

/** Hash a preview token for storage. Exported so the CLI and the API agree. */
export function hashToken(token: string): string {
  return sha256Hex(token);
}
