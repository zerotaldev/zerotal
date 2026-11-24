<script setup lang="ts">
/**
 * "Continue with GitHub / Google", for the providers config/social.ts has switched on.
 * Plain links rather than Inertia visits: they leave the app for the provider's site.
 */
import { computed } from "vue";
import Icon from "./Icon.vue";
import { buttonClass } from "../lib/button";

const props = defineProps<{ providers: string[] }>();

const PROVIDERS = {
  github: { label: "GitHub", icon: "github" },
  google: { label: "Google", icon: "google" },
} as const;

const available = computed(() =>
  props.providers.filter((name): name is keyof typeof PROVIDERS => name in PROVIDERS),
);
</script>

<template>
  <div v-if="available.length > 0" class="grid gap-2 sm:grid-cols-2">
    <a
      v-for="name in available"
      :key="name"
      :href="`/auth/${name}`"
      :class="buttonClass('secondary', 'md', 'w-full')"
    >
      <Icon :name="PROVIDERS[name].icon" class="size-4" />
      {{ PROVIDERS[name].label }}
    </a>
  </div>
</template>
