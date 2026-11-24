<script setup lang="ts">
/**
 * The create and edit form, which differ only in where they send the data and what the
 * button says. Part of the example resource.
 */
import { Link, useForm } from "@inertiajs/vue3";
import Button from "./Button.vue";
import Card from "./Card.vue";
import CardBody from "./CardBody.vue";
import CardFooter from "./CardFooter.vue";
import SelectField from "./SelectField.vue";
import TextAreaField from "./TextAreaField.vue";
import TextField from "./TextField.vue";
import type { Project, ProjectStatus } from "../types";

const props = defineProps<{ project?: Project | undefined }>();

const STATUS_OPTIONS = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
] as const;

const form = useForm({
  name: props.project?.name ?? "",
  description: props.project?.description ?? "",
  status: (props.project?.status ?? "planning") as ProjectStatus,
});

function submit() {
  if (props.project) form.put(route("projects.update", { project: props.project.id }));
  else form.post(route("projects.store"));
}
</script>

<template>
  <Card>
    <form @submit.prevent="submit">
      <CardBody class="space-y-5">
        <TextField v-model="form.name" label="Name" autofocus :error="form.errors.name" required />
        <TextAreaField
          v-model="form.description"
          label="Description"
          hint="Optional. What it is, and what done looks like."
          rows="4"
          :error="form.errors.description"
        />
        <SelectField
          v-model="form.status"
          label="Status"
          :options="STATUS_OPTIONS"
          :error="form.errors.status"
        />
      </CardBody>
      <CardFooter>
        <Link
          :href="route('projects')"
          class="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Link>
        <Button type="submit" :disabled="form.processing">
          {{ form.processing ? "Saving…" : project ? "Save changes" : "Create project" }}
        </Button>
      </CardFooter>
    </form>
  </Card>
</template>
