<script setup lang="ts">
/**
 * A user's initials in a circle. Decorative — the name is always written out next to
 * it — so it is hidden from screen readers. Swap in an `<img>` once users have photos.
 */
import { computed } from "vue";

const props = withDefaults(defineProps<{ name: string; size?: "sm" | "md" | "lg" | undefined }>(), {
  size: "md",
});

const SIZE = { sm: "size-7 text-[0.7rem]", md: "size-9 text-xs", lg: "size-12 text-base" };

/** Up to two initials from a name: "Ada Lovelace" → "AL", "ada" → "A". */
const initials = computed(() => {
  const parts = props.name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
});
</script>

<template>
  <span
    aria-hidden="true"
    :class="[
      'inline-grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-accent-foreground ring-1 ring-border',
      SIZE[size],
    ]"
  >
    {{ initials }}
  </span>
</template>
