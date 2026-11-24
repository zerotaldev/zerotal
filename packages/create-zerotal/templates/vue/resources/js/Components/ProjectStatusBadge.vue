<script setup lang="ts">
/** A project's status as a coloured label. Part of the example resource. */
import Badge from "./Badge.vue";
import type { ProjectStatus } from "../types";

defineProps<{ status: ProjectStatus }>();

const TONE = { planning: "neutral", active: "primary", completed: "success" } as const;
const LABEL: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  completed: "Completed",
};
</script>

<template>
  <Badge :tone="TONE[status]">{{ LABEL[status] }}</Badge>
</template>
