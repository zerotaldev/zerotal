/**
 * Reading a page the way the visitor sees it.
 *
 * A Flow page reaches a test as finished HTML, not as a component name and its props, so
 * a test asks the HTML: which page is this (its title), and what does it show. The pages
 * put a `data-*` attribute on the few values a test wants to read exactly — a count, the
 * current session — so a test is not tied to the markup around them.
 */
import { expect } from "bun:test";
import type { TestResponse } from "zerotal/testing";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/** The page's own title: "Sign in" from "Sign in — Acme". */
export function titleOf(res: TestResponse): string {
  const title = decode(res.text().match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  return title.split(" — ")[0] ?? title;
}

/** The response is the page with this title — the way a test tells one page from another. */
export function assertPage(res: TestResponse, title: string): TestResponse {
  res.assertOk();
  expect(titleOf(res)).toBe(title);
  return res;
}

/** What the page says, as one line of text: tags dropped and whitespace collapsed. */
export function textIn(res: TestResponse): string {
  const body = res.text().replace(/<(script|template|style)[\s\S]*?<\/\1>/g, "");
  return decode(body.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ");
}

/** Every value the page gives an attribute, in order: `attributes(res, "data-session")`. */
export function attributes(res: TestResponse, name: string): string[] {
  const pattern = new RegExp(`\\s${name}="([^"]*)"`, "g");
  return [...res.text().matchAll(pattern)].map((match) => decode(match[1] ?? ""));
}

/** The text of the first element carrying `attribute` (or `attribute="value"`), tags stripped. */
export function textOf(res: TestResponse, attribute: string): string | undefined {
  const pattern = new RegExp(`<([a-z0-9]+)[^>]*\\s${attribute}[^>]*>([\\s\\S]*?)</\\1>`);
  const inner = res.text().match(pattern)?.[2];
  return inner === undefined ? undefined : decode(inner.replace(/<[^>]+>/g, "")).trim();
}
