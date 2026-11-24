<script setup lang="ts">
/**
 * Light / dark / system, from a small menu. Settings → Appearance offers the same three;
 * both read and write the same stored choice (resources/js/lib/theme.ts).
 */
import { computed } from "vue";
import Dropdown from "./Dropdown.vue";
import Icon from "./Icon.vue";
import { setAppearance, useAppearance, type Appearance } from "../lib/theme";
import type { IconName } from "../lib/icons";

const ICON: Record<Appearance, IconName> = { light: "sun", dark: "moon", system: "laptop" };
const LABEL: Record<Appearance, string> = { light: "Light", dark: "Dark", system: "System" };

const appearance = useAppearance();
const items = computed(() =>
  (["light", "dark", "system"] as const).map((option) => ({
    label: LABEL[option],
    icon: ICON[option],
    onSelect: () => setAppearance(option),
  })),
);
</script>

<template>
  <Dropdown label="Theme" :items="items">
    <template #trigger>
      <span
        class="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Icon :name="ICON[appearance]" class="size-4.5" />
      </span>
    </template>
  </Dropdown>
</template>
