<script setup lang="ts">
import { Head, Link, useForm, usePage } from "@inertiajs/vue3";
import AppLayout from "../Layouts/AppLayout.vue";
import Button from "../Components/Button.vue";
import Card from "../Components/Card.vue";
import TextField from "../Components/TextField.vue";
import type { SharedProps } from "../types";

defineOptions({ layout: AppLayout });
defineProps<{ title: string }>();

const old = usePage<SharedProps>().props.old;

const form = useForm({
  name: typeof old["name"] === "string" ? old["name"] : "",
  email: typeof old["email"] === "string" ? old["email"] : "",
  password: "",
  password_confirmation: "",
});
</script>

<template>
  <Head :title="title" />

  <div class="mx-auto max-w-md">
    <header>
      <h1 class="text-3xl font-bold tracking-tight text-balance">{{ title }}</h1>
      <p class="mt-2 text-muted-foreground">It takes about ten seconds.</p>
    </header>

    <Card class="mt-8 p-6 sm:p-8">
      <form class="space-y-5" @submit.prevent="form.post('/register')">
        <TextField
          v-model="form.name"
          label="Name"
          autocomplete="name"
          :error="form.errors.name"
          required
        />
        <TextField
          v-model="form.email"
          label="Email"
          type="email"
          autocomplete="email"
          :error="form.errors.email"
          required
        />
        <TextField
          v-model="form.password"
          label="Password"
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
          {{ form.processing ? "Creating…" : "Create account" }}
        </Button>
      </form>
    </Card>

    <p class="mt-6 text-sm text-muted-foreground">
      Already registered?
      <Link :href="route('login')" class="text-accent hover:underline">Sign in</Link>
    </p>
  </div>
</template>
