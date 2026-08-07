import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped active locale. `LocaleMiddleware` runs each request inside
 * `I18nContext.run(locale, …)` so the `Lang` facade and the global `t()` helper
 * resolve to the right language without threading it through every call.
 */
const _storage = new AsyncLocalStorage<string>();

export class I18nContext {
  /** Execute `callback` with `locale` as the active request locale. */
  static run<T>(locale: string, callback: () => T): T {
    return _storage.run(locale, callback);
  }

  /** The active request locale, or undefined outside a request boundary. */
  static current(): string | undefined {
    return _storage.getStore();
  }
}
