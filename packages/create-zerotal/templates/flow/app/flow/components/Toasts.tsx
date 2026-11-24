import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import type { IconName } from "../lib/icons";
import type { FlashKind } from "../lib/page";
import { Icon } from "./Icon";

const TONE: Record<FlashKind, string> = {
  success: "text-success",
  error: "text-destructive",
  warning: "text-warning",
  info: "text-foreground",
};

const ICON: Record<FlashKind, IconName> = {
  success: "check",
  error: "alert",
  warning: "alert",
  info: "info",
};

const KINDS: readonly FlashKind[] = ["success", "error", "warning", "info"];

function Toast({ kind, message }: { kind: FlashKind; message: string }): HtmlNode {
  return (
    <div
      data-toast={kind}
      role={kind === "error" ? "alert" : "status"}
      class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-lg sm:w-96"
    >
      <Icon name={ICON[kind]} class={cn("mt-0.5 size-4.5 shrink-0", TONE[kind])} />
      <p data-toast-message="" class="flex-1 text-sm text-card-foreground">
        {message}
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        data-dismiss-toast=""
        class="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon name="close" class="size-4" />
      </button>
    </div>
  );
}

/**
 * Auto-dismissing toasts.
 *
 * Most arrive from the server: a route calls `http.flash("success", "…")` before
 * redirecting, the flash survives exactly one request, and the page that request shows
 * renders it here. The browser can raise one too, with `toast()` from
 * resources/js/lib/toasts.ts, for something that happened there alone (a passkey prompt
 * the user cancelled) — it copies one of the templates below. Every layout renders this
 * once, so no page has to think about it.
 */
export function Toasts({ flash }: { flash: Partial<Record<FlashKind, string>> }): HtmlNode {
  return (
    // Always in the DOM, so a screen reader is already listening when a toast arrives.
    <div
      aria-live="polite"
      data-toasts=""
      class="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      {KINDS.map((kind) => {
        const message = flash[kind];
        return message ? <Toast kind={kind} message={message} /> : null;
      })}
      {KINDS.map((kind) => (
        <template data-toast-template={kind}>
          <Toast kind={kind} message="" />
        </template>
      ))}
    </div>
  );
}
