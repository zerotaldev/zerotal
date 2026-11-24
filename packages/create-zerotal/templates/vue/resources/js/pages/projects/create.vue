<script setup lang="ts">
import { Head } from "@inertiajs/vue3";
import AppLayout from "../../Layouts/AppLayout.vue";
import PageHeader from "../../Components/PageHeader.vue";
import ProjectForm from "../../Components/ProjectForm.vue";

defineOptions({ layout: AppLayout });
defineProps<{ title: string }>();
</script>

<template>
  <Head :title="title" />
  <div class="max-w-2xl">
    <PageHeader title="New project" :back="{ href: route('projects'), label: 'Projects' }" />
    <ProjectForm />
  </div>
</template>
