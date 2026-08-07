<script setup lang="ts">
/**
 * Labelled text input with error and hint slots — the Vue twin of the React
 * template's TextField, including its accessibility wiring: the label points at
 * the control, and an error is announced via role="alert" and aria-describedby.
 */
import { computed, useId } from "vue";
import { cn } from "../lib/cn";

const props = withDefaults(
  defineProps<{
    label: string;
    modelValue: string;
    error?: string | undefined;
    hint?: string | undefined;
    type?: string;
    autocomplete?: string;
    required?: boolean;
    class?: string;
  }>(),
  { type: "text", required: false },
);

defineEmits<{ "update:modelValue": [value: string] }>();

const uid = useId();
const controlId = `${uid}-control`;
const errorId = `${uid}-error`;
const hintId = `${uid}-hint`;

const CONTROL =
  "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-sm " +
  "transition-colors placeholder:text-muted-foreground focus:outline-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const controlClass = computed(() =>
  cn(CONTROL, props.error ? "border-destructive" : "border-input", props.class),
);
</script>

<template>
  <div class="space-y-1.5">
    <label :for="controlId" class="block text-sm font-medium text-foreground">
      {{ label }}
    </label>

    <input
      :id="controlId"
      :type="type"
      :value="modelValue"
      :autocomplete="autocomplete"
      :required="required"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="error ? errorId : hint ? hintId : undefined"
      :class="controlClass"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />

    <p v-if="error" :id="errorId" role="alert" class="text-sm text-destructive">
      {{ error }}
    </p>
    <p v-else-if="hint" :id="hintId" class="text-sm text-muted-foreground">
      {{ hint }}
    </p>
  </div>
</template>
