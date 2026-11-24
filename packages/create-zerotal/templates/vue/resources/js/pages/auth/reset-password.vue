<script setup lang="ts">
import { Head, useForm } from "@inertiajs/vue3";
import AuthLayout from "../../Layouts/AuthLayout.vue";
import Button from "../../Components/Button.vue";
import TextField from "../../Components/TextField.vue";

const props = defineProps<{
  title: string;
  /** Both arrive on the query string of the emailed link. */
  token: string;
  email: string;
}>();

// Token and email ride along with the new password, so the POST carries everything the
// server needs to check the link without trusting the session.
const form = useForm({
  token: props.token,
  email: props.email,
  password: "",
  password_confirmation: "",
});

function submit() {
  form.post(route("reset-password.store"), {
    onFinish: () => form.reset("password", "password_confirmation"),
  });
}
</script>

<template>
  <Head :title="title" />

  <AuthLayout title="Choose a new password">
    <form class="space-y-5" @submit.prevent="submit">
      <TextField v-model="form.email" label="Email" type="email" readonly />
      <TextField
        v-model="form.password"
        label="New password"
        type="password"
        autocomplete="new-password"
        autofocus
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

      <Button type="submit" class="w-full" :disabled="form.processing">
        {{ form.processing ? "Saving…" : "Save new password" }}
      </Button>
    </form>
  </AuthLayout>
</template>
