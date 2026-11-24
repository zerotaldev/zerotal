<script setup lang="ts">
/**
 * A titled section of a card — the shape every settings panel takes. The `actions`
 * slot sits to the right of the title on wide screens and below it on narrow ones.
 */
defineProps<{ title: string; description?: string | undefined }>();
</script>

<template>
  <div
    class="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pt-6"
  >
    <div class="min-w-0">
      <h2 class="text-base font-semibold text-card-foreground">{{ title }}</h2>
      <p v-if="description" class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
