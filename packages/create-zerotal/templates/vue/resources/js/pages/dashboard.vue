<script setup lang="ts">
import { Head, Link } from "@inertiajs/vue3";
import AppLayout from "../Layouts/AppLayout.vue";
import Button from "../Components/Button.vue";
import Card from "../Components/Card.vue";
import CardHeader from "../Components/CardHeader.vue";
import EmptyState from "../Components/EmptyState.vue";
import Icon from "../Components/Icon.vue";
import PageHeader from "../Components/PageHeader.vue";
import ProjectStatusBadge from "../Components/ProjectStatusBadge.vue";
import { timeAgo } from "../lib/format";
import type { IconName } from "../lib/icons";
import type { Project } from "../types";

defineOptions({ layout: AppLayout });

const props = defineProps<{
  title: string;
  greeting: string;
  stats: { total: number; active: number; completed: number };
  recentProjects: Project[];
}>();

const STATS: { label: string; key: keyof typeof props.stats; icon: IconName }[] = [
  { label: "Projects", key: "total", icon: "folder" },
  { label: "Active", key: "active", icon: "bolt" },
  { label: "Completed", key: "completed", icon: "check" },
];
</script>

<template>
  <Head :title="title" />

  <PageHeader :title="greeting" description="Here is where your projects stand.">
    <template #actions>
      <Button :href="route('projects.create')">
        <Icon name="plus" class="size-4" />
        New project
      </Button>
    </template>
  </PageHeader>

  <div class="grid gap-4 sm:grid-cols-3">
    <Card v-for="stat in STATS" :key="stat.key" class="flex items-center gap-4 p-5">
      <div
        class="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"
      >
        <Icon :name="stat.icon" class="size-5" />
      </div>
      <div>
        <p class="text-sm text-muted-foreground">{{ stat.label }}</p>
        <p class="text-2xl font-semibold tabular-nums">{{ stats[stat.key] }}</p>
      </div>
    </Card>
  </div>

  <div class="mt-8">
    <EmptyState
      v-if="recentProjects.length === 0"
      icon="folder"
      title="Start your first project"
      description="Projects are the example resource in this app: a list, a form, and a policy that keeps each one private to its owner. Make one to see it all work."
    >
      <template #action>
        <Button :href="route('projects.create')">
          <Icon name="plus" class="size-4" />
          Create a project
        </Button>
      </template>
    </EmptyState>

    <Card v-else>
      <CardHeader title="Recently updated">
        <template #actions>
          <Link :href="route('projects')" class="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        </template>
      </CardHeader>
      <ul class="mt-4 divide-y divide-border border-t border-border">
        <li v-for="project in recentProjects" :key="project.id">
          <Link
            :href="route('projects.edit', { project: project.id })"
            class="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/50 sm:px-6"
          >
            <span class="min-w-0 flex-1 truncate font-medium">{{ project.name }}</span>
            <ProjectStatusBadge :status="project.status" />
            <span class="hidden w-28 shrink-0 text-right text-sm text-muted-foreground sm:block">
              {{ timeAgo(project.updatedAt) }}
            </span>
          </Link>
        </li>
      </ul>
    </Card>
  </div>
</template>
