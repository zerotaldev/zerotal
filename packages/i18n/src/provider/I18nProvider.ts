import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import { Translator } from "../Translator.ts";
import { loadCatalogs } from "../loadCatalogs.ts";
import { LocaleMiddleware } from "../LocaleMiddleware.ts";
import { I18nConfig } from "../config.ts";
import type { I18nConfigShape } from "../config.ts";
import { __ } from "../facades/Lang.ts";
import "../augment.ts";

/**
 * Registers the translation service and wires request-locale resolution.
 *
 * @example
 * // bootstrap/providers.ts
 * import { I18nProvider } from '@zerotal/i18n';
 * export default [I18nProvider];
 *
 * // config/i18n.ts
 * import { I18nConfig } from '@zerotal/i18n';
 * export default I18nConfig({ supportedLocales: ['en', 'fr'], loadPath: 'resources/lang' });
 */
export class I18nProvider extends ServiceProvider {
  static override provides = ["i18n"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test", "repl"];

  private async _resolveConfig(): Promise<I18nConfigShape> {
    const cfg = (await this.app.container.make("config")) as {
      get<T>(path: string): T | undefined;
    };
    return I18nConfig(cfg.get<Partial<I18nConfigShape>>("i18n") ?? {});
  }

  override onRegister(): void {
    this.app.container.singleton("i18n", async () => {
      const config = await this._resolveConfig();
      const catalogs = {
        ...(config.loadPath ? await loadCatalogs(config.loadPath) : {}),
        ...(config.catalogs ?? {}),
      };
      return new Translator({
        catalogs,
        defaultLocale: config.defaultLocale,
        fallbackLocale: config.fallbackLocale,
      });
    });
  }

  override async onBooting(): Promise<void> {
    const translator = (await this.app.container.make("i18n")) as Translator;
    const config = await this._resolveConfig();
    LocaleMiddleware.configure(translator, config);
    this.app.useOnce(LocaleMiddleware);

    // `__()` without an import, for every route, view, job and notification in
    // the app. Installed here rather than at module load because it is only
    // honest once there is a translator behind it: a global that resolves
    // against an unbound container would answer every string with itself, which
    // reads as "not translated yet" rather than as "i18n is not installed".
    //
    // The declaration that makes it type-check lives in `augment.ts`, beside the
    // `HttpContext` one, since both are the same kind of ambient promise.
    (globalThis as { __?: typeof __ }).__ = __;
  }
}
