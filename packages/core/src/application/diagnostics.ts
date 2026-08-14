/**
 * Diagnoses for the development error page.
 *
 * The overlay is good at showing *what* threw and bad at saying what to do about
 * it. `no such table: assets` is the canonical case: the message is exact, the
 * stack is entirely framework frames, and the answer — "you have three
 * migrations you have not run" — lives in a package `@zerotal/core` cannot
 * import, because `@zerotal/orm` depends on it and not the other way round.
 *
 * So the overlay asks instead. A package registers a diagnoser, the error page
 * runs them in order, and the first one that recognises the error contributes a
 * panel. A diagnoser that recognises nothing returns `null` and costs a function
 * call.
 *
 * @example
 * ```ts
 * registerErrorDiagnoser((error) => {
 *   const missing = detectMissingTable(error);
 *   if (!missing) return null;
 *   return { title: `The ${missing} table does not exist.`, detail: "…" };
 * });
 * ```
 */
import type { HttpContext } from "../pipeline/HttpContext.ts";

/**
 * A button the overlay may offer.
 *
 * Deliberately narrow: a `POST` to a same-origin path, carrying a token the page
 * was given. It exists so a diagnosis can *fix* the thing it diagnosed, and the
 * shape is constrained because that means a page rendered by a GET can change
 * server state — see the safety note on {@link ErrorDiagnosis}.
 */
export interface DiagnosisAction {
  /** Button text, e.g. `"Run 3 migrations"`. */
  label: string;
  /** Same-origin path the button posts to. */
  url: string;
  /** Single-use token minted for this render, required by the endpoint. */
  token: string;
  /** Text shown while the request is in flight. */
  pendingLabel?: string;
}

/**
 * What a diagnoser concluded.
 *
 * > ⚠️ **An `action` mutates server state from a page rendered by a GET.** A dev
 * > server on `localhost:3000` is reachable by any site the developer has open in
 * > another tab, so the endpoint behind one must: refuse outside development on
 * > its own terms rather than trusting that the overlay is dev-only, require the
 * > `token`, and check the origin. Whoever registers the endpoint owns all three
 * > — this type only carries them to the page.
 */
export interface ErrorDiagnosis {
  /** One line: what is actually wrong. */
  title: string;
  /** A short paragraph: why, and what to do. */
  detail: string;
  /** Supporting specifics — migration names, candidate files. Rendered as a list. */
  items?: string[];
  /** Offered only when the diagnosis is confident enough to be actionable. */
  action?: DiagnosisAction;
}

export type ErrorDiagnoser = (
  error: Error,
  ctx?: HttpContext,
) => ErrorDiagnosis | null | Promise<ErrorDiagnosis | null>;

const _diagnosers: ErrorDiagnoser[] = [];

/**
 * Contribute a diagnosis to the development error page.
 *
 * Registered from a provider's `onRegister()`. Diagnosers run in registration
 * order and the first non-null result wins, so a package should recognise only
 * errors it genuinely owns.
 */
export function registerErrorDiagnoser(diagnoser: ErrorDiagnoser): void {
  _diagnosers.push(diagnoser);
}

/**
 * Run the registered diagnosers and return the first result.
 *
 * A diagnoser that throws is skipped: it runs while an error page is already
 * being rendered, and failing there would replace a useful stack trace with a
 * useless one.
 *
 * @internal
 */
export async function _diagnoseError(
  error: Error,
  ctx?: HttpContext,
): Promise<ErrorDiagnosis | null> {
  for (const diagnoser of _diagnosers) {
    try {
      const result = await diagnoser(error, ctx);
      if (result) return result;
    } catch {
      // See above — a broken diagnoser must not take the error page with it.
    }
  }
  return null;
}

/** Drop every registered diagnoser. Tests. @internal */
export function _resetErrorDiagnosers(): void {
  _diagnosers.length = 0;
}
