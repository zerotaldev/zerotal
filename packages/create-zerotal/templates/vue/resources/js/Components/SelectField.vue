<script setup lang="ts">
/** A labelled select with its error and hint wired up. */
import Field from "./Field.vue";
import Select from "./Select.vue";

defineOptions({ inheritAttrs: false });
defineProps<{
  label: string;
  options: readonly { value: string; label: string }[];
  error?: string | undefined;
  hint?: string | undefined;
}>();
const model = defineModel<string>({ default: "" });
</script>

<template>
  <Field v-slot="control" :label="label" :error="error" :hint="hint">
    <Select v-model="model" :options="options" v-bind="{ ...$attrs, ...control }" />
  </Field>
</template>
