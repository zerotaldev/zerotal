import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { HttpContext, ZerotalError } from "@zerotal/core";
import { Translator } from "./Translator.ts";
import { I18nContext } from "./I18nContext.ts";
import { I18nConfig } from "./config.ts";
import { resolveLocale, parseAcceptLanguage } from "./locale.ts";
import { loadCatalogs } from "./loadCatalogs.ts";
import { LocaleMiddleware } from "./LocaleMiddleware.ts";
import { I18nError, CatalogLoadError } from "./errors.ts";

const catalogs = {
  en: {
    welcome: { greeting: "Hello, {name}!" },
    "validation.required": "The :field field is required.",
    apples: "no apples | one apple | {count} apples",
    items: "{count} item | {count} items",
    only_en: "English only",
  },
  fr: {
    welcome: { greeting: "Bonjour, {name} !" },
    apples: "aucune pomme | une pomme | {count} pommes",
  },
};
const make = () =>
  new Translator({
    catalogs: structuredClone(catalogs),
    defaultLocale: "en",
    fallbackLocale: "en",
  });

describe("Translator — lookup", () => {
  it("resolves nested dot-paths and flat dotted keys", () => {
    const t = make();
    expect(t.translate("welcome.greeting", { name: "Alice" })).toBe("Hello, Alice!");
    expect(t.translate("validation.required", { field: "Email" })).toBe(
      "The Email field is required.",
    );
  });
  it("returns the key unchanged when missing", () => {
    expect(make().translate("does.not.exist")).toBe("does.not.exist");
  });
  it("falls back to the fallback locale", () => {
    const t = new Translator({
      catalogs: structuredClone(catalogs),
      defaultLocale: "fr",
      fallbackLocale: "en",
    });
    expect(t.translate("only_en")).toBe("English only"); // missing in fr → en fallback
  });
  it("has() checks active + fallback locale", () => {
    const t = make();
    expect(t.has("welcome.greeting")).toBe(true);
    expect(t.has("nope")).toBe(false);
  });
});

describe("Translator — interpolation & pluralization", () => {
  it("interpolates both {var} and :var", () => {
    const t = make();
    expect(t.translate("welcome.greeting", { name: "X" })).toBe("Hello, X!");
    expect(t.translate("validation.required", { field: "Name" })).toBe(
      "The Name field is required.",
    );
  });
  it("pluralizes 3-segment messages by count", () => {
    const t = make();
    expect(t.translate("apples", { count: 0 })).toBe("no apples");
    expect(t.translate("apples", { count: 1 })).toBe("one apple");
    expect(t.translate("apples", { count: 5 })).toBe("5 apples");
  });
  it("pluralizes 2-segment messages (singular | plural)", () => {
    const t = make();
    expect(t.translate("items", { count: 1 })).toBe("1 item");
    expect(t.translate("items", { count: 3 })).toBe("3 items");
  });
  it("translate(locale) overrides the default", () => {
    expect(make().translate("welcome.greeting", { name: "Léa" }, "fr")).toBe("Bonjour, Léa !");
  });
});

describe("I18nContext", () => {
  it("drives the translator default locale within run()", () => {
    const t = make();
    expect(t.translate("welcome.greeting", { name: "A" })).toBe("Hello, A!"); // default en
    I18nContext.run("fr", () => {
      expect(I18nContext.current()).toBe("fr");
      expect(t.translate("welcome.greeting", { name: "A" })).toBe("Bonjour, A !");
    });
    expect(I18nContext.current()).toBeUndefined();
  });
});

