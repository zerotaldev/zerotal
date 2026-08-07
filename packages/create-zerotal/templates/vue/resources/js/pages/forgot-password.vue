<script setup lang="ts">
import { Head, Link, useForm } from "@inertiajs/vue3";
import AppLayout from "../Layouts/AppLayout.vue";
import Button from "../Components/Button.vue";
import Card from "../Components/Card.vue";
import TextField from "../Components/TextField.vue";

defineOptions({ layout: AppLayout });
defineProps<{ title: string }>();

const form = useForm({ email: "" });
</script>

<template>
  <Head :title="title" />

  <div class="mx-auto max-w-md">
    <header>
      <h1 class="text-3xl font-bold tracking-tight text-balance">{{ title }}</h1>
      <p class="mt-2 text-muted-foreground">
        Give us the address you signed up with and we will send a link.
      </p>
    </header>

    <Card class="mt-8 p-6 sm:p-8">
      <form class="space-y-5" @submit.prevent="form.post('/forgot-password')">
        <TextField
          v-model="form.email"
          label="Email"
          type="email"
          autocomplete="email"
          hint="In development the link is written to the server log rather than emailed."
          :error="form.errors.email"
          required
        />

        <Button type="submit" :disabled="form.processing">
          {{ form.processing ? "Sending…" : "Send reset link" }}
        </Button>
      </form>
    </Card>

    <p class="mt-6 text-sm text-muted-foreground">
      <Link href="/login" class="text-accent hover:underline">Back to sign in</Link>
    </p>
  </div>
</template>
