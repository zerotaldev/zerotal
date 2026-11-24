<script setup lang="ts">
/**
 * What a list shows before it has anything in it: what the thing is, and the one
 * action that fills it. An empty table with no explanation reads as broken.
 */
import Icon from "./Icon.vue";
import type { IconName } from "../lib/icons";

defineProps<{ icon?: IconName | undefined; title: string; description?: string | undefined }>();
</script>

<template>
  <div
    class="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center"
  >
    <div
      v-if="icon"
      class="grid size-12 place-items-center rounded-xl border border-border bg-accent text-accent-foreground"
    >
      <Icon :name="icon" class="size-6" />
    </div>
    <h3 class="mt-4 text-base font-semibold">{{ title }}</h3>
    <p v-if="description" class="mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground">
      {{ description }}
    </p>
    <div v-if="$slots.action" class="mt-6"><slot name="action" /></div>
  </div>
</template>
