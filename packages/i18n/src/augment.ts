import type { Translator } from "./Translator.ts";
import type { Replacements } from "./types.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    /** The translation service — registered by I18nProvider. */
    i18n: Translator;
  }

  interface HttpContext {
    /**
     * Translate a key using this request's resolved locale.
     *
     * @example
     * ctx.t('welcome.greeting', { name: 'Alice' });
     * ctx.t('welcome.greeting', { name: 'Alice' }, 'fr'); // explicit locale
     */
    t(key: string, replacements?: Replacements, locale?: string): string;
  }
}

export {};
