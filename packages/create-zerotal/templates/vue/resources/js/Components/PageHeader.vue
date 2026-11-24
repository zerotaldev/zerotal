<script setup lang="ts">
/** The title row at the top of a signed-in page: what this is, and what you can do here. */
import { Link } from "@inertiajs/vue3";
import Icon from "./Icon.vue";

defineProps<{
  title: string;
  description?: string | undefined;
  /** A link back up a level, shown above the title. */
  back?: { href: string; label: string } | undefined;
}>();
</script>

<template>
  <header class="mb-8">
    <Link
      v-if="back"
      :href="back.href"
      class="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon name="chevron-left" class="size-4" />
      {{ back.label }}
    </Link>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{{ title }}</h1>
        <p v-if="description" class="mt-1.5 text-muted-foreground">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap gap-2"><slot name="actions" /></div>
    </div>
  </header>
</template>
