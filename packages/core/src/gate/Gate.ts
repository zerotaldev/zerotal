/**
 * The site gate: maintenance, and private preview.
 *
 * The primitive is here and the button is yours. An app that wants a toggle in
 * its own console builds it against this; `zt down` / `zt preview` / `zt up` are
 * the same three calls with a terminal in front of them.
 *
 * @example
 * ```ts
 * import { Gate } from "@zerotal/core/gate";
 *
 * await Gate.preview({ token, until: "2026-09-30", by: user.name });
 * await Gate.maintenance({ retryAfter: 120, by: user.name });
 * await Gate.open();
 * Gate.status(); // { mode: "preview", since, until, by } — never the token
 * ```
 *
 * @module
 */
import { clearGate, gateExpired, hashToken, readGate, writeGate, type GateState } from "./state.ts";

/** Options for {@link Gate.maintenance}. */
export interface MaintenanceOptions {
  /**
   * Seconds to put in `Retry-After`. Defaults to 60.
   *
   * Worth setting honestly: a crawler that is told 60 and finds the site still
   * down an hour later treats the next number with less patience.
   */
  retryAfter?: number | undefined;
  /** Who raised it. Shown by `Gate.status()` and `zt doctor`. */
  by?: string | undefined;
}

/** Options for {@link Gate.preview}. */
export interface PreviewOptions {
  /**
   * The secret that admits a visitor, via `?preview=<token>`.
   *
   * Stored as a hash, so this value cannot be read back out — keep the copy you
   * hand to testers. Passing a new one rotates: every cookie issued under the
   * old token stops working, which is the point, because the way a preview
   * leaks is a tester forwarding the link to somebody who has left.
   */
  token: string;
  /** ISO date the preview lifts itself on, e.g. `"2026-09-30"`. */
  until?: string | undefined;
  /** Who raised it. */
  by?: string | undefined;
}

/** What {@link Gate.status} reports. Deliberately never includes the token. */
export interface GateStatus {
  mode: GateState["mode"] | "open";
  since?: string | undefined;
  until?: string | undefined;
  by?: string | undefined;
  retryAfter?: number | undefined;
  /** Whether `until` has passed — the gate is still up and should not be. */
  expired?: boolean | undefined;
}

/**
 * Read and write the site gate.
 *
 * Synchronous underneath — the state is one small file — but the methods that
 * change it are `async` so an app's own console handler can `await` them without
 * caring, and so a future driver (shared storage, for a multi-instance deploy)
 * does not change the signature.
 */
export const Gate = {
  /**
   * Take the site down. Everyone is refused, staff included.
   *
   * Answered `503` with `Retry-After`, never `200`. A maintenance page served at
   * `200` tells a search engine that "we will be back shortly" is the content of
   * your homepage, and it will index it as such.
   */
  async maintenance(options: MaintenanceOptions = {}): Promise<void> {
    writeGate({
      mode: "maintenance",
      since: new Date().toISOString(),
      retryAfter: options.retryAfter ?? 60,
      ...(options.by ? { by: options.by } : {}),
    });
  },

  /**
   * Put the site behind a private preview. Invited visitors get the real site.
   *
   * @throws When the token is shorter than 16 characters. A preview token is a
   *   password on the whole site with no rate limit in front of it, and a short
   *   one chosen by hand is the failure this refuses rather than documents.
   */
  async preview(options: PreviewOptions): Promise<void> {
    if (options.token.length < 16) {
      throw new Error(
        "[Zerotal] A preview token must be at least 16 characters. It is the only thing " +
          "between the public and an unlaunched site, and nothing rate-limits guesses at it. " +
          "Generate one with `zt preview` and no --token.",
      );
    }
    writeGate({
      mode: "preview",
      since: new Date().toISOString(),
      tokenHash: hashToken(options.token),
      ...(options.until ? { until: options.until } : {}),
      ...(options.by ? { by: options.by } : {}),
    });
  },

  /** Open the site. Opening an already-open site is not an error. */
  async open(): Promise<void> {
    clearGate();
  },

  /** What the gate is doing, for a console or a health page. Never the token. */
  status(): GateStatus {
    const state = readGate();
    if (!state) return { mode: "open" };
    return {
      mode: state.mode,
      since: state.since,
      until: state.until,
      by: state.by,
      retryAfter: state.retryAfter,
      expired: gateExpired(state),
    };
  },
};
