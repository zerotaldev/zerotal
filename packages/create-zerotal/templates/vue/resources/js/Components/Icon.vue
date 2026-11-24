<script setup lang="ts">
/**
 * The icons this starter needs, inlined: `<Icon name="folder" class="size-4" />`.
 *
 * One component with a `name` rather than one file per glyph: in Vue an SFC is a file,
 * and thirty files for thirty `<path>` elements is more ceremony than the icons are
 * worth. The same glyphs as the React starter's Icon.tsx.
 *
 * Outline icons inherit `currentColor`, so they follow the theme with no extra wiring.
 * The two brand marks (GitHub, Google) carry their own fill. Reach for a real icon set
 * once you outgrow these.
 */
import { computed } from "vue";

import { ICONS, type IconName } from "../lib/icons";

const props = defineProps<{ name: IconName }>();
const icon = computed(() => ICONS[props.name]);
</script>

<template>
  <!-- The markup is this file's own constants, never user input. -->
  <svg
    v-if="icon.brand"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    v-html="icon.body"
  />
  <svg
    v-else
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="icon.body"
  />
</template>
