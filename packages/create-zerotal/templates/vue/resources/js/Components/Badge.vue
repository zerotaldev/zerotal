<script setup lang="ts">
/** A short status label — a project's status, "This device", "On". */
import { computed } from "vue";
import { cn } from "../lib/cn";

type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger";
const props = withDefaults(defineProps<{ tone?: BadgeTone | undefined }>(), { tone: "neutral" });

const TONE: Record<BadgeTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  primary: "border-primary/25 bg-accent text-accent-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
};

const classes = computed(() =>
  cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
    TONE[props.tone],
  ),
);
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
