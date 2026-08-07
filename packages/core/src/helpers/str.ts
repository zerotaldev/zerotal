/**
 * The `Str` string-manipulation utility — a collection of case converters,
 * substring helpers, and a `macro()` hook for registering project-specific
 * string methods at runtime.
 */
export const Str = {
  /** 'hello-world' | 'hello_world' | 'hello world' → 'helloWorld' */
  camelCase(value: string): string {
    return value.toLowerCase().replace(/[-_\s]+([a-z])/g, (_, char: string) => char.toUpperCase());
  },

  /** 'helloWorld' → 'hello_world' */
  snakeCase(value: string): string {
    return value
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .replace(/([a-z\d])([A-Z])/g, "$1_$2")
      .toLowerCase();
  },

  /** 'helloWorld' | 'hello world' → 'hello-world' */
  slugify(value: string): string {
    return (
      value
        .replace(/([A-Z])/g, " $1")
        .normalize("NFD")
        // Strip combining diacritical marks (U+0300–U+036F) so accented letters slug cleanly.
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
    );
  },

  /** 'hello world' → 'Hello World' */
  titleCase(value: string): string {
    return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
  },

  /** 'hello-world' | 'helloWorld' → 'HelloWorld' */
  pascalCase(value: string): string {
    // Collapse separators without lowercasing so existing camelCase humps survive.
    const collapsed = value.replace(/[-_\s]+([a-zA-Z])/g, (_, char: string) => char.toUpperCase());
    return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
  },

  /** Upper-case the first character only. 'hello world' → 'Hello world' */
  capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  },

  /** Lower-case the first character only. 'BlogPost' → 'blogPost' */
  lcfirst(value: string): string {
    return value.charAt(0).toLowerCase() + value.slice(1);
  },

  /**
   * Truncate to maxLength, appending suffix if truncated.
   * truncate('hello world', 7) → 'hell...'
   */
  truncate(value: string, maxLength: number, suffix = "..."): string {
    if (value.length <= maxLength) return value;
    return value.slice(0, Math.max(0, maxLength - suffix.length)) + suffix;
  },

  /** Returns true if the value contains only alphanumeric characters (non-empty). */
  isAlphanumeric(value: string): boolean {
    return /^[a-zA-Z0-9]+$/.test(value);
  },

  /** Pad left: padLeft('42', 5, '0') → '00042' */
  padLeft(value: string, length: number, char = " "): string {
    return value.padStart(length, char);
  },

  /** 'helloWorld' | 'hello world' → 'hello-world' */
  kebab(value: string): string {
    return value
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
      .replace(/([a-z\d])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase();
  },

  /** Collapse all consecutive whitespace (including newlines) into a single space and trim. */
  squish(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  },

  /**
   * Ensure the string ends with `cap`.
   * If it already ends with `cap`, returns as-is.
   * finish('https://example.com', '/') → 'https://example.com/'
   */
  finish(value: string, cap: string): string {
    return value.endsWith(cap) ? value : value + cap;
  },

  /**
   * Ensure the string starts with `prefix`.
   * If it already starts with `prefix`, returns as-is.
   * start('path/to/file', '/') → '/path/to/file'
   */
  start(value: string, prefix: string): string {
    return value.startsWith(prefix) ? value : prefix + value;
  },

  /** Return everything after the first occurrence of `needle`, or the full string if not found. */
  after(value: string, needle: string): string {
    const index = value.indexOf(needle);
    return index === -1 ? value : value.slice(index + needle.length);
  },

  /** Return everything before the first occurrence of `needle`, or the full string if not found. */
  before(value: string, needle: string): string {
    const index = value.indexOf(needle);
    return index === -1 ? value : value.slice(0, index);
  },

  /** Return everything after the LAST occurrence of `needle`. */
  afterLast(value: string, needle: string): string {
    const index = value.lastIndexOf(needle);
    return index === -1 ? value : value.slice(index + needle.length);
  },

  /** Return everything before the LAST occurrence of `needle`. */
  beforeLast(value: string, needle: string): string {
    const index = value.lastIndexOf(needle);
    return index === -1 ? value : value.slice(0, index);
  },

  /** Return true if `value` contains `substring` (case-sensitive). */
  contains(value: string, substring: string): boolean {
    return value.includes(substring);
  },

  /**
   * Generate a cryptographically random alphanumeric string of the given length.
   * Uses `crypto.getRandomValues` — no external dependencies.
   */
  random(length = 32): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
  },

  /**
   * Replace the first occurrence of `search` with `replace`.
   * replaceFirst('the cat sat on the mat', 'the', 'a') → 'a cat sat on the mat'
   */
  replaceFirst(value: string, search: string, replace: string): string {
    const index = value.indexOf(search);
    return index === -1
      ? value
      : value.slice(0, index) + replace + value.slice(index + search.length);
  },

  /**
   * Replace the last occurrence of `search` with `replace`.
   */
  replaceLast(value: string, search: string, replace: string): string {
    const index = value.lastIndexOf(search);
    return index === -1
      ? value
      : value.slice(0, index) + replace + value.slice(index + search.length);
  },

  /** Reverse a string: reverse('hello') → 'olleh' */
  reverse(value: string): string {
    return [...value].reverse().join("");
  },

  /**
   * Limit the string to `maxWords` words, appending `suffix` if truncated.
   * words('One two three four', 2) → 'One two...'
   */
  words(value: string, maxWords: number, suffix = "..."): string {
    const parts = value.trim().split(/\s+/);
    if (parts.length <= maxWords) return value;
    return parts.slice(0, maxWords).join(" ") + suffix;
  },

  /**
   * Register a macro (custom method) on the Str object.
   *
   * The function is assigned directly to `Str`, so you call it as `Str.myMacro(...)`.
   * Add a module augmentation to your project for full TypeScript type safety:
   *
   * @example
   * // In AppServiceProvider.onBooted():
   * Str.macro('readableSize', (bytes: number) =>
   *   bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
   * );
   *
   * // In types.d.ts (for type safety):
   * declare module '@zerotal/core' {
   *   interface StrMacros { readableSize(bytes: number): string; }
   * }
   *
   * // In a controller:
   * (Str as typeof Str & StrMacros).readableSize(2048); // '2.0 KB'
   */
  macro(name: string, fn: (...args: unknown[]) => unknown): void {
    (Str as Record<string, unknown>)[name] = fn;
  },
};
