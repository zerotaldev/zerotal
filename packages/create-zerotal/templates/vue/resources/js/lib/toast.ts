/** A toast's tone. */
export type ToastKind = "success" | "error" | "warning" | "info";

/** The event Components/Toasts.vue listens for. */
export const TOAST_EVENT = "app:toast";

/**
 * Show a toast from anywhere in the browser — for something that happened there alone
 * (a passkey prompt the user cancelled). Messages from the server arrive as flash.
 */
export function toast(kind: ToastKind, message: string): void {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { kind, message } }));
}
