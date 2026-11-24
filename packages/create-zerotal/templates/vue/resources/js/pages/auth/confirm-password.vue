<script setup lang="ts">
import { Head, Link, useForm } from "@inertiajs/vue3";
import AuthLayout from "../../Layouts/AuthLayout.vue";
import Button from "../../Components/Button.vue";
import TextField from "../../Components/TextField.vue";

defineProps<{ title: string }>();

const form = useForm({ password: "" });
</script>

<template>
  <Head :title="title" />

  <AuthLayout
    title="Confirm your password"
    description="This is a secure area. Enter your password to continue — you won't be asked again for a few hours."
  >
    <form
      class="space-y-5"
      @submit.prevent="form.post(route('confirm-password.store'), { onFinish: () => form.reset() })"
    >
      <TextField
        v-model="form.password"
        label="Password"
        type="password"
        autocomplete="current-password"
        autofocus
        :error="form.errors.password"
        required
      />

      <Button type="submit" class="w-full" :disabled="form.processing">
        {{ form.processing ? "Checking…" : "Confirm" }}
      </Button>
    </form>

    <template #footer>
      <Link :href="route('settings')" class="font-medium text-primary hover:underline"
        >Back to settings</Link
      >
    </template>
  </AuthLayout>
</template>
