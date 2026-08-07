# @zerotal/i18n

> Request-scoped internationalization with interpolation, pluralization, and fallback.

Resolves each visitor's locale automatically from the query string, a cookie, or
the `Accept-Language` header, then translates message keys with interpolation,
pluralization, and locale fallback. Translations are available on the request
context (`http.t`), through the `Lang` facade, and via the global `t()` helper.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/i18n
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { I18nProvider } from "@zerotal/i18n";

export default [I18nProvider];
```

`I18nProvider` registers `LocaleMiddleware`, which resolves the locale for every
request and injects `ctx.t()` and `ctx.locale`. Configure it in `config/i18n.ts`:

```ts
// config/i18n.ts
import { I18nConfig } from "@zerotal/i18n";
import { env } from "@zerotal/core";

export default I18nConfig({
  defaultLocale: env("APP_LOCALE", "en"),
  fallbackLocale: env("APP_FALLBACK_LOCALE", "en"),
  supportedLocales: ["en", "fr", "es"],
  resolvers: ["query", "cookie", "accept-header"], // tried in order
  queryKey: "lang", // ?lang=fr
  cookieKey: "locale", // locale=fr cookie
  loadPath: "resources/lang", // <locale>.json catalogs
});
```

## Usage

Translate from a controller via the request context:

```ts
async show({ http }: Context) {
  http.t("welcome.greeting", { name: "Alice" });       // active locale
  http.t("welcome.greeting", { name: "Alice" }, "fr"); // explicit locale
  return http.response.json({ locale: http.locale });
}
```

Anywhere else, use the `Lang` facade or the global `t()` helper — both honour the
active request locale via `I18nContext`:

```ts
import { Lang, t } from "@zerotal/i18n";

Lang.translate("auth.login.title");
t("dashboard.welcome");

// Override the resolved locale for the current request:
Lang.setLocale("fr");
```

Catalogs support nested or flat dotted keys, `{name}`/`:name` interpolation, and
pipe-separated pluralization chosen by `count`:

```json
{
  "welcome": { "greeting": "Hello, {name}!" },
  "validation.required": "The :field field is required.",
  "apples": "no apples | one apple | {count} apples"
}
```

```ts
t("apples", { count: 0 }); // "no apples"
t("apples", { count: 5 }); // "5 apples"
```

A key missing in the active locale falls back to `fallbackLocale`; if still
missing, the key itself is returned (gaps are visible, never thrown).

## Exports

- `Translator` — the core translation service (and `TranslatorOptions`).
- `I18nProvider` — registers `LocaleMiddleware` and binds the translator.
- `LocaleMiddleware` — resolves the locale per request and injects `ctx.t`/`ctx.locale`.
- `I18nContext` — async-local storage holding the active request locale.
- `Lang`, `t` — facade and global helper that read the active locale.
- `I18nConfig` / `I18nConfigShape` — config factory and its shape.
- `loadCatalogs` — load `<locale>.json` catalogs from disk.
- `resolveLocale`, `parseAcceptLanguage` — locale resolution helpers.
- Types: `Messages`, `Catalogs`, `Replacements`, `LocaleResolver`.
- Errors: `I18nError` (`E_I18N`), `CatalogLoadError` (`E_I18N_CATALOG_LOAD`).

## Documentation

- [Internationalization](../../docs/i18n.md)
