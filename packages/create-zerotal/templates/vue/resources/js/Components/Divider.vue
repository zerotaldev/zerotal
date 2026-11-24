<script setup lang="ts">
/** The "or" rule between one way of signing in and another. */
withDefaults(defineProps<{ label?: string | undefined }>(), { label: "or" });
</script>

<template>
  <div class="flex items-center gap-3 text-xs tracking-wide text-muted-foreground uppercase">
    <span class="h-px flex-1 bg-border" />
    {{ label }}
    <span class="h-px flex-1 bg-border" />
  </div>
</template>
