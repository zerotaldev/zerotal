<script setup lang="ts">
/**
 * A labelled text input with its error and hint wired up. Pass `:error="form.errors.email"`
 * straight from `useForm()`. Other attributes (type, autocomplete, required…) go to the
 * input.
 */
import Field from "./Field.vue";
import Input from "./Input.vue";

defineOptions({ inheritAttrs: false });
defineProps<{ label: string; error?: string | undefined; hint?: string | undefined }>();
const model = defineModel<string>({ default: "" });
</script>

<template>
  <Field :label="label" :error="error" :hint="hint">
    <!-- Shown to the right of the label — a "Forgot password?" link, say. -->
    <template v-if="$slots.aside" #aside><slot name="aside" /></template>
    <template #default="control">
      <Input v-model="model" v-bind="{ ...$attrs, ...control }" />
    </template>
  </Field>
</template>
