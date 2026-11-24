<script setup lang="ts">
/** A bare multi-line input, styled like Input. */
import { computed, useAttrs } from "vue";
import { CONTROL, controlBorder } from "../lib/button";
import { cn } from "../lib/cn";

defineOptions({ inheritAttrs: false });
const model = defineModel<string>({ default: "" });
const attrs = useAttrs();
const classes = computed(() =>
  cn(
    CONTROL,
    "resize-y",
    controlBorder(attrs["aria-invalid"] === true || attrs["aria-invalid"] === "true"),
  ),
);
</script>

<template>
  <textarea v-model="model" rows="5" v-bind="attrs" :class="[classes, attrs.class]" />
</template>
