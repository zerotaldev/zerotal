import { createFacade } from "@zerotal/core";
import type { Replacements } from "../types.ts";

/**
 * Facade for the translation service (container key `i18n`). Resolves against
 * the active request locale via I18nContext.
 *
 * @example
 * import { Lang } from '@zerotal/i18n';
 * Lang.translate('welcome.greeting', { name: 'Alice' });
 */
export const Lang = createFacade<"i18n">("i18n");

/**
 * The global translation helper.
 *
 * The argument is the English sentence, not a symbolic name: `__('Email')`,
 * never `__('auth.email')`. English is the source language, so the source text
 * doubles as the key — which means the default locale needs no catalog at all,
 * and a string that has never been translated still renders as the words the
 * developer wrote.
 *
 * @example
 * __('Email');
 * __('{count} unread', { count: 5 });
 * __('Signed out.', {}, 'zu'); // explicit locale, for queue jobs
 */
export function __(key: string, replacements?: Replacements, locale?: string): string {
  return Lang.translate(key, replacements, locale);
}
