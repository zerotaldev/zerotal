<script setup lang="ts">
/** The app's surface primitive — matches the React template's Card. */
import { computed } from "vue";
import { cn } from "../lib/cn";

const props = withDefaults(
  defineProps<{ class?: string; interactive?: boolean }>(),
  { interactive: false },
);

const classes = computed(() =>
  cn(
    "surface rounded-xl",
    props.interactive &&
      "transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40",
    props.class,
  ),
);
</script>

<template>
  <div :class="classes"><slot /></div>
</template>
