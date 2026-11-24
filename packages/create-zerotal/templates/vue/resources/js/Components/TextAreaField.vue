<script setup lang="ts">
/**
 * A labelled multi-line input with its error and hint wired up. Pass `:error="form.errors.email"`
 * straight from `useForm()`. Other attributes (type, autocomplete, required…) go to the
 * input.
 */
import Field from "./Field.vue";
import Textarea from "./Textarea.vue";

defineOptions({ inheritAttrs: false });
defineProps<{ label: string; error?: string | undefined; hint?: string | undefined }>();
const model = defineModel<string>({ default: "" });
</script>

<template>
  <Field v-slot="control" :label="label" :error="error" :hint="hint">
    <Textarea v-model="model" v-bind="{ ...$attrs, ...control }" />
  </Field>
</template>
