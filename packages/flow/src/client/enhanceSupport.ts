/**
 * The parts of the plain-form enhancement that are decisions rather than effects.
 *
 * Split out of `enhance.ts` for a reason worth recording. That file is served as a
 * **classic script** — `<script src="/__flow/enhance.js" defer>` on pages that have
 * no module loader and no framework on them. A bundle ending in an `export`
 * statement is a `SyntaxError` in that position, and the browser discards the whole
 * file. It does so *silently*: the forms fall back to native posts and the page
 * still works, so the enhancement is simply absent on exactly the pages it was
 * added for, with nothing in the console to say why.
 *
 * So the entry exports nothing, and everything worth asserting on lives here, where
 * a test can import it. Bun inlines this back into the bundle at build time, so the
 * split costs the browser nothing.
 *
 * @module
 */

/** Marks a form as enhanced. */
export const ATTR = "data-enhance";

/** Overrides what gets replaced: any CSS selector. */
export const TARGET_ATTR = "data-enhance-target";

/** Set on a form while its submission is in flight, for styling and re-entry guards. */
export const BUSY_ATTR = "data-enhance-busy";

/**
 * Whether two URLs name the same place, resolved against the document.
 *
 * Both sides are resolved before comparing, because one of them is whatever the
 * author wrote in `action` — usually relative — and the other is `response.url`,
 * which `fetch` always reports absolute. Comparing them raw would call every
 * ordinary submission a redirect.
 */
export function sameUrl(a: string, b: string, baseHref: string): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a, baseHref).href === new URL(b, baseHref).href;
  } catch {
    return a === b;
  }
}

/**
 * Where a form's response should be written.
 *
 * The form itself by default. That is the useful default because it is what makes
 * validation errors land where the person is looking without the page author
 * naming anything — and because the form is the one element guaranteed to exist in
 * the response, given the server just re-rendered it.
 *
 * @param onMissing - Called when `data-enhance-target` matches nothing.
 */
export function targetFor(
  form: HTMLFormElement,
  root: ParentNode,
  onMissing: (selector: string) => void,
): Element {
  const selector = form.getAttribute(TARGET_ATTR);
  if (!selector) return form;
  const found = root.querySelector(selector);
  if (found) return found;
  // A selector matching nothing is an authoring mistake. Swapping the form instead
  // is both harmless and visible: the page still works and the console says why it
  // did not do what was asked.
  onMissing(selector);
  return form;
}

/**
 * Find, in a freshly parsed response document, the element corresponding to
 * `target` in the live one.
 *
 * Identity is by `id` when there is one, then by the selector the author gave, then
 * — for a bare `<form data-enhance>` — by position among the enhanced forms on the
 * page. The positional fallback is what lets the simplest possible usage work with
 * no attributes at all, and it is why `id` is tried first: two forms that change
 * order between renders would otherwise swap content.
 */
export function matchIn(
  doc: Document,
  live: ParentNode,
  form: HTMLFormElement,
  target: Element,
): Element | null {
  if (target.id) {
    const byId = doc.getElementById(target.id);
    if (byId) return byId;
  }

  const selector = form.getAttribute(TARGET_ATTR);
  if (selector) return doc.querySelector(selector);

  const forms = Array.from(live.querySelectorAll(`form[${ATTR}]`));
  const index = forms.indexOf(form);
  const candidates = doc.querySelectorAll(`form[${ATTR}]`);
  return index >= 0 ? (candidates[index] ?? null) : (candidates[0] ?? null);
}
