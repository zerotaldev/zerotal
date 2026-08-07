import type { Pipe, NextFn, HttpContext } from "@zerotal/core";
import { resolveLocale } from "./locale.ts";
import { I18nContext } from "./I18nContext.ts";
import type { Translator } from "./Translator.ts";
import type { I18nConfigShape } from "./config.ts";

/**
 * Resolves the request locale, exposes `ctx.locale` + `ctx.t()`, and runs the
 * rest of the pipeline inside `I18nContext.run()` so the `Lang` facade and the
 * global `t()` helper see the right locale. Configured by I18nProvider via
 * `LocaleMiddleware.configure()` and registered with `app.useOnce()`.
 */
export class LocaleMiddleware implements Pipe<HttpContext> {
  private static _translator: Translator | null = null;
  private static _config: I18nConfigShape | null = null;

  static configure(translator: Translator, config: I18nConfigShape): void {
    LocaleMiddleware._translator = translator;
    LocaleMiddleware._config = config;
  }

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const translator = LocaleMiddleware._translator;
    const config = LocaleMiddleware._config;
    if (!translator || !config) return next();

    const locale = resolveLocale(http.request, config);
    http.locale = locale;
    http.t = (key, replacements, loc) => translator.translate(key, replacements, loc ?? locale);

    return I18nContext.run(locale, () => next());
  }
}
