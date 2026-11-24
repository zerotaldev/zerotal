<script setup lang="ts">
/**
 * A bare text input, styled — for where the label lives elsewhere (a search box). For a
 * labelled control with its error wired up, use TextField.
 */
import { computed, useAttrs } from "vue";
import { CONTROL, controlBorder } from "../lib/button";
import { cn } from "../lib/cn";

defineOptions({ inheritAttrs: false });
const model = defineModel<string>({ default: "" });
const attrs = useAttrs();
const classes = computed(() =>
  cn(CONTROL, controlBorder(attrs["aria-invalid"] === true || attrs["aria-invalid"] === "true")),
);
</script>

<template>
  <input v-model="model" v-bind="attrs" :class="[classes, attrs.class]" />
</template>
