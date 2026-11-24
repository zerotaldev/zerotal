<script setup lang="ts">
/**
 * A message that belongs to the page rather than to the moment — "verify your email",
 * "save these codes". For "saved" and other one-off confirmations, flash a toast.
 *
 * `danger` and `warning` are announced to screen readers as they appear.
 */
import { computed } from "vue";
import Icon from "./Icon.vue";
import { cn } from "../lib/cn";

type Tone = "info" | "success" | "warning" | "danger";
const props = withDefaults(defineProps<{ tone?: Tone | undefined; title?: string | undefined }>(), {
  tone: "info",
});

const TONE: Record<Tone, string> = {
  info: "border-border bg-muted/50 text-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

const classes = computed(() => cn("flex gap-3 rounded-xl border p-4", TONE[props.tone]));
const icon = computed(() =>
  props.tone === "info" ? "info" : props.tone === "success" ? "check" : "alert",
);
</script>

<template>
  <div :role="tone === 'danger' || tone === 'warning' ? 'alert' : undefined" :class="classes">
    <Icon :name="icon" class="mt-0.5 size-5 shrink-0" />
    <div class="min-w-0 flex-1 text-sm">
      <p v-if="title" class="font-semibold">{{ title }}</p>
      <div v-if="$slots.default" :class="['text-foreground/80', title ? 'mt-1' : '']">
        <slot />
      </div>
      <div v-if="$slots.actions" class="mt-3 flex flex-wrap gap-2"><slot name="actions" /></div>
    </div>
  </div>
</template>
