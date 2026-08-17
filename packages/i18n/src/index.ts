// @zerotal/i18n — public API

// Core service
export { Translator } from "./Translator.ts";
export type { TranslatorOptions } from "./Translator.ts";

// Request-scoped locale
export { I18nContext } from "./I18nContext.ts";

// Provider + middleware
export { I18nProvider } from "./provider/I18nProvider.ts";
export { LocaleMiddleware } from "./LocaleMiddleware.ts";

// Facade + helper
export { Lang, __ } from "./facades/Lang.ts";

// Config
export { I18nConfig } from "./config.ts";
export type { I18nConfigShape } from "./config.ts";

// Catalog loading + locale resolution
export { loadCatalogs } from "./loadCatalogs.ts";
export { resolveLocale, parseAcceptLanguage } from "./locale.ts";

// Types
export type { Messages, Catalogs, Replacements, LocaleResolver } from "./types.ts";

// Typed error vocabulary
export * from "./errors.ts";

// Side-effect: activate @zerotal/core HttpContext + ContainerBindings augmentation.
import "./augment.ts";
