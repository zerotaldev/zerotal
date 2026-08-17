import type { Translator } from "./Translator.ts";
import type { Replacements } from "./types.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    /** The translation service — registered by I18nProvider. */
    i18n: Translator;
  }

  interface HttpContext {
    /**
     * Translate an English source string using this request's resolved locale.
     *
     * @example
     * ctx.__('Hello, {name}!', { name: 'Alice' });
     * ctx.__('Hello, {name}!', { name: 'Alice' }, 'fr'); // explicit locale
     */
    __(key: string, replacements?: Replacements, locale?: string): string;
  }
}

/**
 * `__()` without an import.
 *
 * `I18nProvider` puts the helper on `globalThis` when it boots, and this is the
 * declaration that lets a route or a view call `__("Email")` with no import
 * line. The signature is the named export's, so nothing about a call site
 * changes except what is missing from the top of the file.
 *
 * `var` rather than `const`, because only `var` in a `declare global` block
 * creates a matching property on `globalThis` for the assignment to satisfy.
 */
declare global {
  var __: (key: string, replacements?: Replacements, locale?: string) => string;
}

export {};
