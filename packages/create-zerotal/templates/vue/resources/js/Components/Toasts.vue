<script setup lang="ts">
/**
 * Auto-dismissing toasts.
 *
 * Most arrive from the server: a route calls `http.flash("success", "…")` before
 * redirecting, the flash survives exactly one request, and the shared `flash` prop
 * carries it here. A component can raise one too, with `toast()` from lib/toast.ts, for
 * something that happened in the browser alone. Rendered once by each layout.
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePage } from "@inertiajs/vue3";
import Icon from "./Icon.vue";
import { TOAST_EVENT, type ToastKind } from "../lib/toast";
import type { SharedProps } from "../types";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const TONE: Record<ToastKind, string> = {
  success: "text-success",
  error: "text-destructive",
  warning: "text-warning",
  info: "text-foreground",
};

const page = usePage<SharedProps>();
const toasts = ref<Toast[]>([]);
let nextId = 1;

function push(items: Omit<Toast, "id">[]) {
  const added = items.map((item) => ({ ...item, id: nextId++ }));
  toasts.value = [...toasts.value, ...added];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => !added.some((a) => a.id === t.id));
  }, 5000);
}

function dismiss(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

// Each visit that carries a flash shows it once.
watch(
  () => page.props.flash,
  (flash) => {
    const items: Omit<Toast, "id">[] = [];
    for (const kind of ["success", "error", "warning", "info"] as const) {
      const message = flash?.[kind];
      if (message) items.push({ kind, message });
    }
    if (items.length > 0) push(items);
  },
  { immediate: true },
);

const onToast = (event: Event) => push([(event as CustomEvent<Omit<Toast, "id">>).detail]);
onMounted(() => window.addEventListener(TOAST_EVENT, onToast));
onBeforeUnmount(() => window.removeEventListener(TOAST_EVENT, onToast));
</script>

<!-- Always in the DOM, so a screen reader is already listening when a toast arrives. -->
<template>
  <div
    aria-live="polite"
    class="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
  >
    <div
      v-for="t in toasts"
      :key="t.id"
      :role="t.kind === 'error' ? 'alert' : 'status'"
      class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-lg sm:w-96"
    >
      <Icon
        :name="t.kind === 'success' ? 'check' : t.kind === 'info' ? 'info' : 'alert'"
        :class="['mt-0.5 size-4.5 shrink-0', TONE[t.kind]]"
      />
      <p class="flex-1 text-sm text-card-foreground">{{ t.message }}</p>
      <button
        type="button"
        aria-label="Dismiss"
        class="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground"
        @click="dismiss(t.id)"
      >
        <Icon name="close" class="size-4" />
      </button>
    </div>
  </div>
</template>
