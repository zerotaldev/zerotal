/**
 * The `Lang` facade and the `__()` global.
 *
 * `Translator` is covered thoroughly elsewhere, but nothing in an application
 * calls it directly — apps call `Lang.translate(...)` or `__(...)`, and those go
 * through the container and the ambient locale context before they ever reach a
 * translator. That path was the untested one, which matters because its failure
 * mode is quiet: a facade resolving the wrong instance, or a helper that ignores
 * the request's locale, returns a *plausible* string in the wrong language rather
 * than throwing.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Application } from "@zerotal/core";
import { Lang, __ } from "./Lang.ts";
import { Translator } from "../Translator.ts";
import { I18nContext } from "../I18nContext.ts";

const catalogs = {
  en: { greeting: "Hello, {name}!", plain: "Plain" },
  fr: { greeting: "Bonjour, {name} !", plain: "Simple" },
};

function bindTranslator(): Translator {
  Application._resetInstance();
  const app = Application.create({ env: "test" });
  const translator = new Translator({
    catalogs: structuredClone(catalogs),
    defaultLocale: "en",
    fallbackLocale: "en",
  });
  app.container.value("i18n" as never, translator as never);
  app.adoptAsCurrent();
  return translator;
}

let translator: Translator;
beforeEach(() => {
  translator = bindTranslator();
});
afterEach(() => Application._resetInstance());

describe("Lang facade", () => {
  it("resolves the bound translator and translates through it", () => {
    expect(Lang.translate("greeting", { name: "Alice" })).toBe("Hello, Alice!");
  });

  it("forwards an explicit locale argument", () => {
    expect(Lang.translate("greeting", { name: "Alice" }, "fr")).toBe("Bonjour, Alice !");
  });

  it("exposes the same instance the container holds, not a copy", () => {
    // A facade that constructed its own translator would silently ignore an
    // app's configured catalogs — the values would come from defaults and look
    // reasonable. Mutating the bound instance and reading through the facade is
    // the cheapest proof they are one object.
    translator.addCatalog("en", { late: "Added later" });
    expect(Lang.translate("late")).toBe("Added later");
  });
});

describe("__() global", () => {
  it("delegates to the facade", () => {
    expect(__("greeting", { name: "Bob" })).toBe("Hello, Bob!");
  });

  it("passes replacements and an explicit locale through", () => {
    expect(__("greeting", { name: "Bob" }, "fr")).toBe("Bonjour, Bob !");
  });

  it("returns the key unchanged when it is missing, rather than throwing", () => {
    // A view calling __() on a key nobody added should render something inert.
    expect(__("nope.not.here")).toBe("nope.not.here");
  });
});

describe("the ambient request locale", () => {
  it("is what Lang and __() translate against inside a locale context", () => {
    // This is the whole point of the facade: a request that resolved `fr` should
    // get French from a bare `__("plain")` with no locale argument anywhere.
    I18nContext.run("fr", () => {
      expect(__("plain")).toBe("Simple");
      expect(Lang.translate("plain")).toBe("Simple");
    });
  });

  it("falls back to the default locale outside any context", () => {
    expect(__("plain")).toBe("Plain");
  });

  it("does not leak the locale past the context", () => {
    I18nContext.run("fr", () => __("plain"));
    expect(__("plain")).toBe("Plain");
  });

  it("lets an explicit locale argument win over the ambient one", () => {
    I18nContext.run("fr", () => {
      expect(__("plain", undefined, "en")).toBe("Plain");
    });
  });
});