describe("resolveLocale / parseAcceptLanguage", () => {
  const cfg = I18nConfig({ defaultLocale: "en", supportedLocales: ["en", "fr", "es"] });
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it("orders Accept-Language by quality", () => {
    expect(parseAcceptLanguage("fr;q=0.8, en;q=0.9, es;q=0.1")).toEqual(["en", "fr", "es"]);
  });
  it("resolves from the query string", () => {
    expect(resolveLocale(req("https://x/?lang=fr"), cfg)).toBe("fr");
  });
  it("resolves from a cookie", () => {
    expect(resolveLocale(req("https://x/", { cookie: "theme=dark; locale=es" }), cfg)).toBe("es");
  });
  it("resolves from Accept-Language, including base language", () => {
    expect(resolveLocale(req("https://x/", { "accept-language": "fr-FR,fr;q=0.9" }), cfg)).toBe(
      "fr",
    );
  });
  it("ignores unsupported locales and falls back to default", () => {
    expect(resolveLocale(req("https://x/?lang=de"), cfg)).toBe("en");
  });
  it("honours resolver order (query beats accept-header)", () => {
    const url = req("https://x/?lang=es", { "accept-language": "fr" });
    expect(resolveLocale(url, cfg)).toBe("es");
  });
});

describe("loadCatalogs", () => {
  const TMP = `./.tmp-lang-${Date.now()}`;
  beforeAll(async () => {
    await Bun.write(`${TMP}/en.json`, JSON.stringify({ hi: "Hi" }));
    await Bun.write(`${TMP}/fr.json`, JSON.stringify({ hi: "Salut" }));
  });
  afterAll(async () => {
    await rm(TMP, { recursive: true, force: true }).catch(() => {});
  });

  it("loads <locale>.json files into a catalog map", async () => {
    const c = await loadCatalogs(TMP);
    expect(Object.keys(c).sort()).toEqual(["en", "fr"]);
    expect((c.en as Record<string, string>).hi).toBe("Hi");
  });
  it("returns an empty map for a missing directory", async () => {
    expect(await loadCatalogs("./.nope-dir")).toEqual({});
  });
  it("throws CatalogLoadError on malformed JSON", async () => {
    await Bun.write(`${TMP}/bad.json`, "{ not json");
    await expect(loadCatalogs(TMP)).rejects.toBeInstanceOf(CatalogLoadError);
  });
});

describe("LocaleMiddleware", () => {
  it("sets ctx.locale + ctx.t and runs the chain inside the locale context", async () => {
    LocaleMiddleware.configure(make(), I18nConfig({ supportedLocales: ["en", "fr"] }));
    const mw = new LocaleMiddleware();
    const ctx = HttpContext.fake("http://localhost/?lang=fr");
    let seenInside: string | undefined;
    const sentinel = new Response("ok");
    const result = await mw.handle(ctx, async () => {
      seenInside = I18nContext.current();
      ctx.response = sentinel;
      return ctx.response;
    });
    if (result instanceof Response) ctx.response = result;
    // The downstream response flows back out through the middleware.
    expect(ctx.response).toBe(sentinel);
    expect(ctx.locale).toBe("fr");
    expect(seenInside).toBe("fr");
    expect(ctx.t("welcome.greeting", { name: "Z" })).toBe("Bonjour, Z !");
    expect(ctx.t("welcome.greeting", { name: "Z" }, "en")).toBe("Hello, Z!");
  });
});

describe("config + errors", () => {
  it("I18nConfig applies defaults and overrides", () => {
    const d = I18nConfig();
    expect(d).toMatchObject({
      defaultLocale: "en",
      fallbackLocale: "en",
      resolvers: ["query", "cookie", "accept-header"],
      queryKey: "lang",
      cookieKey: "locale",
    });
    const o = I18nConfig({ defaultLocale: "fr", supportedLocales: ["fr", "en"] });
    expect(o.fallbackLocale).toBe("fr");
    expect(o.supportedLocales).toEqual(["fr", "en"]);
  });
  it("errors extend I18nError/ZerotalError with stable codes", () => {
    const e = new CatalogLoadError("x/en.json", new Error("bad"));
    expect(e).toBeInstanceOf(I18nError);
    expect(e).toBeInstanceOf(ZerotalError);
    expect(e.code).toBe("E_I18N_CATALOG_LOAD");
  });
});
