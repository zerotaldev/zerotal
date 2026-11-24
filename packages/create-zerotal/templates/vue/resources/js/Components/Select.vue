<script setup lang="ts">
/**
 * A native `<select>`, styled to match the inputs. Native on purpose: it is keyboard- and
 * screen-reader-accessible for free, and on a phone it opens the system picker.
 */
import { computed, useAttrs } from "vue";
import Icon from "./Icon.vue";
import { CONTROL, controlBorder } from "../lib/button";
import { cn } from "../lib/cn";

defineOptions({ inheritAttrs: false });
defineProps<{ options: readonly { value: string; label: string }[] }>();
const model = defineModel<string>({ default: "" });
const attrs = useAttrs();
const classes = computed(() =>
  cn(
    CONTROL,
    "appearance-none pr-9",
    controlBorder(attrs["aria-invalid"] === true || attrs["aria-invalid"] === "true"),
  ),
);
</script>

<template>
  <div class="relative">
    <select v-model="model" v-bind="attrs" :class="classes">
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <Icon
      name="chevron-down"
      class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
</template>
