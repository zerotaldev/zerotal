<script setup lang="ts">
/**
 * A button, or — given `href` — an Inertia link styled as one, so a nav action and a form
 * submit can't drift apart. The styles live in lib/button.ts.
 */
import { computed } from "vue";
import { Link } from "@inertiajs/vue3";
import { buttonClass, type ButtonSize, type ButtonVariant } from "../lib/button";

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant | undefined;
    size?: ButtonSize | undefined;
    type?: "button" | "submit" | "reset" | undefined;
    disabled?: boolean | undefined;
    /** Render a link to this URL instead of a button. */
    href?: string | undefined;
  }>(),
  { variant: "primary", size: "md", type: "button", disabled: false },
);

const classes = computed(() => buttonClass(props.variant, props.size));
</script>

<template>
  <Link v-if="href" :href="href" :class="classes"><slot /></Link>
  <button v-else :type="type" :disabled="disabled" :class="classes"><slot /></button>
</template>
