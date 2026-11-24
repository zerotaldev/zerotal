<script setup lang="ts">
/** The logo mark and the app's name, as config/app.ts sets it. */
import { useAppName } from "../lib/site";

withDefaults(defineProps<{ hideName?: boolean | undefined }>(), { hideName: false });
const name = useAppName();
</script>

<template>
  <span class="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight">
    <img src="/zt.svg" alt="" class="size-8 shrink-0 rounded-lg" />
    <span :class="hideName ? 'sr-only' : 'truncate'">{{ name }}</span>
  </span>
</template>
