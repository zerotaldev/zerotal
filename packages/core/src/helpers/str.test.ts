import { describe, it, expect } from "bun:test";
import { Str } from "./str.ts";

describe("Str.camelCase()", () => {
  it("converts dash-separated to camelCase", () => {
    expect(Str.camelCase("hello-world")).toBe("helloWorld");
  });

  it("converts underscore-separated to camelCase", () => {
    expect(Str.camelCase("hello_world")).toBe("helloWorld");
  });

  it("converts space-separated to camelCase", () => {
    expect(Str.camelCase("hello world")).toBe("helloWorld");
  });

  it("lowercases the result entirely first", () => {
    expect(Str.camelCase("HELLO_WORLD")).toBe("helloWorld");
  });

  it("handles single word", () => {
    expect(Str.camelCase("hello")).toBe("hello");
  });

  it("collapses multiple separators", () => {
    expect(Str.camelCase("hello--world")).toBe("helloWorld");
  });
});

describe("Str.snakeCase()", () => {
  it("converts camelCase to snake_case", () => {
    expect(Str.snakeCase("helloWorld")).toBe("hello_world");
  });

  it("handles consecutive uppercase (HTMLParser → html_parser)", () => {
    expect(Str.snakeCase("HTMLParser")).toBe("html_parser");
  });

  it("passes through already snake_case", () => {
    expect(Str.snakeCase("hello_world")).toBe("hello_world");
  });

  it("lowercases the result", () => {
    expect(Str.snakeCase("Hello")).toBe("hello");
  });
});

describe("Str.capitalize()", () => {
  it("upper-cases only the first character", () => {
    expect(Str.capitalize("hello world")).toBe("Hello world");
  });

  it("leaves an already-capitalized string unchanged", () => {
    expect(Str.capitalize("Hello")).toBe("Hello");
  });

  it("handles the empty string", () => {
    expect(Str.capitalize("")).toBe("");
  });
});

describe("Str.lcfirst()", () => {
  it("lower-cases only the first character", () => {
    expect(Str.lcfirst("BlogPost")).toBe("blogPost");
  });

  it("leaves an already-lowercased string unchanged", () => {
    expect(Str.lcfirst("user")).toBe("user");
  });
});

