/**
 * Toasts, in the browser.
 *
 * The server writes the flash messages of the request into the page (components/Toasts.tsx)
 * so they show with or without this script. Here they are dismissed after a few seconds
 * or on a click, and `toast()` raises one for something that happened in the browser
 * alone — a passkey prompt the user cancelled — from the templates beside them.
 */
export type ToastKind = "success" | "error" | "warning" | "info";

const STASH_KEY = "app:toasts";
const LIFETIME = 5000;

function region(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-toasts]");
}

function schedule(toast: HTMLElement): void {
  setTimeout(() => toast.remove(), LIFETIME);
}

/** Show a toast from anywhere in the browser. */
export function toast(kind: ToastKind, message: string): void {
  const container = region();
  const template = container?.querySelector<HTMLTemplateElement>(
    `template[data-toast-template="${kind}"]`,
  );
  const toast = template?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  if (!container || !toast) return;
  const text = toast.querySelector("[data-toast-message]");
  if (text) text.textContent = message;
  container.insertBefore(toast, container.querySelector("template"));
  schedule(toast);
}

/**
 * Carry toasts over a page load. forms.ts uses it when a request it sent already used
 * up the flash: the toast is saved here and shown by the page the browser goes to.
 */
export function stashToasts(items: { kind: ToastKind; message: string }[]): void {
  try {
    if (items.length > 0) sessionStorage.setItem(STASH_KEY, JSON.stringify(items));
  } catch {
    // No storage: the toast is lost, the change it reported is not.
  }
}

export function installToasts(): void {
  const container = region();
  if (container) {
    // Put back the ones the server wrote, so a screen reader announces them as it would
    // a toast that arrived later, and start their clocks.
    for (const toast of container.querySelectorAll<HTMLElement>("[data-toast]")) {
      toast.remove();
      container.insertBefore(toast, container.querySelector("template"));
      schedule(toast);
    }
  }

  try {
    const stashed = sessionStorage.getItem(STASH_KEY);
    sessionStorage.removeItem(STASH_KEY);
    for (const item of JSON.parse(stashed ?? "[]") as { kind: ToastKind; message: string }[]) {
      toast(item.kind, item.message);
    }
  } catch {
    // Nothing usable was stashed.
  }

  document.addEventListener("click", (event) => {
    const button = (event.target as Element).closest("[data-dismiss-toast]");
    button?.closest("[data-toast]")?.remove();
  });
}
