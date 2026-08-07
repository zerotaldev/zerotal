<script setup lang="ts">
/**
 * The handful of icons this starter needs, inlined.
 *
 * One component with a `name` rather than one file per glyph: in Vue an SFC is
 * a file, and fourteen files for fourteen `<path>` elements is more ceremony
 * than the icons are worth. Same paths and same stroke treatment as the React
 * template, so both render identically.
 *
 * They inherit `currentColor`, so they follow the theme with no extra wiring.
 */
const props = withDefaults(defineProps<{ name: IconName; class?: string }>(), {});

type IconName = "sun" | "moon" | "menu" | "close" | "check" | "arrow-right";

const PATHS: Record<IconName, string> = {
  sun: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M18 6 6 18M6 6l12 12",
  check: "m20 6-11 11-5-5",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
};
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    :class="props.class"
  >
    <circle v-if="name === 'sun'" cx="12" cy="12" r="4" />
    <path :d="PATHS[name]" />
  </svg>
</template>
