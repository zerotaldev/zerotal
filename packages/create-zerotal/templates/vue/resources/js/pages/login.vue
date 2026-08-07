<script setup lang="ts">
import { Head, Link, useForm, usePage } from "@inertiajs/vue3";
import AppLayout from "../Layouts/AppLayout.vue";
import Button from "../Components/Button.vue";
import Card from "../Components/Card.vue";
import TextField from "../Components/TextField.vue";
import type { SharedProps } from "../types";

defineOptions({ layout: AppLayout });
defineProps<{ title: string }>();

const page = usePage<SharedProps>();
const old = page.props.old;

const form = useForm({
  email: typeof old["email"] === "string" ? old["email"] : "",
  password: "",
  remember: false,
});
</script>

<template>
  <Head :title="title" />

  <div class="mx-auto max-w-md">
    <header>
      <h1 class="text-3xl font-bold tracking-tight text-balance">{{ title }}</h1>
      <p class="mt-2 text-muted-foreground">Enter your details to continue.</p>
    </header>

    <Card class="mt-8 p-6 sm:p-8">
      <form class="space-y-5" @submit.prevent="form.post('/login')">
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
          autocomplete="current-password"
          :error="form.errors.password"
          required
        />

        <label class="flex items-center gap-2 text-sm text-muted-foreground">
          <input v-model="form.remember" type="checkbox" class="rounded border-input" />
          Remember me
        </label>

        <Button type="submit" :disabled="form.processing">
          {{ form.processing ? "Signing in…" : "Sign in" }}
        </Button>
      </form>
    </Card>

    <div class="mt-6 flex items-center justify-between text-sm">
      <Link href="/forgot-password" class="text-accent hover:underline">Forgot your password?</Link>
      <Link href="/register" class="text-accent hover:underline">Create an account</Link>
    </div>
  </div>
</template>
