<script setup lang="ts">
import { Head, useForm } from "@inertiajs/vue3";
import AppLayout from "../Layouts/AppLayout.vue";
import Button from "../Components/Button.vue";
import Card from "../Components/Card.vue";
import TextField from "../Components/TextField.vue";

defineOptions({ layout: AppLayout });

// Token and email arrive on the query string of the emailed link and ride along
// in the form, so the POST carries everything the server needs to verify it
// without trusting the session.
const props = defineProps<{ title: string; token: string; email: string }>();

const form = useForm({
  token: props.token,
  email: props.email,
  password: "",
  password_confirmation: "",
});
</script>

<template>
  <Head :title="title" />

  <div class="mx-auto max-w-md">
    <header>
      <h1 class="text-3xl font-bold tracking-tight text-balance">{{ title }}</h1>
      <p class="mt-2 text-muted-foreground">Resetting the password for {{ email }}.</p>
    </header>

    <Card class="mt-8 p-6 sm:p-8">
      <form class="space-y-5" @submit.prevent="form.post('/reset-password')">
        <TextField
          v-model="form.password"
          label="New password"
          type="password"
          autocomplete="new-password"
          hint="At least 8 characters."
          :error="form.errors.password"
          required
        />
        <TextField
          v-model="form.password_confirmation"
          label="Confirm password"
          type="password"
          autocomplete="new-password"
          :error="form.errors.password_confirmation"
          required
        />

        <Button type="submit" :disabled="form.processing">
          {{ form.processing ? "Updating…" : "Update password" }}
        </Button>
      </form>
    </Card>
  </div>
</template>
