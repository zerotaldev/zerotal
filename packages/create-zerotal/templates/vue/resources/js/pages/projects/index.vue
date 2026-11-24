<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, Link, router } from "@inertiajs/vue3";
import AppLayout from "../../Layouts/AppLayout.vue";
import Button from "../../Components/Button.vue";
import Card from "../../Components/Card.vue";
import EmptyState from "../../Components/EmptyState.vue";
import Icon from "../../Components/Icon.vue";
import Input from "../../Components/Input.vue";
import Modal from "../../Components/Modal.vue";
import PageHeader from "../../Components/PageHeader.vue";
import Pagination from "../../Components/Pagination.vue";
import ProjectStatusBadge from "../../Components/ProjectStatusBadge.vue";
import { timeAgo } from "../../lib/format";
import type { Pagination as PaginationData, Project } from "../../types";

defineOptions({ layout: AppLayout });

const props = defineProps<{
  title: string;
  projects: Project[];
  pagination: PaginationData;
  search: string;
}>();

/** /projects?search=…&page=…, leaving out what is empty. */
function listUrl(search: string, page = 1): string {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return route("projects") + (query ? `?${query}` : "");
}

// Search as the user types, a beat after they stop. `preserveState` keeps the input
// focused, and `replace` keeps every keystroke out of the back button's history.
const query = ref(props.search);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(query, (value) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    router.get(
      listUrl(value.trim()),
      {},
      { preserveState: true, preserveScroll: true, replace: true },
    );
  }, 250);
});

const filtered = computed(() => props.search !== "");
const deleting = ref<Project | null>(null);

function destroy() {
  if (!deleting.value) return;
  router.delete(route("projects.destroy", { project: deleting.value.id }), {
    preserveScroll: true,
    onFinish: () => (deleting.value = null),
  });
}
</script>

<template>
  <Head :title="title" />

  <PageHeader title="Projects" description="Everything you are working on, in one place.">
    <template #actions>
      <Button :href="route('projects.create')">
        <Icon name="plus" class="size-4" />
        New project
      </Button>
    </template>
  </PageHeader>

  <EmptyState
    v-if="pagination.total === 0 && !filtered"
    icon="folder"
    title="No projects yet"
    description="Projects are where your work lives. Create the first one to see how the list, the form and the policy fit together."
  >
    <template #action>
      <Button :href="route('projects.create')">
        <Icon name="plus" class="size-4" />
        Create a project
      </Button>
    </template>
  </EmptyState>

  <div v-else class="space-y-4">
    <div class="relative max-w-sm">
      <Icon
        name="search"
        class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        v-model="query"
        type="search"
        aria-label="Search projects"
        placeholder="Search by name or description"
        class="pl-9"
      />
    </div>

    <EmptyState
      v-if="projects.length === 0"
      icon="search"
      title="No matches"
      :description="`Nothing matches “${search}”.`"
    >
      <template #action>
        <Button variant="secondary" @click="query = ''">Clear the search</Button>
      </template>
    </EmptyState>

    <Card v-else class="overflow-hidden">
      <ul class="divide-y divide-border">
        <li
          v-for="project in projects"
          :key="project.id"
          class="flex items-center gap-4 px-4 py-4 sm:px-5"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <Link
                :href="route('projects.edit', { project: project.id })"
                class="truncate font-medium hover:underline"
              >
                {{ project.name }}
              </Link>
              <ProjectStatusBadge :status="project.status" />
            </div>
            <p v-if="project.description" class="mt-0.5 truncate text-sm text-muted-foreground">
              {{ project.description }}
            </p>
          </div>
          <p class="hidden shrink-0 text-sm text-muted-foreground sm:block">
            Updated {{ timeAgo(project.updatedAt) }}
          </p>
          <div class="flex shrink-0 gap-1">
            <Button
              :href="route('projects.edit', { project: project.id })"
              variant="ghost"
              size="icon"
              :aria-label="`Edit ${project.name}`"
            >
              <Icon name="pencil" class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              :aria-label="`Delete ${project.name}`"
              @click="deleting = project"
            >
              <Icon name="trash" class="size-4" />
            </Button>
          </div>
        </li>
      </ul>
    </Card>

    <Pagination :pagination="pagination" :href="(page) => listUrl(search, page)" noun="projects" />
  </div>

  <Modal
    :open="deleting !== null"
    :title="`Delete “${deleting?.name ?? ''}”?`"
    description="The project is removed for good. This cannot be undone."
    @close="deleting = null"
  >
    <template #footer>
      <Button variant="secondary" @click="deleting = null">Cancel</Button>
      <Button variant="danger" @click="destroy">Delete project</Button>
    </template>
  </Modal>
</template>