describe("Str.slugify()", () => {
  it("converts camelCase to slug", () => {
    expect(Str.slugify("helloWorld")).toBe("hello-world");
  });

  it("converts spaced string to slug", () => {
    expect(Str.slugify("hello world")).toBe("hello-world");
  });

  it("strips accents/diacritics", () => {
    expect(Str.slugify("café résumé")).toBe("cafe-resume");
  });

  it("strips non-alphanumeric characters", () => {
    expect(Str.slugify("Hello, World!")).toBe("hello-world");
  });

  it("collapses multiple dashes", () => {
    expect(Str.slugify("hello   world")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(Str.slugify("  hello world  ")).toBe("hello-world");
  });
});

describe("Str.titleCase()", () => {
  it("capitalises the first letter of each word", () => {
    expect(Str.titleCase("hello world")).toBe("Hello World");
  });

  it("handles single word", () => {
    expect(Str.titleCase("hello")).toBe("Hello");
  });

  it("leaves already-titlecased strings unchanged", () => {
    expect(Str.titleCase("Hello World")).toBe("Hello World");
  });
});

describe("Str.pascalCase()", () => {
  it("converts dash-separated to PascalCase", () => {
    expect(Str.pascalCase("hello-world")).toBe("HelloWorld");
  });

  it("converts camelCase to PascalCase", () => {
    expect(Str.pascalCase("helloWorld")).toBe("HelloWorld");
  });

  it("single word is capitalised", () => {
    expect(Str.pascalCase("hello")).toBe("Hello");
  });
});

describe("Str.truncate()", () => {
  it("truncates and appends default suffix '...'", () => {
    expect(Str.truncate("hello world", 7)).toBe("hell...");
  });

  it("returns the string unchanged when at or below maxLength", () => {
    expect(Str.truncate("hi", 5)).toBe("hi");
    expect(Str.truncate("hello", 5)).toBe("hello");
  });

  it("uses a custom suffix", () => {
    expect(Str.truncate("hello world", 8, "…")).toBe("hello w…");
  });

  it("handles maxLength shorter than suffix gracefully (returns suffix only)", () => {
    // maxLength 2, suffix '...' (len 3): slice(0, 0) + '...' = '...'
    expect(Str.truncate("hello", 2)).toBe("...");
  });
});

describe("Str.isAlphanumeric()", () => {
  it("returns true for alphanumeric strings", () => {
    expect(Str.isAlphanumeric("abc123")).toBe(true);
    expect(Str.isAlphanumeric("ABC")).toBe(true);
    expect(Str.isAlphanumeric("123")).toBe(true);
  });

  it("returns false for strings with spaces", () => {
    expect(Str.isAlphanumeric("hello world")).toBe(false);
  });

  it("returns false for strings with special characters", () => {
    expect(Str.isAlphanumeric("hello!")).toBe(false);
    expect(Str.isAlphanumeric("hello_world")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(Str.isAlphanumeric("")).toBe(false);
  });
});

describe("Str.padLeft()", () => {
  it("pads with a custom character", () => {
    expect(Str.padLeft("42", 5, "0")).toBe("00042");
  });

  it("pads with spaces by default", () => {
    expect(Str.padLeft("hi", 5)).toBe("   hi");
  });

  it("returns the string unchanged when already at or above length", () => {
    expect(Str.padLeft("hello", 3)).toBe("hello");
    expect(Str.padLeft("hello", 5)).toBe("hello");
  });
});

describe("Str.kebab()", () => {
  it("converts camelCase to kebab-case", () => {
    expect(Str.kebab("helloWorld")).toBe("hello-world");
  });
  it("converts spaces to hyphens", () => {
    expect(Str.kebab("hello world")).toBe("hello-world");
  });
  it("converts PascalCase", () => {
    expect(Str.kebab("HelloWorld")).toBe("hello-world");
  });
});

describe("Str.squish()", () => {
  it("collapses multiple spaces", () => {
    expect(Str.squish("  hello   world  ")).toBe("hello world");
  });
  it("collapses newlines and tabs", () => {
    expect(Str.squish("hello\n\tworld")).toBe("hello world");
  });
});

describe("Str.finish()", () => {
  it("appends cap when missing", () => {
    expect(Str.finish("https://example.com", "/")).toBe("https://example.com/");
  });
  it("does not double-append when already present", () => {
    expect(Str.finish("https://example.com/", "/")).toBe("https://example.com/");
  });
});

describe("Str.start()", () => {
  it("prepends prefix when missing", () => {
    expect(Str.start("path/to/file", "/")).toBe("/path/to/file");
  });
  it("does not double-prepend when already present", () => {
    expect(Str.start("/path/to/file", "/")).toBe("/path/to/file");
  });
});

describe("Str.after()", () => {
  it("returns substring after needle", () => {
    expect(Str.after("user@example.com", "@")).toBe("example.com");
  });
  it("returns full string when needle not found", () => {
    expect(Str.after("hello", "@")).toBe("hello");
  });
});

describe("Str.before()", () => {
  it("returns substring before needle", () => {
    expect(Str.before("user@example.com", "@")).toBe("user");
  });
  it("returns full string when needle not found", () => {
    expect(Str.before("hello", "@")).toBe("hello");
  });
});

describe("Str.afterLast()", () => {
  it("returns substring after last occurrence", () => {
    expect(Str.afterLast("path/to/file.txt", "/")).toBe("file.txt");
  });
});

describe("Str.beforeLast()", () => {
  it("returns substring before last occurrence", () => {
    expect(Str.beforeLast("path/to/file.txt", "/")).toBe("path/to");
  });
});

describe("Str.contains()", () => {
  it("returns true when substr is found", () => {
    expect(Str.contains("hello world", "world")).toBe(true);
  });
  it("returns false when not found", () => {
    expect(Str.contains("hello world", "xyz")).toBe(false);
  });
});

describe("Str.random()", () => {
  it("returns a string of the requested length", () => {
    expect(Str.random(16).length).toBe(16);
  });
  it("defaults to 32 characters", () => {
    expect(Str.random().length).toBe(32);
  });
  it("generates different values each call", () => {
    expect(Str.random(20)).not.toBe(Str.random(20));
  });
  it("contains only alphanumeric characters", () => {
    expect(Str.random(64)).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe("Str.replaceFirst()", () => {
  it("replaces the first occurrence only", () => {
    expect(Str.replaceFirst("the cat sat on the mat", "the", "a")).toBe("a cat sat on the mat");
  });
  it("returns unchanged string when not found", () => {
    expect(Str.replaceFirst("hello", "xyz", "abc")).toBe("hello");
  });
});

describe("Str.replaceLast()", () => {
  it("replaces the last occurrence only", () => {
    expect(Str.replaceLast("the cat sat on the mat", "the", "a")).toBe("the cat sat on a mat");
  });
});

describe("Str.reverse()", () => {
  it("reverses a string", () => {
    expect(Str.reverse("hello")).toBe("olleh");
  });
  it("handles empty string", () => {
    expect(Str.reverse("")).toBe("");
  });
});

describe("Str.words()", () => {
  it("limits to max words with suffix", () => {
    expect(Str.words("One two three four", 2)).toBe("One two...");
  });
  it("returns unchanged when under limit", () => {
    expect(Str.words("One two", 5)).toBe("One two");
  });
  it("accepts custom suffix", () => {
    expect(Str.words("a b c d", 2, " [more]")).toBe("a b [more]");
  });
});

// ── Str.macro() ───────────────────────────────────────────────────────────────

describe("Str.macro()", () => {
  it("registers a custom function accessible as Str.name()", () => {
    Str.macro("shout", (s: unknown) => `${String(s).toUpperCase()}!`);
    expect((Str as Record<string, unknown>)["shout"]?.("hello")).toBe("HELLO!");
  });

  it("overwrites an existing macro with the same name", () => {
    Str.macro("greet", (_: unknown) => "hello");
    Str.macro("greet", (_: unknown) => "hi");
    expect((Str as Record<string, unknown>)["greet"]?.("x")).toBe("hi");
  });

  it("macro can call other Str methods via closure", () => {
    Str.macro("shoutSlug", (s: unknown) => Str.slugify(String(s)).toUpperCase());
    expect((Str as Record<string, unknown>)["shoutSlug"]?.("Hello World")).toBe("HELLO-WORLD");
  });
});
