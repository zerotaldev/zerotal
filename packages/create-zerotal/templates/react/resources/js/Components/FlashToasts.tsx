import { useEffect, useState } from "react";
import { usePage } from "@inertiajs/react";
import { cn } from "../lib/cn";
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from "./Icons";
import type { SharedProps } from "../types";

/**
 * Auto-dismissing toasts driven by the shared `flash` prop.
 *
 * A route calls `http.flash("success", "…")` before redirecting; the flash
 * survives exactly one request, `@zerotal/inertia` merges it into every page's
 * props, and this component turns it into a toast. Rendered once in AppLayout,
 * so no page has to think about it.
 */

interface Toast {
  id: number;
  kind: "success" | "error" | "warning" | "info";
  message: string;
}

const TONE: Record<Toast["kind"], string> = {
  success: "border-success/40 text-success",
  error: "border-destructive/40 text-destructive",
  warning: "border-warning/40 text-warning",
  info: "border-border text-foreground",
};

export default function FlashToasts() {
  const { flash } = usePage<SharedProps>().props;
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const next: Toast[] = [];
    if (flash?.success) next.push({ id: Date.now(), kind: "success", message: flash.success });
    if (flash?.error) next.push({ id: Date.now() + 1, kind: "error", message: flash.error });
    if (flash?.warning) next.push({ id: Date.now() + 2, kind: "warning", message: flash.warning });
    if (flash?.info) next.push({ id: Date.now() + 3, kind: "info", message: flash.info });
    if (next.length === 0) return;

    setToasts((prev) => [...prev, ...next]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => !next.some((n) => n.id === t.id)));
    }, 5000);
    return () => clearTimeout(timer);
  }, [flash?.success, flash?.error, flash?.warning, flash?.info]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-card p-3.5 shadow-lg",
            TONE[toast.kind],
          )}
        >
          <span className="mt-0.5 shrink-0">
            {toast.kind === "success" ? (
              <CheckIcon className="size-4.5" />
            ) : toast.kind === "warning" ? (
              <AlertIcon className="size-4.5" />
            ) : toast.kind === "info" ? (
              <InfoIcon className="size-4.5" />
            ) : (
              <CloseIcon className="size-4.5" />
            )}
          </span>
          <p className="flex-1 text-sm text-card-foreground">{toast.message}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            className="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
