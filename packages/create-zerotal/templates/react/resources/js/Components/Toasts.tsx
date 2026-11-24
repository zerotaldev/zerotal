import { useEffect, useState } from "react";
import { usePage } from "@inertiajs/react";
import { cn } from "../lib/cn";
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from "./Icons";
import type { SharedProps } from "../types";

/**
 * Auto-dismissing toasts.
 *
 * Most arrive from the server: a route calls `http.flash("success", "…")` before
 * redirecting, the flash survives exactly one request, and the shared `flash` prop
 * carries it here. A component can raise one too, with {@link toast}, for something that
 * happened in the browser alone (a passkey prompt the user cancelled). Rendered once by
 * each layout, so no page has to think about it.
 */

export type ToastKind = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const EVENT = "app:toast";

/** Show a toast from anywhere in the browser. */
export function toast(kind: ToastKind, message: string): void {
  window.dispatchEvent(new CustomEvent<Omit<Toast, "id">>(EVENT, { detail: { kind, message } }));
}

const TONE: Record<ToastKind, string> = {
  success: "text-success",
  error: "text-destructive",
  warning: "text-warning",
  info: "text-foreground",
};

const ICON: Record<ToastKind, typeof CheckIcon> = {
  success: CheckIcon,
  error: AlertIcon,
  warning: AlertIcon,
  info: InfoIcon,
};

let nextId = 1;

export default function Toasts() {
  const { flash } = usePage<SharedProps>().props;
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (items: Omit<Toast, "id">[]) => {
    const added = items.map((item) => ({ ...item, id: nextId++ }));
    setToasts((prev) => [...prev, ...added]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => !added.some((a) => a.id === t.id)));
    }, 5000);
  };

  useEffect(() => {
    const items: Omit<Toast, "id">[] = [];
    for (const kind of ["success", "error", "warning", "info"] as const) {
      const message = flash?.[kind];
      if (message) items.push({ kind, message });
    }
    if (items.length > 0) push(items);
  }, [flash?.success, flash?.error, flash?.warning, flash?.info]);

  useEffect(() => {
    const onToast = (event: Event) => push([(event as CustomEvent<Omit<Toast, "id">>).detail]);
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    // Always in the DOM, so a screen reader is already listening when a toast arrives.
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-lg sm:w-96"
          >
            <Icon className={cn("mt-0.5 size-4.5 shrink-0", TONE[t.kind])} />
            <p className="flex-1 text-sm text-card-foreground">{t.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <CloseIcon className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
