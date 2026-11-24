<script setup lang="ts">
/**
 * The label, hint and error around a form control — the accessibility plumbing you
 * would otherwise retype on every form. The control goes in the default slot, which
 * receives the ids and ARIA attributes to bind:
 *
 *   <Field label="Email" :error="form.errors.email" v-slot="control">
 *     <Input v-bind="control" v-model="form.email" type="email" />
 *   </Field>
 *
 * TextField, TextAreaField and SelectField are that, already put together.
 */
import { computed, useId } from "vue";

const props = defineProps<{
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}>();

const id = `${useId()}-control`;
const errorId = `${id}-error`;
const hintId = `${id}-hint`;

const control = computed(() => ({
  id,
  "aria-invalid": props.error ? true : undefined,
  "aria-describedby": props.error ? errorId : props.hint ? hintId : undefined,
}));
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-baseline justify-between gap-3">
      <label :for="id" class="block text-sm font-medium text-foreground">{{ label }}</label>
      <slot name="aside" />
    </div>

    <slot v-bind="control" />

    <p v-if="error" :id="errorId" class="text-sm text-destructive">{{ error }}</p>
    <p v-else-if="hint" :id="hintId" class="text-sm text-muted-foreground">{{ hint }}</p>
  </div>
</template>
