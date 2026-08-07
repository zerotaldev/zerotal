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
 * Convenience global translation helper — handy as a view global.
 *
 * @example
 * t('messages.unread', { count: 5 });
 */
export function t(key: string, replacements?: Replacements, locale?: string): string {
  return Lang.translate(key, replacements, locale);
}
