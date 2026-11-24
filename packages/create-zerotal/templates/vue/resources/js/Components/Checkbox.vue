<script setup lang="ts">
/**
 * A checkbox with its label. The whole label is the click target, and the box uses the
 * theme's primary colour through `accent-color`, so it stays a real checkbox.
 */
import { useId } from "vue";

defineProps<{ label: string; description?: string | undefined }>();
const model = defineModel<boolean>({ default: false });
const id = useId();
</script>

<template>
  <div class="flex items-start gap-2.5">
    <input
      :id="id"
      v-model="model"
      type="checkbox"
      :aria-describedby="description ? `${id}-description` : undefined"
      class="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
    />
    <div class="text-sm leading-5">
      <label :for="id" class="font-medium text-foreground">{{ label }}</label>
      <p v-if="description" :id="`${id}-description`" class="text-muted-foreground">
        {{ description }}
      </p>
    </div>
  </div>
</template>
