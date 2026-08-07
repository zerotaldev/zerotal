<script setup lang="ts">
/**
 * Auto-dismissing toasts driven by the shared `flash` prop.
 *
 * A route calls `http.flash("success", "…")` before redirecting; the flash
 * survives exactly one request, @zerotal/inertia merges it into every page's
 * props, and this turns it into a toast. Rendered once in AppLayout, so no page
 * has to think about it.
 */
import { ref, watch } from "vue";
import { usePage } from "@inertiajs/vue3";
import { cn } from "../lib/cn";
import Icon from "./Icon.vue";
import type { SharedProps } from "../types";

interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
}

const TONE: Record<Toast["kind"], string> = {
  success: "border-success/40 text-success",
  error: "border-destructive/40 text-destructive",
};

const page = usePage<SharedProps>();
const toasts = ref<Toast[]>([]);

watch(
  () => [page.props.flash?.success, page.props.flash?.error] as const,
  ([success, error]) => {
    const next: Toast[] = [];
    if (success) next.push({ id: Date.now(), kind: "success", message: success });
    if (error) next.push({ id: Date.now() + 1, kind: "error", message: error });
    if (next.length === 0) return;

    toasts.value = [...toasts.value, ...next];
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => !next.some((n) => n.id === t.id));
    }, 5000);
  },
  { immediate: true },
);

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
</script>

<template>
  <div
    v-if="toasts.length"
    aria-live="polite"
    class="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="
        cn(
          'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-card p-3.5 shadow-lg',
          TONE[toast.kind],
        )
      "
    >
      <span class="mt-0.5 shrink-0">
        <Icon :name="toast.kind === 'success' ? 'check' : 'close'" class="size-4.5" />
      </span>
      <p class="flex-1 text-sm text-card-foreground">{{ toast.message }}</p>
      <button
        type="button"
        aria-label="Dismiss"
        class="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground"
        @click="dismiss(toast.id)"
      >
        <Icon name="close" class="size-4" />
      </button>
    </div>
  </div>
</template>
