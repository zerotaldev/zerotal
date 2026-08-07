import { RequestContext } from "@zerotal/core";

/**
 * Per-request Inertia history-encryption flags.
 *
 * The server does not encrypt anything itself — encryption happens client-side. The server's job is
 * to set the `encryptHistory` / `clearHistory` flags on the page object; the Inertia client reacts
 * to them. Flags are stored per-request (keyed by the active HttpContext) so concurrent requests
 * don't interfere.
 */
interface HistoryFlags {
  encrypt?: boolean;
  clear?: boolean;
}

const _store = new WeakMap<object, HistoryFlags>();
let _defaultEncrypt = false;

/**
 * Set the global default for history encryption (from `inertia.encryptHistory` config).
 *
 * @param on - When `true`, every page encrypts its history state unless overridden per request.
 * @internal
 */
export function setHistoryEncryptionDefault(on: boolean): void {
  _defaultEncrypt = on;
}

function flagsForCurrent(): HistoryFlags {
  const ctx = RequestContext.get() as unknown as object;
  let flags = _store.get(ctx);
  if (!flags) {
    flags = {};
    _store.set(ctx, flags);
  }
  return flags;
}

/**
 * Encrypt the current page's history state in the browser (protects props cached in
 * `history.state` for a page holding sensitive data). Effective for the current request.
 *
 * @param on - Pass `false` to opt this page out when encryption is the global default. Default `true`.
 * @example
 * ```ts
 * async show(http: HttpContext): Promise<void> {
 *   Inertia.encryptHistory();
 *   return inertia('Account/Settings', { account });
 * }
 * ```
 */
export function encryptHistory(on = true): void {
  flagsForCurrent().encrypt = on;
}

/**
 * Clear any previously encrypted history state — call on logout so cached page data
 * can't be recovered via the browser Back button.
 *
 * @example
 * ```ts
 * async destroy(http: HttpContext): Promise<void> {
 *   await Auth.logout();
 *   Inertia.clearHistory();
 *   return redirect('/login');
 * }
 * ```
 */
export function clearHistory(): void {
  flagsForCurrent().clear = true;
}

/** @internal Resolve the effective flags for the current request, applying the global default. */
export function readHistoryFlags(): { encryptHistory?: boolean; clearHistory?: boolean } {
  const ctx = RequestContext.tryGet() as unknown as object | undefined;
  const flags = ctx ? _store.get(ctx) : undefined;
  const encrypt = flags?.encrypt ?? _defaultEncrypt;
  const out: { encryptHistory?: boolean; clearHistory?: boolean } = {};
  if (encrypt) out.encryptHistory = true;
  if (flags?.clear) out.clearHistory = true;
  return out;
}
