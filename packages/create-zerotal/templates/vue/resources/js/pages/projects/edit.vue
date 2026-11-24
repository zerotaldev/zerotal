<script setup lang="ts">
import { Head } from "@inertiajs/vue3";
import AppLayout from "../../Layouts/AppLayout.vue";
import PageHeader from "../../Components/PageHeader.vue";
import ProjectForm from "../../Components/ProjectForm.vue";
import type { Project } from "../../types";

defineOptions({ layout: AppLayout });
defineProps<{ title: string; project: Project }>();
</script>

<template>
  <Head :title="title" />
  <div class="max-w-2xl">
    <PageHeader :title="project.name" :back="{ href: route('projects'), label: 'Projects' }" />
    <ProjectForm :project="project" />
  </div>
</template>
