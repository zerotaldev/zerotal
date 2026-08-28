// ── @zerotal/flow plain-form enhancement bundle ─────────────────────────────────
//
// The entry point for the second Bun.build() in FlowProvider.onBooting(). It
// produces /__flow/enhance.js.
//
// **Deliberately separate from the runtime bundle, and deliberately tiny.** The
// whole point of this feature is a page with *no Flow component on it* — an
// ordinary server-rendered form, on a route that is not `Router.flow`. Such a page
// is never served `/__flow/runtime.js`, so there is no script to hook into; and
// pulling Alpine and the WebSocket bridge onto a page with no component to drive
// would be paying the entire framework's client cost for a submit handler.
//
// **This file exports nothing, and must not.** It is loaded as a classic script,
// where a trailing `export` statement is a SyntaxError that discards the whole
// bundle — silently, because the forms then post natively and the page still
// works. The decisions worth testing live in `enhanceSupport.ts`, which Bun inlines
// back in at build time.
//
// ## The contract
//
//   <form method="post" action="/subscribe" data-enhance>
//
// The form posts through `fetch`, and the matching form in the response replaces
// this one in place. Validation errors then appear where they belong and the rest
// of the page is untouched — no flash, no scroll loss, no re-render of a page that
// did not change.
//
// Everything about it degrades:
//
//   - **No JavaScript is an ordinary post.** `data-enhance` is additive on a form
//     that already has `method` and `action`, so the no-JS path is not a fallback
//     that was written and might rot — it is the form itself, unmodified. If that
//     is ever not free, the word "enhancement" is doing no work.
//   - **A network failure re-submits natively.** The difference between a bad
//     connection being slow and a bad connection losing what somebody typed.
//   - **A redirect is followed**, its document swapped in and `pushState`d, so the
//     address bar agrees with the page.

import { ATTR, BUSY_ATTR, matchIn, sameUrl, targetFor } from "./enhanceSupport.ts";

/**
 * Move focus back to where it was before the swap.
 *
 * Replacing a subtree destroys the focused element, and a form that reports "this
 * field is required" having just taken the cursor away from that field is worse
 * than one that did not enhance at all. Matched by `name`, which survives a
 * re-render in a way a DOM node cannot.
 */
function restoreFocus(root: Element, name: string | null, start: number | null): void {
  if (!name) return;
  const next = root.querySelector<HTMLInputElement>(`[name="${CSS.escape(name)}"]`);
  if (!next) return;
  next.focus();
  if (start === null) return;
  try {
    next.setSelectionRange(start, start);
  } catch {
    // Not a text-like control (checkbox, select, file) — focus alone is the job.
  }
}

/**
 * Submit the form the way the browser would have, with the enhancement out of the
 * way so this handler does not catch its own fallback.
 */
function nativeSubmit(form: HTMLFormElement, submitter: HTMLElement | null): void {
  form.removeAttribute(ATTR);
  if (submitter && "click" in submitter) {
    // Through the submitter, so a named button still contributes its value.
    submitter.click();
    return;
  }
  form.submit();
}

/**
 * Handle one enhanced submission.
 *
 * Throws nothing: every failure path either falls back to a native submit or
 * leaves the page exactly as it was.
 */
async function submitEnhanced(form: HTMLFormElement, submitter: HTMLElement | null): Promise<void> {
  const method = (form.getAttribute("method") || "get").toUpperCase();
  const action = form.getAttribute("action") || window.location.href;

  // `new FormData(form, submitter)` includes the button that was actually pressed,
  // which is how `<button name="intent" value="delete">` tells the server which one.
  const data = new FormData(form, submitter as HTMLButtonElement | null);

  let url = action;
  let body: FormData | null = data;
  if (method === "GET") {
    // A GET form carries its fields in the query string, not a body.
    const query = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (typeof value === "string") query.append(key, value);
    }
    const separator = action.includes("?") ? "&" : "?";
    url = query.toString() ? `${action}${separator}${query}` : action;
    body = null;
  }

  const target = targetFor(form, document, (selector) =>
    console.warn(`[flow] data-enhance-target="${selector}" matched nothing; replacing the form.`),
  );

  const active = document.activeElement as HTMLInputElement | null;
  const focusedName = active && form.contains(active) ? active.getAttribute("name") : null;
  const caret = (() => {
    try {
      return active?.selectionStart ?? null;
    } catch {
      return null;
    }
  })();

  form.setAttribute(BUSY_ATTR, "");

  let response: Response;
  let html: string;
  try {
    response = await fetch(url, {
      method,
      ...(body ? { body } : {}),
      credentials: "same-origin",
      redirect: "follow",
      headers: { "X-Flow-Enhance": "1", Accept: "text/html" },
    });
    html = await response.text();
  } catch {
    // The network, not the server. Hand the submission back to the browser, which
    // shows its own error and — crucially — has not lost the form data.
    form.removeAttribute(BUSY_ATTR);
    nativeSubmit(form, submitter);
    return;
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");

  // `fetch` followed the redirect for us, so a changed URL means the server sent us
  // somewhere. Swap the whole document and record the move, or the address bar
  // keeps claiming we are on the page that did the posting.
  if (response.redirected || !sameUrl(response.url, url, window.location.href)) {
    document.documentElement.replaceWith(document.importNode(parsed.documentElement, true));
    window.history.pushState({}, "", response.url);
    window.dispatchEvent(new CustomEvent("flow:enhanced", { detail: { navigated: true } }));
    return;
  }

  const replacement = matchIn(parsed, document, form, target);
  if (!replacement) {
    // The response has no counterpart for what we were going to replace — the page
    // changed shape. Guessing would put arbitrary markup somewhere arbitrary; a
    // full navigation is the honest answer.
    window.location.href = response.url || url;
    return;
  }

  const adopted = document.importNode(replacement, true);
  target.replaceWith(adopted);
  adopted.removeAttribute(BUSY_ATTR);
  restoreFocus(adopted, focusedName, caret);
  window.dispatchEvent(
    new CustomEvent("flow:enhanced", { detail: { navigated: false, status: response.status } }),
  );
}

/**
 * One delegated listener on the document, for every enhanced form that exists now
 * or is added later.
 *
 * Delegation rather than per-form binding because the swap above replaces forms
 * with fresh nodes: anything bound directly would be discarded by the first
 * successful submission, and the second one would post natively for no visible
 * reason.
 */
function install(): void {
  document.addEventListener(
    "submit",
    (event) => {
      const form = (event.target as HTMLElement | null)?.closest?.(`form[${ATTR}]`) as
        HTMLFormElement | null | undefined;
      if (!form) return;
      // Let a default-prevented submit stay prevented; another handler owns it.
      if (event.defaultPrevented) return;
      // An explicit opt-out on a form that carries the attribute for styling.
      if (form.getAttribute(ATTR) === "false") return;
      // A submission already in flight: drop the second rather than racing two
      // responses into the same target.
      if (form.hasAttribute(BUSY_ATTR)) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      void submitEnhanced(form, (event as SubmitEvent).submitter);
    },
    // Bubble phase: a component's own handler gets to preventDefault first.
    false,
  );
}

if (typeof document !== "undefined") {
  install();
}
