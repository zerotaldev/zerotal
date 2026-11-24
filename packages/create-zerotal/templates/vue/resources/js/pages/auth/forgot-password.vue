<script setup lang="ts">
import { Head, Link, useForm } from "@inertiajs/vue3";
import AuthLayout from "../../Layouts/AuthLayout.vue";
import Button from "../../Components/Button.vue";
import TextField from "../../Components/TextField.vue";

defineProps<{
  title: string;
  /** Mail is printed by the server rather than sent (MAIL_DRIVER=log). */
  mailIsLogged: boolean;
}>();

const form = useForm({ email: "" });
</script>

<template>
  <Head :title="title" />

  <AuthLayout
    title="Forgot your password?"
    description="Enter the address you signed up with and we will send you a link to choose a new one."
  >
    <form class="space-y-5" @submit.prevent="form.post(route('forgot-password.store'))">
      <TextField
        v-model="form.email"
        label="Email"
        type="email"
        autocomplete="email"
        autofocus
        :hint="
          mailIsLogged
            ? 'Mail is printed in the terminal running the server, not sent (MAIL_DRIVER=log).'
            : undefined
        "
        :error="form.errors.email"
        required
      />

      <Button type="submit" class="w-full" :disabled="form.processing">
        {{ form.processing ? "Sending…" : "Email me a reset link" }}
      </Button>
    </form>

    <template #footer>
      <Link :href="route('login')" class="font-medium text-primary hover:underline"
        >Back to sign in</Link
      >
    </template>
  </AuthLayout>
</template>
