import { stashToasts, toast, type ToastKind } from "./toasts";

/**
 * Forms, in the browser.
 *
 * A form here is ordinary HTML: it posts to a handler in app/routes/, which validates and
 * redirects, and the page it redirects to shows the result — the errors and what was
 * typed, or a flash message. That needs no script, and most forms get none.
 *
 * Two things are added:
 *
 * - **A busy label.** A submit button with `data-loading-text` says what is happening
 *   ("Saving…") and is disabled until the next page arrives, so a double click sends once.
 *
 * - **PUT, PATCH and DELETE.** A browser form can only GET or POST, and the routes that
 *   change or remove something answer to the verb that says so. A form with
 *   `data-method="put"` (or `patch`, `delete`) — or a submit button with one, alongside
 *   `formaction` — is sent from here instead, asking for JSON:
 *   a validation failure comes back as a 422 with the messages, shown in place under each
 *   field (see components/Field.tsx), and success is the redirect, followed to the next page.
 */

/** Field name → message. The framework sends either one message or a list per field. */
type Errors = Record<string, string | string[]>;

function busy(button: HTMLButtonElement | null, on: boolean): void {
  if (!button?.dataset["loadingText"]) return;
  if (on) {
    button.dataset["idleHtml"] = button.innerHTML;
    button.textContent = button.dataset["loadingText"];
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset["idleHtml"] ?? button.innerHTML;
    button.disabled = false;
  }
}

function showErrors(form: HTMLFormElement, errors: Errors): void {
  for (const slot of form.querySelectorAll<HTMLElement>("[data-error-for]")) {
    const name = slot.dataset["errorFor"] ?? "";
    const raw = errors[name];
    const message = Array.isArray(raw) ? raw[0] : raw;
    const control = form.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
    const hint = form.querySelector<HTMLElement>(`[data-hint-for="${CSS.escape(name)}"]`);

    slot.textContent = message ?? "";
    slot.hidden = !message;
    if (hint) hint.hidden = Boolean(message);
    if (control) {
      if (message) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
      const describedBy = message ? slot.id : hint?.id;
      if (describedBy) control.setAttribute("aria-describedby", describedBy);
      else control.removeAttribute("aria-describedby");
    }
  }
  // Send focus to the first field with a problem, as a full page load would.
  form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

/** The toasts a page was rendered with, before it is thrown away for the real one. */
function toastsIn(html: string): { kind: ToastKind; message: string }[] {
  const page = new DOMParser().parseFromString(html, "text/html");
  return Array.from(page.querySelectorAll<HTMLElement>("[data-toasts] > [data-toast]")).map(
    (el) => ({
      kind: el.dataset["toast"] as ToastKind,
      message: el.querySelector("[data-toast-message]")?.textContent ?? "",
    }),
  );
}

async function send(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | null,
  method: string,
): Promise<void> {
  // A button can send its form somewhere else (`formaction`), as a browser would.
  const action = submitter?.getAttribute("formaction") ?? form.action;
  const response = await fetch(action, {
    method: method.toUpperCase(),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(new FormData(form, submitter) as unknown as Record<string, string>),
  }).catch(() => null);

  if (!response) {
    busy(submitter, false);
    toast("error", "Could not reach the server. Check your connection and try again.");
    return;
  }

  if (response.status === 422) {
    const data = (await response.json().catch(() => ({}))) as { errors?: Errors; message?: string };
    busy(submitter, false);
    if (data.errors) showErrors(form, data.errors);
    else toast("error", data.message ?? "That did not work. Check the form and try again.");
    return;
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    busy(submitter, false);
    toast("error", data.message ?? "Something went wrong. Try again.");
    return;
  }

  // The handler redirected and `fetch` followed, so the next page has been rendered —
  // and its flash message used up — already. Keep its toasts for the real visit.
  stashToasts(toastsIn(await response.text()));
  window.location.assign(response.url);
}

export function installForms(): void {
  document.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    const submitter = ((event as SubmitEvent).submitter as HTMLButtonElement | null) ?? null;
    if (event.defaultPrevented) return;

    // The button's own `data-method` wins, as `formaction` does over `action`.
    const method = (submitter?.dataset["method"] ?? form.dataset["method"])?.toLowerCase();
    if (method && method !== "get" && method !== "post") {
      event.preventDefault();
      if (submitter?.disabled) return;
      busy(submitter, true);
      void send(form, submitter, method);
      return;
    }

    // An ordinary post: let the browser send it, and say so on the button.
    queueMicrotask(() => busy(submitter, true));
  });

  // Back from the next page with the back button: the page comes out of the cache as it
  // was left, button still busy.
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-idle-html]")) {
      busy(button, false);
    }
  });
}
